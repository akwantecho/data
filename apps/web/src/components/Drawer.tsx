import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A side panel for the detail behind something on the page (plan §22) — the
 * evidence for an alert, the figures behind an insight.
 *
 * A drawer rather than a page because the evidence is only meaningful next to the
 * thing it explains; closing it should return you to exactly where you were.
 */
export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Focus moves to the panel once, when it opens. Re-running this on every render
  // would pull focus back out of whatever the reader is typing into.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="drawer__scrim" role="presentation" onClick={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-header">
          <h2 className="card__title">{title}</h2>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
