// The editor's menu bar (File, Edit, Sprite, Layer, Frame, View) and the status
// line. Every action of the editor is here, with its shortcut, so the panels
// only keep the buttons used all the time.

import type { MenuItem, Menu } from '../../components/MenuBar';
import { MenuBar } from '../../components/MenuBar';
import { keyLabel } from '../../keys';
import { setOptionsOpen } from '../../optionsOpen';
import {
  addImageLayer, addReferenceImage, bakeLayerPart, deleteCurrentLayer, duplicateCurrentLayer, makeLayerPart, mergeLayerDown, moveLayerTo,
  newLayer, outlineArt, removeOutlineArt, setPaperMode, setTileMode, toggleLayerVisible, toggleReference,
} from '../actions';
import { deleteFrame, mirrorSelection, moveFrameTo, tagSelection } from '../animation';
import { clearRecent, openRecent, pickWithInput, recentItems } from '../files';
import { useSp } from '../hooks';
import { setPaletteLock } from '../prefs';
import { runAction } from '../shortcuts';
import { tabList } from '../tabs';
import { canRedo, canUndo, emit, openDialog, sp } from '../state';


/** A menu item for a registered action: its label and keys come from the shortcut registry. */
const act = (id: string, label: string, extra: Partial<Exclude<MenuItem, 'sep'>> = {}): MenuItem => ({
  label, shortcut: keyLabel(`sprite.${id}`) || undefined, run: () => runAction(id), ...extra,
});

const toggle = (label: string, on: boolean, run: () => void, extra: Partial<Exclude<MenuItem, 'sep'>> = {}): MenuItem => ({ label, checked: on, run, ...extra });

function recentMenu(): MenuItem[] {
  const list = recentItems();
  if (!list.length) return [{ label: 'No recent files', disabled: true }];
  return [
    ...list.map((r): MenuItem => ({
      label: r.kind === 'gm' ? `${r.name}  ·  ${r.project}` : r.name,
      title: r.kind === 'gm' ? `GameMaker sprite ${r.name} in ${r.project}` : r.name,
      run: () => openRecent(r),
    })),
    'sep',
    { label: 'Clear recent', run: clearRecent },
  ];
}

