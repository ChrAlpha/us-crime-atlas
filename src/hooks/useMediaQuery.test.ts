import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COMPACT_QUERY, useMediaQuery } from './useMediaQuery';

/** A controllable MediaQueryList per query. */
function stubMatchMedia(initial: Record<string, boolean>) {
  const lists = new Map<string, {
    matches: boolean;
    listeners: Set<() => void>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  }>();
  const matchMedia = vi.fn((query: string) => {
    let list = lists.get(query);
    if (!list) {
      const listeners = new Set<() => void>();
      list = {
        matches: initial[query] ?? false,
        listeners,
        addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
        removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
      };
      lists.set(query, list);
    }
    return list as unknown as MediaQueryList;
  });
  vi.stubGlobal('matchMedia', matchMedia);
  const change = (query: string, matches: boolean) => {
    const list = lists.get(query)!;
    list.matches = matches;
    for (const listener of list.listeners) listener();
  };
  return { matchMedia, lists, change };
}

describe('COMPACT_QUERY', () => {
  it('targets phone-width viewports', () => {
    expect(COMPACT_QUERY).toBe('(max-width: 767px)');
  });
});

describe('useMediaQuery', () => {
  it('starts from the current match', () => {
    const { matchMedia } = stubMatchMedia({ [COMPACT_QUERY]: true });
    const { result } = renderHook(() => useMediaQuery(COMPACT_QUERY));

    expect(result.current).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(COMPACT_QUERY);
  });

  it('reports a query that does not match', () => {
    stubMatchMedia({});
    const { result } = renderHook(() => useMediaQuery('(min-width: 2000px)'));
    expect(result.current).toBe(false);
  });

  it('follows change events', () => {
    const { change, lists } = stubMatchMedia({ [COMPACT_QUERY]: false });
    const { result } = renderHook(() => useMediaQuery(COMPACT_QUERY));
    expect(lists.get(COMPACT_QUERY)!.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    act(() => change(COMPACT_QUERY, true));
    expect(result.current).toBe(true);

    act(() => change(COMPACT_QUERY, false));
    expect(result.current).toBe(false);
  });

  it('removes its listener on unmount', () => {
    const { lists } = stubMatchMedia({ [COMPACT_QUERY]: true });
    const { unmount } = renderHook(() => useMediaQuery(COMPACT_QUERY));
    const list = lists.get(COMPACT_QUERY)!;
    const listener = list.addEventListener.mock.calls[0]![1];

    unmount();

    expect(list.removeEventListener).toHaveBeenCalledExactlyOnceWith('change', listener);
    expect(list.listeners.size).toBe(0);
  });

  it('switches lists when the query changes', () => {
    const { change, lists } = stubMatchMedia({ narrow: true, wide: false });
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), { initialProps: { query: 'narrow' } });
    expect(result.current).toBe(true);

    rerender({ query: 'wide' });

    expect(result.current).toBe(false);
    expect(lists.get('narrow')!.listeners.size).toBe(0);
    expect(lists.get('wide')!.listeners.size).toBe(1);

    act(() => change('narrow', false));
    act(() => change('wide', true));
    expect(result.current).toBe(true);
  });

  it('falls back to no match without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result, unmount } = renderHook(() => useMediaQuery(COMPACT_QUERY));

    expect(result.current).toBe(false);
    expect(() => unmount()).not.toThrow();
  });
});
