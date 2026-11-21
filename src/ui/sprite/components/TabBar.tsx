// The open sprites as tabs: click to switch, × or middle click to close,
// drag to reorder. A dot marks changes that are not saved.

import { keyLabel } from '../../keys';
import { useReorder } from '../../components/useReorder';
import { useSp } from '../hooks';
import { activeIndex, closeTab, isModified, moveTab, switchTab, tabList } from '../tabs';

export function TabBar() {
  useSp('tabs', 'structure', 'pixels', 'cursor');
  const { itemProps, marks } = useReorder('x', (from, over, before) => {
    let to = before ? over : over + 1;
    if (from < to) to--;
    moveTab(from, to);
  });
  const list = tabList();
  const active = activeIndex();
  return (
    <div className="sp-tabs" role="tablist" aria-label="Open sprites">
      {list.map((t, i) => {
        const modified = isModified(t, i);
        const kind = t.fileHandle ? ` · ${t.fileHandle.name}` : t.gmName ? ' · GameMaker sprite' : '';
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            className={'sp-tab' + (i === active ? ' on' : '') + marks(i)}
            title={`${t.name}${kind} · ${t.doc.w}×${t.doc.h}${modified ? ' · not saved' : ''}\n${keyLabel('sprite.nextTab')} / ${keyLabel('sprite.prevTab')} switch tabs`}
            onClick={() => switchTab(i)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') { e.preventDefault(); switchTab((i + 1) % list.length); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); switchTab((i - 1 + list.length) % list.length); }
            }}
            {...itemProps(i)}
          >
            {t.gmName && <span className="sp-tab-kind" aria-hidden="true">GM</span>}
            <span className="sp-tab-name">{t.name}</span>
            {modified && <span className="sp-tab-dot" aria-label="not saved">●</span>}
            <button type="button" className="sp-tab-close" aria-label={`Close ${t.name}`} title={`Close (${keyLabel('sprite.closeTab')})`}
              onClick={(e) => { e.stopPropagation(); closeTab(i); }}>×</button>
          </div>
        );
      })}
    </div>
  );
}
