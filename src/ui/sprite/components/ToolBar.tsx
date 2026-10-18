// The tools on the left, as icons with their shortcut letter.

import { Fragment } from 'react';
import { keyLabel, keysBus } from '../../keys';
import { useSp } from '../hooks';
import { setTool, sp, type Tool } from '../state';
import { TOOL_ICONS } from './icons';

interface ToolDef { tool: Tool; name: string; help?: string }

export const TOOLS: ToolDef[][] = [
  [
    { tool: 'pencil', name: 'Pencil', help: 'Right click: secondary color. Shift+click: straight line. Alt+click: pick a color.' },
    { tool: 'eraser', name: 'Eraser' },
    { tool: 'line', name: 'Line', help: 'Shift: straight or 45°.' },
    { tool: 'shade', name: 'Shading brush', help: 'Left click: one step lighter, right click: one step darker, along your ramps (or My palette in its order).' },
    { tool: 'bucket', name: 'Paint bucket' },
    { tool: 'rect', name: 'Rectangle', help: 'Shift: square.' },
    { tool: 'ellipse', name: 'Ellipse', help: 'Shift: circle.' },
    { tool: 'picker', name: 'Eyedropper', help: 'Right click: sets the secondary color.' },
  ],
  [
    { tool: 'select', name: 'Select', help: 'Shift adds, Alt subtracts. Drag inside to move, drag the squares to resize.' },
    { tool: 'wand', name: 'Select by color', help: 'Shift adds, Alt subtracts.' },
    { tool: 'move', name: 'Move', help: 'Moves the selection, or the whole layer when nothing is selected.' },
    { tool: 'canvas', name: 'Canvas size', help: 'Drag the squares on the edges of the paper.' },
    { tool: 'pan', name: 'Hand', help: 'Moves the view.' },
  ],
];

export function ToolBar() {
  useSp('tool');
  keysBus.use('keys');
  return (
    <div className="sp-tools panel" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOLS.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <hr />}
          {group.map((t) => (
            <button
              key={t.tool}
              type="button"
              className="tool sp-tool"
              data-sptool={t.tool}
              aria-label={t.name}
              aria-pressed={sp.tool === t.tool}
              title={`${t.name}${keyLabel(`sprite.${t.tool}`) ? ` (${keyLabel(`sprite.${t.tool}`)})` : ''}${t.help ? `\n${t.help}` : ''}`}
              onClick={() => setTool(t.tool)}
            >
              {TOOL_ICONS[t.tool]}
              <kbd>{keyLabel(`sprite.${t.tool}`)}</kbd>
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
