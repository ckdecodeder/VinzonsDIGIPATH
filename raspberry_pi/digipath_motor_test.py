#!/usr/bin/env python3
"""
NEMA + TB6600 motor test — clockwise (CW) and counter-clockwise (CCW).

Uses digipath_tb6600.py (same pins as pi_ws_scanner.env).
Run on Raspberry Pi with motors wired. Use --simulate on laptop.

Examples:
  python3 digipath_motor_test.py lift cw 400
  python3 digipath_motor_test.py lift ccw 400
  python3 digipath_motor_test.py lift -400          # same as ccw 400
  python3 digipath_motor_test.py lift down 400
  python3 digipath_motor_test.py lift up 400
  python3 digipath_motor_test.py sort ccw 200
  python3 digipath_motor_test.py --interactive
  python3 digipath_motor_test.py --simulate lift cw 50
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from digipath_tb6600 import LiftAxis, SortAxis, _env_bool, _env_int


def _parse_direction(raw: str) -> bool:
    """Return True = clockwise (DIR forward/high), False = counter-clockwise."""
    value = raw.strip().lower()
    if value in ("cw", "clockwise", "forward", "fwd"):
        return True
    if value in ("ccw", "counter-clockwise", "counterclockwise", "reverse", "rev"):
        return False
    if value in ("down",):
        return True
    if value in ("up",):
        return False
    raise argparse.ArgumentTypeError(f"Unknown direction: {raw!r} (use cw, ccw, up, down)")


def _resolve_move(axis_name: str, direction: bool, steps: int, axis) -> tuple[bool, int]:
    """Map lift up/down to DIR polarity; return (clockwise_for_step, steps)."""
    count = abs(int(steps))
    count = max(1, min(count, 50000))
    if axis_name != "lift":
        return direction, count
    down_high = _env_bool("DIGIPATH_LIFT_DOWN_DIR_HIGH", "1")
    # For lift: down = down_is_dir_high, up = opposite
    if direction:  # cw/down request
        return down_high, count
  # ccw/up request
    return not down_high, count


def _parse_steps_arg(raw: int | None, direction: bool | None) -> tuple[bool, int]:
    """Support negative steps: lift -400 == ccw/up 400."""
    if raw is None:
        raise ValueError("steps required")
    steps = int(raw)
    if steps < 0:
        return False if direction is None else direction, abs(steps)
    if steps == 0:
        return True, 1
    return True if direction is None else direction, steps


def _motor_label(axis_name: str, clockwise: bool) -> str:
    if axis_name == "lift":
        down_high = _env_bool("DIGIPATH_LIFT_DOWN_DIR_HIGH", "1")
        if clockwise:
            return "CW (DIR forward — down if DOWN_DIR_HIGH=1)" if down_high else "CW (DIR forward — up)"
        return "CCW (DIR reverse — up if DOWN_DIR_HIGH=1)" if down_high else "CCW (DIR reverse — down)"
    if clockwise:
        return "CW (DIR forward)"
    return "CCW (DIR reverse)"


def _build_axes(simulate: bool) -> tuple[LiftAxis, SortAxis]:
    lift = LiftAxis(
        "lift",
        _env_int("DIGIPATH_LIFT_PUL_BCM", 17),
        _env_int("DIGIPATH_LIFT_DIR_BCM", 27),
        _env_int("DIGIPATH_LIFT_ENA_BCM", 22),
        down_is_dir_high=_env_bool("DIGIPATH_LIFT_DOWN_DIR_HIGH", "1"),
        simulate=simulate,
    )
    sort_axis = SortAxis(
        "sort",
        _env_int("DIGIPATH_SORT_PUL_BCM", 23),
        _env_int("DIGIPATH_SORT_DIR_BCM", 24),
        _env_int("DIGIPATH_SORT_ENA_BCM", 25),
        simulate=simulate,
    )
    return lift, sort_axis


def _pause(secs: float, label: str = ""):
    if secs <= 0:
        return
    if label:
        print(f"[Test] Wait {secs:.1f}s — {label}")
    time.sleep(secs)


def run_axis(
    axis,
    axis_name: str,
    clockwise: bool,
    steps: int,
    *,
    settle_secs: float,
    step_delay_us: int,
) -> int:
    forward, count = _resolve_move(axis_name, clockwise, steps, axis)
    label = _motor_label(axis_name, clockwise)
    print(f"[Test] {axis_name.upper()} {label} — {count} steps (DIR forward={int(forward)})")
    _pause(settle_secs, f"before {axis_name} move")

    axis.set_enabled(True)
    try:
        moved = axis.step(count, forward=forward, step_delay_us=step_delay_us)
        print(f"[Test] {axis_name.upper()} done — moved {moved} steps")
        _pause(settle_secs, f"after {axis_name} move")
        return moved
    finally:
        axis.set_enabled(False)


def interactive_loop(lift: LiftAxis, sort_axis: SortAxis, *, settle_secs: float, step_delay_us: int, default_steps: int):
    print("")
    print("=== DigiPath NEMA motor test (CW / CCW) ===")
    print("Pins from .env / pi_ws_scanner.env")
    print(f"Settle delay: {settle_secs}s   Step delay: {step_delay_us} us")
    print("")
    print("  1  Lift clockwise / down (CW)")
    print("  2  Lift counter-clockwise / up (CCW)")
    print("  3  Sort clockwise (CW)")
    print("  4  Sort counter-clockwise (CCW)")
    print("  5  Lift down then up (return)")
    print("  6  Sort CW then CCW (return)")
    print("  q  Quit")
    print("")

    while True:
        try:
            choice = input("Choice [1-6/q]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n[Test] Exit")
            break

        if choice in ("q", "quit", "exit"):
            break

        try:
            steps_raw = input(f"Steps [{default_steps}, negative=reverse]: ").strip()
            if not steps_raw:
                steps = default_steps
            else:
                steps_val = int(steps_raw)
                steps = abs(steps_val)
                if steps_val < 0:
                    if choice == "1":
                        choice = "2"
                    elif choice == "3":
                        choice = "4"
            steps = max(1, min(steps, 50000))
        except ValueError:
            print("[Test] Invalid steps")
            continue

        try:
            if choice == "1":
                run_axis(lift, "lift", True, steps, settle_secs=settle_secs, step_delay_us=step_delay_us)
            elif choice == "2":
                run_axis(lift, "lift", False, steps, settle_secs=settle_secs, step_delay_us=step_delay_us)
            elif choice == "3":
                run_axis(sort_axis, "sort", True, steps, settle_secs=settle_secs, step_delay_us=step_delay_us)
            elif choice == "4":
                run_axis(sort_axis, "sort", False, steps, settle_secs=settle_secs, step_delay_us=step_delay_us)
            elif choice == "5":
                run_axis(lift, "lift", True, steps, settle_secs=settle_secs, step_delay_us=step_delay_us)
                run_axis(lift, "lift", False, steps, settle_secs=settle_secs, step_delay_us=step_delay_us)
            elif choice == "6":
                run_axis(sort_axis, "sort", True, steps, settle_secs=settle_secs, step_delay_us=step_delay_us)
                run_axis(sort_axis, "sort", False, steps, settle_secs=settle_secs, step_delay_us=step_delay_us)
            else:
                print("[Test] Unknown choice")
        except Exception as err:
            print(f"[Test] Error: {err}")
        print("")


def probe_direction(lift: LiftAxis, sort_axis: SortAxis, motor_name: str, *, steps: int, step_delay_us: int):
    """Toggle DIR and pulse a few steps each way — find if DIR pin actually changes."""
    axis = lift if motor_name == "lift" else sort_axis
    bcm_dir = axis.dir_bcm
    bcm_pul = axis.pul_bcm
    small = max(5, min(int(steps), 80))

    print("")
    print(f"=== DIR probe: {motor_name.upper()} ===")
    print(f"PUL BCM {bcm_pul}   DIR BCM {bcm_dir}")
    sink = _env_bool("DIGIPATH_TB6600_SIGNAL_SINK", "0")
    print(f"Signal mode: {'SINK (GPIO on - pins, + to 5V)' if sink else 'SOURCE (GPIO on + pins, - to GND)'}")
    print("On Pi (another terminal):  raspi-gpio get", bcm_dir)
    print("")

    for label, forward in (("DIR HIGH / forward", True), ("DIR LOW / reverse", False)):
        print(f"--- {label} ---")
        axis.set_enabled(True)
        try:
            axis.set_direction(forward)
            axis._dir_settle_delay()
            level = axis.dir_gpio_level()
            print(f"DIR forward={int(forward)}  GPIO readback={level}")
            time.sleep(1.5)
            moved = axis.step(small, forward=forward, step_delay_us=step_delay_us)
            print(f"Pulsed {moved} steps")
        finally:
            axis.set_enabled(False)
        time.sleep(2.0)

    print("")
    print("If GPIO readback is SAME both times → DIR pin not switching (rewire or wrong pin).")
    print("If readback changes but motor same direction → try DIGIPATH_TB6600_SIGNAL_SINK=1 (rewire + to 5V).")
    print("If readback changes and motor changes → working; use up/down or ccw/cw normally.")


def main() -> int:
    parser = argparse.ArgumentParser(description="NEMA motor CW/CCW test (TB6600)")
    parser.add_argument("motor", nargs="?", choices=("lift", "sort"), help="Motor to test")
    parser.add_argument("direction", nargs="?", type=_parse_direction, help="cw or ccw")
    parser.add_argument("steps", nargs="?", type=int, help="Number of steps")
    parser.add_argument("--interactive", "-i", action="store_true", help="Interactive menu")
    parser.add_argument("--probe-dir", metavar="MOTOR", choices=("lift", "sort"), help="DIR diagnostic (lift or sort)")
    parser.add_argument("--probe-steps", type=int, default=40, help="Steps per direction in --probe-dir")
    parser.add_argument("--simulate", action="store_true", help="No GPIO — dry run")
    parser.add_argument("--settle", type=float, default=None, help="Seconds between moves (default: env or 3)")
    parser.add_argument("--step-delay-us", type=int, default=None, help="Pulse delay microseconds")
    parser.add_argument("--default-steps", type=int, default=400, help="Default steps in interactive mode")
    args = parser.parse_args()

    simulate = args.simulate or _env_bool("DIGIPATH_MECH_SIMULATE", "0")
    settle_secs = args.settle if args.settle is not None else float(os.environ.get("DIGIPATH_MOTOR_SETTLE_SECS", "3"))
    step_delay_us = args.step_delay_us if args.step_delay_us is not None else _env_int("DIGIPATH_MOTOR_STEP_DELAY_US", 900)

    if simulate:
        print("[Test] SIMULATE mode — no GPIO pulses")
    else:
        try:
            import gpiozero  # noqa: F401
        except ImportError:
            print("[Test] gpiozero not installed. On Pi: sudo apt install python3-gpiozero", file=sys.stderr)
            return 1

    lift, sort_axis = _build_axes(simulate=simulate)
    try:
        if args.probe_dir:
            if simulate:
                print("[Test] --probe-dir needs real GPIO (remove --simulate)")
                return 1
            probe_direction(
                lift,
                sort_axis,
                args.probe_dir,
                steps=args.probe_steps,
                step_delay_us=step_delay_us,
            )
            return 0

        if args.interactive or not args.motor:
            interactive_loop(
                lift,
                sort_axis,
                settle_secs=settle_secs,
                step_delay_us=step_delay_us,
                default_steps=max(1, args.default_steps),
            )
            return 0

        if args.direction is None or args.steps is None:
            parser.error("motor test requires: motor direction steps  (or use --interactive)")

        steps = int(args.steps)
        direction = args.direction
        if steps < 0:
            direction = False
            steps = abs(steps)
        steps = max(1, min(steps, 50000))
        axis = lift if args.motor == "lift" else sort_axis
        run_axis(axis, args.motor, direction, steps, settle_secs=settle_secs, step_delay_us=step_delay_us)
        return 0
    finally:
        lift.close()
        sort_axis.close()


if __name__ == "__main__":
    raise SystemExit(main())