const MENUS: Menu[] = [
  {
    label: 'File',
    items: () => [
      act('newSprite', 'New sprite…'),
      act('open', 'Open…'),
      act('openGm', 'Open from GameMaker…'),
      { label: 'Open recent', items: recentMenu() },
      'sep',
      {
        label: 'Import',
        items: [
          { label: 'Image as a new layer…', title: 'A PNG at its own pixel size, on a new layer in this frame', run: () => pickWithInput('image/*', addImageLayer) },
          { label: 'Reference image…', title: 'Shown half transparent while drawing, never exported', run: () => pickWithInput('image/*', addReferenceImage) },
          { label: 'GameMaker sprite…', run: () => openDialog('gmopen') },
        ],
      },
      'sep',
      act('save', 'Save', { title: sp.fileHandle ? `Save into ${sp.fileHandle.name}` : 'Save as a .pixelize file' }),
      act('saveAs', 'Save as…'),
      'sep',
      act('export', 'Export…'),
      { label: 'Send to GameMaker…', run: () => { sp.exportAs = 'gamemaker'; openDialog('export'); } },
      'sep',
      act('closeTab', 'Close tab'),
      'sep',
      { label: 'Options and shortcuts…', run: () => setOptionsOpen(true) },
    ],
  },
  {
    label: 'Edit',
    items: () => {
      const sel = !!(sp.mask || sp.floating);
      return [
        act('undo', 'Undo', { disabled: !canUndo() }),
        act('redo', 'Redo', { disabled: !canRedo() }),
        'sep',
        act('cut', 'Cut'),
        act('copy', 'Copy'),
        act('paste', 'Paste'),
        act('delete', 'Delete', { disabled: !sel }),
        'sep',
        act('selectAll', 'Select all'),
        act('deselect', 'Deselect', { disabled: !sel }),
        'sep',
        act('toLayer', 'Move selection to a new layer', { disabled: !sel }),
        act('copyToLayer', 'Copy selection to a new layer', { disabled: !sel }),
        'sep',
        { label: 'Outline', title: 'Outline the art on this layer (or the selected art) with the primary color', run: () => outlineArt(false) },
        { label: 'Outline with corners', run: () => outlineArt(true) },
        { label: 'Remove outline', title: 'Fill the dark outline with the colors next to it; lines inside one part stay', run: () => removeOutlineArt(false) },
        { label: 'Remove outline and shrink', title: 'Drop the silhouette outline (the art gets 1 px smaller)', run: () => removeOutlineArt(true) },
      ];
    },
  },
  {
    label: 'Sprite',
    items: () => [
      { label: 'Canvas size…', run: () => openDialog('canvas') },
      'sep',
      toggle('Check for problems', sp.checkOpen, () => { sp.checkOpen = !sp.checkOpen; if (!sp.checkOpen) { sp.issues = []; sp.issueFocus = null; } emit('view'); },
        { title: 'Orphan pixels, jaggies, banding and colors that are almost the same' }),
      toggle('Color variants', sp.variantsOpen, () => { sp.variantsOpen = !sp.variantsOpen; if (!sp.variantsOpen) sp.showVariant = null; emit('view'); }),
      toggle('Lock to my palette', sp.paletteLock, () => setPaletteLock(!sp.paletteLock), { title: 'Everything painted, filled or pasted snaps to My palette' }),
    ],
  },
  {
    label: 'Layer',
    items: () => {
      const l = sp.doc.layers[sp.layer], n = sp.doc.layers.length;
      return [
        { label: 'New layer', run: newLayer },
        { label: 'Duplicate layer', run: duplicateCurrentLayer },
        { label: 'Delete layer', run: deleteCurrentLayer, disabled: n < 2 },
        'sep',
        { label: 'Merge down', run: mergeLayerDown, disabled: sp.layer < 1 },
        { label: 'Move up', run: () => moveLayerTo(sp.layer, sp.layer + 1), disabled: sp.layer >= n - 1 },
        { label: 'Move down', run: () => moveLayerTo(sp.layer, sp.layer - 1), disabled: sp.layer < 1 },
        'sep',
        toggle('Visible', l.visible, () => toggleLayerVisible()),
        toggle('Reference layer', !!l.ref, () => toggleReference(sp.layer), { title: 'Shown while drawing, never exported' }),
        l.part
          ? { label: 'Bake part', title: 'Keep the posed pixels and stop posing this layer', run: bakeLayerPart }
          : { label: 'Make a posable part', title: 'Pose this layer frame by frame with the Pose tool instead of redrawing it', run: makeLayerPart },
      ];
    },
  },
  {
    label: 'Frame',
    items: () => {
      const n = sp.doc.frames.length;
      return [
        act('newFrame', 'New frame'),
        act('dupFrame', 'Duplicate frame'),
        { label: 'Delete frame', run: deleteFrame, disabled: n < 2 },
        { label: 'Move earlier', run: () => moveFrameTo(sp.frame, sp.frame - 1), disabled: sp.frame < 1 },
        { label: 'Move later', run: () => moveFrameTo(sp.frame, sp.frame + 1), disabled: sp.frame >= n - 1 },
        'sep',
        act('copyCel', 'Copy cel'),
        act('pasteCel', 'Paste cel'),
        'sep',
        { label: 'Tag the selected frames', run: tagSelection },
        { label: 'Add mirrored frames', title: "Left/right mirrored copies of the selected frames (or of this frame's tag), at the end", run: mirrorSelection },
        'sep',
        act('play', sp.playing ? 'Pause' : 'Play'),
        act('prevFrame', 'Previous frame', { disabled: sp.frame < 1 }),
        act('nextFrame', 'Next frame', { disabled: sp.frame >= n - 1 }),
      ];
    },
  },
  {
    label: 'View',
    items: () => [
      act('zoomIn', 'Zoom in'),
      act('zoomOut', 'Zoom out'),
      act('fit', 'Fit the canvas'),
      'sep',
      toggle('Grid', sp.showGrid, () => { sp.showGrid = !sp.showGrid; emit('view'); }),
      toggle('Onion skin', sp.onion, () => runAction('onion'), { shortcut: keyLabel('sprite.onion') || undefined }),
      toggle('Tile mode', sp.tileMode, () => setTileMode(!sp.tileMode), { title: '3 × 3 copies of the canvas; strokes wrap around the edges' }),
      toggle('Preview window', sp.previewOpen, () => { sp.previewOpen = !sp.previewOpen; emit('view'); }),
      'sep',
      act('nextTab', 'Next tab', { disabled: tabList().length < 2 }),
      act('prevTab', 'Previous tab', { disabled: tabList().length < 2 }),
      'sep',
      toggle('Checkerboard paper', sp.paperMode === 'checker', () => setPaperMode('checker')),
      toggle('Plain color paper', sp.paperMode === 'color', () => setPaperMode('color')),
    ],
  },
];

export function TopBar() {
  useSp('structure', 'recent', 'tabs');
  return (
    <div className="sp-bar panel">
      <MenuBar menus={MENUS} label="Sprite editor menu" />
      <p className="status" id="spStatus" role="status" />
    </div>
  );
}

