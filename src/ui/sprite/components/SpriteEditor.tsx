// The whole sprite editor: top bar, tools, options, canvas, side panels, timeline.

import type { CSSProperties } from 'react';
import { hex } from '../../../core/color';
import { useSp } from '../hooks';
import { sp } from '../state';
import { CanvasPanel } from './CanvasPanel';
import { ColorPanel } from './ColorPanel';
import { LayersPanel } from './LayersPanel';
import { Palettes } from './Palettes';
import { PreviewWindow } from './PreviewWindow';
import { Timeline } from './Timeline';
import { ToolBar } from './ToolBar';
import { ToolOptions } from './ToolOptions';
import { TopBar } from './TopBar';

export function SpriteEditor() {
  useSp('paper');
  // the paper also shows behind the thumbnails and the preview (styles.css)
  return (
    <div className={sp.paperMode === 'color' ? 'sp-root paper-solid' : 'sp-root'} style={{ '--paper': hex(sp.paperColor) } as CSSProperties}>
      <TopBar />
      <div className="sp-main">
        <ToolBar />
        <div className="sp-center">
          <ToolOptions />
          <CanvasPanel />
        </div>
        <aside className="sp-side">
          <ColorPanel />
          <Palettes />
          <LayersPanel />
        </aside>
      </div>
      <Timeline />
      <PreviewWindow />
    </div>
  );
}
