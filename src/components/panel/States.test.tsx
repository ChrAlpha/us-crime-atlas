import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DELAYED_WINDOW, EMPTY_WINDOW, evidenceFor } from '../../test/panelFixtures';
import { ErrorSummary, LoadingSummary, NoRecordsSummary } from './States';

describe('LoadingSummary', () => {
  it('announces loading politely behind a skeleton', () => {
    const { container } = render(<LoadingSummary label="Loading official New York City incident records" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/^Loading official New York City incident records$/);
    expect(within(status).getByText('Loading official New York City incident records')).toHaveClass('sr-only');
    expect(container.querySelectorAll('.skeleton')).toHaveLength(4);
    expect(container.querySelectorAll('.skeleton[aria-hidden="true"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-peek-end]')).toHaveLength(1);
    expect(container.querySelector('[data-peek-end]')).toHaveClass('skeleton--short');
  });

  it('announces whatever the caller is loading', () => {
    render(<LoadingSummary label="Looking up FBI totals for this area" />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Looking up FBI totals for this area$/);
  });
});

describe('ErrorSummary', () => {
  it('names the source, shows the error, and retries', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(
      <ErrorSummary
        error="New York City returned HTTP 503."
        onRefresh={onRefresh}
        title="Couldn't load New York City police records"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('state', 'state--error');
    expect(alert.querySelector('svg')).toHaveClass('state__icon');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent(
      /^Couldn't load New York City police records$/,
    );
    expect(alert).toHaveTextContent('New York City returned HTTP 503. Nothing is shown rather than a guess.');

    const retry = within(alert).getByRole('button', { name: 'Try again' });
    expect(retry).toHaveAttribute('data-peek-end');
    expect(retry).toHaveAttribute('type', 'button');
    await user.click(retry);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('titles a failed FBI lookup', () => {
    render(
      <ErrorSummary
        error="The Census geography service did not respond within 20 seconds."
        onRefresh={vi.fn()}
        title="Couldn't look up FBI totals for this area"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent("Couldn't look up FBI totals for this area");
    expect(alert).toHaveTextContent(
      'The Census geography service did not respond within 20 seconds. Nothing is shown rather than a guess.',
    );
  });

  it.each([null, ''])('falls back to a generic message for %j', (error) => {
    render(<ErrorSummary error={error} onRefresh={vi.fn()} title="Couldn't load records" />);
    expect(screen.getByRole('alert').querySelector('p')).toHaveTextContent(
      /^The official source did not return a usable response\. Nothing is shown rather than a guess\.$/,
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
