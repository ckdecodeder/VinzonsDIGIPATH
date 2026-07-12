"""
DigiPath mechanical sequence — TB6600 lift + sort with 6× YS-27 hall sensors.

Flow:
  1. Door closed (hall 1) → lift to capture (hall 3) → scan settle
  2. Scan + upload (caller)
  3. Lift up/down to target layer hall (4/5/6) — bypass other layers, stop at target
  4. Sort carousel deposit rotate
  5. Lift returns to main (hall 2)

Lift move directions (up/down) are configurable via .env until hardware is finalized.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from digipath_hall_ys27 import (
    CAPTURE,
    DOOR,
    LAYER_1,
    LAYER_2,
    LAYER_3,
    LAYER_TO_SENSOR,
    MAIN,
    SENSOR_LABELS,
    HallReading,
    build_default_bank,
)
from digipath_tb6600 import LiftAxis, SortAxis, _env_bool, _env_int


def _clamp_layer(value) -> int:
    try:
        layer = int(value)
    except (TypeError, ValueError):
        layer = 1
    return max(1, min(3, layer))


def _parse_lift_dir(name: str, default: str = "down") -> str:
    value = os.environ.get(name, default).strip().lower()
    if value in ("up", "u", "raise", "ascend"):
        return "up"
    return "down"


def resolve_sort_layer(payload: dict | None) -> int:
    payload = payload or {}
    if payload.get("sortLayer") is not None:
        return _clamp_layer(payload.get("sortLayer"))
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
        self.enabled = _env_bool("DIGIPATH_MECH_ENABLED", "0")
        self.simulate = _env_bool("DIGIPATH_MECH_SIMULATE", "0")
        self.door_monitor_enabled = _env_bool("DIGIPATH_DOOR_MONITOR", "1")
        self.motor_settle_secs = max(1.0, float(os.environ.get("DIGIPATH_MOTOR_SETTLE_SECS", "3")))
        self.scan_settle_secs = max(1.0, float(os.environ.get("DIGIPATH_SCAN_SETTLE_SECS", "6")))
        self.lift_travel_max_steps = _env_int("DIGIPATH_LIFT_TRAVEL_MAX_STEPS", 14000)
        self.lift_down_max_steps = _env_int("DIGIPATH_LIFT_DOWN_MAX_STEPS", self.lift_travel_max_steps)
        self.lift_up_max_steps = _env_int("DIGIPATH_LIFT_UP_MAX_STEPS", self.lift_travel_max_steps)
        self.sort_max_steps = _env_int("DIGIPATH_SORT_MAX_STEPS", 10000)
        self.sort_chunk_steps = max(1, _env_int("DIGIPATH_SORT_CHUNK_STEPS", 6))
        self.step_delay_us = _env_int("DIGIPATH_MOTOR_STEP_DELAY_US", 900)

        self.lift_to_capture_dir = _parse_lift_dir("DIGIPATH_LIFT_TO_CAPTURE_DIR", "down")
        self.lift_to_main_dir = _parse_lift_dir("DIGIPATH_LIFT_TO_MAIN_DIR", "up")
        self.lift_to_layer_dir = _parse_lift_dir("DIGIPATH_LIFT_TO_LAYER_DIR", "down")
        self.sort_deposit_steps = max(0, _env_int("DIGIPATH_SORT_DEPOSIT_STEPS", 400))

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
            return

        down_high = _env_bool("DIGIPATH_LIFT_DOWN_DIR_HIGH", "1")
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
        self._halls = build_default_bank(simulate=self.simulate)
        self._refresh_hall_flags()
        print(
            f"[Mech] 6× hall + TB6600 ready "
            f"(simulate={int(self.simulate)} "
            f"to_capture={self.lift_to_capture_dir} to_main={self.lift_to_main_dir})"
        )

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
        self._status.at_capture = self._halls.is_triggered(CAPTURE)

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
            }

    def _motor_pause(self, label: str = ""):
        if label:
            print(f"[Mech] Pause {self.motor_settle_secs:.0f}s — {label}")
        time.sleep(self.motor_settle_secs)

    def _ensure_ready(self):
        if not self.enabled or not self._lift or not self._sort or not self._halls:
            raise RuntimeError("Mechanism disabled or not initialized")

    def _lift_step_fn(self, direction: str):
        if direction == "up":
            return lambda n: self._lift.step_up(n, step_delay_us=self.step_delay_us, stop_event=self._stop)
        return lambda n: self._lift.step_down(n, step_delay_us=self.step_delay_us, stop_event=self._stop)

    def _move_lift_to_hall(self, target_sensor: int, direction: str, *, label: str) -> int:
        """Move lift until target hall triggers; returns steps moved."""
        max_steps = self.lift_up_max_steps if direction == "up" else self.lift_down_max_steps
        sensor_name = SENSOR_LABELS.get(target_sensor, str(target_sensor))
        print(f"[Mech] Lift {direction} → hall {target_sensor} ({sensor_name})")

        if self.simulate and not self._halls.is_triggered(target_sensor):
            trigger_at = {
                CAPTURE: max(200, max_steps // 3),
                MAIN: max(200, max_steps // 4),
            }.get(target_sensor, max(200, max_steps // 3))
            start_pos = self._lift.simulated_position
            step_fn_base = self._lift_step_fn(direction)

            def _sim_step(n: int) -> int:
                moved = step_fn_base(n)
                traveled = abs(self._lift.simulated_position - start_pos)
                if traveled >= trigger_at:
                    self._halls.simulate_trigger(target_sensor, True)
                return moved

            step_fn = _sim_step
        else:
            step_fn = self._lift_step_fn(direction)

        stopped, moved, passed = self._halls.step_until(
            step_fn,
            stop_sensor=target_sensor,
            max_steps=max_steps,
            chunk_steps=self.sort_chunk_steps,
            stop_event=self._stop,
        )
        if not stopped:
            raise RuntimeError(
                f"Hall {target_sensor} ({sensor_name}) not detected after {moved} lift-{direction}-steps"
            )
        print(f"[Mech] Reached hall {target_sensor} ({sensor_name}) in {moved} steps (passed={sorted(passed)})")
        self._refresh_hall_flags()
        return moved

    def go_to_capture(self):
        """Move lift to exact camera frame hall (sensor 3)."""
        self._ensure_ready()
        if self._halls.is_triggered(CAPTURE):
            print("[Mech] Already at capture hall — skip lift move")
            self._refresh_hall_flags()
            return 0

        with self._lock:
            self._status.phase = "to_capture"
            self._status.last_error = ""

        self._motor_pause("before lift to capture")
        try:
            self._lift.set_enabled(True)
            self._sort.set_enabled(False)
            moved = self._move_lift_to_hall(CAPTURE, self.lift_to_capture_dir, label="capture")
            self._motor_pause("after capture hall")
            return moved
        except Exception as err:
            with self._lock:
                self._status.phase = "error"
                self._status.last_error = str(err)
            raise
        finally:
            if self._lift:
                self._lift.set_enabled(False)

    def return_to_main(self):
        """Return lift to main/home hall (sensor 2) — required end state after sort."""
        self._ensure_ready()
        if self._halls.is_triggered(MAIN):
            print("[Mech] Already at main hall — skip lift move")
            self._refresh_hall_flags()
            with self._lock:
                self._status.phase = "idle"
            return 0

        with self._lock:
            self._status.phase = "to_main"

        self._motor_pause("before lift to main")
        try:
            self._lift.set_enabled(True)
            self._sort.set_enabled(False)
            moved = self._move_lift_to_hall(MAIN, self.lift_to_main_dir, label="main")
            self._motor_pause("after main hall")
            with self._lock:
                self._status.phase = "idle"
            return moved
        except Exception as err:
            with self._lock:
                self._status.phase = "error"
                self._status.last_error = str(err)
            raise
        finally:
            if self._lift:
                self._lift.set_enabled(False)

    def on_door_closed(self):
        """Door shut (hall 1) → move to capture and settle for scan."""
        self._ensure_ready()
        with self._lock:
            if self._status.phase not in ("idle", "ready_for_scan"):
                print(f"[Mech] Door closed ignored — busy phase={self._status.phase}")
                return
            self._status.last_error = ""

        print("[Mech] Door closed — auto move to capture")
        try:
            self.go_to_capture()
            print(f"[Mech] Scan settle {self.scan_settle_secs:.0f}s at capture...")
            time.sleep(self.scan_settle_secs)
            with self._lock:
                self._status.phase = "ready_for_scan"
            print("[Mech] Ready for scan at capture frame")
        except Exception as err:
            with self._lock:
                self._status.phase = "error"
                self._status.last_error = str(err)
            print(f"[Mech] Door → capture failed: {err}")

    def prepare_for_capture(self):
        """Ensure lift is at capture hall, then scan settle (dashboard capture or after door)."""
        self._ensure_ready()
        with self._lock:
            self._status.last_error = ""

        try:
            self.go_to_capture()
            if not self._halls.is_triggered(CAPTURE):
                raise RuntimeError("Capture hall not active after lift move")
            print(f"[Mech] Scan settle {self.scan_settle_secs:.0f}s...")
            time.sleep(self.scan_settle_secs)
            with self._lock:
                self._status.phase = "ready_for_scan"
        except Exception as err:
            with self._lock:
                self._status.phase = "error"
                self._status.last_error = str(err)
            raise

    def sort_and_return(self, sort_layer: int):
        """Lift to target layer hall (vertical), sort deposit, then return to main."""
        self._ensure_ready()
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
        }

        def _on_layer_hall(reading: HallReading):
            layer = layer_for_sensor.get(reading.sensor_id)
            if layer is None:
                return
            if layer not in passed_layers:
                passed_layers.append(layer)
                print(f"[Mech] Passed layer {layer} hall (sensor {reading.sensor_id})")

        try:
            # --- Phase A: lift up/down to target layer hall BEFORE sort ---
            print(
                f"[Mech] Lift {self.lift_to_layer_dir} → layer {target_layer} "
                f"(hall {target_sensor}) before sort"
            )
            self._motor_pause("before lift to layer")
            self._lift.set_enabled(True)
            self._sort.set_enabled(False)

            if self._halls.is_triggered(target_sensor):
                print(f"[Mech] Already at layer {target_layer} hall — skip lift move")
            else:
                if self.simulate:
                    trigger_at = {
                        LAYER_1: max(200, self.lift_down_max_steps // 4),
                        LAYER_2: max(400, self.lift_down_max_steps // 2),
                        LAYER_3: max(600, (self.lift_down_max_steps * 3) // 4),
                    }[target_sensor]
                    start_pos = self._lift.simulated_position
                    step_fn_base = self._lift_step_fn(self.lift_to_layer_dir)

                    def _sim_lift(n: int) -> int:
                        moved = step_fn_base(n)
                        if abs(self._lift.simulated_position - start_pos) >= trigger_at:
                            self._halls.simulate_trigger(target_sensor, True)
                        return moved

                    lift_step = _sim_lift
                else:
                    lift_step = self._lift_step_fn(self.lift_to_layer_dir)

                max_steps = (
                    self.lift_up_max_steps
                    if self.lift_to_layer_dir == "up"
                    else self.lift_down_max_steps
                )
                stopped, moved, seen = self._halls.step_until(
                    lift_step,
                    stop_sensor=target_sensor,
                    max_steps=max_steps,
                    chunk_steps=self.sort_chunk_steps,
                    on_sensor=_on_layer_hall,
                    stop_event=self._stop,
                )
                if not stopped:
                    raise RuntimeError(
                        f"Layer {target_layer} hall not detected after {moved} lift steps "
                        f"(passed={passed_layers or sorted(seen)})"
                    )
                print(
                    f"[Mech] Lift at layer {target_layer} after {moved} steps "
                    f"(passed layers: {passed_layers or sorted(seen)})"
                )

            self._motor_pause("after lift at layer")

            # --- Phase B: sort carousel deposit ---
            with self._lock:
                self._status.phase = "sorting"
                self._status.passed_layers = list(passed_layers)

            if self.sort_deposit_steps > 0:
                print(f"[Mech] Sort deposit rotate ({self.sort_deposit_steps} steps)")
                self._motor_pause("before sort deposit")
                self._sort.set_enabled(True)
                self._lift.set_enabled(False)
                deposited = self._sort.step_sort(
                    self.sort_deposit_steps,
                    step_delay_us=self.step_delay_us,
                    stop_event=self._stop,
                )
                print(f"[Mech] Sort deposit done ({deposited} steps)")
                self._motor_pause("after sort deposit")

            # --- Phase C: return to main ---
            self.return_to_main()
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

    def run_post_upload_sort(self, sort_layer: int):
        self.sort_and_return(sort_layer)

    def start_door_monitor(self):
        """Poll door hall; on close edge run on_door_closed when idle."""
        if not self.enabled or not self.door_monitor_enabled or not self._halls:
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


def mechanism_prepare_for_capture():
    mech = get_mechanism()
    if not mech.enabled:
        return
    mech.prepare_for_capture()


def mechanism_start_door_monitor():
    mech = get_mechanism()
    if not mech.enabled:
        return
    mech.start_door_monitor()


def mechanism_start_sort_async(sort_layer: int):
    global _sort_thread
    mech = get_mechanism()
    if not mech.enabled:
        return

    def _worker():
        try:
            mech.run_post_upload_sort(sort_layer)
        except Exception as err:
            print(f"[Mech] Sort sequence failed: {err}")

    with _mechanism_lock:
        if _sort_thread and _sort_thread.is_alive():
            print("[Mech] Waiting for previous sort to finish...")
            _sort_thread.join(timeout=120)
        _sort_thread = threading.Thread(target=_worker, daemon=True, name="digipath-sort")
        _sort_thread.start()
