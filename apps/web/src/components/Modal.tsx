import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  title: string;
  /** Omit to make the dialog blocking (no Escape, no backdrop close). */
  onClose?: () => void;
  children: ReactNode;
  /** Optional description id inside children, announced with the title. */
  describedBy?: string;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: focus moves inside and is trapped, the page behind is made
 * inert, focus returns to the opener on close. Rendered in a portal outside #root.
 */
export function Modal({ open, title, onClose, children, describedBy, className }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    document.body.classList.add('modal-open');

    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog;
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (!dialog) return;
      if (event.key === 'Escape' && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (
        event.shiftKey &&
        (document.activeElement === firstItem || document.activeElement === dialog)
      ) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Passive cleanup runs after the portal left the DOM: only other open dialogs remain.
      if (!document.querySelector('[data-modal-open="true"]')) {
        root?.removeAttribute('inert');
        document.body.classList.remove('modal-open');
      }
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current?.();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal ${className ?? ''}`}
        role={onClose ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-modal-open="true"
      >
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
