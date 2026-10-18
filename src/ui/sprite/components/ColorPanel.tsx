// The color panel: primary/secondary slots, the in-app picker and a hex
// field. It also edits the paper color when the paper swatch under the
// canvas is chosen.

import { useEffect, useState, type CSSProperties } from 'react';
import { hex, hexToRgb, type RGBA } from '../../../core/color';
import { HsvPicker } from '../../components/HsvPicker';
import { pickSlot, pickedColor, setPickedColor, setPaperMode, swapColors } from '../actions';
import { useSp } from '../hooks';
import { sp, setColor } from '../state';

function Slot(props: { id: string; which: 'primary' | 'secondary'; label: string }) {
  const c = sp[props.which];
  return (
    <button
      type="button"
      className={sp.pickSlot === props.which ? 'sp-slot on' : 'sp-slot'}
      id={props.id}
      aria-label={props.label}
      title={`${props.which === 'primary' ? 'Primary (left click)' : 'Secondary (right click)'}: ${c[3] ? hex(c) : 'transparent'}`}
      style={{ '--c': c[3] ? hex(c) : 'transparent' } as CSSProperties}
      onClick={() => pickSlot(props.which)}
    />
  );
}

export function ColorPanel() {
  useSp('color', 'paper');
  const c = pickedColor();

  // the hex field shows the color unless the user is typing in it
  const shown = c[3] ? hex(c) : '';
  const [draft, setDraft] = useState(shown);
  const [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setDraft(shown); }, [shown, typing]);
  const commitHex = () => {
    setTyping(false);
    const v = draft.trim().replace(/^#?/, '#');
    if (/^#[0-9a-f]{6}$/i.test(v)) setPickedColor([...hexToRgb(v), 255] as RGBA);
    else setDraft(shown);
  };

  // "Clear" makes the color transparent; on the paper it goes back to the checkerboard
  const clear = () => {
    if (sp.pickSlot === 'paper') { setPaperMode('checker'); pickSlot('primary'); }
    else setColor(sp.pickSlot, [0, 0, 0, 0]);
  };

  return (
    <div className="panel sp-color">
      <div className="sp-slots">
        <Slot id="spPrimary" which="primary" label="Primary color" />
        <Slot id="spSecondary" which="secondary" label="Secondary color" />
        <button type="button" className="ghost small" title="Swap colors (X)" onClick={swapColors}>⇄</button>
        <button type="button" className="ghost small" title="Make this color transparent (draws like an eraser)" onClick={clear}>Clear</button>
        <span className="tag" id="spEditing">{sp.pickSlot === 'paper' ? 'Paper' : ''}</span>
        <input
          type="text"
          id="spHex"
          maxLength={7}
          aria-label="Hex color"
          spellCheck={false}
          value={draft}
          placeholder={c[3] ? '' : 'transparent'}
          onFocus={() => setTyping(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => { if (e.key === 'Enter') commitHex(); }}
        />
      </div>
      <HsvPicker color={[c[0], c[1], c[2]]} onChange={(rgb) => setPickedColor([...rgb, 255])} ids={{ sv: 'spSV', hue: 'spHue' }} />
    </div>
  );
}
