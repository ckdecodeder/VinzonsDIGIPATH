"""Backward-compatible import — hardware is TB6600 stepper drivers, not relays."""

from motor_controller import motor_controller as relay_controller

__all__ = ["relay_controller"]
