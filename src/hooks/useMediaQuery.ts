import { useEffect, useState } from 'react';

/** Phones get the map-first sheet; wider screens get a docked side panel. */
export const COMPACT_QUERY = '(max-width: 767px)';

function matches(query: string): boolean {
  return window.matchMedia?.(query).matches ?? false;
}

export function useMediaQuery(query: string): boolean {
  const [matched, setMatched] = useState(() => matches(query));

  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return undefined;
    const update = () => setMatched(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matched;
}
