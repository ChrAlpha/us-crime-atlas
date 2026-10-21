import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analysisFor,
  CENTER,
  CURRENT_WINDOW,
  DELAYED_WINDOW,
  EMPTY_WINDOW,
  evidenceFor,
  PLACE,
  PROVIDER,
  truncation,
} from '../test/panelFixtures';
import type { SheetSnap } from '../hooks/useSheet';
import { groupIncidentsByLocation } from './mapLayers';
import { PlacePanel, type PanelSelection, type PanelTab, type PlacePanelProps } from './PlacePanel';

function props(overrides: Partial<PlacePanelProps> = {}): PlacePanelProps {
  const evidence = overrides.evidence === undefined ? evidenceFor(CURRENT_WINDOW) : overrides.evidence;
  return {
    compact: false,
    place: PLACE,
    provider: PROVIDER,
    status: 'ready',
    analysis: evidence ? analysisFor(evidence) : null,
    evidence,
    error: null,
    radiusMeters: 1000,
    tab: 'overview',
    snap: 'peek',
    selection: null,
    themePreference: 'system',
    onTabChange: vi.fn(),
    onSnapChange: vi.fn(),
    onVisibleHeightChange: vi.fn(),
    onReportSelect: vi.fn(),
    onFocusIncident: vi.fn(),
    onClearSelection: vi.fn(),
    onRefresh: vi.fn(),
    onPlaceSelect: vi.fn(),
    onThemePreferenceChange: vi.fn(),
    ...overrides,
  };
}

function renderPanel(overrides: Partial<PlacePanelProps> = {}) {
  const view = props(overrides);
  const result = render(<PlacePanel {...view} />);
  return { ...result, view, rerenderWith: (next: Partial<PlacePanelProps>) => result.rerender(<PlacePanel {...view} {...next} />) };
}

const panel = () => screen.getByTestId('evidence-panel');
const sourceLine = () => panel().querySelector('.place__source')!;
const scroller = () => panel().querySelector<HTMLElement>('.panel__scroll')!;
const tab = (name: RegExp | string) => screen.getByRole('tab', { name });

/** A map pick of the spot where every report in the circle was published. */
function mapSelection(incidentId: string | null = 'theft-1', origin: PanelSelection['origin'] = 'map'): PanelSelection {
  const analysis = analysisFor(evidenceFor(CURRENT_WINDOW));
  const [location] = groupIncidentsByLocation(CENTER, 1000, analysis.currentIncidents);
  return { location: location!, incidentId, origin };
}

describe('PlacePanel header', () => {
  it('names the place and its detail', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'Evidence for Times Square' })).toBe(panel());
    const title = screen.getByRole('heading', { level: 1, name: 'Times Square' });
    expect(title).toHaveAttribute('title', 'Times Square');
    expect(panel().querySelector('.place__detail')).toHaveTextContent('Manhattan · New York City');
  });

  it('calls a place without detail a dropped pin', () => {
    renderPanel({ place: { ...PLACE, label: '40.75800, -73.98550', detail: '' } });
    expect(panel().querySelector('.place__detail')).toHaveTextContent('Dropped pin');
  });
});

describe('PlacePanel source line', () => {
  it('says the map is all there is without a feed', () => {
    renderPanel({ provider: null, status: 'idle', evidence: null });
    expect(sourceLine()).toHaveTextContent(/^Map only · no verified incident feed$/);
  });

  it('marks the source unavailable after an error', () => {
    renderPanel({ status: 'error', error: 'HTTP 503' });
    expect(sourceLine()).toHaveTextContent(/^New York City police records · unavailable$/);
  });

  it('says the feed is being checked while the first load runs', () => {
    renderPanel({ status: 'loading', evidence: null });
    expect(sourceLine()).toHaveTextContent(/^New York City police records · checking the feed…$/);
  });

  it('names the records alone before any load starts', () => {
    renderPanel({ status: 'idle', evidence: null });
    expect(sourceLine()).toHaveTextContent(/^New York City police records$/);
  });

  it('names the records alone for a feed without records', () => {
    renderPanel({ evidence: evidenceFor(EMPTY_WINDOW, { incidents: [] }) });
    expect(sourceLine()).toHaveTextContent(/^New York City police records$/);
  });

  it('shows the dates analyzed', () => {
    renderPanel();
    expect(sourceLine()).toHaveTextContent(/^New York City police records · Sep 19 – Oct 18, 2026$/);
    expect(screen.queryByTestId('delayed-feed-tag')).not.toBeInTheDocument();
  });

  it('tags a feed whose publisher is behind', () => {
    renderPanel({ evidence: evidenceFor(DELAYED_WINDOW) });

    expect(sourceLine()).toHaveTextContent('New York City police records · Jun 1 – Jun 30, 2026');
    const tag = screen.getByTestId('delayed-feed-tag');
    expect(tag).toHaveTextContent(/^113 days behind$/);
    expect(tag).toHaveClass('tag');
    expect(tag.querySelector('svg')).toBeInTheDocument();
  });
});

