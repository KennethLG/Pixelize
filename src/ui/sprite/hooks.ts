// React side of the editor state: components call useSp('pixels', 'cursor', …)
// and re-render when any of those events fires, then read `sp` directly.

import { spBus, type SpEvent } from './state';

export const useSp = (...events: SpEvent[]): void => spBus.use(...events);
