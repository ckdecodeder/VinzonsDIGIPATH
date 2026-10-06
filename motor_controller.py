"""Two TB6600 drivers + 3-layer document sorting on Raspberry Pi."""

from __future__ import annotations

import json
import os
import re
import threading
import time


def _env_bool(name, default="0"):
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


def _env_int(name, default):
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return int(default)


class Tb6600Driver:
    """One TB6600: PUL + DIR + optional ENA."""

    def __init__(self, name, pul_pin, dir_pin, ena_pin=0, ena_active_low=True):
        from gpiozero import OutputDevice

        self.name = name
        self.pul = OutputDevice(pul_pin, active_high=True, initial_value=False)
        self.dir = OutputDevice(dir_pin, active_high=True, initial_value=False)
        self.ena = None
        self.ena_active_low = ena_active_low
        if ena_pin and int(ena_pin) > 0:
            initial = True if ena_active_low else False
            self.ena = OutputDevice(int(ena_pin), active_high=True, initial_value=initial)

    def close(self):
        for pin in (self.pul, self.dir, self.ena):
            if not pin:
                continue
            try:
                pin.off()
                pin.close()
            except Exception:
                pass

    def _set_enabled(self, enabled):
        if not self.ena:
            return
        if self.ena_active_low:
            self.ena.off() if enabled else self.ena.on()
        else:
            self.ena.on() if enabled else self.ena.off()

    def step(self, steps, direction, step_delay_secs, label):
        steps = max(0, int(steps))
        if steps <= 0:
            return
        self.dir.on() if direction else self.dir.off()
        self._set_enabled(True)
        half = max(step_delay_secs / 2.0, 0.00005)
        print(
            f"[Motor] {self.name}: {label} — {steps} steps, dir={'HIGH' if direction else 'LOW'}"
        )
        for _ in range(steps):
            self.pul.on()
            time.sleep(half)
            self.pul.off()
            time.sleep(half)
        self._set_enabled(False)


