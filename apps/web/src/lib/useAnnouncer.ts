import { useCallback, useState } from 'react';

/**
 * Text for a page's polite live region. An identical consecutive message gets a trailing
 * non-breaking space toggled, so the region changes and screen readers announce it again.
 */
export function useAnnouncer(): [string, (message: string) => void] {
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback(
    (message: string) =>
      setAnnouncement((previous) => (previous === message ? `${message}\u00a0` : message)),
    [],
  );
  return [announcement, announce];
}
