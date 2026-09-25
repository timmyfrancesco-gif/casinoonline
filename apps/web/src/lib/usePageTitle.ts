import { useEffect } from 'react';

export const SITE_NAME = 'Casinò Verde';

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${SITE_NAME}`;
  }, [title]);
}
