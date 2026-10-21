import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nearestSnap,
  nextSnap,
  sheetGeometry,
  SNAPS,
  useSheet,
  type SheetControls,
  type SheetGeometry,
  type SheetSnap,
} from './useSheet';

describe('sheetGeometry', () => {
  it('rests at the end of the answer, a fixed half height, and the full sheet', () => {
    expect(sheetGeometry(700, 160, 800)).toEqual({ peek: 160, half: 440, full: 700 });
  });

  it('never peeks less than 128 px when the sheet allows it', () => {
    expect(sheetGeometry(700, 40, 800)).toEqual({ peek: 128, half: 440, full: 700 });
  });

  it('treats a sheet shorter than 128 px as 128 px tall', () => {
    expect(sheetGeometry(50, 10, 800)).toEqual({ peek: 64, half: 128, full: 128 });
  });

  it('peeks at most half of the sheet', () => {
    expect(sheetGeometry(400, 300, 1000)).toEqual({ peek: 200, half: 400, full: 400 });
  });

  it('peeks at most 45% of the viewport', () => {
    expect(sheetGeometry(900, 500, 800)).toEqual({ peek: 360, half: 440, full: 900 });
  });

  it('keeps the half position at least 80 px above the peek', () => {
    expect(sheetGeometry(900, 400, 600)).toEqual({ peek: 270, half: 350, full: 900 });
  });

  it('never rests the half position above the full sheet', () => {
    expect(sheetGeometry(300, 100, 800)).toEqual({ peek: 128, half: 300, full: 300 });
  });

  it('rounds to whole pixels', () => {
    expect(sheetGeometry(700, 160.4, 801)).toEqual({ peek: 160, half: 441, full: 700 });
  });
});

describe('nearestSnap', () => {
  const geometry: SheetGeometry = { peek: 160, half: 440, full: 700 };

  it('picks the closest resting height', () => {
    expect(nearestSnap(geometry, 100, 0)).toBe('peek');
    expect(nearestSnap(geometry, 280, 0)).toBe('peek');
    expect(nearestSnap(geometry, 420, 0)).toBe('half');
    expect(nearestSnap(geometry, 690, 0)).toBe('full');
    expect(nearestSnap(geometry, 900, 0)).toBe('full');
  });

  it('keeps the lower position on an exact tie', () => {
    expect(nearestSnap(geometry, 300, 0)).toBe('peek');
    expect(nearestSnap(geometry, 570, 0)).toBe('half');
  });

  it('carries a flick 160 ms along its velocity', () => {
    expect(nearestSnap(geometry, 300, 2)).toBe('full');
    expect(nearestSnap(geometry, 600, -2)).toBe('peek');
    expect(nearestSnap(geometry, 250, 1)).toBe('half');
  });
});

describe('nextSnap', () => {
  it('cycles peek, half, full', () => {
    expect(SNAPS).toEqual(['peek', 'half', 'full']);
    expect(nextSnap('peek')).toBe('half');
    expect(nextSnap('half')).toBe('full');
    expect(nextSnap('full')).toBe('peek');
  });
});

/* ---------- The hook, against real DOM nodes with stubbed layout. ---------- */

const layout = { sheetHeight: 700, scrollerTop: 100, peekEndBottom: 250, summaryBottom: 400 };

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, x: 0, y: top, width: 0, height: bottom - top, toJSON: () => ({}) };
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  readonly disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

interface HarnessProps {
  enabled?: boolean;
  snap?: SheetSnap;
  withScroller?: boolean;
  withPeekEnd?: boolean;
  onSnapChange(snap: SheetSnap): void;
  onVisibleHeightChange(height: number): void;
}

let controls: SheetControls;

function Harness({ enabled = true, snap = 'peek', withScroller = true, withPeekEnd = true, onSnapChange, onVisibleHeightChange }: HarnessProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  controls = useSheet({ enabled, snap, sheetRef, scrollRef, summaryRef, onSnapChange, onVisibleHeightChange });
  const summary = createElement(
    'div',
    { 'data-testid': 'summary', ref: summaryRef },
    withPeekEnd ? createElement('p', { 'data-peek-end': '' }, 'answer') : 'answer',
  );
  return createElement(
    'div',
    { 'data-testid': 'sheet', ref: sheetRef, style: controls.style, ...controls.bind },
    withScroller ? createElement('div', { 'data-testid': 'scroller', ref: scrollRef }, summary) : summary,
  );
}

