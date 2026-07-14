"""WebRTC camera stream for Pi (aiortc) — likhain-style low-latency video track."""

from __future__ import annotations

import asyncio
import fractions
import threading
import time
from typing import Callable

AIORTC_AVAILABLE = False
try:
    import av
    from aiortc import RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, VideoStreamTrack

    try:
        from aiortc.sdp import candidate_from_sdp
    except ImportError:
        candidate_from_sdp = None  # type: ignore

    AIORTC_AVAILABLE = True
except ImportError:
    RTCPeerConnection = None  # type: ignore
    VideoStreamTrack = object  # type: ignore
    candidate_from_sdp = None  # type: ignore


def parse_remote_ice_candidate(candidate: dict) -> "RTCIceCandidate":
    """Browser sends RTCIceCandidate.toJSON(); aiortc 1.6 needs candidate_from_sdp."""
    cand_str = (candidate.get("candidate") or "").strip()
    if not cand_str:
        raise ValueError("empty ICE candidate")

    if candidate_from_sdp is not None:
        sdp_body = cand_str.split(":", 1)[1].strip() if cand_str.startswith("candidate:") else cand_str
        ice = candidate_from_sdp(sdp_body)
        ice.sdpMid = candidate.get("sdpMid")
        ice.sdpMLineIndex = candidate.get("sdpMLineIndex")
        return ice

    return RTCIceCandidate(
        sdpMid=candidate.get("sdpMid"),
        sdpMLineIndex=candidate.get("sdpMLineIndex"),
        candidate=cand_str,
    )


class PreviewVideoTrack(VideoStreamTrack):
    """Feeds preview BGR frames into a WebRTC video track."""

    kind = "video"

    def __init__(self, frame_getter: Callable[[], object | None], fps: float):
        super().__init__()
        self._frame_getter = frame_getter
        self._fps = max(1.0, float(fps))
        self._count = 0

    async def recv(self):
        # No artificial pacing — encoder pulls latest frame as fast as it can.
        frame_bgr = self._frame_getter()
        if frame_bgr is None:
            await asyncio.sleep(0.002)
            frame_bgr = self._frame_getter()

        video = av.VideoFrame.from_ndarray(frame_bgr, format="bgr24")
        self._count += 1
        video.pts = self._count
        video.time_base = fractions.Fraction(1, int(self._fps))
        return video


class PiWebRtcHub:
    def __init__(self, frame_getter: Callable[[], object | None], fps: float, send_signal):
        self._frame_getter = frame_getter
        self._fps = fps
        self._send_signal = send_signal
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._pcs: dict[str, RTCPeerConnection] = {}
        self._active = False

    @property
    def available(self) -> bool:
        return AIORTC_AVAILABLE

    @property
    def active(self) -> bool:
        return self._active

    def start(self) -> bool:
        if not AIORTC_AVAILABLE:
            print("[PiWebRTC] aiortc not installed — run: bash scripts/pi-install-webrtc.sh")
            return False
        if self._thread:
            return True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="pi-webrtc")
        self._thread.start()
        for _ in range(50):
            if self._loop:
                print("[PiWebRTC] Ready (likhain-style WebRTC video)")
                return True
            time.sleep(0.02)
        return False

    def _run_loop(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def _submit(self, coro, timeout=45):
        if not self._loop:
            return None
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        try:
            return future.result(timeout=timeout)
        except Exception as err:
            print(f"[PiWebRTC] {err}")
            return None

    async def _close_pc(self, user_id: str):
        pc = self._pcs.pop(user_id, None)
        if pc:
            await pc.close()
        if not self._pcs:
            self._active = False

    async def _on_offer(self, user_id: str, channel: str, sdp: dict):
        await self._close_pc(user_id)

        pc = RTCPeerConnection()
        self._pcs[user_id] = pc
        track = PreviewVideoTrack(self._frame_getter, self._fps)
        pc.addTrack(track)

        @pc.on("icecandidate")
        async def on_ice(event):
            if not event.candidate:
                return
            self._send_signal(
                {
                    "type": "scanner:webrtc:ice",
                    "channel": channel,
                    "userId": user_id,
                    "candidate": event.candidate.to_json(),
                }
            )

        @pc.on("connectionstatechange")
        async def on_state_change():
            state = pc.connectionState
            print(f"[PiWebRTC] peer {user_id} state={state}")
            if state in ("failed", "closed", "disconnected"):
                await self._close_pc(user_id)

        offer = RTCSessionDescription(sdp=sdp.get("sdp", ""), type=sdp.get("type", "offer"))
        await pc.setRemoteDescription(offer)
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        self._active = True

        self._send_signal(
            {
                "type": "scanner:webrtc:answer",
                "channel": channel,
                "userId": user_id,
                "sdp": {
                    "type": pc.localDescription.type,
                    "sdp": pc.localDescription.sdp,
                },
            }
        )
        print(f"[PiWebRTC] Sent answer to dashboard user {user_id}")

    async def _on_ice(self, user_id: str, candidate: dict | None):
        pc = self._pcs.get(user_id)
        if not pc or not candidate:
            return
        try:
            ice = parse_remote_ice_candidate(candidate)
            await pc.addIceCandidate(ice)
        except Exception as err:
            print(f"[PiWebRTC] ICE candidate error: {err}")

    def handle_offer(self, user_id: str, channel: str, sdp: dict):
        if not user_id or not channel or not sdp:
            return
        self._submit(self._on_offer(user_id, channel, sdp))

    def handle_ice(self, user_id: str, candidate: dict | None):
        if not user_id:
            return
        self._submit(self._on_ice(user_id, candidate), timeout=10)

    def close_all(self):
        if not self._loop:
            return
        for user_id in list(self._pcs.keys()):
            self._submit(self._close_pc(user_id), timeout=10)
