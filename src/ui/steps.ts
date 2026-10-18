// The step-by-step flow: which step is open. Every step after the first
// unlocks once there is an image. The components show each step's panel and
// workspace pieces (see stepClass); the step also goes on <body data-step>
// for the layout rules in styles.css.

import { app, pxBus } from './app';

export const STEPS = ['image', 'grid', 'colors', 'clean', 'edit', 'frames', 'export'] as const;
export type Step = (typeof STEPS)[number];

export const STEP_NAMES: Record<Step, string> = {
  image: 'Image', grid: 'Pixels', colors: 'Colors', clean: 'Background & crop', edit: 'Touch up', frames: 'Animation', export: 'Export',
};

let step: Step = 'image';

export const currentStep = () => step;
export const onStep = (fn: (s: Step) => void) => pxBus.on('step', () => fn(step));

export function goTo(s: Step): void {
  if (s !== 'image' && !app.source) return;
  step = s;
  document.body.dataset.step = s;
  pxBus.emit('step');
}

export const nextStep = () => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(step) + 1)];
export const prevStep = () => STEPS[Math.max(0, STEPS.indexOf(step) - 1)];

/** "offstep" (hidden) unless the open step is one of `steps` (space separated). */
export const stepClass = (steps: string) => (steps.split(' ').includes(step) ? '' : ' offstep');

export function initSteps(): void {
  // a new image always starts at checking its grid
  pxBus.on('source', () => goTo('grid'));
  goTo('image');
}
