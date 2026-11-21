// The toasts, stacked in the bottom right corner of the page (toast.ts).

import { closeToast, holdToast, toastBus, toasts, type ToastKind } from '../toast';

const ICON: Record<ToastKind, string> = { ok: '✓', error: '!', info: 'i', busy: '' };

export function Toasts() {
  toastBus.use('toasts');
  const list = toasts();
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
          onPointerEnter={() => holdToast(t.id, true)}
          onPointerLeave={() => holdToast(t.id, false)}
        >
          <span className="toast-icon" aria-hidden="true">{t.kind === 'busy' ? <i className="toast-spin" /> : ICON[t.kind]}</span>
          <div className="toast-text">
            <b>{t.text}</b>
            {t.detail && <span>{t.detail}</span>}
          </div>
          {t.kind !== 'busy' && <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => closeToast(t.id)}>×</button>}
        </div>
      ))}
    </div>
  );
}
