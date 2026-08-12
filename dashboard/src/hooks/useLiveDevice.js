import { useEffect, useRef, useState } from 'react';
import { useOptionalRealtime } from '../context/RealtimeContext';

const isDeviceOnline = (device) => Boolean(device?.connected || device?.streamWsConnected);

/**
 * Keeps device status in sync via WebSocket `device:updated` events
 * without requiring a manual page refresh.
 */
export function useLiveDevice(sourceDevice) {
  const realtime = useOptionalRealtime();
  const [device, setDevice] = useState(sourceDevice);
  const wasOnlineRef = useRef(isDeviceOnline(sourceDevice));

  useEffect(() => {
    setDevice(sourceDevice);
    wasOnlineRef.current = isDeviceOnline(sourceDevice);
  }, [sourceDevice]);

  useEffect(() => {
    if (!realtime?.client) return undefined;
    return realtime.subscribe('device:updated', (message) => {
      if (!message?.device) return;
      setDevice(message.device);
    });
  }, [realtime]);

  const cameOnline = isDeviceOnline(device) && !wasOnlineRef.current;

  useEffect(() => {
    wasOnlineRef.current = isDeviceOnline(device);
  }, [device]);

  return { device, cameOnline, isOnline: isDeviceOnline(device) };
}

export { isDeviceOnline };