function renderSheet(overrides: Partial<HarnessProps> = {}) {
  const onSnapChange = vi.fn<(snap: SheetSnap) => void>();
  const onVisibleHeightChange = vi.fn<(height: number) => void>();
  const props: HarnessProps = { onSnapChange, onVisibleHeightChange, ...overrides };
  const view = render(createElement(Harness, props));
  return {
    ...view,
    props,
    onSnapChange: props.onSnapChange as typeof onSnapChange,
    onVisibleHeightChange: props.onVisibleHeightChange as typeof onVisibleHeightChange,
    sheet: screen.getByTestId('sheet'),
    rerenderWith: (next: Partial<HarnessProps>) => view.rerender(createElement(Harness, { ...props, ...next })),
  };
}

type PointerKind = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel';

function pointer(kind: PointerKind, target: Element, clientY: number, timeStamp: number, extra: PointerEventInit = {}) {
  const event = createEvent[kind](target, { pointerId: 7, pointerType: 'touch', button: 0, clientY, ...extra });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  fireEvent(target, event);
}

function sheetStyle(sheet: HTMLElement) {
  return {
    offset: sheet.style.getPropertyValue('--sheet-offset'),
    scrollHeight: sheet.style.getPropertyValue('--sheet-scroll-height'),
  };
}

beforeEach(() => {
  Object.assign(layout, { sheetHeight: 700, scrollerTop: 100, peekEndBottom: 250, summaryBottom: 400 });
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('innerHeight', 800);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function clientHeight(this: Element) {
    return (this as HTMLElement).dataset.testid === 'sheet' ? layout.sheetHeight : 0;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function boundingRect(this: Element) {
    const element = this as HTMLElement;
    if (element.dataset.testid === 'scroller') return rect(layout.scrollerTop, layout.scrollerTop + 700);
    if (element.hasAttribute('data-peek-end')) return rect(200, layout.peekEndBottom);
    if (element.dataset.testid === 'summary') return rect(layout.scrollerTop, layout.summaryBottom);
    return rect(0, 0);
  });
});

