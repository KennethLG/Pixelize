// The tools on the left, as icons with their shortcut letter.

import { Fragment } from 'react';
import { useSp } from '../hooks';
import { setTool, sp, type Tool } from '../state';
import { TOOL_ICONS } from './icons';

interface ToolDef { tool: Tool; name: string; key: string; help?: string }

export const TOOLS: ToolDef[][] = [
  [
    { tool: 'pencil', name: 'Pencil', key: 'B', help: 'Right click: secondary color. Shift+click: straight line. Alt+click: pick a color.' },
    { tool: 'eraser', name: 'Eraser', key: 'E' },
    { tool: 'line', name: 'Line', key: 'L', help: 'Shift: straight or 45°.' },
    { tool: 'bucket', name: 'Paint bucket', key: 'G' },
    { tool: 'rect', name: 'Rectangle', key: 'U', help: 'Shift: square.' },
    { tool: 'ellipse', name: 'Ellipse', key: 'O', help: 'Shift: circle.' },
    { tool: 'picker', name: 'Eyedropper', key: 'I', help: 'Right click: sets the secondary color.' },
  ],
  [
    { tool: 'select', name: 'Select', key: 'M', help: 'Shift adds, Alt subtracts. Drag inside to move, drag the squares to resize.' },
    { tool: 'wand', name: 'Select by color', key: 'W', help: 'Shift adds, Alt subtracts.' },
    { tool: 'move', name: 'Move', key: 'V', help: 'Moves the selection, or the whole layer when nothing is selected.' },
    { tool: 'canvas', name: 'Canvas size', key: 'C', help: 'Drag the squares on the edges of the paper.' },
    { tool: 'pan', name: 'Hand', key: 'H', help: 'Moves the view (or hold Space).' },
  ],
];

export function ToolBar() {
  useSp('tool');
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
              title={`${t.name} (${t.key})${t.help ? `\n${t.help}` : ''}`}
              onClick={() => setTool(t.tool)}
            >
              {TOOL_ICONS[t.tool]}
              <kbd>{t.key}</kbd>
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
