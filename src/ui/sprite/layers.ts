// The layers panel: top layer first, click to select, eye to hide, double
// click to rename, drag to reorder, and an opacity slider for the selected one.

import {
  addLayer, duplicateLayer, mergeDown, moveLayer, removeLayer,
} from '../../core/sprite';
import { $, field } from '../dom';
import { emit, on, pushDoc, setLayer, sp } from './state';

let dragFrom: number | null = null;

function row(li: number): HTMLElement {
  const l = sp.doc.layers[li];
  const el = document.createElement('div');
  el.className = 'sp-layer' + (li === sp.layer ? ' sel' : '') + (l.visible ? '' : ' hidden-layer');
  el.draggable = true;
  el.tabIndex = 0;
  el.dataset.layer = String(li);

  const eye = document.createElement('button');
  eye.type = 'button';
  eye.className = 'sp-eye';
  eye.textContent = l.visible ? '◉' : '○';
  eye.title = l.visible ? 'Hide layer' : 'Show layer';
  eye.setAttribute('aria-pressed', String(l.visible));
  eye.addEventListener('click', (e) => {
    e.stopPropagation();
    pushDoc();
    l.visible = !l.visible;
    emit('structure', 'pixels');
  });

  const name = document.createElement('span');
  name.className = 'sp-lname';
  name.textContent = l.name;
  name.title = 'Double click to rename';
  name.addEventListener('dblclick', () => rename(li, name));

  const op = document.createElement('small');
  op.textContent = l.opacity < 1 ? `${Math.round(l.opacity * 100)}%` : '';

  el.append(eye, name, op);
  el.addEventListener('click', () => setLayer(li));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLayer(li); } });

  el.addEventListener('dragstart', (e) => { dragFrom = li; el.classList.add('dragging'); e.dataTransfer!.effectAllowed = 'move'; });
  el.addEventListener('dragend', () => { dragFrom = null; clearMarks(); });
  el.addEventListener('dragover', (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    clearMarks();
    el.classList.add(above(e, el) ? 'drop-before' : 'drop-after');
  });
  el.addEventListener('drop', (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    // the list shows the top layer first, so "above" in the list is a higher index
    let to = above(e, el) ? li + 1 : li;
    if (dragFrom < to) to--;
    const from = dragFrom;
    dragFrom = null;
    clearMarks();
    if (from === to) return;
    pushDoc();
    moveLayer(sp.doc, from, to);
    sp.layer = to;
    emit('structure', 'cursor', 'pixels');
  });
  return el;
}

const above = (e: DragEvent, el: HTMLElement) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; };
const clearMarks = () => document.querySelectorAll('.sp-layer').forEach((r) => r.classList.remove('drop-before', 'drop-after', 'dragging'));

function rename(li: number, span: HTMLElement): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = sp.doc.layers[li].name;
  input.className = 'sp-lrename';
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== sp.doc.layers[li].name) { pushDoc(); sp.doc.layers[li].name = v; }
    emit('structure');
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function render(): void {
  const list = $('spLayers');
  const rows: HTMLElement[] = [];
  for (let li = sp.doc.layers.length - 1; li >= 0; li--) rows.push(row(li));
  list.replaceChildren(...rows);
  const l = sp.doc.layers[sp.layer];
  field('spOpacity').value = String(Math.round(l.opacity * 100));
  $('spOpacityOut').textContent = `${Math.round(l.opacity * 100)}%`;
  field('spLayerDel').disabled = sp.doc.layers.length < 2;
  field('spLayerMerge').disabled = sp.layer < 1;
  field('spLayerUp').disabled = sp.layer >= sp.doc.layers.length - 1;
  field('spLayerDown').disabled = sp.layer < 1;
}

function shift(dir: 1 | -1): void {
  const to = sp.layer + dir;
  if (to < 0 || to >= sp.doc.layers.length) return;
  pushDoc();
  moveLayer(sp.doc, sp.layer, to);
  sp.layer = to;
  emit('structure', 'cursor', 'pixels');
}

export function initLayers(): void {
  $('spLayerAdd').addEventListener('click', () => { pushDoc(); addLayer(sp.doc, sp.layer + 1); sp.layer++; emit('structure', 'cursor'); });
  $('spLayerDup').addEventListener('click', () => { pushDoc(); duplicateLayer(sp.doc, sp.layer); sp.layer++; emit('structure', 'cursor', 'pixels'); });
  $('spLayerDel').addEventListener('click', () => {
    pushDoc();
    if (removeLayer(sp.doc, sp.layer)) { sp.layer = Math.max(0, sp.layer - 1); emit('structure', 'cursor', 'pixels'); }
  });
  $('spLayerMerge').addEventListener('click', () => {
    pushDoc();
    if (mergeDown(sp.doc, sp.layer)) { sp.layer--; emit('structure', 'cursor', 'pixels'); }
  });
  $('spLayerUp').addEventListener('click', () => shift(1));
  $('spLayerDown').addEventListener('click', () => shift(-1));

  // one undo step per slider drag
  let sliding = false;
  field('spOpacity').addEventListener('input', () => {
    if (!sliding) { pushDoc(); sliding = true; }
    const v = Number(field('spOpacity').value);
    sp.doc.layers[sp.layer].opacity = v / 100;
    $('spOpacityOut').textContent = `${v}%`;
    emit('pixels');
  });
  field('spOpacity').addEventListener('change', () => { sliding = false; emit('structure'); });

  on('structure', render);
  on('cursor', render);
  render();
}
