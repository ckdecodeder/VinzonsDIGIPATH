"""
DigiPath mechanical sequence — TB6600 lift + sort with YS-27 hall sensors.

Physical halls (Hall #3 scanner REMOVED):
  1 door (GPIO 5) — safety: must be CLOSED before SORT (no auto motor on close)
  2 main/layer1 (GPIO 6)
  4 layer2 (GPIO 19)
  5 layer3 (GPIO 12)

Confirm & Register (SORT) sequence:
  0. Require hall #1 door closed (if wired)
  1. Lift UP or DOWN until target layer hall (#2 / #4 / #5)
  2. Sort carousel deposit rotate
  3. Lift until main hall #2

Capture button = photo/upload only (no motors).
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

from digipath_hall_ys27 import (
    DOOR,
    LAYER_1,
    LAYER_2,
    LAYER_3,
    LAYER_TO_SENSOR,
    LIFT_AXIS_RANK,
    MAIN,
    PHYSICAL_HALL_NO,
    SENSOR_LABELS,
    HallReading,
    build_default_bank,
    layer_has_hall,
)
from digipath_tb6600 import LiftAxis, SortAxis, _env_bool, _env_int


def _clamp_layer(value) -> int:
    try:
        layer = int(value)
    except (TypeError, ValueError):
        layer = 1
    return max(1, min(3, layer))


def _detect_pin_factory() -> str:
    try:
        from gpiozero import Device

        factory = Device.pin_factory
        return type(factory).__name__ if factory is not None else "none"
    except Exception as err:
        return f"unknown ({err})"


def _read_pi_model() -> str:
    try:
        with open("/proc/device-tree/model", "rb") as fh:
            return fh.read().decode("utf-8", "ignore").strip("\x00 \n")
    except OSError:
        return ""


def _parse_lift_dir(name: str, default: str = "down") -> str:
    value = os.environ.get(name, default).strip().lower()
    if value in ("up", "u", "raise", "ascend"):
        return "up"
    return "down"


# Physical tray mapping:
#   Layer 1 = Memorandum (DT-001)
#   Layer 2 = Executive Order (DT-002)
#   Layer 3 = Communication Letter (DT-003)
DOCUMENT_TYPE_LAYER_MAP = {
    "DT-001": 1,
    "DT-002": 2,
    "DT-003": 3,
}


def resolve_sort_layer(payload: dict | None) -> int:
    payload = payload or {}
    if payload.get("sortLayer") is not None:
        return _clamp_layer(payload.get("sortLayer"))
    doc_type = str(payload.get("documentTypeId") or "").strip()
    if doc_type in DOCUMENT_TYPE_LAYER_MAP:
        return DOCUMENT_TYPE_LAYER_MAP[doc_type]
    priority = str(payload.get("priorityLevel") or "normal").strip().lower()
    if priority in ("urgent", "critical"):
        return 3
    if priority in ("high",):
        return 2
    return 1


@dataclass
class MechanismStatus:
    enabled: bool = False
    simulate: bool = False
    last_sort_layer: int = 0
    passed_layers: list[int] = field(default_factory=list)
    last_error: str = ""
    phase: str = "idle"
    door_closed: bool = False
    at_main: bool = False
    at_capture: bool = False


class DigipathMechanism:
    def __init__(self):
        # Capture-only mode: no hall sensors; lift down when Capture is pressed.
        # Default ON so scan matches motor test behavior unless explicitly disabled.
        self.enabled = _env_bool("DIGIPATH_MECH_ENABLED", "1") or _env_bool(
            "DIGIPATH_MOTOR_ENABLED", "0"
        )
        self.simulate = _env_bool("DIGIPATH_MECH_SIMULATE", "0")
        self.open_loop = _env_bool("DIGIPATH_MECH_OPEN_LOOP", "0")
        self.door_monitor_enabled = _env_bool("DIGIPATH_DOOR_MONITOR", "0")
        # Hall #1 door = safety gate before SORT (does NOT auto-move motors).
        self.sort_require_door_closed = _env_bool("DIGIPATH_SORT_REQUIRE_DOOR_CLOSED", "0")
        self.home_on_start = _env_bool("DIGIPATH_MECH_HOME_ON_START", "0")
        # Power-on jog: lift DOWN then UP (same steps), sort one direction.
        self.startup_test = _env_bool("DIGIPATH_MECH_STARTUP_TEST", "1")
        self.startup_test_lift_steps = max(0, _env_int("DIGIPATH_STARTUP_TEST_LIFT_STEPS", 400))
        self.startup_test_sort_steps = max(0, _env_int("DIGIPATH_STARTUP_TEST_SORT_STEPS", 400))
        # Sort carousel only ever turns one way (same as real sorting), so no return by default.
        self.startup_test_sort_return = _env_bool("DIGIPATH_STARTUP_TEST_SORT_RETURN", "0")
        self.startup_test_pause_secs = max(
            0.0, float(os.environ.get("DIGIPATH_STARTUP_TEST_PAUSE_SECS", "0.5"))
        )
        # Same speed as real lift/sort moves unless overridden, so a passing test proves real sorting.
        self.startup_test_step_delay_us = max(
            100,
            _env_int(
                "DIGIPATH_STARTUP_TEST_STEP_DELAY_US",
                _env_int("DIGIPATH_MOTOR_STEP_DELAY_US", 1500),
            ),
        )
        self.signal_mode = "sink" if _env_bool("DIGIPATH_TB6600_SIGNAL_SINK", "0") else "source"
        self.init_error = ""
        self.last_test: dict = {}
        self.pin_factory = ""
        self.pi_model = _read_pi_model()
        # After photo upload: sort rotate then lift up (same step size).
        self.sort_after_upload = _env_bool("DIGIPATH_MECH_SORT_AFTER_UPLOAD", "1")
        self.homed = False
        self.motor_settle_secs = max(0.0, float(os.environ.get("DIGIPATH_MOTOR_SETTLE_SECS", "2")))
        self.scan_settle_secs = max(0.0, float(os.environ.get("DIGIPATH_SCAN_SETTLE_SECS", "2")))
        self.lift_travel_max_steps = _env_int("DIGIPATH_LIFT_TRAVEL_MAX_STEPS", 14000)
        self.lift_down_max_steps = _env_int("DIGIPATH_LIFT_DOWN_MAX_STEPS", self.lift_travel_max_steps)
        self.lift_up_max_steps = _env_int("DIGIPATH_LIFT_UP_MAX_STEPS", self.lift_travel_max_steps)
        self.sort_max_steps = _env_int("DIGIPATH_SORT_MAX_STEPS", 10000)
        self.sort_chunk_steps = max(1, _env_int("DIGIPATH_SORT_CHUNK_STEPS", 6))
        self.step_delay_us = _env_int("DIGIPATH_MOTOR_STEP_DELAY_US", 1500)

        # One step size for: ikot/down / sort / up (tag 900)
        self.move_steps = max(
            1,
            _env_int(
                "DIGIPATH_MOVE_STEPS",
                _env_int("DIGIPATH_OPEN_LOOP_CAPTURE_STEPS", 900),
            ),
        )
        self.capture_down_count = max(1, _env_int("DIGIPATH_CAPTURE_DOWN_COUNT", 3))

        self.lift_to_capture_dir = _parse_lift_dir("DIGIPATH_LIFT_TO_CAPTURE_DIR", "down")
        self.lift_to_main_dir = _parse_lift_dir("DIGIPATH_LIFT_TO_MAIN_DIR", "up")
        self.lift_to_layer_dir = _parse_lift_dir("DIGIPATH_LIFT_TO_LAYER_DIR", "down")
        self.sort_deposit_steps = max(
            0, _env_int("DIGIPATH_SORT_DEPOSIT_STEPS", self.move_steps)
        )
        # Seconds the sort motor runs CW per document; overrides DIGIPATH_SORT_DEPOSIT_STEPS when > 0.
        try:
            self.sort_deposit_secs = max(0.0, float(os.environ.get("DIGIPATH_SORT_DEPOSIT_SECS", "10")))
        except ValueError:
            self.sort_deposit_secs = 10.0
        self.sort_forward = _env_bool("DIGIPATH_SORT_FORWARD", "1")
        self.open_loop_capture_steps = self.move_steps
        self.open_loop_main_steps = _env_int(
            "DIGIPATH_OPEN_LOOP_MAIN_STEPS",
            self.move_steps,
        )
        self.open_loop_layer_steps = {
            1: _env_int(
                "DIGIPATH_OPEN_LOOP_LAYER1_STEPS",
                _env_int("DIGIPATH_LAYER1_STEPS", 500),
            ),
            2: _env_int(
                "DIGIPATH_OPEN_LOOP_LAYER2_STEPS",
                _env_int("DIGIPATH_LAYER2_STEPS", 1000),
            ),
            3: _env_int(
                "DIGIPATH_OPEN_LOOP_LAYER3_STEPS",
                _env_int("DIGIPATH_LAYER3_STEPS", 1500),
            ),
        }
        layer2_steps = self.open_loop_layer_steps[2]
        layer3_steps = self.open_loop_layer_steps[3]
        self.layer_3_extra_steps = _env_int(
            "DIGIPATH_HALL_LAYER3_EXTRA_STEPS",
            max(200, layer3_steps - layer2_steps),
        )

        self._lock = threading.RLock()
        self._status = MechanismStatus(enabled=self.enabled, simulate=self.simulate)
        self._lift: LiftAxis | None = None
        self._sort: SortAxis | None = None
        self._halls = None
        self._stop = threading.Event()
        self._door_thread: threading.Thread | None = None
        self._door_was_closed = False
        self._on_door_closed: Callable[[], None] | None = None

        if not self.enabled:
            print(
                "[Mech] DISABLED — motors run in test-motors.sh only. "
                "Set DIGIPATH_MECH_ENABLED=1 in pi_ws_scanner.env to move on scan."
            )
            return

        down_high = _env_bool("DIGIPATH_LIFT_DOWN_DIR_HIGH", "1")
        # A GPIO failure must not crash the scanner — surface it in the dashboard instead.
        try:
            self._lift = LiftAxis(
                "lift",
                _env_int("DIGIPATH_LIFT_PUL_BCM", 17),
                _env_int("DIGIPATH_LIFT_DIR_BCM", 27),
                _env_int("DIGIPATH_LIFT_ENA_BCM", 22),
                down_is_dir_high=down_high,
                simulate=self.simulate,
            )
            self._sort = SortAxis(
                "sort",
                _env_int("DIGIPATH_SORT_PUL_BCM", 23),
                _env_int("DIGIPATH_SORT_DIR_BCM", 24),
                _env_int("DIGIPATH_SORT_ENA_BCM", 25),
                simulate=self.simulate,
            )
        except Exception as err:
            self.init_error = f"GPIO/motor driver init failed: {err}"
            self._status.last_error = self.init_error
            print(f"[Mech] {self.init_error}")
            for axis in (self._lift, self._sort):
                if axis:
                    axis.close()
            self._lift = self._sort = None
            return
        self.pin_factory = _detect_pin_factory() if not self.simulate else "simulate"
        # Sensors off for now (open-loop Capture → lift down only).
        self._halls = None
        if not self.open_loop:
            try:
                self._halls = build_default_bank(simulate=self.simulate)
                self._refresh_hall_flags()
            except Exception as err:
                self._halls = None
                self.open_loop = True
                print(f"[Mech] Hall init failed — forcing open-loop: {err}")

        if self.open_loop:
            return_steps = self.move_steps * self.capture_down_count
            print(
                f"[Mech] ENABLED — Capture: {self.capture_down_count}× DOWN "
                f"{self.move_steps} → photo → SORT {self.sort_deposit_steps} → UP "
                f"{return_steps} (sensors OFF)"
            )
        else:
            print(
                f"[Mech] ENABLED hall-guided "
                f"(simulate={int(self.simulate)} "
                f"lift PUL/DIR/ENA="
                f"{_env_int('DIGIPATH_LIFT_PUL_BCM', 17)}/"
                f"{_env_int('DIGIPATH_LIFT_DIR_BCM', 27)}/"
                f"{_env_int('DIGIPATH_LIFT_ENA_BCM', 22)})"
            )
            if self._halls:
                print(f"[Mech] Hall snapshot at start: {self._halls.read_all_labeled()}")

    def close(self):
        self._stop.set()
        if self._door_thread and self._door_thread.is_alive():
            self._door_thread.join(timeout=2)
        self._door_thread = None
        with self._lock:
            if self._lift:
                self._lift.close()
            if self._sort:
                self._sort.close()
            if self._halls:
                self._halls.close()
            self._lift = self._sort = self._halls = None

    def _refresh_hall_flags(self):
        if not self._halls:
            return
        self._status.door_closed = self._halls.is_triggered(DOOR)
        self._status.at_main = self._halls.is_triggered(MAIN)
        # Hall #3 removed — capture height is open-loop steps only.
        self._status.at_capture = self._status.phase in ("ready_for_scan", "to_capture")

    def status_dict(self) -> dict:
        with self._lock:
            self._refresh_hall_flags()
            return {
                "enabled": self._status.enabled,
                "simulate": self._status.simulate,
                "phase": self._status.phase,
                "doorClosed": self._status.door_closed,
                "atMain": self._status.at_main,
                "atCapture": self._status.at_capture,
                "halls": self._halls.read_all_labeled() if self._halls else {},
                "lastSortLayer": self._status.last_sort_layer,
                "passedLayers": list(self._status.passed_layers),
                "lastError": self._status.last_error,
                "liftToCaptureDir": self.lift_to_capture_dir,
                "liftToMainDir": self.lift_to_main_dir,
                "liftToLayerDir": self.lift_to_layer_dir,
                "openLoop": self.open_loop,
                "homed": self.homed,
                "homeOnStart": self.home_on_start,
                "startupTest": self.startup_test,
                "signalMode": self.signal_mode,
                "initError": self.init_error,
                "motorsReady": bool(self._lift and self._sort),
                "pinFactory": self.pin_factory,
                "piModel": self.pi_model,
                "lastTest": dict(self.last_test),
            }

    def _motor_pause(self, label: str = ""):
        if label:
            print(f"[Mech] Pause {self.motor_settle_secs:.0f}s — {label}")
        time.sleep(self.motor_settle_secs)

    def _ensure_ready(self):
        if not self.enabled or not self._lift or not self._sort:
            raise RuntimeError("Mechanism disabled or not initialized")
        if not self.open_loop and not self._halls:
            raise RuntimeError(
                "Hall sensors required for scan motors (or set DIGIPATH_MECH_OPEN_LOOP=1)"
            )

    def _hall_label(self, sensor_id: int) -> str:
        physical = PHYSICAL_HALL_NO.get(sensor_id, "?")
        name = SENSOR_LABELS.get(sensor_id, str(sensor_id))
        return f"#{physical} {name}"

    def _current_lift_sensor(self) -> int | None:
        """Which lift-axis hall is currently active (prefer lowest / farthest down)."""
        if not self._halls:
            return None
        active = [
            sid
            for sid, rank in LIFT_AXIS_RANK.items()
            if self._halls.is_triggered(sid) and int(self._halls.pin_map.get(sid, 0) or 0) > 0
        ]
        if not active:
            return None
        # Prefer unique BCM readings; MAIN and LAYER_1 share pin so either is fine.
        return max(active, key=lambda sid: LIFT_AXIS_RANK[sid])

    def _direction_to_sensor(self, target_sensor: int, *, fallback: str) -> str:
        """Pick up/down from current hall rank vs target — no guessing when halls work."""
        current = self._current_lift_sensor()
        if current is None:
            print(
                f"[Mech] No lift hall active now — fallback dir={fallback} "
                f"toward {self._hall_label(target_sensor)}"
            )
            return fallback
        cur_rank = LIFT_AXIS_RANK.get(current)
        tgt_rank = LIFT_AXIS_RANK.get(target_sensor)
        if cur_rank is None or tgt_rank is None:
            return fallback
        if cur_rank == tgt_rank:
            return "hold"
        direction = "down" if tgt_rank > cur_rank else "up"
        print(
            f"[Mech] Position: at {self._hall_label(current)} (rank {cur_rank}) → "
            f"{self._hall_label(target_sensor)} (rank {tgt_rank}) ⇒ {direction}"
        )
        return direction

    def _enable_lift_only(self, reason: str):
        print(f"[Mech] NEMA LIFT ENA=ON ({reason})")
        self._lift.set_enabled(True)
        self._sort.set_enabled(False)

    def _enable_sort_only(self, reason: str):
        print(f"[Mech] NEMA SORT ENA=ON ({reason})")
        self._sort.set_enabled(True)
        self._lift.set_enabled(False)

    def _move_lift_open_loop(self, direction: str, steps: int, label: str) -> int:
        count = max(0, int(steps))
        if count <= 0:
            return 0
        print(f"[Mech] Open-loop lift {direction} — {count} steps ({label})")
        step_fn = self._lift_step_fn(direction)
        return step_fn(count)

    def _move_lift_to_sort_layer(self, target_layer: int, *, on_sensor=None) -> int:
        """Hall-guided lift to sort layer (layer 3 = layer2 hall + extra steps if no hall)."""
        if target_layer == 3 and not layer_has_hall(self._halls.pin_map, 3):
            print(
                f"[Mech] Layer 3 has no hall — move to layer 2 hall, "
                f"then +{self.layer_3_extra_steps} steps"
            )
            total = 0
            if not self._halls.is_triggered(LAYER_2):
                total += self._move_lift_to_hall(
                    LAYER_2,
                    label="layer-2-for-layer-3",
                    fallback_dir=self.lift_to_layer_dir,
                    on_sensor=on_sensor,
                )
            direction = self._direction_to_sensor(LAYER_3, fallback=self.lift_to_layer_dir)
            if direction == "hold":
                direction = self.lift_to_layer_dir
            total += self._move_lift_open_loop(
                direction,
                self.layer_3_extra_steps,
                "layer-3-extra",
            )
            return total

        target_sensor = LAYER_TO_SENSOR[target_layer]
        return self._move_lift_to_hall(
            target_sensor,
            label=f"layer-{target_layer}",
            fallback_dir=self.lift_to_layer_dir,
            on_sensor=on_sensor,
        )

    def _run_sort_deposit(self, reason: str, *, steps: int | None = None) -> int:
        """Turn the sort motor CW — for sort_deposit_secs when set, otherwise a fixed step count."""
        self._enable_sort_only(reason)
        try:
            if self.sort_deposit_secs > 0:
                print(f"[Mech] Sort CW for {self.sort_deposit_secs:g}s ({reason})")
                deadline = time.monotonic() + self.sort_deposit_secs
                deposited = 0
                while time.monotonic() < deadline and not self._stop.is_set():
                    deposited += self._sort.step_sort(
                        50,
                        forward=self.sort_forward,
                        step_delay_us=self.step_delay_us,
                        stop_event=self._stop,
                    )
            else:
                count = self.sort_deposit_steps if steps is None else steps
                print(f"[Mech] Sort CW {count} steps ({reason})")
                deposited = self._sort.step_sort(
                    count,
                    forward=self.sort_forward,
                    step_delay_us=self.step_delay_us,
                    stop_event=self._stop,
                )
            print(f"[Mech] Sort done ({deposited} steps) — motor off")
            return deposited
        finally:
            self._sort.set_enabled(False)

    def _sensors_beyond(self, target_sensor: int, direction: str) -> set[int]:
        """Lift halls past the target in the travel direction — hitting one means overshoot."""
        target_rank = LIFT_AXIS_RANK.get(target_sensor)
        if target_rank is None or not self._halls:
            return set()
        target_bcm = int(self._halls.pin_map.get(target_sensor, 0) or 0)
        beyond = set()
        for sid, rank in LIFT_AXIS_RANK.items():
            bcm = int(self._halls.pin_map.get(sid, 0) or 0)
            if bcm <= 0 or bcm == target_bcm:
                continue
            if (direction == "down" and rank > target_rank) or (direction == "up" and rank < target_rank):
                beyond.add(sid)
        return beyond

    def _lift_step_fn(self, direction: str):
        if direction == "up":
            return lambda n: self._lift.step_up(n, step_delay_us=self.step_delay_us, stop_event=self._stop)
        return lambda n: self._lift.step_down(n, step_delay_us=self.step_delay_us, stop_event=self._stop)

    def _move_lift_to_hall(
        self,
        target_sensor: int,
        *,
        label: str,
        fallback_dir: str,
        on_sensor=None,
        direction: str | None = None,
    ) -> int:
        """Move lift until target hall triggers; direction from current hall position."""
        if self._halls.is_triggered(target_sensor):
            print(f"[Mech] Already at {self._hall_label(target_sensor)} — skip ({label})")
            self._refresh_hall_flags()
            return 0

        resolved = direction or self._direction_to_sensor(target_sensor, fallback=fallback_dir)
        if resolved == "hold":
            print(f"[Mech] Hold at same rank as {self._hall_label(target_sensor)} — skip")
            return 0

        # 0 = no step limit: keep turning until the target hall is detected.
        max_steps = self.lift_up_max_steps if resolved == "up" else self.lift_down_max_steps
        print(
            f"[Mech] CMD lift {resolved} → {self._hall_label(target_sensor)} "
            f"({label}, max_steps={max_steps or 'unlimited'})"
        )

        if self.simulate and not self._halls.is_triggered(target_sensor):
            sim_span = max_steps or 14000
            trigger_at = {
                MAIN: max(200, sim_span // 4),
                LAYER_2: max(400, sim_span // 2),
                LAYER_3: max(600, (sim_span * 3) // 4),
            }.get(target_sensor, max(200, sim_span // 3))
            start_pos = self._lift.simulated_position
            step_fn_base = self._lift_step_fn(resolved)

            def _sim_step(n: int) -> int:
                moved = step_fn_base(n)
                traveled = abs(self._lift.simulated_position - start_pos)
                if traveled >= trigger_at:
                    self._halls.simulate_trigger(target_sensor, True)
                return moved

            step_fn = _sim_step
        else:
            step_fn = self._lift_step_fn(resolved)

        # Keep turning until the target hall fires. A hall past the target (overshoot / wrong
        # start direction) reverses the lift, so it sweeps between halls instead of stopping.
        direction_now = resolved
        moved = 0
        passed: set[int] = set()
        while True:
            remaining = (max_steps - moved) if max_steps > 0 else 10**9
            if remaining <= 0:
                raise RuntimeError(
                    f"{self._hall_label(target_sensor)} not detected after {moved} "
                    f"lift steps — lift stopped (passed={sorted(passed)})"
                )
            stopped, leg_moved, leg_passed = self._halls.step_until(
                step_fn,
                stop_sensor=target_sensor,
                max_steps=remaining,
                chunk_steps=self.sort_chunk_steps,
                on_sensor=on_sensor,
                stop_event=self._stop,
                abort_sensors=self._sensors_beyond(target_sensor, direction_now),
            )
            moved += leg_moved
            passed |= leg_passed
            if stopped:
                break
            if self._stop.is_set():
                raise RuntimeError(f"Lift stopped (shutdown) before {self._hall_label(target_sensor)}")
            if leg_moved <= 0:
                raise RuntimeError(f"Lift motor did not step toward {self._hall_label(target_sensor)}")
            if max_steps > 0 and moved >= max_steps:
                continue
            direction_now = "up" if direction_now == "down" else "down"
            step_fn = self._lift_step_fn(direction_now)
            print(
                f"[Mech] Hall beyond {self._hall_label(target_sensor)} fired — "
                f"reversing {direction_now} and still searching ({moved} steps so far)"
            )
        print(
            f"[Mech] Reached {self._hall_label(target_sensor)} in {moved} steps "
            f"(passed={sorted(passed)})"
        )
        self._refresh_hall_flags()
        return moved

    def startup_self_test(self) -> bool:
        """Jog both motors so wiring/drivers are verified on every service start.

        Lift DOWN n → UP n ends where it started; sort forward n → back n likewise.
        Open-loop on purpose: must work even with hall sensors unplugged.
        """
        lift_steps = self.startup_test_lift_steps
        sort_steps = self.startup_test_sort_steps
        pause = self.startup_test_pause_secs
        delay_us = self.startup_test_step_delay_us
        result = {
            "ok": False,
            "at": datetime.now().isoformat(timespec="seconds"),
            "message": "",
            "liftSteps": lift_steps,
            "sortSteps": sort_steps,
            "stepDelayUs": delay_us,
            "signalMode": self.signal_mode,
            "liftMoved": 0,
            "sortMoved": 0,
            "hallsBefore": {},
            "hallsAfter": {},
        }

        if not self.enabled:
            result["message"] = "Mechanism disabled (DIGIPATH_MECH_ENABLED=0)"
            self.last_test = result
            return False
        if not self._lift or not self._sort:
            result["message"] = self.init_error or "Motor drivers not initialized"
            self.last_test = result
            print(f"[Mech] STARTUP TEST SKIPPED: {result['message']}")
            return False

        with self._lock:
            self._status.phase = "self_test"
            self._status.last_error = ""
        result["message"] = "Running..."
        self.last_test = dict(result)
        print(
            f"[Mech] STARTUP TEST — lift DOWN/UP {lift_steps} steps, "
            f"sort {sort_steps} steps{' + return' if self.startup_test_sort_return else ''} "
            f"@ {delay_us}us/step ({self.signal_mode} wiring)"
        )
        if self._halls:
            result["hallsBefore"] = self._halls.read_all_labeled()
            print(f"[Mech] Halls before test: {result['hallsBefore']}")
        try:
            with self._lock:
                if lift_steps > 0:
                    self._enable_lift_only("startup test")
                    moved = self._lift.step_down(
                        lift_steps, step_delay_us=delay_us, stop_event=self._stop
                    )
                    print(f"[Mech] Test lift DOWN {moved}/{lift_steps}")
                    time.sleep(pause)
                    moved += self._lift.step_up(
                        lift_steps, step_delay_us=delay_us, stop_event=self._stop
                    )
                    result["liftMoved"] = moved
                    print(f"[Mech] Test lift DOWN+UP pulses {moved}/{lift_steps * 2}")
                    self._lift.set_enabled(False)
                    time.sleep(pause)

                if sort_steps > 0:
                    self._enable_sort_only("startup test")
                    moved = self._sort.step_sort(
                        sort_steps,
                        forward=self.sort_forward,
                        step_delay_us=delay_us,
                        stop_event=self._stop,
                    )
                    if self.startup_test_sort_return:
                        time.sleep(pause)
                        moved += self._sort.step_sort(
                            sort_steps,
                            forward=not self.sort_forward,
                            step_delay_us=delay_us,
                            stop_event=self._stop,
                        )
                    result["sortMoved"] = moved
                    print(f"[Mech] Test sort pulses {moved}")
                    self._sort.set_enabled(False)

                self._status.phase = "idle"
            if self._halls:
                result["hallsAfter"] = self._halls.read_all_labeled()
                print(f"[Mech] Halls after test: {result['hallsAfter']}")
            result["ok"] = True
            result["message"] = "Pulses sent to both drivers — confirm the motors physically moved"
            print("[Mech] STARTUP TEST OK — pulses sent to lift + sort")
            return True
        except Exception as err:
            result["message"] = f"Test error: {err}"
            with self._lock:
                self._status.phase = "error"
                self._status.last_error = f"startup test: {err}"
            print(f"[Mech] STARTUP TEST FAILED: {err}")
            return False
        finally:
            result["at"] = datetime.now().isoformat(timespec="seconds")
            self.last_test = result
            if self._lift:
                self._lift.set_enabled(False)
            if self._sort:
                self._sort.set_enabled(False)

    def home_to_main(self, *, reason: str = "startup"):
        """Always bring lift to main / top (hall #2) before idle operation."""
        self._ensure_ready()
        with self._lock:
            self._status.phase = "homing"
            self._status.last_error = ""

        print(f"[Mech] HOME → lift must be at main/top (hall #2) [{reason}]")
        try:
            if self.open_loop:
                if self._halls and self._halls.is_triggered(MAIN):
                    print("[Mech] Already at main hall #2 — home skip")
                else:
                    self._motor_pause("before home to main")
                    self._enable_lift_only(f"home {reason}")
                    # Always drive UP toward main on power-on.
                    moved = self._move_lift_open_loop(
                        "up",
                        self.open_loop_main_steps,
                        "home-main",
                    )
                    print(f"[Mech] Open-loop home moved {moved} steps UP")
                    self._motor_pause("after home")
            else:
                if self._halls and self._halls.is_triggered(MAIN):
                    print("[Mech] Already at main hall #2 — home OK")
                else:
                    self._motor_pause("before home to main")
                    self._enable_lift_only(f"home {reason}")
                    # Prefer UP (top). Position-aware if a lower hall is active.
                    moved = self._move_lift_to_hall(
                        MAIN,
                        label=f"home-{reason}",
                        fallback_dir="up",
                        direction="up",
                    )
                    print(f"[Mech] Homed to main in {moved} steps")
                    self._motor_pause("after home")
                if self._halls and not self._halls.is_triggered(MAIN):
                    raise RuntimeError(
                        "Home failed — main hall #2 not active after lift UP"
                    )

            self.homed = True
            with self._lock:
                self._status.phase = "idle"
                self._status.at_main = True
            print("[Mech] Lift at MAIN (top) — ready")
            return True
        except Exception as err:
            self.homed = False
            with self._lock:
                self._status.phase = "error"
                self._status.last_error = str(err)
            print(f"[Mech] Home to main FAILED: {err}")
            raise
        finally:
            if self._lift:
                self._lift.set_enabled(False)

    def go_to_capture(self):
        """Move to capture height via step counts — Hall #3 scanner sensor removed."""
        self.prepare_for_capture()

    def return_to_main(self):
        """Return lift to main/home hall #2 (UP/DOWN until hall #2 fires)."""
        self._ensure_ready()
        if self._halls is None:
            with self._lock:
                self._status.phase = "to_main"
            self._motor_pause("before lift to main")
            try:
                self._enable_lift_only("to main")
                moved = self._move_lift_open_loop(
                    self.lift_to_main_dir,
                    self.open_loop_main_steps,
                    "main",
                )
                self._motor_pause("after main move")
                with self._lock:
                    self._status.phase = "idle"
                self.homed = True
                return moved
            except Exception as err:
                with self._lock:
                    self._status.phase = "error"
                    self._status.last_error = str(err)
                self.homed = False
                raise
            finally:
                if self._lift:
                    self._lift.set_enabled(False)

        with self._lock:
            self._status.phase = "to_main"

        self._motor_pause("before lift to main")
        try:
            self._enable_lift_only("to main hall #2")
            moved = self._move_lift_to_hall(
                MAIN,
                label="main",
                fallback_dir=self.lift_to_main_dir,
            )
            self._motor_pause("after main hall")
            with self._lock:
                self._status.phase = "idle"
            self.homed = True
            return moved
        except Exception as err:
            with self._lock:
                self._status.phase = "error"
                self._status.last_error = str(err)
            self.homed = False
            raise
        finally:
            if self._lift:
                self._lift.set_enabled(False)

    def on_door_closed(self):
        """Hall #1 closed edge — status only. Motors run on Confirm & Register / SORT."""
        self._refresh_hall_flags()
        print("[Mech] Hall #1 DOOR closed (safety) — waiting for Confirm & Register to SORT")

    def assert_door_ready_for_sort(self):
        """Block SORT while door is open when hall #1 is wired."""
        if not self.sort_require_door_closed or not self._halls:
            return
        door_bcm = int(self._halls.pin_map.get(DOOR, 0) or 0)
        if door_bcm <= 0:
            return
        self._refresh_hall_flags()
        if self._halls.is_triggered(DOOR):
            print("[Mech] Hall #1 DOOR closed — OK to sort")
            return
        raise RuntimeError(
            "Close the scanner door (hall #1 / GPIO 5) before Confirm & Register sort"
        )

    def prepare_for_capture(self):
        """
        Capture button (no sensors), tag DigiPath move size:
          DOWN 900 → wait → DOWN 900 → DOWN 900 → settle for camera.
        Sort + UP run after upload (see run_post_upload_sort).
        """
        self._ensure_ready()
        steps = self.move_steps
        downs = self.capture_down_count
        with self._lock:
            self._status.last_error = ""
            self._status.phase = "to_capture"

        print(
            f"[Mech] Capture pressed → lift DOWN ×{downs} @ {steps} steps each"
        )
        try:
            for i in range(1, downs + 1):
                self._enable_lift_only(f"capture down #{i}/{downs}")
                moved = self._move_lift_open_loop("down", steps, f"capture-down-{i}")
                print(f"[Mech] DOWN #{i}/{downs} done ({moved} steps)")
                self._lift.set_enabled(False)
                if i < downs and self.motor_settle_secs > 0:
                    self._motor_pause(f"wait after down #{i}")

            if self.scan_settle_secs > 0:
                print(f"[Mech] Scan settle {self.scan_settle_secs:.0f}s before camera...")
                time.sleep(self.scan_settle_secs)
            with self._lock:
                self._status.phase = "ready_for_scan"
            print("[Mech] Ready for camera (after 3× down)")
        except Exception as err:
            with self._lock:
                self._status.phase = "error"
                self._status.last_error = str(err)
            raise
        finally:
            if self._lift:
                self._lift.set_enabled(False)

    def run_post_upload_sort(self, sort_layer: int):
        """After upload: SORT rotate then lift UP (open-loop), or hall-guided if sensors on."""
        if not self.open_loop:
            self.sort_and_return(sort_layer)
            return

        self._ensure_ready()
        steps = self.move_steps
        sort_steps = self.sort_deposit_steps or steps
        with self._lock:
            self._status.phase = "sorting"
            self._status.last_sort_layer = _clamp_layer(sort_layer)
            self._status.last_error = ""

        return_steps = steps * self.capture_down_count
        print(
            f"[Mech] UPLOAD_DONE → SORT {sort_steps} then UP {return_steps} "
            f"({self.capture_down_count}× capture distance, layer tag={_clamp_layer(sort_layer)})"
        )
        try:
            if self.motor_settle_secs > 0:
                self._motor_pause("before sort")
            if self.sort_deposit_secs > 0 or sort_steps > 0:
                self._run_sort_deposit("post-upload sort rotate", steps=sort_steps)

            if self.motor_settle_secs > 0:
                self._motor_pause("before lift up")
            self._enable_lift_only("post-upload return up")
            moved = self._move_lift_open_loop("up", return_steps, "post-upload-up")
            print(f"[Mech] UP done ({moved} steps) — back toward top")
            self.homed = True
            with self._lock:
                self._status.phase = "idle"
        except Exception as err:
            with self._lock:
                self._status.phase = "error"
                self._status.last_error = str(err)
            raise
        finally:
            if self._sort:
                self._sort.set_enabled(False)
            if self._lift:
                self._lift.set_enabled(False)

    def sort_and_return(self, sort_layer: int):
        """Confirm & Register: lift to target layer hall, sort deposit, return to main."""
        self._ensure_ready()
        self.assert_door_ready_for_sort()
        target_layer = _clamp_layer(sort_layer)
        target_sensor = LAYER_TO_SENSOR[target_layer]
        passed_layers: list[int] = []

        with self._lock:
            self._status.phase = "lift_to_layer"
            self._status.last_sort_layer = target_layer
            self._status.passed_layers = []
            self._status.last_error = ""

        layer_for_sensor = {
            LAYER_1: 1,
            LAYER_2: 2,
            LAYER_3: 3,
            MAIN: 1,
        }

        def _on_layer_hall(reading: HallReading):
            layer = layer_for_sensor.get(reading.sensor_id)
            if layer is None:
                return
            if layer not in passed_layers:
                passed_layers.append(layer)
                print(
                    f"[Mech] Passed layer {layer} ({self._hall_label(reading.sensor_id)})"
                )

        try:
            print(
                f"[Mech] UPLOAD_DONE → proceed sort to layer {target_layer} "
                f"({self._hall_label(target_sensor)})"
            )
            # Prefer hall sensors: lift UP or DOWN until the target tray hall fires.
            use_halls = self._halls is not None
            self._motor_pause("before lift to layer")
            if use_halls:
                self._enable_lift_only(f"hall-guided layer {target_layer}")
                print(
                    f"[Mech] Lift UP/DOWN until hall for layer {target_layer} "
                    f"({self._hall_label(target_sensor)}) then SORT"
                )
                if target_layer == 3 and not layer_has_hall(self._halls.pin_map, 3):
                    moved = self._move_lift_to_sort_layer(target_layer, on_sensor=_on_layer_hall)
                    print(f"[Mech] Lift at layer 3 (via layer2 + extra) after {moved} steps")
                else:
                    moved = self._move_lift_to_hall(
                        target_sensor,
                        label=f"layer-{target_layer}",
                        fallback_dir=self.lift_to_layer_dir,
                        on_sensor=_on_layer_hall,
                    )
                    print(
                        f"[Mech] At layer {target_layer} after {moved} steps "
                        f"(passed: {passed_layers}) — starting SORT"
                    )
                self._motor_pause("after lift at layer")
            else:
                layer_steps = self.open_loop_layer_steps.get(target_layer, self.open_loop_layer_steps[1])
                print(
                    f"[Mech] No halls — open-loop lift {self.lift_to_layer_dir} → layer {target_layer} "
                    f"({layer_steps} steps) before sort"
                )
                self._enable_lift_only(f"open-loop layer {target_layer}")
                moved = self._move_lift_open_loop(
                    self.lift_to_layer_dir, layer_steps, f"layer-{target_layer}"
                )
                print(f"[Mech] Open-loop lift at layer {target_layer} after {moved} steps")
                self._motor_pause("after lift at layer")

            with self._lock:
                self._status.phase = "sorting"
                self._status.passed_layers = list(passed_layers)

            if self.sort_deposit_secs > 0 or self.sort_deposit_steps > 0:
                self._motor_pause("before sort deposit")
                self._run_sort_deposit("deposit rotate")
                self._motor_pause("after sort deposit")

            self.return_to_main()
            self.homed = True
        except Exception as err:
            with self._lock:
                self._status.phase = "error"
                self._status.last_error = str(err)
            raise
        finally:
            if self._sort:
                self._sort.set_enabled(False)
            if self._lift:
                self._lift.set_enabled(False)

    def start_door_monitor(self):
        """Poll door hall; on close edge run on_door_closed when idle."""
        if not self.enabled or not self.door_monitor_enabled or not self._halls or self.open_loop:
            if self.open_loop and self.door_monitor_enabled:
                print("[Mech] Door monitor off in open-loop mode (use dashboard Capture)")
            return
        if self._door_thread and self._door_thread.is_alive():
            return

        def _loop():
            print("[Mech] Door monitor started (hall 1)")
            while not self._stop.is_set():
                try:
                    closed = self._halls.is_triggered(DOOR)
                    with self._lock:
                        self._status.door_closed = closed
                    if closed and not self._door_was_closed:
                        self.on_door_closed()
                    self._door_was_closed = closed
                except Exception as err:
                    print(f"[Mech] Door monitor error: {err}")
                time.sleep(0.08)

        self._door_thread = threading.Thread(target=_loop, daemon=True, name="digipath-door")
        self._door_thread.start()


_mechanism: DigipathMechanism | None = None
_mechanism_lock = threading.Lock()
_sort_thread: threading.Thread | None = None


def get_mechanism() -> DigipathMechanism:
    global _mechanism
    with _mechanism_lock:
        if _mechanism is None:
            _mechanism = DigipathMechanism()
        return _mechanism


def mechanism_home_on_startup():
    """On power-on / service start: lift always goes to main (top) first."""
    mech = get_mechanism()
    if not mech.enabled:
        return
    if not mech.home_on_start:
        print("[Mech] Startup home skipped (DIGIPATH_MECH_HOME_ON_START=0)")
        return
    mech.home_to_main(reason="power-on")


def mechanism_startup_self_test() -> bool:
    mech = get_mechanism()
    if not mech.enabled:
        print("[Mech] Startup test skipped (DIGIPATH_MECH_ENABLED=0)")
        return mech.startup_self_test()
    if not mech.startup_test:
        print("[Mech] Startup test skipped (DIGIPATH_MECH_STARTUP_TEST=0)")
        return False
    return mech.startup_self_test()


def mechanism_prepare_for_capture():
    mech = get_mechanism()
    if not mech.enabled:
        print(
            "[Mech] *** SCAN MOTORS SKIPPED *** DIGIPATH_MECH_ENABLED=0. "
            "test-motors.sh still works (direct GPIO). "
            "Set DIGIPATH_MECH_ENABLED=1 in Desktop .env and restart scanner."
        )
        return
    print(
        f"[Mech] prepare_for_capture BEGIN "
        f"(enabled=1 open_loop={int(mech.open_loop)} steps={mech.move_steps})"
    )
    mech.prepare_for_capture()
    print("[Mech] prepare_for_capture END")


def mechanism_start_door_monitor():
    mech = get_mechanism()
    if not mech.enabled:
        return
    if mech.home_on_start and not mech.homed:
        print("[Mech] Door monitor waits until lift is homed to main")
        try:
            mech.home_to_main(reason="before-door-monitor")
        except Exception as err:
            print(f"[Mech] Cannot start door monitor — home failed: {err}")
            return
    mech.start_door_monitor()


def mechanism_start_sort_async(sort_layer: int):
    """Post-upload sort — skipped while sensors are off / SORT_AFTER_UPLOAD=0."""
    global _sort_thread
    mech = get_mechanism()
    if not mech.enabled:
        print(
            f"[Mech] UPLOAD_DONE received but sort skipped (layer {sort_layer}) — "
            "DIGIPATH_MECH_ENABLED=0"
        )
        return
    if not mech.sort_after_upload:
        print(
            f"[Mech] UPLOAD_DONE — sort skipped (DIGIPATH_MECH_SORT_AFTER_UPLOAD=0, "
            f"layer would be {sort_layer})"
        )
        return

    print(
        f"[Mech] SIGNAL upload_done → driver proceed_sort layer={sort_layer}"
    )

    def _worker():
        try:
            mech.run_post_upload_sort(sort_layer)
            print(f"[Mech] Sort sequence finished (layer {sort_layer})")
        except Exception as err:
            print(f"[Mech] Sort sequence failed: {err}")

    with _mechanism_lock:
        if _sort_thread and _sort_thread.is_alive():
            print("[Mech] Waiting for previous sort to finish...")
            _sort_thread.join(timeout=120)
        _sort_thread = threading.Thread(target=_worker, daemon=True, name="digipath-sort")
        _sort_thread.start()
