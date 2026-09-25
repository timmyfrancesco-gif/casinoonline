/** Storage helpers: every access may throw (private mode, blocked site data). */
function safeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStorage(key: string, kind: 'local' | 'session' = 'local'): string | null {
  try {
    return safeStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(
  key: string,
  value: string,
  kind: 'local' | 'session' = 'local',
): void {
  try {
    safeStorage(kind)?.setItem(key, value);
  } catch {
    // Ignore: preferences are a convenience only.
  }
}
