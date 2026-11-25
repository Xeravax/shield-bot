import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  tone?: "default" | "danger";
}

export function Dialog({
  title,
  children,
  onClose,
  actions,
  tone = "default",
}: Props) {
  // Portal to <body> so `position: fixed` covers the viewport even though the
  // case file uses transforms/perspective (which would trap fixed children).
  return createPortal(
    <div
      className="dialog-backdrop paper-theme"
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`dialog-card${tone === "danger" ? " danger" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dialog-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          {actions ?? (
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
