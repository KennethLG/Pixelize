// Whether the Options window is open, so the header button and the menus can both open it.

import { createBus } from './bus';

export const optionsBus = createBus<'options'>();
let open = false;

export const isOptionsOpen = () => open;
export function setOptionsOpen(v: boolean): void {
  open = v;
  optionsBus.emit('options');
}
