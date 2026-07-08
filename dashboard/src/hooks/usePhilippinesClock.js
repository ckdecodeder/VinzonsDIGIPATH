import { useEffect, useRef, useState } from 'react';
import { formatPhilippinesDateTime, manilaPartsToEpoch } from '../utils/philippinesDateTime';

async function fetchManilaEpochMs() {
  const res = await fetch('https://timeapi.io/api/Time/current/zone?timeZone=Asia/Manila', {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('timeapi unavailable');
  const data = await res.json();
  if (!data?.year) throw new Error('timeapi payload invalid');
  const epochMs = manilaPartsToEpoch(data);
  if (Number.isNaN(epochMs)) throw new Error('timeapi epoch invalid');
  return epochMs;
}

export default function usePhilippinesClock() {
  const [displayTime, setDisplayTime] = useState(() => formatPhilippinesDateTime());
  const anchorRef = useRef({
    epochMs: Date.now(),
    localMs: Date.now(),
  });

  useEffect(() => {
    let cancelled = false;
    let tickInterval;
    let resyncInterval;

    const currentEpochMs = () => {
      const { epochMs, localMs } = anchorRef.current;
      return epochMs + (Date.now() - localMs);
    };

    const tick = () => {
      setDisplayTime(formatPhilippinesDateTime(new Date(currentEpochMs())));
    };

    const sync = async () => {
      try {
        const epochMs = await fetchManilaEpochMs();
        if (cancelled) return;
        anchorRef.current = { epochMs, localMs: Date.now() };
        tick();
      } catch {
        // Keep ticking from the last known anchor.
      }
    };

    sync();
    tickInterval = window.setInterval(tick, 1000);
    resyncInterval = window.setInterval(sync, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(tickInterval);
      window.clearInterval(resyncInterval);
    };
  }, []);

  return displayTime;
}
