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
        self.step_delay_us = _env_int("DIGIPATH_MOTOR_STEP_DELAY_US", 800)
        self.ena_active_low = _env_bool("DIGIPATH_MOTOR_ENA_ACTIVE_LOW", "1")
        self.layer_count = max(1, min(3, _env_int("DIGIPATH_LAYER_COUNT", 3)))
        self.sort_rule = os.environ.get("DIGIPATH_SORT_RULE", "priority").strip().lower()

        self.lift_pul = _env_int("DIGIPATH_LIFT_PUL_GPIO", _env_int("DIGIPATH_RELAY1_GPIO", 17))
        self.lift_dir = _env_int("DIGIPATH_LIFT_DIR_GPIO", 18)
        self.lift_ena = _env_int("DIGIPATH_LIFT_ENA_GPIO", 22)
        self.lift_up_dir = _env_bool("DIGIPATH_LIFT_UP_DIR", "1")

        self.rotate_pul = _env_int(
            "DIGIPATH_ROTATE_PUL_GPIO",
            _env_int("DIGIPATH_ROTATE_SELECT_GPIO", _env_int("DIGIPATH_RELAY2_GPIO", 27)),
        )
        self.rotate_dir = _env_int("DIGIPATH_ROTATE_DIR_GPIO", 23)
        self.rotate_ena = _env_int("DIGIPATH_ROTATE_ENA_GPIO", 24)
        self.rotate_left_steps = _env_int("DIGIPATH_ROTATE_LEFT_STEPS", 400)
        self.rotate_left_dir = _env_bool("DIGIPATH_ROTATE_LEFT_DIR", "0")

        self.lift_home_steps = _env_int("DIGIPATH_LIFT_HOME_STEPS", 0)
        self.lift_scan_steps = _env_int("DIGIPATH_LIFT_SCAN_STEPS", _env_int("DIGIPATH_LIFT_UP_STEPS", 800))
        self.layer_steps = {
            1: _env_int("DIGIPATH_LAYER1_STEPS", 250),
            2: _env_int("DIGIPATH_LAYER2_STEPS", 500),
            3: _env_int("DIGIPATH_LAYER3_STEPS", 750),
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
                "DT-001": 1,
                "DT-002": 1,
                "DT-003": 2,
                "DT-004": 2,
                "DT-005": 3,
                "DT-006": 3,
                "DT-007": 2,
                "DT-008": 2,
                "DT-009": 3,
            }
        try:
            parsed = json.loads(raw)
            return {str(key): int(value) for key, value in parsed.items()}
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}

    @property
    def step_delay_secs(self):
        return max(self.step_delay_us, 50) / 1_000_000.0

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
                "upDirHigh": self.lift_up_dir,
                "layerSteps": self.layer_steps,
            },
            "rotate": {
                "pulGpio": self.rotate_pul,
                "dirGpio": self.rotate_dir,
                "enaGpio": self.rotate_ena,
                "leftSteps": self.rotate_left_steps,
                "leftDirHigh": self.rotate_left_dir,
            },
            "priorityLayerMap": self.priority_layer_map,
            "lastError": self._last_error,
        }

    def _move_lift_to(self, target_steps, label):
        if not self.enabled or not self._lift:
            return
        target_steps = max(0, int(target_steps))
        delta = target_steps - self._current_lift_steps
        if delta == 0:
            print(f"[Motor] lift: already at {label} ({target_steps} steps)")
            return
        direction = self.lift_up_dir if delta > 0 else (not self.lift_up_dir)
        self._lift.step(abs(delta), direction, self.step_delay_secs, label)
        self._current_lift_steps = target_steps

    def rotate_left(self, steps=None):
        if not self.enabled or not self._rotate:
            return
        count = self.rotate_left_steps if steps is None else int(steps)
        with self._lock:
            self._rotate.step(count, self.rotate_left_dir, self.step_delay_secs, "rotate-left")

    def lift_to_scan(self):
        with self._lock:
            self._move_lift_to(self.lift_scan_steps, "lift-to-scan")

    def lift_to_layer(self, layer):
        layer = self._clamp_layer(layer)
        with self._lock:
            self._move_lift_to(self._layer_steps_for(layer), f"lift-to-layer-{layer}")

    def return_home(self):
        with self._lock:
            self._move_lift_to(self.lift_home_steps, "lift-home")

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
        """Feed/align document, then lift to camera scan height."""
        if not self.enabled:
            return
        print("[Motor] Starting scan sequence (feed + scan height)...")
        self.rotate_left()
        self.lift_to_scan()

    def finish_scan_sequence(self, sort_layer=1):
        """Deposit scanned document to sorting layer, then return home."""
        if not self.enabled:
            return
        layer = self._clamp_layer(sort_layer)
        self._last_sort_layer = layer
        print(f"[Motor] Sorting document to layer {layer}...")
        self.lift_to_layer(layer)
        time.sleep(max(_env_int("DIGIPATH_LAYER_SETTLE_MS", 300), 0) / 1000.0)
        self.return_home()
        print(f"[Motor] Scan + sort complete (layer {layer}).")

    def cleanup(self):
        with self._lock:
            try:
                self.return_home()
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