class MotorController:
    """
    Two TB6600 drivers + 3 sorting layers:
      Rotate driver -> feed / align document (left)
      Lift driver   -> scan height + layer 1/2/3 deposit positions
    """

    def __init__(self):
        self.enabled = _env_bool("DIGIPATH_MOTOR_ENABLED", os.environ.get("DIGIPATH_RELAY_ENABLED", "0"))
        self.driver = os.environ.get("DIGIPATH_MOTOR_DRIVER", "tb6600-dual").strip().lower()
        self.step_delay_us = _env_int("DIGIPATH_MOTOR_STEP_DELAY_US", 3500)
        # Lift up/down is just positioning — run it faster so Capture proceeds
        # quickly. Rotate/sort stays slow for gentle sorting.
        self.lift_step_delay_us = _env_int("DIGIPATH_LIFT_STEP_DELAY_US", 900)
        self.ena_active_low = _env_bool("DIGIPATH_MOTOR_ENA_ACTIVE_LOW", "1")
        self.layer_count = max(1, min(3, _env_int("DIGIPATH_LAYER_COUNT", 3)))
        self.sort_rule = os.environ.get("DIGIPATH_SORT_RULE", "priority").strip().lower()

        self.lift_pul = _env_int("DIGIPATH_LIFT_PUL_GPIO", _env_int("DIGIPATH_RELAY1_GPIO", 17))
        self.lift_dir = _env_int("DIGIPATH_LIFT_DIR_GPIO", 18)
        self.lift_ena = _env_int("DIGIPATH_LIFT_ENA_GPIO", 0)
        self.lift_up_dir = _env_bool("DIGIPATH_LIFT_UP_DIR", "1")

        self.rotate_pul = _env_int(
            "DIGIPATH_ROTATE_PUL_GPIO",
            _env_int("DIGIPATH_ROTATE_SELECT_GPIO", _env_int("DIGIPATH_RELAY2_GPIO", 27)),
        )
        self.rotate_dir = _env_int("DIGIPATH_ROTATE_DIR_GPIO", 23)
        self.rotate_ena = _env_int("DIGIPATH_ROTATE_ENA_GPIO", 0)
        self.rotate_left_steps = _env_int("DIGIPATH_ROTATE_LEFT_STEPS", 1200)
        self.rotate_left_dir = _env_bool("DIGIPATH_ROTATE_LEFT_DIR", "0")
        # Sorting selector: rotate to a bin per layer, then rotate back.
        self.rotate_sort_dir = _env_bool("DIGIPATH_ROTATE_SORT_DIR", "0")
        self.rotate_return = _env_bool("DIGIPATH_ROTATE_RETURN", "1")
        self.rotate_layer_steps = {
            1: _env_int("DIGIPATH_ROTATE_LAYER1_STEPS", 400),
            2: _env_int("DIGIPATH_ROTATE_LAYER2_STEPS", 800),
            3: _env_int("DIGIPATH_ROTATE_LAYER3_STEPS", 1200),
        }

        # Home is at the TOP. Positions are measured as steps BELOW the top.
        self.lift_home_steps = _env_int("DIGIPATH_LIFT_HOME_STEPS", 0)
        self.lift_scan_steps = _env_int("DIGIPATH_LIFT_SCAN_STEPS", _env_int("DIGIPATH_LIFT_UP_STEPS", 1600))
        self.lift_deposit_steps = _env_int("DIGIPATH_LIFT_DEPOSIT_STEPS", self.lift_scan_steps)
        self.layer_steps = {
            1: _env_int("DIGIPATH_LAYER1_STEPS", 500),
            2: _env_int("DIGIPATH_LAYER2_STEPS", 1000),
            3: _env_int("DIGIPATH_LAYER3_STEPS", 1500),
        }
        self.priority_layer_map = {
            "urgent": _env_int("DIGIPATH_SORT_LAYER_URGENT", 1),
            "high": _env_int("DIGIPATH_SORT_LAYER_HIGH", 2),
            "normal": _env_int("DIGIPATH_SORT_LAYER_NORMAL", 3),
            "low": _env_int("DIGIPATH_SORT_LAYER_LOW", 3),
        }
        self.document_type_layer_map = self._load_document_type_layer_map()

        self._lift = None
        self._rotate = None
        self._lock = threading.Lock()
        self._last_error = ""
        self._current_lift_steps = self.lift_home_steps
        self._last_sort_layer = None

        if self.enabled:
            self._init_gpio()

    def _load_document_type_layer_map(self):
        raw = os.environ.get("DIGIPATH_SORT_DOCUMENT_TYPE_LAYERS", "").strip()
        if not raw:
            return {
                "DT-001": 1,  # Memorandum
                "DT-002": 2,  # Executive Order
                "DT-003": 3,  # Communication Letter
            }
        try:
            parsed = json.loads(raw)
            return {str(key): int(value) for key, value in parsed.items()}
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}

    @property
    def step_delay_secs(self):
        return max(self.step_delay_us, 50) / 1_000_000.0

    @property
    def lift_step_delay_secs(self):
        return max(self.lift_step_delay_us, 50) / 1_000_000.0

    def _init_gpio(self):
        try:
            self._lift = Tb6600Driver(
                "lift",
                self.lift_pul,
                self.lift_dir,
                self.lift_ena,
                self.ena_active_low,
            )
            self._rotate = Tb6600Driver(
                "rotate",
                self.rotate_pul,
                self.rotate_dir,
                self.rotate_ena,
                self.ena_active_low,
            )
            print(
                f"[Motor] 2x TB6600 + {self.layer_count} layers — "
                f"lift PUL=GPIO{self.lift_pul}, rotate PUL=GPIO{self.rotate_pul}"
            )
        except Exception as err:
            self._last_error = str(err)
            self.enabled = False
            print(f"[Motor] Disabled — GPIO init failed: {err}")

    def _clamp_layer(self, layer):
        try:
            value = int(layer)
        except (TypeError, ValueError):
            value = 1
        return max(1, min(self.layer_count, value))

    def _layer_steps_for(self, layer):
        layer = self._clamp_layer(layer)
        return self.layer_steps.get(layer, self.layer_steps[1])

    def status(self):
        return {
            "enabled": self.enabled,
            "driver": self.driver,
            "layout": "dual-tb6600-3layer-sort",
            "stepDelayUs": self.step_delay_us,
            "layerCount": self.layer_count,
            "sortRule": self.sort_rule,
            "currentLiftSteps": self._current_lift_steps,
            "lastSortLayer": self._last_sort_layer,
            "lift": {
                "pulGpio": self.lift_pul,
                "dirGpio": self.lift_dir,
                "enaGpio": self.lift_ena,
                "homeSteps": self.lift_home_steps,
                "scanSteps": self.lift_scan_steps,
                "depositSteps": self.lift_deposit_steps,
                "upDirHigh": self.lift_up_dir,
                "layerSteps": self.layer_steps,
            },
            "rotate": {
                "pulGpio": self.rotate_pul,
                "dirGpio": self.rotate_dir,
                "enaGpio": self.rotate_ena,
                "leftSteps": self.rotate_left_steps,
                "leftDirHigh": self.rotate_left_dir,
                "sortDirHigh": self.rotate_sort_dir,
                "layerSteps": self.rotate_layer_steps,
                "returnAfterSort": self.rotate_return,
            },
            "priorityLayerMap": self.priority_layer_map,
            "lastError": self._last_error,
        }

    def _move_lift_to(self, target_steps, label):
        # Position is steps BELOW the top (home=0). Larger target = further DOWN.
        if not self.enabled or not self._lift:
            return
        target_steps = max(0, int(target_steps))
        delta = target_steps - self._current_lift_steps
        if delta == 0:
            print(f"[Motor] lift: already at {label} ({target_steps} steps)")
            return
        going_down = delta > 0
        direction = (not self.lift_up_dir) if going_down else self.lift_up_dir
        self._lift.step(abs(delta), direction, self.lift_step_delay_secs, label)
        self._current_lift_steps = target_steps

    def _rotate_to_bin(self, layer):
        # Rotate the sorting selector to the bin for this layer, then back.
        if not self.enabled or not self._rotate:
            return
        layer = self._clamp_layer(layer)
        steps = self.rotate_layer_steps.get(layer, self.rotate_layer_steps[1])
        if steps <= 0:
            return
        self._rotate.step(steps, self.rotate_sort_dir, self.step_delay_secs, f"sort-bin-{layer}")
        if self.rotate_return:
            time.sleep(max(_env_int("DIGIPATH_SORT_DROP_MS", 400), 0) / 1000.0)
            self._rotate.step(steps, not self.rotate_sort_dir, self.step_delay_secs, f"sort-bin-{layer}-return")

    def rotate_left(self, steps=None):
        if not self.enabled or not self._rotate:
            return
        count = self.rotate_left_steps if steps is None else int(steps)
        with self._lock:
            self._rotate.step(count, self.rotate_left_dir, self.step_delay_secs, "rotate-left")

    def rotate_to_bin(self, layer):
        with self._lock:
            self._rotate_to_bin(layer)

    def lift_to_scan(self):
        with self._lock:
            self._move_lift_to(self.lift_scan_steps, "lift-down-to-scan")

    def lift_to_deposit(self):
        with self._lock:
            self._move_lift_to(self.lift_deposit_steps, "lift-down-to-deposit")

    def lift_to_top(self):
        with self._lock:
            self._move_lift_to(self.lift_home_steps, "lift-up-to-top")

    def lift_to_layer(self, layer):
        # Backward-compat: sorting now uses the rotate selector.
        self.rotate_to_bin(layer)

    def return_home(self):
        self.lift_to_top()

    def resolve_sort_layer(self, payload=None, text="", title=""):
        payload = payload or {}

        if payload.get("sortLayer") is not None:
            layer = self._clamp_layer(payload.get("sortLayer"))
            print(f"[Motor] Sort layer from payload: {layer}")
            return layer

        if self.sort_rule == "document_type":
            doc_type = str(payload.get("documentTypeId") or "").strip()
            if doc_type in self.document_type_layer_map:
                layer = self._clamp_layer(self.document_type_layer_map[doc_type])
                print(f"[Motor] Sort layer from document type {doc_type}: {layer}")
                return layer

        priority = str(payload.get("priorityLevel") or "").strip().lower()
        if not priority:
            blob = f"{title}\n{text}".lower()
            if re.search(r"\burgent\b|\bimmediate\b|\bpriority\b", blob):
                priority = "urgent"
            elif re.search(r"\bhigh\b|\bimportant\b", blob):
                priority = "high"
            elif re.search(r"\blow\b", blob):
                priority = "low"
            else:
                priority = "normal"

        layer = self._clamp_layer(self.priority_layer_map.get(priority, 3))
        print(f"[Motor] Sort layer from priority '{priority}': {layer}")
        return layer

    def run_scan_sequence(self):
        """From TOP, lower the tray DOWN to the camera scan height."""
        if not self.enabled:
            return
        print("[Motor] Scan sequence: lowering DOWN to scan height...")
        with self._lock:
            self._move_lift_to(self.lift_scan_steps, "lift-down-to-scan")

    def finish_scan_sequence(self, sort_layer=1):
        """After scan: UP to top, DOWN to deposit, ROTATE-sort, then UP to top."""
        if not self.enabled:
            return
        layer = self._clamp_layer(sort_layer)
        self._last_sort_layer = layer
        print(f"[Motor] Finish: up, down, sort to layer {layer}, return to top...")
        with self._lock:
            self._move_lift_to(self.lift_home_steps, "lift-up-to-top")
            self._move_lift_to(self.lift_deposit_steps, "lift-down-to-deposit")
            self._rotate_to_bin(layer)
            time.sleep(max(_env_int("DIGIPATH_LAYER_SETTLE_MS", 300), 0) / 1000.0)
            self._move_lift_to(self.lift_home_steps, "lift-up-to-top")
        print(f"[Motor] Scan + sort complete (layer {layer}).")

    def self_test(self, steps=200):
        """Pulse each motor separately to isolate wiring vs software issues."""
        if not self.enabled or not self._lift or not self._rotate:
            print(f"[Motor] Self-test skipped — enabled={self.enabled}, "
                  f"lift={bool(self._lift)}, rotate={bool(self._rotate)}")
            return
        steps = max(1, int(steps))
        with self._lock:
            print(f"[Motor] SELF-TEST 1/2 — LIFT only (GPIO{self.lift_pul}/{self.lift_dir})")
            self._lift.step(steps, not self.lift_up_dir, self.step_delay_secs, "test-lift-down")
            time.sleep(0.6)
            self._lift.step(steps, self.lift_up_dir, self.step_delay_secs, "test-lift-up")
            time.sleep(1.0)
            print(f"[Motor] SELF-TEST 2/2 — ROTATE only (GPIO{self.rotate_pul}/{self.rotate_dir})")
            self._rotate.step(steps, self.rotate_sort_dir, self.step_delay_secs, "test-rotate-fwd")
            time.sleep(0.6)
            self._rotate.step(steps, not self.rotate_sort_dir, self.step_delay_secs, "test-rotate-back")
        print("[Motor] SELF-TEST done. Both motors should have moved separately.")

    def cleanup(self):
        with self._lock:
            try:
                self._move_lift_to(self.lift_home_steps, "lift-home")
            except Exception:
                pass
            for channel in (self._lift, self._rotate):
                if channel:
                    try:
                        channel.close()
                    except Exception:
                        pass
            self._lift = None
            self._rotate = None


