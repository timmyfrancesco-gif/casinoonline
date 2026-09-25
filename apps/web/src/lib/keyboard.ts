/** True when a key event comes from a text field: game shortcuts must not fire there. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range'].includes(type);
  }
  return false;
}

/** True while a modal dialog is open (shortcuts are disabled behind it). */
export function isModalOpen(): boolean {
  return document.querySelector('[data-modal-open="true"]') !== null;
}

export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.repeat ||
    isTypingTarget(event.target) ||
    isModalOpen()
  );
}
