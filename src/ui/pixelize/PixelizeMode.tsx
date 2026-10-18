// The Pixelize mode: the step bar, the current step's settings on the left,
// and its workspace on the right.

import type { ComponentType } from 'react';
import { app, pxBus } from '../app';
import { STEPS, STEP_NAMES, currentStep, goTo, nextStep, prevStep, type Step } from '../steps';
import { CleanStep, ColorsStep, EditStep, ExportStep, FramesStep, GridStep, ImageStep } from './StepPanels';
import { Workspace } from './Workspace';

const PANELS: Record<Step, ComponentType> = {
  image: ImageStep, grid: GridStep, colors: ColorsStep, clean: CleanStep, edit: EditStep, frames: FramesStep, export: ExportStep,
};
const OPTIONAL = new Set<Step>(['edit', 'frames']);

function StepBar() {
  const cur = STEPS.indexOf(currentStep());
  return (
    <nav className="steps" aria-label="Steps">
      {STEPS.map((s, k) => (
        <button
          key={s}
          type="button"
          className={'step' + (app.source && k < cur ? ' done' : '')}
          data-step={s}
          disabled={k > 0 && !app.source}
          aria-current={k === cur ? 'step' : undefined}
          onClick={() => goTo(s)}
        >
          <b>{k + 1}</b><span>{STEP_NAMES[s]}{OPTIONAL.has(s) && <small>optional</small>}</span>
        </button>
      ))}
    </nav>
  );
}

export function PixelizeMode() {
  pxBus.use('step', 'source');
  const step = currentStep(), Panel = PANELS[step];
  const after = step === 'export' ? null : nextStep();
  return (
    <>
      <StepBar />
      <div className="app">
        <aside className="side">
          <Panel />
          <div className="stepnav">
            {step !== 'image' && <button type="button" className="ghost" id="backBtn" onClick={() => goTo(prevStep())}>Back</button>}
            {after && <button type="button" id="nextBtn" disabled={!app.source} onClick={() => goTo(after)}>Next: {STEP_NAMES[after]}</button>}
          </div>
          <p className="status" id="status" role="status" />
        </aside>
        <Workspace />
      </div>
    </>
  );
}
