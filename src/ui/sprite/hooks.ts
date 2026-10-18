// React side of the editor state: components call useSp('pixels', 'cursor', …)
// and re-render when any of those events fires, then read `sp` directly.

import { useCallback, useSyncExternalStore } from 'react';
import { on, versions, type SpEvent } from './state';

export function useSp(...events: SpEvent[]): void {
  const key = events.join(' ');
  const subscribe = useCallback((cb: () => void) => {
    const offs = key.split(' ').map((ev) => on(ev as SpEvent, cb));
    return () => offs.forEach((off) => off());
  }, [key]);
  // a string of the event counts: stable between changes, different after one
  const snapshot = () => key.split(' ').map((ev) => versions.get(ev as SpEvent) || 0).join('.');
  useSyncExternalStore(subscribe, snapshot);
}
