// The step-by-step flow: which step is open, what each step shows, and the
// Back / Next buttons. Every step after the first unlocks once there is an image.
// Panels are matched by data-panel; anything else in the page with a
// data-show list (e.g. data-show="colors edit") only shows on those steps.

import { app, onSource } from './app';
import { $ } from './dom';

export const STEPS = ['image', 'grid', 'colors', 'clean', 'edit', 'frames', 'export'] as const;
export type Step = (typeof STEPS)[number];

const NAMES: Record<Step, string> = {
  image: 'Image', grid: 'Pixels', colors: 'Colors', clean: 'Background & crop', edit: 'Touch up', frames: 'Animation', export: 'Export',
};

let step: Step = 'image';
const listeners: ((s: Step) => void)[] = [];

export const currentStep = () => step;
export const onStep = (fn: (s: Step) => void) => listeners.push(fn);

export function goTo(s: Step): void {
  if (s !== 'image' && !app.source) return;
  const changed = s !== step;
  step = s;
  document.body.dataset.step = s;
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== s; });
  document.querySelectorAll<HTMLElement>('[data-show]').forEach((el) => el.classList.toggle('offstep', !el.dataset.show!.split(' ').includes(s)));
  updateNav();
  listeners.forEach((f) => f(s));
  // on narrow screens the step bar scrolls sideways, or may be scrolled away
  if (changed) document.querySelector(`.step[data-step="${s}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateNav(): void {
  const i = STEPS.indexOf(step);
  document.querySelectorAll<HTMLButtonElement>('.step').forEach((b) => {
    const k = STEPS.indexOf(b.dataset.step as Step);
    b.disabled = k > 0 && !app.source;
    b.classList.toggle('done', !!app.source && k < i);
    if (k === i) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  });
  const next = $<HTMLButtonElement>('nextBtn'), after = STEPS[i + 1];
  $('backBtn').hidden = i === 0;
  next.hidden = !after;
  next.disabled = !app.source;
  if (after) next.textContent = `Next: ${NAMES[after]}`;
}

export function initSteps(): void {
  document.querySelectorAll<HTMLButtonElement>('.step').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.step as Step)));
  $('backBtn').addEventListener('click', () => goTo(STEPS[Math.max(0, STEPS.indexOf(step) - 1)]));
  $('nextBtn').addEventListener('click', () => goTo(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(step) + 1)]));
  // a new image always starts at checking its grid
  onSource(() => goTo('grid'));
  goTo('image');
}