describe('useSheet', () => {
  it('stays out of the way while disabled', () => {
    const { sheet, onVisibleHeightChange } = renderSheet({ enabled: false });

    expect(sheet.getAttribute('style')).toBeNull();
    expect(controls.style).toEqual({});
    expect(controls.dragging).toBe(false);
    expect(onVisibleHeightChange).toHaveBeenCalledExactlyOnceWith(0);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it('ignores pointers while disabled', () => {
    const { sheet, onSnapChange } = renderSheet({ enabled: false });

    pointer('pointerDown', sheet, 600, 1000);
    pointer('pointerMove', sheet, 300, 1100);
    pointer('pointerUp', sheet, 300, 1200);

    expect(controls.dragging).toBe(false);
    expect(onSnapChange).not.toHaveBeenCalled();
    expect(controls.consumeDragClick()).toBe(false);
  });

  it('stays unmeasured when an element is missing', () => {
    const { sheet, onVisibleHeightChange } = renderSheet({ withScroller: false });

    expect(controls.style).toEqual({});
    expect(sheet.getAttribute('style')).toBeNull();
    expect(onVisibleHeightChange).toHaveBeenCalledExactlyOnceWith(0);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it('measures the sheet and positions it at the resting height', () => {
    const { sheet, onVisibleHeightChange } = renderSheet();

    // The answer ends 150 px into the scroller, plus a 10 px margin.
    expect(sheetStyle(sheet)).toEqual({ offset: '540px', scrollHeight: '160px' });
    expect(onVisibleHeightChange).toHaveBeenLastCalledWith(160);
    expect(controls.dragging).toBe(false);

    const [observer] = FakeResizeObserver.instances;
    expect(observer!.observed).toEqual([sheet, screen.getByTestId('summary')]);
  });

  it('falls back to the bottom of the summary without a peek marker', () => {
    const { sheet, onVisibleHeightChange } = renderSheet({ withPeekEnd: false });

    // The summary ends 300 px into the scroller, plus a 10 px margin.
    expect(sheetStyle(sheet)).toEqual({ offset: '390px', scrollHeight: '310px' });
    expect(onVisibleHeightChange).toHaveBeenLastCalledWith(310);
  });

  it('follows the snap it is given', () => {
    const { sheet, onVisibleHeightChange, rerenderWith } = renderSheet();

    rerenderWith({ snap: 'half' });
    expect(sheetStyle(sheet)).toEqual({ offset: '260px', scrollHeight: '440px' });
    expect(onVisibleHeightChange).toHaveBeenLastCalledWith(440);

    rerenderWith({ snap: 'full' });
    expect(sheetStyle(sheet)).toEqual({ offset: '0px', scrollHeight: '700px' });
    expect(onVisibleHeightChange).toHaveBeenLastCalledWith(700);
  });

  it('reports zero once disabled again', () => {
    const { sheet, onVisibleHeightChange, rerenderWith } = renderSheet({ snap: 'half' });
    expect(onVisibleHeightChange).toHaveBeenLastCalledWith(440);

    rerenderWith({ enabled: false });

    expect(onVisibleHeightChange).toHaveBeenLastCalledWith(0);
    expect(controls.style).toEqual({});
    expect(sheetStyle(sheet)).toEqual({ offset: '', scrollHeight: '' });
    expect(FakeResizeObserver.instances[0]!.disconnect).toHaveBeenCalledOnce();
  });

  it('re-measures on window resize and on observed size changes', () => {
    const { sheet, onVisibleHeightChange } = renderSheet({ snap: 'half' });
    const calls = onVisibleHeightChange.mock.calls.length;

    // Same layout: the geometry is kept and nothing is reported again.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(onVisibleHeightChange).toHaveBeenCalledTimes(calls);

    layout.sheetHeight = 600;
    vi.stubGlobal('innerHeight', 700);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    // half = max(160 + 80, 700 * 0.55) = 385
    expect(sheetStyle(sheet)).toEqual({ offset: '215px', scrollHeight: '385px' });
    expect(onVisibleHeightChange).toHaveBeenLastCalledWith(385);

    layout.peekEndBottom = 400;
    const beforeObserved = onVisibleHeightChange.mock.calls.length;
    act(() => FakeResizeObserver.instances[0]!.trigger());
    // peek = min(310, 300, 315) = 300; half = max(380, 385) = 385: only the peek moved.
    expect(onVisibleHeightChange).toHaveBeenCalledTimes(beforeObserved + 1);
    expect(onVisibleHeightChange).toHaveBeenLastCalledWith(385);
    expect(sheetStyle(sheet)).toEqual({ offset: '215px', scrollHeight: '385px' });
  });

  it('drags with the pointer and snaps to the nearest resting height', () => {
    const { sheet, onSnapChange } = renderSheet();

    pointer('pointerDown', sheet, 600, 1000);
    expect(controls.dragging).toBe(false);

    // Within the 6 px slop: still a tap.
    pointer('pointerMove', sheet, 595, 1010);
    expect(controls.dragging).toBe(false);
    expect(sheetStyle(sheet)).toEqual({ offset: '540px', scrollHeight: '160px' });

    pointer('pointerMove', sheet, 400, 1100);
    expect(controls.dragging).toBe(true);
    // 160 + 200 visible; the scroller grows with it.
    expect(sheetStyle(sheet)).toEqual({ offset: '340px', scrollHeight: '360px' });

    // Hold still before letting go, so there is no flick.
    pointer('pointerMove', sheet, 400, 2100);
    pointer('pointerUp', sheet, 400, 2110);

    expect(onSnapChange).toHaveBeenCalledExactlyOnceWith('half');
    expect(controls.dragging).toBe(false);
    expect(sheetStyle(sheet)).toEqual({ offset: '540px', scrollHeight: '160px' });
    expect(controls.consumeDragClick()).toBe(true);
    expect(controls.consumeDragClick()).toBe(false);
  });

  it('does not swallow the next tap when a drag ended without a click', () => {
    const { sheet } = renderSheet();

    // Dragging by the place header: the click after release lands off the handle.
    pointer('pointerDown', sheet, 600, 1000);
    pointer('pointerMove', sheet, 400, 1100);
    pointer('pointerUp', sheet, 400, 2000);

    pointer('pointerDown', sheet, 600, 3000);
    pointer('pointerUp', sheet, 600, 3050);
    expect(controls.consumeDragClick()).toBe(false);
  });

  it('settles back to rest when the sheet is disabled mid-drag', () => {
    const { sheet, onSnapChange, rerenderWith } = renderSheet();

    pointer('pointerDown', sheet, 600, 1000);
    pointer('pointerMove', sheet, 400, 1100);
    expect(controls.dragging).toBe(true);

    rerenderWith({ enabled: false });
    pointer('pointerUp', sheet, 400, 2000);
    rerenderWith({ enabled: true });

    expect(onSnapChange).not.toHaveBeenCalled();
    expect(controls.dragging).toBe(false);
    expect(sheetStyle(sheet)).toEqual({ offset: '540px', scrollHeight: '160px' });
  });

  it('carries a fast flick to a farther snap', () => {
    const { sheet, onSnapChange } = renderSheet();

    pointer('pointerDown', sheet, 600, 1000);
    pointer('pointerMove', sheet, 400, 1100);
    pointer('pointerUp', sheet, 400, 1105);

    // 360 px visible moving up at 2 px/ms lands nearest the full sheet.
    expect(onSnapChange).toHaveBeenCalledExactlyOnceWith('full');
  });

  it('measures velocity over at least 1 ms', () => {
    const { sheet, onSnapChange } = renderSheet({ snap: 'half' });

    pointer('pointerDown', sheet, 300, 1000);
    pointer('pointerMove', sheet, 290, 1000);
    pointer('pointerUp', sheet, 290, 1000);

    // 10 px in "0 ms" counts as 10 px/ms, flung all the way up.
    expect(onSnapChange).toHaveBeenCalledExactlyOnceWith('full');
  });

  it('keeps a drag between 70% of the peek and the full sheet', () => {
    const { sheet } = renderSheet();

    pointer('pointerDown', sheet, 600, 1000);
    pointer('pointerMove', sheet, 1000, 1100);
    // max(160 * 0.7, 160 - 400) = 112 visible; the scroller keeps its resting height.
    expect(sheetStyle(sheet)).toEqual({ offset: '588px', scrollHeight: '160px' });

    pointer('pointerMove', sheet, -500, 1200);
    expect(sheetStyle(sheet)).toEqual({ offset: '0px', scrollHeight: '700px' });
  });

  it('treats a short press as a tap, not a drag', () => {
    const { sheet, onSnapChange } = renderSheet();

    pointer('pointerDown', sheet, 600, 1000);
    pointer('pointerMove', sheet, 603, 1010);
    pointer('pointerUp', sheet, 603, 1020);

    expect(onSnapChange).not.toHaveBeenCalled();
    expect(controls.dragging).toBe(false);
    expect(controls.consumeDragClick()).toBe(false);
  });

  it('finishes a cancelled drag like a release', () => {
    const { sheet, onSnapChange } = renderSheet({ snap: 'full' });

    pointer('pointerDown', sheet, 100, 1000);
    pointer('pointerMove', sheet, 640, 1100);
    expect(controls.dragging).toBe(true);
    pointer('pointerMove', sheet, 640, 1600);
    pointer('pointerCancel', sheet, 640, 1610);

    expect(onSnapChange).toHaveBeenCalledExactlyOnceWith('peek');
    expect(controls.dragging).toBe(false);
    expect(controls.consumeDragClick()).toBe(true);
  });

  it('captures the pointer while dragging when the browser supports it', () => {
    const { sheet } = renderSheet();
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(sheet, { setPointerCapture, releasePointerCapture });

    pointer('pointerDown', sheet, 600, 1000);
    expect(setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);

    pointer('pointerUp', sheet, 600, 1010);
    expect(releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('ignores secondary mouse buttons but follows the primary one', () => {
    const { sheet, onSnapChange } = renderSheet();

    pointer('pointerDown', sheet, 600, 1000, { pointerType: 'mouse', button: 2 });
    pointer('pointerMove', sheet, 300, 1100, { pointerType: 'mouse', button: 2 });
    pointer('pointerUp', sheet, 300, 1200, { pointerType: 'mouse', button: 2 });
    expect(controls.dragging).toBe(false);
    expect(onSnapChange).not.toHaveBeenCalled();

    pointer('pointerDown', sheet, 600, 2000, { pointerType: 'mouse' });
    pointer('pointerMove', sheet, 300, 2100, { pointerType: 'mouse' });
    expect(controls.dragging).toBe(true);
    pointer('pointerMove', sheet, 300, 3100, { pointerType: 'mouse' });
    pointer('pointerUp', sheet, 300, 3110, { pointerType: 'mouse' });
    // 160 + 300 = 460 visible.
    expect(onSnapChange).toHaveBeenCalledExactlyOnceWith('half');
  });

  it('ignores moves and releases without a press', () => {
    const { sheet, onSnapChange } = renderSheet();

    pointer('pointerMove', sheet, 300, 1000);
    pointer('pointerUp', sheet, 300, 1100);

    expect(controls.dragging).toBe(false);
    expect(onSnapChange).not.toHaveBeenCalled();
    expect(controls.consumeDragClick()).toBe(false);
  });

  it('disconnects the observer and stops listening for resizes on unmount', () => {
    const { unmount } = renderSheet();
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const [observer] = FakeResizeObserver.instances;

    unmount();

    expect(observer!.disconnect).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
