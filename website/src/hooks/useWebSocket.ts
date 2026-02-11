'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { getWSClient } from '@/lib/ws-client';

export function useWebSocket() {
  const wsRef = useRef(getWSClient());
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const ws = wsRef.current;

    const unsubConnect = ws.onConnect(() => {
      setIsConnected(true);
    });

    const unsubDisconnect = ws.onDisconnect(() => {
      setIsConnected(false);
    });

    ws.connect();

    return () => {
      unsubConnect();
      unsubDisconnect();
    };
  }, []);

  const subscribe = useCallback((type: string, handler: (data: unknown) => void) => {
    return wsRef.current.on(type, handler);
  }, []);

  const send = useCallback((type: string, data: unknown) => {
    wsRef.current.send(type, data);
  }, []);

  const subscribeChannel = useCallback((channel: string) => {
    wsRef.current.subscribe(channel);
  }, []);

  const unsubscribeChannel = useCallback((channel: string) => {
    wsRef.current.unsubscribe(channel);
  }, []);

  return {
    isConnected,
    subscribe,
    send,
    subscribeChannel,
    unsubscribeChannel,
  };
}
