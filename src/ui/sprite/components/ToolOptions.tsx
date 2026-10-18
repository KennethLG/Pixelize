// The bar above the canvas: options of the current tool, and what you can do
// with the selection when there is one.

import { carryFloating, commitFloating, deselect, sp } from '../state';
import {
  bakeLayerPart, deleteSelection, freePose, makeLayerPart, outlineArt, resetPivot, restPose, setAngle, setBrush, setLayerParent, setOption, transform,
} from '../actions';
import { parentChoices, partOf, poseOf } from '../../../core/parts';
import { selectAll, selectionBox } from '../canvas';
import { copy, cut } from '../io';
import { useSp } from '../hooks';
import { keyLabel } from '../../keys';
import { Seg } from '../../components/common';

const HINTS: Partial<Record<typeof sp.tool, string>> = {
  line: 'Shift: straight or 45°. Right click: secondary color.',
  shade: 'Left click: one step lighter. Right click: one step darker. Steps along your ramps, or My palette in its order.',
  rect: 'Shift: square or circle. Right click: secondary color.',
  ellipse: 'Shift: square or circle. Right click: secondary color.',
  select: 'Shift adds, Alt subtracts. Drag inside the selection to move it, or its squares to resize it.',
  lasso: 'Draw around what you want to move (an arm, a leg). Shift adds, Alt subtracts. Then drag the round handle to turn it around the target.',
  wand: 'Shift adds, Alt subtracts. Drag inside the selection to move it, or its squares to resize it.',
  move: 'Drag to move the selection, or the whole layer if nothing is selected. Arrow keys move 1 px.',
  picker: 'Left click: primary color. Right click: secondary.',
  pan: 'Drag to move the view. Scroll to zoom.',
  canvas: 'Drag the orange squares on the edges of the paper. Drag elsewhere to move the view.',
};

function SelectionActions() {
  const box = selectionBox();
  if (!box) return null;
  const btn = (label: string, title: string, fn: (e: React.MouseEvent) => void) => (
    <button type="button" className="ghost small" title={title} onClick={fn}>{label}</button>
  );
  return (
    <div className="group sp-sel">
      <span className="tag">{`${box.w}×${box.h}${sp.floating ? ' · moving' : ''}`}</span>
      {btn('×2', 'Make it twice as big', () => transform((w, h) => [w * 2, h * 2]))}
      {btn('½', 'Make it half as big', () => transform((w, h) => [w / 2, h / 2]))}
      {btn('Flip ↔', 'Flip horizontally', () => transform(() => 'flipH'))}
      {btn('Flip ↕', 'Flip vertically', () => transform(() => 'flipV'))}
      {btn('⟲ 90°', 'Turn a quarter to the left', () => transform(() => 'rotCCW'))}
      {btn('⟳ 90°', 'Turn a quarter to the right', () => transform(() => 'rotCW'))}
      {btn('180°', 'Turn upside down', () => transform(() => 'rot180'))}
      <label className="sp-angle" title={`Turn around the pivot (the target), with RotSprite so lines stay clean.\nDrag the round handle above the selection, or press ${keyLabel('sprite.turnRight')} / ${keyLabel('sprite.turnLeft')}.`}>
        <span className="muted">Angle</span>
        <input type="number" step={1} value={sp.floating?.angle ?? 0} aria-label="Angle in degrees" onChange={(e) => setAngle(Number(e.target.value) || 0)} />
        <span className="muted">°</span>
      </label>
      {sp.floating?.pivot && btn('Center pivot', 'Put the turning point back in the middle', resetPivot)}
      {btn('◀ Frame', 'Copy the selection into the previous frame, keeping its place and turn.\nShift+click: move it there instead.', (e) => carryFloating(sp.frame - 1, !e.shiftKey))}
      {btn('Frame ▶', 'Copy the selection into the next frame, keeping its place and turn.\nShift+click: move it there instead.', (e) => carryFloating(sp.frame + 1, !e.shiftKey))}
      {btn('Copy', 'Copy (Ctrl+C)', copy)}
      {btn('Cut', 'Cut (Ctrl+X)', cut)}
      {btn('Delete', 'Delete', deleteSelection)}
      {btn('Apply', 'Put the moved pixels down (Enter)', commitFloating)}
      {btn('Deselect', 'Deselect (Ctrl+D or Esc)', deselect)}
    </div>
  );
}

