import { useEffect, useRef, useState } from 'react';
import { getCachedIceServers, preloadIceServers } from '../api/apiBase';

const resolveIceServers = async () => {
  const cached = getCachedIceServers();
  if (cached?.length) return cached;
  return preloadIceServers();
};

const isLocalPreviewHost = () => {
  if (typeof window === 'undefined') return false;
  const { hostname } = window.location;
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || /^192\.168\./.test(hostname)
    || /^10\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
};

const parseDeviceId = (channel = '') => {
  const parts = channel.split(':');
  return parts.length >= 2 ? parts[1] : 'DEV-001';
};

/**
 * Likhain-style WebRTC preview: recvonly video, jitterBufferTarget=0, stable MediaStream ref.
 */
export function useScannerWebRtc({ client, channel, enabled, reloadKey = 0, onReady, onFailed }) {
  const [remoteStream, setRemoteStream] = useState(null);
  const [connected, setConnected] = useState(false);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const iceQueueRef = useRef([]);
  const startedRef = useRef(false);
  const onReadyRef = useRef(onReady);
  const onFailedRef = useRef(onFailed);
  onReadyRef.current = onReady;
  onFailedRef.current = onFailed;

  useEffect(() => {
    if (!enabled || !client || !channel) {
      return undefined;
    }

    const webrtcEnabled = import.meta.env.VITE_SCANNER_WEBRTC !== '0';
    if (!webrtcEnabled || typeof RTCPeerConnection === 'undefined') {
      onFailedRef.current?.('webrtc-unavailable');
      return undefined;
    }

    let stopped = false;
    let offAnswer = null;
    let offIce = null;
    let offOpen = null;
    const remoteMerged = new MediaStream();
    streamRef.current = remoteMerged;

    const flushIce = async (pc) => {
      if (!pc?.remoteDescription) return;
      while (iceQueueRef.current.length) {
        const candidate = iceQueueRef.current.shift();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // ignore stale candidates
        }
      }
    };

    const setupPeer = async () => {
      const iceServers = await resolveIceServers();
      if (stopped) return;

      const pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: isLocalPreviewHost() ? 0 : 2,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });
      pcRef.current = pc;
      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.onicecandidate = (event) => {
        if (!event.candidate || stopped) return;
        client.sendMessage?.({
          type: 'scanner:webrtc:ice',
          channel,
          candidate: event.candidate.toJSON(),
        });
      };

      pc.ontrack = (event) => {
        if (event.track.kind === 'video') {
          const recv = event.receiver;
          if (recv) {
            if ('jitterBufferTarget' in recv) {
              recv.jitterBufferTarget = 0;
            }
            if ('playoutDelayHint' in recv) {
              recv.playoutDelayHint = 0;
            }
          }
        }
        const ms = streamRef.current;
        if (!ms.getTracks().some((track) => track.id === event.track.id)) {
          ms.addTrack(event.track);
        }
        setRemoteStream((prev) => (prev === ms ? prev : ms));
        setConnected(true);
        onReadyRef.current?.('webrtc');
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          onFailedRef.current?.(pc.connectionState);
        }
      };

      const onAnswer = async (message) => {
        if (stopped || message.channel !== channel) return;
        try {
          await pc.setRemoteDescription(message.sdp);
          await flushIce(pc);
        } catch {
          onFailedRef.current?.('answer-error');
        }
      };

      const onIce = async (message) => {
        if (stopped || message.channel !== channel || !message.candidate) return;
        iceQueueRef.current.push(message.candidate);
        await flushIce(pc);
      };

      const start = async () => {
        if (startedRef.current || stopped) return;
        startedRef.current = true;
        try {
      const offer = await pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false,
        voiceActivityDetection: false,
      });
          await pc.setLocalDescription(offer);
          client.sendMessage?.({
            type: 'scanner:webrtc:offer',
            channel,
            deviceId: parseDeviceId(channel),
            sdp: {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            },
          });
        } catch {
          onFailedRef.current?.('offer-error');
        }
      };

      offAnswer = client.on?.('scanner:webrtc:answer', onAnswer);
      offIce = client.on?.('scanner:webrtc:ice', onIce);
      offOpen = client.on?.('connection:open', start);

      if (client.connected) start();
    };

    setupPeer();

    return () => {
      stopped = true;
      startedRef.current = false;
      offAnswer?.();
      offIce?.();
      offOpen?.();
      iceQueueRef.current = [];
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      setRemoteStream(null);
      setConnected(false);
    };
  }, [client, channel, enabled, reloadKey]);

  return { remoteStream, connected, mode: connected ? 'webrtc' : 'connecting' };
}
