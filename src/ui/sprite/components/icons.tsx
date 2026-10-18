// Tool icons, drawn by hand on a 24 × 24 grid (stroke only, they take the text color).

import type { ReactNode } from 'react';
import type { Tool } from '../state';

const svg = (children: ReactNode) => <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;

export const TOOL_ICONS: Record<Tool, ReactNode> = {
  pencil: svg(<><path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z" /><path d="M14 6.6l3.4 3.4" /></>),
  eraser: svg(<><path d="M10 20l-6-6a1.5 1.5 0 0 1 0-2.1L12.9 3a1.5 1.5 0 0 1 2.1 0L21 9a1.5 1.5 0 0 1 0 2.1L12 20z" /><path d="M8 9l7 7" /><path d="M12 20h8" /></>),
  line: svg(<><path d="M6 18L18 6" /><rect x="3.5" y="15.5" width="5" height="5" rx="1" /><rect x="15.5" y="3.5" width="5" height="5" rx="1" /></>),
  shade: svg(<><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" /></>),
  bucket: svg(<><path d="M3.5 11.5L11 4l7.5 7.5L11 19z" /><path d="M3.5 11.5h15" /><path d="M8 3l3 1" /><path d="M20.5 15.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z" /></>),
  rect: svg(<rect x="4" y="6" width="16" height="12" rx="1" />),
  ellipse: svg(<ellipse cx="12" cy="12" rx="8.5" ry="7" />),
  picker: svg(<><path d="M13.5 6.5l4 4" /><path d="M16 4.5a2.1 2.1 0 0 1 3 0l.5.5a2.1 2.1 0 0 1 0 3L17.5 10l-4-4z" /><path d="M14.5 8.5L6 17v3h3l8.5-8.5" /></>),
  select: svg(<><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><path d="M11 4h2M11 20h2M4 11v2M20 11v2" /></>),
  wand: svg(<><path d="M4 20L14 10" /><path d="M12.5 8.5l3 3" /><path d="M17 3v3M15.5 4.5h3" /><path d="M20 9v2M19 10h2" /><path d="M9.5 3.5v2M8.5 4.5h2" /></>),
  move: svg(<><path d="M12 3v18M3 12h18" /><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></>),
  canvas: svg(<><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></>),
  pan: svg(<><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11" /><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v7" /><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5A6.5 6.5 0 0 1 10.5 20h-.3a6 6 0 0 1-5-2.7l-2.4-3.7a1.5 1.5 0 0 1 2.4-1.8L8 14" /></>),
};