/** Pose tool: make the current layer a part, hang it from another part, reset or free its pose in this frame. */
function PoseOptions() {
  const d = sp.doc, li = sp.layer, part = partOf(d, li);
  if (!part) {
    return (
      <div className="group">
        <button type="button" className="small" title="Use this layer's art in this frame as the part at rest. Then pose it in other frames instead of redrawing it." onClick={makeLayerPart}>
          {`Make “${d.layers[li].name}” a part`}
        </button>
        <span className="hint">Put each limb on its own layer and make it a part. Duplicate the frame, then drag the parts to pose them.</span>
      </div>
    );
  }
  const pose = poseOf(d, sp.frame, li);
  return (
    <div className="group sp-pose">
      <span className="tag">{pose ? `${Math.round(pose.angle)}°` : 'free here'}</span>
      <label className="muted">
        Hangs from{' '}
        <select value={part.parent ?? ''} aria-label="Parent part" onChange={(e) => setLayerParent(e.target.value || null)}>
          <option value="">nothing</option>
          {parentChoices(d, li).map((i) => <option key={i} value={d.layers[i].part!.id}>{d.layers[i].name}</option>)}
        </select>
      </label>
      <button type="button" className="ghost small" title="Back to the rest pose in this frame" onClick={restPose}>Rest pose</button>
      {pose && <button type="button" className="ghost small" title="Keep this frame's pixels as they are and stop following the pose here" onClick={freePose}>Free this frame</button>}
      <button type="button" className="ghost small" title="Stop being a part. Every frame keeps its pixels." onClick={bakeLayerPart}>Not a part</button>
      <span className="hint">Drag to turn around the joint, Alt or right drag to move, drag the dot to move the joint. Paint in the rest pose to change it everywhere.</span>
    </div>
  );
}

export function ToolOptions() {
  useSp('tool', 'selection', 'pixels', 'cursor', 'structure');
  const t = sp.tool;
  const hasSelection = !!(sp.mask || sp.floating);
  const drawing = t === 'pencil' || t === 'eraser' || t === 'line' || t === 'shade' || t === 'rect' || t === 'ellipse';
  return (
    <div className="sp-options panel">
      {drawing && (
        <div className="group">
          <span className="muted">Brush</span>
          <input type="range" min={1} max={16} value={Math.min(16, sp.brush)} aria-label="Brush size slider" onChange={(e) => setBrush(Number(e.target.value))} />
          <input type="number" min={1} max={32} value={sp.brush} aria-label="Brush size in pixels" onChange={(e) => setBrush(Number(e.target.value))} />
          <span className="muted">px <kbd>[</kbd> <kbd>]</kbd></span>
        </div>
      )}
      {t === 'pencil' && (
        <label className="check" title={sp.brush > 1 ? 'Only for a 1 px brush' : 'Takes out the corner pixel when a stroke turns, so lines stay one pixel thin'}>
          <input type="checkbox" checked={sp.pixelPerfect} disabled={sp.brush > 1} onChange={(e) => setOption('pixelPerfect', e.target.checked)} />Pixel perfect
        </label>
      )}
      {drawing && (
        <div className="group" role="group" aria-label="Symmetry">
          <span className="muted">Mirror</span>
          <button type="button" className="tool sp-sym" aria-pressed={sp.symX} title="Mirror left and right" onClick={() => setOption('symX', !sp.symX)}>↔</button>
          <button type="button" className="tool sp-sym" aria-pressed={sp.symY} title="Mirror top and bottom" onClick={() => setOption('symY', !sp.symY)}>↕</button>
        </div>
      )}
      {(t === 'rect' || t === 'ellipse') && (
        <Seg name="spRectMode" label="Shape" value={sp.rectFilled ? 'filled' : 'outline'}
          options={[{ value: 'outline', label: 'Outline' }, { value: 'filled', label: 'Filled' }]}
          onChange={(v) => setOption('rectFilled', v === 'filled')} />
      )}
      {t === 'bucket' && (
        <>
          <Seg name="spBucketMode" label="Bucket" value={sp.bucketMode}
            options={[
              { value: 'fill', label: 'Fill area', title: 'Fill the connected area' },
              { value: 'replace', label: 'Replace color', title: 'Repaint every pixel of the clicked color on this layer' },
            ]}
            onChange={(v) => setOption('bucketMode', v)} />
          {sp.bucketMode === 'replace' && (
            <label className="check">
              <input type="checkbox" checked={sp.replaceAllFrames} onChange={(e) => setOption('replaceAllFrames', e.target.checked)} />In every frame
            </label>
          )}
        </>
      )}
      {t === 'wand' && (
        <label className="check">
          <input type="checkbox" checked={sp.contiguous} onChange={(e) => setOption('contiguous', e.target.checked)} />Only connected pixels
        </label>
      )}
      {t === 'canvas' && (
        <Seg name="spCanvasMode" label="When the canvas changes size" value={sp.canvasMode}
          options={[
            { value: 'keep', label: 'Keep pixel size', title: 'The art keeps its size; space is added or cut around it' },
            { value: 'stretch', label: 'Stretch art', title: 'The art stretches with the paper' },
          ]}
          onChange={(v) => setOption('canvasMode', v)} />
      )}
      {t === 'pose' && <PoseOptions />}
      {!hasSelection && HINTS[t] && <span className="hint">{HINTS[t]}</span>}
      {hasSelection && <SelectionActions />}
      <button type="button" className="ghost small sp-selall" title={'Outline the art on this layer (or the selected art) with the primary color.\nShift+click: fill the diagonal corners too.'} onClick={(e) => outlineArt(e.shiftKey)}>Outline</button>
      <button type="button" className="ghost small" title="Select all (Ctrl+A)" onClick={selectAll}>Select all</button>
    </div>
  );
}
