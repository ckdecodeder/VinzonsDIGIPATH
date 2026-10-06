#!/usr/bin/env python3
"""
YS-27 Hall sensor live readout — hold a magnet near each sensor to verify wiring.

  python3 digipath_hall_test.py
  python3 digipath_hall_test.py --once
  python3 digipath_hall_test.py --simulate
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from digipath_hall_ys27 import SENSOR_LABELS, build_default_bank


def _load_env():
    root = os.path.dirname(os.path.abspath(__file__))
    for name in (".env", "pi_ws_scanner.env"):
        path = os.path.join(root, name)
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip().replace("\r", "")
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if key and key not in os.environ:
                    os.environ[key] = value.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="DigiPath YS-27 hall sensor test")
    parser.add_argument("--once", action="store_true", help="Print one snapshot and exit")
    parser.add_argument("--simulate", action="store_true", help="No GPIO — software only")
    parser.add_argument("--interval", type=float, default=0.25, help="Poll interval seconds")
    args = parser.parse_args()

    _load_env()
    bank = build_default_bank(simulate=args.simulate)

    print("=== DigiPath Hall sensors (YS-27) ===")
    print("Magnetic: sensor triggers when a magnet is CLOSE (typically output goes LOW).")
    print("Bring a small neodymium magnet near each module — label should show ON.")
    print("Pins from .env (BCM) — shared pins listed once:")
    seen: set[int] = set()
    for sid, label in SENSOR_LABELS.items():
        bcm = bank.pin_map.get(sid, 0)
        if bcm <= 0:
            print(f"  {sid} {label:28} (no GPIO — steps only)")
            continue
        if bcm in seen:
            continue
        seen.add(bcm)
        shared = [
            SENSOR_LABELS[s]
            for s, pin in bank.pin_map.items()
            if pin == bcm and s != sid
        ]
        extra = f"  also: {', '.join(shared)}" if shared else ""
        print(f"  {sid} {label:28} GPIO{bcm}{extra}")
    print("Ctrl+C to stop.\n")

    try:
        while True:
            readings = bank.read_all_labeled()
            line = "  ".join(
                f"{name}:{'ON ' if active else 'off'}" for name, active in readings.items()
            )
            print(line, flush=True)
            if args.once:
                break
            time.sleep(max(0.05, args.interval))
    except KeyboardInterrupt:
        print("\n[Hall] Exit")
    finally:
        bank.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
