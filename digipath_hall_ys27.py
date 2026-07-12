"""
YS-27 Hall sensor modules on Raspberry Pi GPIO (6 sensors).

Mapping (default):
  1 = door (closed = magnet detected)
  2 = main / home (lift rests here after sort)
  3 = capture / exact camera frame
  4 = sort layer 1 (Memorandum)
  5 = sort layer 2 (Executive Order)
  6 = sort layer 3 (Communication Letter)
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Callable


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: str = "1") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


DOOR = 1
MAIN = 2
CAPTURE = 3
LAYER_1 = 4
LAYER_2 = 5
LAYER_3 = 6

# Backward-compatible alias
PREVIEW = CAPTURE

LAYER_TO_SENSOR = {
    1: LAYER_1,
    2: LAYER_2,
    3: LAYER_3,
}

SENSOR_LABELS = {
    DOOR: "door",
    MAIN: "main",
    CAPTURE: "capture",
    LAYER_1: "layer1-memorandum",
    LAYER_2: "layer2-executive-order",
    LAYER_3: "layer3-communication-letter",
}


@dataclass(frozen=True)
class HallReading:
    sensor_id: int
    triggered: bool


class HallSensorBank:
    """Six YS-27 digital outputs — LOW = magnet detected (active-low, pull-up)."""

    def __init__(self, pin_map: dict[int, int], *, active_low: bool = True, simulate: bool = False):
        self.pin_map = {int(k): int(v) for k, v in pin_map.items()}
        self.active_low = active_low
        self.simulate = simulate
        self._inputs: dict[int, object] = {}
        self._sim_state: dict[int, bool] = {sid: False for sid in self.pin_map}

        if simulate:
            return

        from gpiozero import DigitalInputDevice

        for sensor_id, bcm in self.pin_map.items():
            self._inputs[sensor_id] = DigitalInputDevice(
                bcm,
                pull_up=True,
                bounce_time=0.02,
            )

    def close(self):
        for dev in self._inputs.values():
            try:
                dev.close()
            except Exception:
                pass
        self._inputs.clear()

    def simulate_trigger(self, sensor_id: int, triggered: bool = True):
        if sensor_id in self._sim_state:
            self._sim_state[sensor_id] = triggered

    def is_triggered(self, sensor_id: int) -> bool:
        if sensor_id not in self.pin_map:
            return False
        if self.simulate:
            return bool(self._sim_state.get(sensor_id, False))
        dev = self._inputs[sensor_id]
        raw = bool(dev.is_active)
        return raw if not self.active_low else not raw

    def read_all(self) -> dict[int, bool]:
        return {sid: self.is_triggered(sid) for sid in sorted(self.pin_map)}

    def read_all_labeled(self) -> dict[str, bool]:
        return {SENSOR_LABELS.get(sid, f"s{sid}"): self.is_triggered(sid) for sid in sorted(self.pin_map)}

    def wait_for(
        self,
        sensor_id: int,
        *,
        timeout_secs: float = 30.0,
        poll_secs: float = 0.004,
        stop_event=None,
    ) -> bool:
        deadline = time.monotonic() + max(0.1, timeout_secs)
        while time.monotonic() < deadline:
            if stop_event is not None and stop_event.is_set():
                return False
            if self.is_triggered(sensor_id):
                return True
            time.sleep(poll_secs)
        return False

    def step_until(
        self,
        motor_step: Callable[[int], int],
        *,
        stop_sensor: int,
        max_steps: int,
        chunk_steps: int = 8,
        on_sensor: Callable[[HallReading], None] | None = None,
        stop_event=None,
    ) -> tuple[bool, int, set[int]]:
        """
        Pulse motor in chunks; call on_sensor when any hall fires.
        Stops only when stop_sensor triggers.
        Returns (stopped_at_target, steps_moved, passed_sensors).
        """
        moved = 0
        passed: set[int] = set()
        while moved < max_steps:
            if stop_event is not None and stop_event.is_set():
                break
            chunk = min(chunk_steps, max_steps - moved)
            moved += motor_step(chunk)

            for sid in sorted(self.pin_map):
                if not self.is_triggered(sid):
                    continue
                if sid not in passed:
                    passed.add(sid)
                if on_sensor:
                    on_sensor(HallReading(sensor_id=sid, triggered=True))
                if sid == stop_sensor:
                    return True, moved, passed
        return False, moved, passed


def build_default_bank(simulate: bool = False) -> HallSensorBank:
    pin_map = {
        DOOR: _env_int("DIGIPATH_HALL_DOOR_BCM", 5),
        MAIN: _env_int("DIGIPATH_HALL_MAIN_BCM", 6),
        CAPTURE: _env_int("DIGIPATH_HALL_CAPTURE_BCM", 13),
        LAYER_1: _env_int("DIGIPATH_HALL_LAYER1_BCM", 19),
        LAYER_2: _env_int("DIGIPATH_HALL_LAYER2_BCM", 12),
        LAYER_3: _env_int("DIGIPATH_HALL_LAYER3_BCM", 16),
    }
    active_low = _env_bool("DIGIPATH_HALL_ACTIVE_LOW", "1")
    return HallSensorBank(pin_map, active_low=active_low, simulate=simulate)
