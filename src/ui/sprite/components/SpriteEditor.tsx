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
import { CheckPanel } from './CheckPanel';
import { ExportDialog } from './ExportDialog';
import { GmOpenDialog } from './GmOpenDialog';
import { CanvasSizeDialog, NewSpriteDialog } from './SizeDialogs';
import { VariantsPanel } from './VariantsPanel';
import { Timeline } from './Timeline';
import { ToolBar } from './ToolBar';
import { ToolOptions } from './ToolOptions';
import { TopBar } from './TopBar';
import { TabBar } from './TabBar';

export function SpriteEditor() {
  useSp('paper', 'view');
  // the paper also shows behind the thumbnails and the preview (styles.css)
  return (
    <div className={sp.paperMode === 'color' ? 'sp-root paper-solid' : 'sp-root'} style={{ '--paper': hex(sp.paperColor) } as CSSProperties}>
      <TopBar />
      <TabBar />
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
      <CheckPanel />
      <VariantsPanel />
      {sp.dialog === 'export' && <ExportDialog />}
      {sp.dialog === 'gmopen' && <GmOpenDialog />}
      {sp.dialog === 'new' && <NewSpriteDialog />}
      {sp.dialog === 'canvas' && <CanvasSizeDialog />}
    </div>
  );
}
