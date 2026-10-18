// A tiny event bus that React can subscribe to. Plain modules call on()/emit();
// components call use('event', …) to re-render when those events fire, then
// read the module's state directly.

import { useCallback, useSyncExternalStore } from 'react';

export function createBus<E extends string>() {
  const listeners = new Map<E, Set<() => void>>();
  /** How many times each event fired; React compares these to know when to re-render. */
  const versions = new Map<E, number>();

  /** Listens to an event. Returns a function that stops listening. */
  function on(ev: E, fn: () => void): () => void {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev)!.add(fn);
    return () => { listeners.get(ev)!.delete(fn); };
  }

  function emit(...evs: E[]): void {
    for (const ev of new Set(evs)) {
      versions.set(ev, (versions.get(ev) || 0) + 1);
      for (const fn of [...(listeners.get(ev) || [])]) fn();
    }
  }

  /** React hook: re-render the calling component when any of these events fires. */
  function use(...events: E[]): void {
    const key = events.join(' ');
    const subscribe = useCallback((cb: () => void) => {
      const offs = (key.split(' ') as E[]).map((ev) => on(ev, cb));
      return () => offs.forEach((off) => off());
    }, [key]);
    useSyncExternalStore(subscribe, () => (key.split(' ') as E[]).map((ev) => versions.get(ev) || 0).join('.'));
  }

  return { on, emit, use, versions };
}