motor_controller = MotorController()


if __name__ == "__main__":
    import sys

    print("=" * 50)
    print(" DigiPath Motor Test")
    print("=" * 50)
    status = motor_controller.status()
    print(f" enabled: {status['enabled']}")
    print(f" lift  PUL=GPIO{status['lift']['pulGpio']} DIR=GPIO{status['lift']['dirGpio']}")
    print(f" rotate PUL=GPIO{status['rotate']['pulGpio']} DIR=GPIO{status['rotate']['dirGpio']}")
    print(f" lastError: {status['lastError'] or '(none)'}")
    print("-" * 50)

    if not motor_controller.enabled:
        print("Motor DISABLED. Set DIGIPATH_MOTOR_ENABLED=1 and load bridge.env.")
        sys.exit(1)

    arg = sys.argv[1] if len(sys.argv) > 1 else "both"
    test_steps = int(sys.argv[2]) if len(sys.argv) > 2 else 300

    try:
        if arg in ("lift", "both"):
            print(f"LIFT test — {test_steps} steps down then up...")
            motor_controller._lift.step(test_steps, not motor_controller.lift_up_dir,
                                        motor_controller.step_delay_secs, "cli-lift-down")
            time.sleep(0.8)
            motor_controller._lift.step(test_steps, motor_controller.lift_up_dir,
                                        motor_controller.step_delay_secs, "cli-lift-up")
        if arg == "both":
            time.sleep(1.2)
        if arg in ("rotate", "both"):
            print(f"ROTATE test — {test_steps} steps fwd then back...")
            motor_controller._rotate.step(test_steps, motor_controller.rotate_sort_dir,
                                          motor_controller.step_delay_secs, "cli-rotate-fwd")
            time.sleep(0.8)
            motor_controller._rotate.step(test_steps, not motor_controller.rotate_sort_dir,
                                          motor_controller.step_delay_secs, "cli-rotate-back")
        print("Done. If only one motor moved, check hardware/wiring on the motor that did not move.")
    finally:
        motor_controller.cleanup()
