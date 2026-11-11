'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiUrl } from './api';

export type LiveStatus = 'connecting' | 'online' | 'offline';

/**
 * Connexion temps réel (namespace /live). `onEvent` est appelé à chaque événement de combat ; l'écran relit alors l'état
 * complet auprès de l'API, ce qui évite de recoller des événements manqués après une coupure de Wi-Fi.
 */
export function useLive(token: string | undefined, onEvent: () => void): { status: LiveStatus; socket: Socket | null } {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [socket, setSocket] = useState<Socket | null>(null);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const s = io(`${apiUrl()}/live`, { auth: token ? { token } : {}, transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
    const resync = () => handler.current();
    s.on('connect', () => {
      setStatus('online');
      s.emit('watch');
      resync(); // après une reconnexion, on rattrape ce qui a été manqué
    });
    s.on('disconnect', () => setStatus('offline'));
    s.on('connect_error', () => setStatus('offline'));
    for (const ev of ['state', 'progress', 'revealed', 'confirmed']) s.on(ev, resync);
    setSocket(s);
    return () => {
      s.close();
      setSocket(null);
    };
  }, [token]);

  return { status, socket };
}
