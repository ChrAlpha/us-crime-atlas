import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DELAYED_WINDOW, EMPTY_WINDOW, evidenceFor, PLACE, PROVIDER } from '../../test/panelFixtures';
import { ErrorSummary, LoadingSummary, NoFeedSummary, NoRecordsSummary } from './States';

describe('LoadingSummary', () => {
  it('announces loading politely behind a skeleton', () => {
    const { container } = render(<LoadingSummary provider={PROVIDER} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/^Loading official New York City incident records$/);
    expect(within(status).getByText('Loading official New York City incident records')).toHaveClass('sr-only');
    expect(container.querySelectorAll('.skeleton')).toHaveLength(4);
    expect(container.querySelectorAll('[data-peek-end]')).toHaveLength(1);
    expect(container.querySelector('[data-peek-end]')).toHaveClass('skeleton--short');
  });
});

describe('ErrorSummary', () => {
  it('names the source, shows the error, and retries', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(<ErrorSummary error="New York City returned HTTP 503." onRefresh={onRefresh} provider={PROVIDER} />);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent("Couldn't load New York City police records");
    expect(alert).toHaveTextContent('New York City returned HTTP 503. Nothing is shown rather than a guess.');

    const retry = within(alert).getByRole('button', { name: 'Try again' });
    expect(retry).toHaveAttribute('data-peek-end');
    await user.click(retry);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it.each([null, ''])('falls back to a generic message for %j', (error) => {
    render(<ErrorSummary error={error} onRefresh={vi.fn()} provider={PROVIDER} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The official publisher did not return a usable response. Nothing is shown rather than a guess.',
    );
  });
});

describe('NoRecordsSummary', () => {
  it('shows no figures for a feed without recent records', () => {
    render(<NoRecordsSummary evidence={evidenceFor(EMPTY_WINDOW, { incidents: [] })} />);

    const state = screen.getByTestId('no-records-state');
    const heading = within(state).getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('No recent records from New York City Police Department');
    expect(heading).toHaveAttribute('data-peek-end');
    expect(state).toHaveTextContent(
      'No records were published in the last 400 days. Published quarterly. Without published records there is '
        + 'nothing to count or compare, so no figures are shown.',
    );
  });

  it('dates the newest record when the feed has one', () => {
    render(<NoRecordsSummary evidence={evidenceFor(DELAYED_WINDOW)} />);
    expect(screen.getByTestId('no-records-state')).toHaveTextContent(
      'The newest published record is from Jun 30, 2026. Published quarterly. The window ends Jun 30, 2026.',
    );
  });
});

describe('NoFeedSummary', () => {
  it('explains that the place has no verified feed', () => {
    render(<NoFeedSummary place={{ ...PLACE, label: 'Boise' }} />);

    const state = screen.getByTestId('no-feed-state');
    const heading = within(state).getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('No official incident feed here yet');
    expect(heading).toHaveAttribute('data-peek-end');
    expect(state).toHaveTextContent('Boise is outside the cities with a verified police incident feed.');
    expect(state).toHaveTextContent("never fills the gap with estimates, a national average, or another city's data.");
  });
});
