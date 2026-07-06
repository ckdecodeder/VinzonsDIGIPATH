import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { realtimeClient } from '../ws/realtimeClient';

const RealtimeContext = createContext(null);

export const RealtimeProvider = ({ enabled, children }) => {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      realtimeClient.disconnect();
      setConnected(false);
      return undefined;
    }

    const offOpen = realtimeClient.on('connection:open', () => setConnected(true));
    const offClose = realtimeClient.on('connection:close', () => setConnected(false));
    realtimeClient.connect();

    return () => {
      offOpen();
      offClose();
      realtimeClient.disconnect();
      setConnected(false);
    };
  }, [enabled]);

  const value = useMemo(() => ({
    connected,
    client: realtimeClient,
    subscribe: (eventName, handler) => realtimeClient.on(eventName, handler),
    subscribeChannel: (channel) => {
      realtimeClient.subscribe(channel);
      return () => realtimeClient.unsubscribe(channel);
    },
  }), [connected]);

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
};

export const useRealtime = () => {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within RealtimeProvider');
  }
  return context;
};

export const useOptionalRealtime = () => useContext(RealtimeContext);
