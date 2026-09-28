"""
Legacy motor controller — REMOVED (no-op stub for old bridge compatibility).

Do not use for new work. Build a new motor algorithm separately and wire it
into pi_ws_scanner.py when ready.
"""


class MotorController:
    def __init__(self):
        self.enabled = False

    def status(self):
        return {
            "enabled": False,
            "removed": True,
            "message": "Legacy motor_controller removed — awaiting new algorithm",
        }

    def run_scan_sequence(self, *args, **kwargs):
        return False

    def finish_scan_sequence(self, *args, **kwargs):
        return False

    def resolve_sort_layer(self, payload=None, text="", title=""):
        return 1

    def cleanup(self):
        return None


motor_controller = MotorController()


if __name__ == "__main__":
    print(motor_controller.status())
