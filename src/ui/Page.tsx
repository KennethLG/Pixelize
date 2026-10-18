// The whole page: the header with the mode switch, and both modes. Both stay
// mounted (only the open one shows) so each keeps its state and canvases.

import { pxBus } from './app';
import { currentMode, setMode, type Mode } from './mode';
import { PixelizeMode } from './pixelize/PixelizeMode';
import { SpriteEditor } from './sprite/components/SpriteEditor';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'pixelize', label: 'Pixelize an image' },
  { mode: 'sprite', label: 'Sprite editor' },
];

export function Page() {
  pxBus.use('mode');
  const mode = currentMode();
  return (
    <div className="wrap">
      <header className="top">
        <h1>Pixelize</h1>
        {mode === 'pixelize' && <p>Fake AI pixel art in, real pixel art out.</p>}
        <div className="modes" role="group" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.mode} type="button" className="mode" data-mode-btn={m.mode} aria-pressed={mode === m.mode} onClick={() => setMode(m.mode)}>{m.label}</button>
          ))}
        </div>
      </header>
      <div id="pixelizeMode" hidden={mode !== 'pixelize'}>
        <PixelizeMode />
      </div>
      <div id="spriteMode" className="sprite" hidden={mode !== 'sprite'}>
        <SpriteEditor />
      </div>
    </div>
  );
}
