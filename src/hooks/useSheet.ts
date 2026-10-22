import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react';

export type SheetSnap = 'peek' | 'half' | 'full';

/** Visible heights, in pixels, of each resting position. */
export interface SheetGeometry {
  peek: number;
  half: number;
  full: number;
}

export const SNAPS: readonly SheetSnap[] = ['peek', 'half', 'full'];
const MIN_PEEK = 128;
/** Space left below the answer when the sheet is lowered. */
const PEEK_MARGIN = 10;
const HALF_SHARE = 0.55;
/** A drag shorter than this is a tap. */
const DRAG_SLOP = 6;
/** How far a flick carries, in milliseconds of its release velocity. */
const FLICK_MS = 160;

export function sheetGeometry(sheetHeight: number, summaryBottom: number, viewportHeight: number): SheetGeometry {
  const full = Math.max(MIN_PEEK, sheetHeight);
  const peek = Math.round(Math.min(Math.max(MIN_PEEK, summaryBottom), full * 0.5, viewportHeight * 0.45));
  const half = Math.round(Math.min(full, Math.max(peek + 80, viewportHeight * HALF_SHARE)));
  return { peek, half, full };
}

/** The resting position nearest to where a drag would carry the sheet. */
export function nearestSnap(geometry: SheetGeometry, visible: number, velocity: number): SheetSnap {
  const projected = visible + velocity * FLICK_MS;
  return SNAPS.reduce((best, snap) => (
    Math.abs(geometry[snap] - projected) < Math.abs(geometry[best] - projected) ? snap : best
  ), 'peek' as SheetSnap);
}

export function nextSnap(snap: SheetSnap): SheetSnap {
  if (snap === 'peek') return 'half';
  if (snap === 'half') return 'full';
  return 'peek';
}

interface DragState {
  startY: number;
  startVisible: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  moved: boolean;
}

export interface SheetControls {
  /** Inline style that positions the sheet; empty when the sheet is disabled. */
  style: CSSProperties;
  dragging: boolean;
  bind: {
    onPointerDown(event: PointerEvent<HTMLElement>): void;
    onPointerMove(event: PointerEvent<HTMLElement>): void;
    onPointerUp(event: PointerEvent<HTMLElement>): void;
    onPointerCancel(event: PointerEvent<HTMLElement>): void;
  };
  /** True once for the click that ends a drag, so it does not also toggle the sheet. */
  consumeDragClick(): boolean;
}

/**
 * A bottom sheet with three resting heights. It moves with `transform` only; the summary
 * element decides how much stays visible when the sheet is lowered.
 */
export function useSheet({
  enabled,
  snap,
  sheetRef,
  scrollRef,
  summaryRef,
  onSnapChange,
  onVisibleHeightChange,
}: {
  enabled: boolean;
  snap: SheetSnap;
  /** The moving, clipping outer element. */
  sheetRef: RefObject<HTMLElement | null>;
  /** The scrolling inner element. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Wraps the place header and the answer; its `[data-peek-end]` child ends the lowest position. */
  summaryRef: RefObject<HTMLElement | null>;
  onSnapChange(snap: SheetSnap): void;
  onVisibleHeightChange(height: number): void;
}): SheetControls {
  const [geometry, setGeometry] = useState<SheetGeometry | null>(null);
  const [dragVisible, setDragVisible] = useState<number | null>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const sheet = sheetRef.current;
    const scroller = scrollRef.current;
    const summary = summaryRef.current;
    if (!enabled || !sheet || !scroller || !summary) {
      setGeometry(null);
      return undefined;
    }
    const measure = () => {
      const anchor = summary.querySelector('[data-peek-end]') ?? summary;
      const peekEnd = anchor.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const next = sheetGeometry(sheet.clientHeight, peekEnd + PEEK_MARGIN, window.innerHeight);
      setGeometry((current) => (
        current && current.peek === next.peek && current.half === next.half && current.full === next.full ? current : next
      ));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    observer.observe(summary);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled, sheetRef, scrollRef, summaryRef]);

  const restingVisible = geometry ? geometry[snap] : 0;

  useEffect(() => {
    onVisibleHeightChange(enabled && geometry ? restingVisible : 0);
  }, [enabled, geometry, restingVisible, onVisibleHeightChange]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabled || !geometry || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // A drag that ended off the handle never produced a click to swallow.
    suppressClick.current = false;
    drag.current = {
      startY: event.clientY,
      startVisible: geometry[snap],
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      moved: false,
    };
  }, [enabled, geometry, snap]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || !geometry) return;
    const delta = state.startY - event.clientY;
    if (!state.moved && Math.abs(delta) < DRAG_SLOP) return;
    state.moved = true;
    const elapsed = Math.max(1, event.timeStamp - state.lastTime);
    state.velocity = (state.lastY - event.clientY) / elapsed;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    setDragVisible(Math.min(geometry.full, Math.max(geometry.peek * 0.7, state.startVisible + delta)));
  }, [geometry]);

  const finish = useCallback((event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragVisible(null);
    if (!state?.moved || !geometry) return;
    suppressClick.current = true;
    const visible = state.startVisible + (state.startY - event.clientY);
    onSnapChange(nearestSnap(geometry, visible, state.velocity));
  }, [geometry, onSnapChange]);

  const consumeDragClick = useCallback(() => {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  }, []);

  const visible = dragVisible ?? restingVisible;
  // The scroller is sized to the part of the sheet on screen; it only grows while dragging up.
  const style: CSSProperties = enabled && geometry
    ? ({
      '--sheet-offset': `${geometry.full - visible}px`,
      '--sheet-scroll-height': `${Math.max(visible, restingVisible)}px`,
    } as CSSProperties)
    : {};

  return {
    style,
    dragging: dragVisible !== null,
    bind: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish },
    consumeDragClick,
  };
}
