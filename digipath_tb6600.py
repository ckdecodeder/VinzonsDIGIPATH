"""
TB6600 stepper driver for Raspberry Pi GPIO (PUL + DIR + optional ENA).

Wiring modes (set DIGIPATH_TB6600_SIGNAL_SINK in .env):
  source (default): PUL+/DIR+/ENA+ -> GPIO,  PUL-/DIR-/ENA- -> GND
  sink:             PUL+/DIR+/ENA+ -> 5V,    PUL-/DIR-/ENA- -> GPIO
"""

from __future__ import annotations

import os
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
        self._dir = None
        self._ena = None
        self._sim_direction = False
        self._sim_position = 0

        if simulate:
            return

        from gpiozero import OutputDevice

        # Source: idle LOW on + pins. Sink (GPIO on - pins): idle HIGH.
        idle_high = self.signal_sink
        self._pul = OutputDevice(self.pul_bcm, active_high=True, initial_value=idle_high)
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

    def _drive_high(self, dev):
        dev.on()

    def _drive_low(self, dev):
        dev.off()

    def _pulse_on(self):
        if self.signal_sink:
            self._drive_low(self._pul)
        else:
            self._drive_high(self._pul)

    def _pulse_off(self):
        if self.signal_sink:
            self._drive_high(self._pul)
        else:
            self._drive_low(self._pul)

    def set_enabled(self, enabled: bool):
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

    def pulse_once(self, high_us: int, low_us: int):
        if self.simulate:
            self._sim_position += 1 if self._sim_direction else -1
            time.sleep((high_us + low_us) / 1_000_000.0)
            return
        self._pulse_on()
        time.sleep(high_us / 1_000_000.0)
        self._pulse_off()
        time.sleep(low_us / 1_000_000.0)

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
        high_us = max(2, delay_us // 2)
        low_us = max(2, delay_us - high_us)
        self.set_direction(forward)
        self._dir_settle_delay()
        moved = 0
        for _ in range(count):
            if stop_event is not None and stop_event.is_set():
                break
            self.pulse_once(high_us, low_us)
            moved += 1
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
