#!/usr/bin/env python3
"""Verify Raspberry Pi bridge dependencies after install-pi-deps.sh."""

from __future__ import annotations

import importlib.util
import shutil
import sys


def check(module: str, required: bool = True) -> bool:
    ok = importlib.util.find_spec(module) is not None
    label = "OK " if ok else ("FAIL" if required else "WARN")
    print(f"{label} {module}")
    return ok or not required


def main() -> int:
    print("[DigiPath] Dependency check")
    print(f"Python: {sys.version.split()[0]} ({sys.executable})")
    print(f"rpicam-still: {'yes' if shutil.which('rpicam-still') else 'no'}")
    print(f"libcamera-still: {'yes' if shutil.which('libcamera-still') else 'no'}")
    print(f"tesseract: {'yes' if shutil.which('tesseract') else 'no'}")
    print("")

    required_ok = all(
        [
            check("requests"),
            check("PIL"),
            check("pytesseract"),
            check("websocket"),
            check("numpy"),
            check("cv2"),
        ]
    )
    check("picamera2", required=False)

    if required_ok:
        print("\nAll required modules are available.")
        return 0

    print("\nSome required modules are missing. Run: sudo bash install-pi-deps.sh")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
