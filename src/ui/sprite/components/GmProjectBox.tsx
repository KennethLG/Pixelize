// The GameMaker project both the Export and the Open windows work with: the
// remembered folder, a button to allow access to it again, or to pick one.

import { useEffect, useState } from 'react';
import { setStatus } from '../../dom';
import { canPickFolders, pickProject, rememberedName, rememberedProject, type GmProject } from '../gmProject';

/** The project folder: none yet, remembered but waiting for a click to allow access again, or open. */
export function useGmProject() {
  const [project, setProject] = useState<GmProject | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    rememberedProject(false).then(async (p) => {
      if (!live) return;
      setProject(p);
      if (!p) setWaiting(await rememberedName());
    }, () => {});
    return () => { live = false; };
  }, []);
  const choose = (fresh: boolean) => {
    (fresh ? pickProject() : rememberedProject(true)).then((p) => {
      if (p) { setProject(p); setWaiting(null); } else if (!fresh) setStatus('Access was not allowed. Choose the folder again.', true);
    }, (e) => { if ((e as Error).name !== 'AbortError') setStatus((e as Error).message, true); });
  };
  return { project, waiting, choose };
}

export function GmProjectBox(props: ReturnType<typeof useGmProject>) {
  const { project, waiting, choose } = props;
  return (
    <div className="exp-project">
      <span className="label">GameMaker project</span>
      {project
        ? <div className="exp-row"><b>{project.name}</b><span className="muted">{project.dir.name}</span><button type="button" className="ghost small" onClick={() => choose(true)}>Change…</button></div>
        : canPickFolders()
          ? <div className="exp-row">
              {waiting && <button type="button" className="small" onClick={() => choose(false)}>Allow access to {waiting}</button>}
              <button type="button" className={waiting ? 'ghost small' : 'small'} onClick={() => choose(true)}>{waiting ? 'Another folder…' : 'Choose the project folder…'}</button>
            </div>
          : <p className="hint bad">This browser cannot open folders. Use the desktop app, Chrome or Edge.</p>}
      {!project && canPickFolders() && <p className="hint">The folder that has the .yyp file. Pixelize remembers it.</p>}
    </div>
  );
}
