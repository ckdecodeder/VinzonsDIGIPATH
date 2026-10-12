"""
TB6600 stepper driver for Raspberry Pi GPIO (PUL + DIR + optional ENA).

Wiring modes (set DIGIPATH_TB6600_SIGNAL_SINK in .env):
  source (default): PUL+/DIR+/ENA+ -> GPIO,  PUL-/DIR-/ENA- -> GND
  sink:             PUL+/DIR+/ENA+ -> 5V,    PUL-/DIR-/ENA- -> GPIO
"""

from __future__ import annotations

import os
import sys
import time


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


class Tb6600Axis:
    """One TB6600 channel: pulse train on PUL, direction on DIR."""

    def __init__(
        self,
        name: str,
        pul_bcm: int,
        dir_bcm: int,
        ena_bcm: int = 0,
        *,
        ena_active_low: bool = True,
        simulate: bool = False,
        signal_sink: bool | None = None,
        dir_invert: bool | None = None,
    ):
        self.name = name
        self.pul_bcm = int(pul_bcm)
        self.dir_bcm = int(dir_bcm)
        self.ena_bcm = int(ena_bcm or 0)
        self.ena_active_low = ena_active_low
        self.simulate = simulate
        self.signal_sink = (
            signal_sink if signal_sink is not None else _env_bool("DIGIPATH_TB6600_SIGNAL_SINK", "0")
        )
        self.dir_invert = dir_invert if dir_invert is not None else _env_bool("DIGIPATH_MOTOR_DIR_INVERT", "0")
        self._pul = None
        self._pul_pin = None
        self._dir = None
        self._ena = None
        self._sim_direction = False
        self._sim_position = 0
        self._last_forward: bool | None = None
        self._last_step_end = 0.0
        self._ramp_index = 0
        self._ramp_steps = max(0, _env_int("DIGIPATH_MOTOR_RAMP_STEPS", 160))
        self._ramp_start_factor = max(1.0, float(os.environ.get("DIGIPATH_MOTOR_RAMP_START_FACTOR", "3")))
        self._continue_gap_secs = 0.05

        if simulate:
            return

        from gpiozero import OutputDevice

        # Source: idle LOW on + pins. Sink (GPIO on - pins): idle HIGH.
        idle_high = self.signal_sink
        self._pul = OutputDevice(self.pul_bcm, active_high=True, initial_value=idle_high)
        self._pul_pin = getattr(self._pul, "pin", None)
        self._dir = OutputDevice(self.dir_bcm, active_high=True, initial_value=False)
        if self.ena_bcm > 0:
            if self.signal_sink:
                initial = False if ena_active_low else True
            else:
                initial = True if ena_active_low else False
            self._ena = OutputDevice(self.ena_bcm, active_high=True, initial_value=initial)

    def close(self):
        for dev in (self._pul, self._dir, self._ena):
            if not dev:
                continue
            try:
                dev.off()
                dev.close()
            except Exception:
                pass
        self._pul = self._dir = self._ena = None
        self._pul_pin = None

    def _drive_high(self, dev):
        dev.on()

    def _drive_low(self, dev):
        dev.off()

    def _write_pul(self, high: bool):
        # Raw pin write skips gpiozero's per-call locking (~20-40 us) — matters at high step rates.
        pin = self._pul_pin
        if pin is not None:
            try:
                pin.state = 1 if high else 0
                return
            except Exception:
                self._pul_pin = None
        if high:
            self._drive_high(self._pul)
        else:
            self._drive_low(self._pul)

    def _pulse_on(self):
        self._write_pul(not self.signal_sink)

    def _pulse_off(self):
        self._write_pul(self.signal_sink)

    def set_enabled(self, enabled: bool):
        self._last_step_end = 0.0
        if self.simulate or not self._ena:
            return
        if self.signal_sink:
            # ENA- LOW = motor enabled (active-low opto, + tied to 5V)
            if enabled:
                self._drive_low(self._ena)
            else:
                self._drive_high(self._ena)
            return
        if self.ena_active_low:
            self._drive_low(self._ena) if enabled else self._drive_high(self._ena)
        else:
            self._drive_high(self._ena) if enabled else self._drive_low(self._ena)

    def set_direction(self, forward: bool):
        self._last_forward = bool(forward)
        if self.simulate:
            self._sim_direction = bool(forward)
            return
        level_high = bool(forward)
        if self.dir_invert:
            level_high = not level_high
        if level_high:
            self._drive_high(self._dir)
        else:
            self._drive_low(self._dir)

    def dir_gpio_level(self) -> int | None:
        """Read back DIR GPIO level (0/1) for diagnostics."""
        if self.simulate or not self._dir:
            return None
        try:
            return int(self._dir.value)
        except Exception:
            return None

    def _dir_settle_delay(self):
        ms = _env_int("DIGIPATH_MOTOR_DIR_SETTLE_MS", 20)
        if ms > 0:
            time.sleep(ms / 1000.0)

    @staticmethod
    def _wait_until(deadline: float):
        # time.sleep alone overshoots by 60-150 us on a busy Pi, which makes steps uneven.
        remaining = deadline - time.perf_counter()
        if remaining > 0.0004:
            time.sleep(remaining - 0.00025)
        while time.perf_counter() < deadline:
            pass

    def pulse_once(self, high_us: int, low_us: int):
        if self.simulate:
            self._sim_position += 1 if self._sim_direction else -1
            time.sleep((high_us + low_us) / 1_000_000.0)
            return
        start = time.perf_counter()
        self._pulse_on()
        self._wait_until(start + high_us / 1_000_000.0)
        self._pulse_off()
        self._wait_until(start + (high_us + low_us) / 1_000_000.0)

    def _ramp_delay_us(self, index: int, cruise_us: int) -> int:
        ramp_steps = self._ramp_steps
        if ramp_steps <= 0 or index >= ramp_steps:
            return cruise_us
        start_us = max(cruise_us, int(cruise_us * self._ramp_start_factor))
        return int(start_us - (start_us - cruise_us) * (index / ramp_steps))

    def step(
        self,
        steps: int,
        *,
        forward: bool = True,
        step_delay_us: int | None = None,
        stop_event=None,
    ) -> int:
        count = max(0, int(steps))
        if count == 0:
            return 0
        delay_us = step_delay_us if step_delay_us is not None else _env_int("DIGIPATH_MOTOR_STEP_DELAY_US", 900)
        forward = bool(forward)
        now = time.perf_counter()
        # Back-to-back chunks (hall-guided moves) must flow as one continuous move:
        # no DIR settle pause and no fresh ramp unless the motor actually stopped.
        continuing = (
            self._last_forward is forward
            and self._last_step_end > 0
            and (now - self._last_step_end) < self._continue_gap_secs
        )
        if not continuing:
            self._ramp_index = 0
        if self._last_forward is not forward:
            self.set_direction(forward)
            self._dir_settle_delay()
        moved = 0
        # Camera/network threads otherwise hold the GIL for up to 5 ms between our pulses.
        prev_switch = sys.getswitchinterval()
        sys.setswitchinterval(0.0002)
        try:
            for _ in range(count):
                if stop_event is not None and stop_event.is_set():
                    break
                step_us = self._ramp_delay_us(self._ramp_index, delay_us)
                high_us = max(2, step_us // 2)
                self.pulse_once(high_us, max(2, step_us - high_us))
                self._ramp_index += 1
                moved += 1
        finally:
            sys.setswitchinterval(prev_switch)
        self._last_step_end = time.perf_counter()
        return moved

    @property
    def simulated_position(self) -> int:
        return self._sim_position


class LiftAxis(Tb6600Axis):
    """Bidirectional lift — DIR selects up vs down (configurable polarity)."""

    def __init__(self, *args, down_is_dir_high: bool = True, **kwargs):
        super().__init__(*args, **kwargs)
        self.down_is_dir_high = down_is_dir_high

    def step_down(self, steps: int, **kwargs) -> int:
        return self.step(steps, forward=self.down_is_dir_high, **kwargs)

    def step_up(self, steps: int, **kwargs) -> int:
        return self.step(steps, forward=not self.down_is_dir_high, **kwargs)


class SortAxis(Tb6600Axis):
    """Sort carousel with configurable direction."""

    def step_sort(self, steps: int, *, forward: bool = True, **kwargs) -> int:
        return self.step(steps, forward=forward, **kwargs)
