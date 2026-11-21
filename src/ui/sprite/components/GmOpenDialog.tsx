// "Open from GameMaker": every sprite of a project as a grid of pictures, with
// a search box and a folder filter. The listing comes from a cache at once and
// is checked against the files in the background (gmLibrary.ts); what the
// filter shows is read first. Double click (or Open) loads the sprite with its
// layers into the editor.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { setStatus } from '../../dom';
import { clearCache, indexProject, loadGmSprite, type Indexer, type LibEntry } from '../gmLibrary';
import { MAX_SIDE } from '../io';
import { commitFloating, emit, setDoc, sp } from '../state';
import { GmProjectBox, useGmProject } from './GmProjectBox';

export function closeGmOpen(): void {
  sp.gmOpen = false;
  emit('view');
}

const isBlank = () => sp.doc.frames.every((f) => f.cels.every((c) => !c.px.some((v, i) => i % 4 === 3 && v)));

/** Object URLs for the thumbnails, kept while the page lives so reopening the window does not make new ones. */
const urls = new WeakMap<Blob, string>();
const urlOf = (b: Blob) => { let u = urls.get(b); if (!u) { u = URL.createObjectURL(b); urls.set(b, u); } return u; };

const Card = memo(function Card(props: { e: LibEntry; selected: boolean; onPick: (name: string) => void; onOpen: (name: string) => void }) {
  const { e } = props;
  const read = e.w > 0;
  return (
    <button
      type="button"
      className={'gmo-card' + (props.selected ? ' sel' : '') + (e.error ? ' bad' : '')}
      title={e.error ?? `${e.name}\n${e.folder}`}
      onClick={() => props.onPick(e.name)}
      onDoubleClick={() => props.onOpen(e.name)}
    >
      <span className="gmo-thumb">{e.thumb ? <img src={urlOf(e.thumb)} alt="" loading="lazy" draggable={false} /> : <i className={read ? '' : 'loading'} />}</span>
      <span className="gmo-name">{e.name}</span>
      <small className="muted">{e.error ? 'unreadable' : read ? `${e.w}×${e.h} · ${e.frames}f${e.layers > 1 ? ` · ${e.layers}L` : ''}` : '…'}</small>
    </button>
  );
});

export function GmOpenDialog() {
  const gmp = useGmProject();
  const { project } = gmp;
  const [entries, setEntries] = useState<LibEntry[]>([]);
  const [checked, setChecked] = useState(0);
  const [done, setDone] = useState(false);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [picked, setPicked] = useState<string | null>(sp.gmName);
  const [opening, setOpening] = useState(false);
  const [round, setRound] = useState(0);
  const indexer = useRef<Indexer | null>(null);
  const search = useRef<HTMLInputElement>(null);

  // list the project's sprites (cache first, then the files)
  useEffect(() => {
    if (!project) return;
    setDone(false);
    setChecked(0);
    const ix = indexProject(project, (list, n) => { setEntries(list); setChecked(n); }, () => setDone(true));
    indexer.current = ix;
    return () => ix.stop();
  }, [project, round]);

  useEffect(() => { search.current?.focus(); }, [project]);

  // Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeGmOpen(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const folders = useMemo(() => [...new Set(entries.map((e) => e.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [entries]);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return entries
      .filter((e) => !folder || e.folder === folder || e.folder.startsWith(`${folder}/`))
      .filter((e) => words.every((w) => e.name.toLowerCase().includes(w) || e.folder.toLowerCase().includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [entries, query, folder]);

  // what the filter shows is read first
  useEffect(() => { indexer.current?.prioritize(shown.slice(0, 200).map((e) => e.name)); }, [shown]);

  const open = (name: string) => {
    if (!project || opening) return;
    const e = entries.find((x) => x.name === name);
    if (e?.error) { setStatus(`${name}: ${e.error}`, true); return; }
    commitFloating();
    if (!isBlank() && !confirm(`Replace the sprite in the editor with ${name}? Save it first if you need it.`)) return;
    setOpening(true);
    loadGmSprite(project, name, MAX_SIDE).then((doc) => {
      setDoc(doc, name);
      sp.gmName = name;
      closeGmOpen();
      setStatus(`Opened ${name} from ${project.name}: ${doc.frames.length} frame${doc.frames.length === 1 ? '' : 's'}, ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'}. Export sends it back to the same sprite.`);
    }, (err) => setStatus((err as Error).message, true)).finally(() => setOpening(false));
  };

  const sel = entries.find((e) => e.name === picked) ?? null;
  const total = project?.spriteNames.length ?? 0;

  return (
    <div className="opt-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) closeGmOpen(); }}>
      <div className="opt-dialog panel gmo-dialog" role="dialog" aria-modal="true" aria-label="Open from GameMaker">
        <div className="opt-head">
          <h2>Open from GameMaker</h2>
          <button type="button" className="ghost small" aria-label="Close" onClick={closeGmOpen}>×</button>
        </div>
        <div className="gmo-body">
          <GmProjectBox {...gmp} />
          {project && (
            <>
              <div className="gmo-filters">
                <input ref={search} type="search" placeholder="Search by name or folder…" aria-label="Search sprites" value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && shown.length) open(picked && shown.some((x) => x.name === picked) ? picked : shown[0].name); }} />
                <select aria-label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
                  <option value="">All folders</option>
                  {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <span className="muted gmo-count">{shown.length === total ? `${total} sprites` : `${shown.length} of ${total}`}</span>
              </div>
              {!done && (
                <div className="gmo-progress" role="status">
                  <span className="muted">Checking the sprites… {checked}/{total}</span>
                  <progress max={total || 1} value={checked} />
                </div>
              )}
              <div className="gmo-grid">
                {shown.map((e) => <Card key={e.name} e={e} selected={e.name === picked} onPick={setPicked} onOpen={open} />)}
                {!shown.length && entries.length > 0 && <p className="hint">No sprite matches.</p>}
              </div>
            </>
          )}
        </div>
        <div className="exp-foot gmo-foot">
          {project && (
            <button type="button" className="ghost small gmo-rescan" title="Forget the cached pictures and read every sprite again"
              onClick={() => { clearCache(project).then(() => setRound((r) => r + 1)); }}>Read all again</button>
          )}
          <span className="muted gmo-sel">{sel ? `${sel.name}${sel.w ? ` · ${sel.w}×${sel.h} · ${sel.frames} frame${sel.frames === 1 ? '' : 's'} · ${sel.layers} layer${sel.layers === 1 ? '' : 's'}` : ''}${sel.folder ? ` · ${sel.folder}` : ''}` : 'Double click a sprite to open it.'}</span>
          <button type="button" className="ghost" onClick={closeGmOpen}>Cancel</button>
          <button type="button" disabled={!sel || opening || !!sel.error} onClick={() => sel && open(sel.name)}>{opening ? 'Opening…' : 'Open'}</button>
        </div>
      </div>
    </div>
  );
}