describe('PlacePanel summary', () => {
  it('explains a place without a feed and shows the about content without tabs', () => {
    renderPanel({ provider: null, status: 'idle', evidence: null });

    expect(screen.getByTestId('no-feed-state')).toHaveTextContent('Times Square is outside the cities');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Cities with official incident data' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Source' })).not.toBeInTheDocument();
  });

  it('shows a source failure with a retry and the about content', async () => {
    const user = userEvent.setup();
    const { view } = renderPanel({ status: 'error', error: 'New York City returned HTTP 503.' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('New York City returned HTTP 503.');
    // A stale result never shows next to an error.
    expect(screen.queryByTestId('finding')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Source' })).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(view.onRefresh).toHaveBeenCalledOnce();
  });

  it('shows a skeleton before the first result', () => {
    renderPanel({ status: 'loading', evidence: null });

    expect(screen.getByRole('status')).toHaveTextContent('Loading official New York City incident records');
    expect(panel().querySelector('.panel__progress')).toBeNull();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload from New York City source' })).toBeDisabled();
  });

  it('keeps the skeleton until both analysis and evidence exist', () => {
    renderPanel({ analysis: null });
    expect(screen.getByRole('status')).toHaveTextContent('Loading official New York City incident records');
  });

  it('shows no figures for a feed without records', () => {
    renderPanel({ evidence: evidenceFor(EMPTY_WINDOW, { incidents: [] }) });

    expect(screen.getByTestId('no-records-state')).toBeInTheDocument();
    expect(screen.queryByTestId('finding')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reported-count')).not.toBeInTheDocument();
  });

  it('states the finding and offers the tabs once ready', () => {
    renderPanel();

    const finding = screen.getByTestId('finding');
    expect(finding.parentElement).toHaveClass('panel__summary');
    expect(screen.getByTestId('evidence-window')).toHaveTextContent('1 km circle vs. the 1–3 km ring');
    expect(screen.getByRole('tablist', { name: 'Evidence views' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the result and shows progress while refreshing', () => {
    renderPanel({ status: 'loading' });

    const progress = screen.getByRole('status');
    expect(progress).toHaveClass('panel__progress');
    expect(progress).toHaveTextContent('Updating official records');
    expect(screen.getByTestId('finding')).toBeInTheDocument();
    expect(sourceLine()).toHaveTextContent(/^New York City police records · Sep 19 – Oct 18, 2026$/);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});

describe('PlacePanel tabs', () => {
  it('marks the current tab and labels the view with it', () => {
    renderPanel({ tab: 'reports' });

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((item) => item.id)).toEqual(['tab-overview', 'tab-reports', 'tab-about']);
    expect(tabs.map((item) => item.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs.map((item) => item.tabIndex)).toEqual([-1, 0, -1]);
    expect(tabs.every((item) => item.getAttribute('aria-controls') === 'panel-view')).toBe(true);

    const view = screen.getByRole('tabpanel');
    expect(view).toHaveAttribute('id', 'panel-view');
    expect(view).toHaveAttribute('aria-labelledby', 'tab-reports');
    expect(tab(/^Reports/).querySelector('.tabs__count')).toHaveTextContent(/^5$/);
    expect(tab('About the data')).toBeInTheDocument();
  });

  it('counts a truncated result as a lower bound', () => {
    renderPanel({ evidence: evidenceFor(CURRENT_WINDOW, { truncation: truncation({ selectedCurrent: true }) }) });
    expect(tab(/^Reports/).querySelector('.tabs__count')).toHaveTextContent(/^5\+$/);
  });

  it('switches tabs on click', async () => {
    const user = userEvent.setup();
    const { view } = renderPanel();

    await user.click(tab(/^Reports/));
    expect(view.onTabChange).toHaveBeenLastCalledWith('reports');
    await user.click(tab('About the data'));
    expect(view.onTabChange).toHaveBeenLastCalledWith('about');
    await user.click(tab('Overview'));
    expect(view.onTabChange).toHaveBeenLastCalledWith('overview');
  });

  it.each<[PanelTab, string, PanelTab]>([
    ['overview', 'ArrowRight', 'reports'],
    ['reports', 'ArrowRight', 'about'],
    ['about', 'ArrowRight', 'overview'],
    ['overview', 'ArrowLeft', 'about'],
    ['reports', 'ArrowLeft', 'overview'],
    ['reports', 'Home', 'overview'],
    ['reports', 'End', 'about'],
  ])('moves from %s with %s to %s', async (current, key, target) => {
    const user = userEvent.setup();
    const { view } = renderPanel({ tab: current });

    screen.getAllByRole('tab', { selected: true })[0]!.focus();
    await user.keyboard(`{${key}}`);

    expect(view.onTabChange).toHaveBeenCalledOnce();
    expect(view.onTabChange).toHaveBeenCalledWith(target);
    expect(document.activeElement).toHaveAttribute('id', `tab-${target}`);
  });

  it('prevents the default action only for keys it handles', () => {
    const { view } = renderPanel();
    const tablist = screen.getByRole('tablist');

    expect(fireEvent.keyDown(tab('Overview'), { key: 'ArrowRight' })).toBe(false);
    expect(fireEvent.keyDown(tablist, { key: 'a' })).toBe(true);
    expect(fireEvent.keyDown(tablist, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(tablist, { key: 'Enter' })).toBe(true);
    expect(view.onTabChange).toHaveBeenCalledOnce();
  });

  it('shows the overview', () => {
    renderPanel({ tab: 'overview' });
    const view = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(within(view).getByTestId('reported-count')).toHaveTextContent('5');
    expect(within(view).queryByRole('region', { name: 'Reports inside the circle' })).not.toBeInTheDocument();
  });

  it('shows the reports', async () => {
    const user = userEvent.setup();
    const { view: props } = renderPanel({ tab: 'reports' });

    const view = screen.getByRole('tabpanel', { name: /^Reports/ });
    const list = within(view).getByRole('region', { name: 'Reports inside the circle' });
    expect(within(list).getAllByRole('button')).toHaveLength(5);
    expect(within(list).queryByRole('button', { expanded: true })).not.toBeInTheDocument();
    expect(within(view).queryByTestId('reported-count')).not.toBeInTheDocument();

    await user.click(within(list).getAllByRole('button')[2]!);
    expect(props.onReportSelect).toHaveBeenCalledWith(props.analysis!.currentIncidents[2]);
  });

  it('shows the about content', () => {
    renderPanel({ tab: 'about' });
    const view = screen.getByRole('tabpanel', { name: 'About the data' });
    expect(within(view).getByRole('heading', { level: 3, name: 'Source' })).toBeInTheDocument();
    expect(within(view).getByText('Showing')).toBeInTheDocument();
  });
});

describe('PlacePanel selection', () => {
  it('opens a map pick above the tabs', async () => {
    const user = userEvent.setup();
    const selection = mapSelection('theft-1');
    const { view } = renderPanel({ selection });

    const selected = screen.getByTestId('selected-reports');
    expect(selected).toHaveTextContent('5 reports at this spot');
    expect(within(selected).getByRole('heading', { level: 3 })).toHaveTextContent('Theft');
    expect(selected).toHaveTextContent(`Location is approximate. ${PROVIDER.meta.precisionNote}`);
    expect(selected.compareDocumentPosition(screen.getByRole('tablist')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(within(selected).getAllByRole('button', { name: /^(?!Close)/ })[0]!);
    expect(view.onFocusIncident).toHaveBeenCalledWith(selection.location.incidents[0]);

    await user.click(screen.getByRole('button', { name: 'Close selected reports' }));
    expect(view.onClearSelection).toHaveBeenCalledOnce();
  });

  it('scrolls to the top for each new map pick', () => {
    const { rerenderWith } = renderPanel();
    scroller().scrollTop = 240;

    rerenderWith({ selection: mapSelection('theft-1') });
    expect(scroller().scrollTop).toBe(0);

    scroller().scrollTop = 240;
    rerenderWith({ selection: mapSelection('theft-1') });
    expect(scroller().scrollTop).toBe(240);

    rerenderWith({ selection: mapSelection('assault-1') });
    expect(scroller().scrollTop).toBe(0);

    scroller().scrollTop = 240;
    rerenderWith({ selection: mapSelection(null) });
    expect(scroller().scrollTop).toBe(0);
    expect(within(screen.getByTestId('selected-reports')).getByRole('heading', { level: 3 })).toHaveTextContent('Assault');
  });

  it('expands a list pick in place instead', () => {
    const { rerenderWith } = renderPanel({ tab: 'reports' });
    scroller().scrollTop = 240;

    rerenderWith({ tab: 'reports', selection: mapSelection('theft-1', 'list') });

    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();
    const expanded = screen.getByRole('button', { expanded: true });
    expect(expanded).toHaveTextContent(/^Theft/);
    expect(expanded.closest('li')!.querySelector('.selected__precision')).toHaveTextContent(PROVIDER.meta.precisionNote);
    expect(scroller().scrollTop).toBe(240);
  });

  it('ignores a list pick outside the reports tab', () => {
    renderPanel({ tab: 'overview', selection: mapSelection('theft-1', 'list') });
    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { expanded: true })).not.toBeInTheDocument();
  });

  it('shows no map pick without a provider', () => {
    renderPanel({ provider: null, status: 'idle', evidence: null, selection: mapSelection('theft-1') });
    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();
  });
});

describe('PlacePanel sheet', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  const handle = () => panel().querySelector<HTMLButtonElement>('.sheet__handle')!;

  it.each<[SheetSnap, string, boolean, SheetSnap]>([
    ['peek', 'Show more of the evidence panel', false, 'half'],
    ['half', 'Expand the evidence panel', true, 'full'],
    ['full', 'Collapse the evidence panel', true, 'peek'],
  ])('labels the handle at %s and steps to the next snap', async (snap, label, expanded, next) => {
    const user = userEvent.setup();
    const { view } = renderPanel({ compact: true, snap });

    const button = screen.getByRole('button', { name: label });
    expect(button).toBe(handle());
    expect(button).toHaveAttribute('aria-expanded', String(expanded));
    expect(panel().className).toBe(`panel panel--sheet is-${snap}`);

    await user.click(button);
    expect(view.onSnapChange).toHaveBeenCalledOnce();
    expect(view.onSnapChange).toHaveBeenCalledWith(next);
  });

  it('reports the visible height of the lowered sheet', () => {
    const { view } = renderPanel({ compact: true, snap: 'peek' });
    expect(view.onVisibleHeightChange).toHaveBeenLastCalledWith(expect.any(Number));
    expect(vi.mocked(view.onVisibleHeightChange).mock.lastCall![0]).toBeGreaterThan(0);
    expect(panel().style.getPropertyValue('--sheet-offset')).toMatch(/px$/);
  });

  it('does not also toggle on the click that ends a drag', () => {
    const { view } = renderPanel({ compact: true, snap: 'peek' });
    const button = handle();

    fireEvent.pointerDown(button, { pointerId: 1, pointerType: 'touch', clientY: 700 });
    fireEvent.pointerMove(button, { pointerId: 1, pointerType: 'touch', clientY: 600 });
    expect(panel()).toHaveClass('is-dragging');
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: 'touch', clientY: 600 });
    expect(panel()).not.toHaveClass('is-dragging');
    expect(view.onSnapChange).toHaveBeenCalledOnce();

    fireEvent.click(button);
    expect(view.onSnapChange).toHaveBeenCalledOnce();

    fireEvent.click(button);
    expect(view.onSnapChange).toHaveBeenCalledTimes(2);
    expect(view.onSnapChange).toHaveBeenLastCalledWith('half');
  });

  it('drags from the place header too', () => {
    const { view } = renderPanel({ compact: true, snap: 'peek' });
    const header = panel().querySelector('header')!;

    fireEvent.pointerDown(header, { pointerId: 1, pointerType: 'touch', clientY: 700 });
    fireEvent.pointerMove(header, { pointerId: 1, pointerType: 'touch', clientY: 500 });
    expect(panel()).toHaveClass('is-dragging');
    fireEvent.pointerUp(header, { pointerId: 1, pointerType: 'touch', clientY: 500 });
    expect(view.onSnapChange).toHaveBeenCalledOnce();
  });

  it('has no handle or sheet outside compact mode', () => {
    const { view } = renderPanel({ compact: false });

    expect(panel().querySelector('.sheet__handle')).toBeNull();
    expect(screen.queryByRole('button', { name: /evidence panel/ })).not.toBeInTheDocument();
    expect(panel().className).toBe('panel');
    expect(view.onVisibleHeightChange).toHaveBeenLastCalledWith(0);

    const header = panel().querySelector('header')!;
    fireEvent.pointerDown(header, { pointerId: 1, pointerType: 'touch', clientY: 700 });
    fireEvent.pointerMove(header, { pointerId: 1, pointerType: 'touch', clientY: 500 });
    expect(panel()).not.toHaveClass('is-dragging');
  });
});
