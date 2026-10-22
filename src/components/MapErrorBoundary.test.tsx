import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MapErrorBoundary } from './MapErrorBoundary';

function Exploding(): never {
  throw new Error('chunk failed');
}

describe('MapErrorBoundary', () => {
  it('renders its children while they work', () => {
    render(<MapErrorBoundary><p>map ready</p></MapErrorBoundary>);
    expect(screen.getByText('map ready')).toBeInTheDocument();
  });

  it('keeps the shell usable and offers a reload when the map fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });

    render(<MapErrorBoundary><Exploding /></MapErrorBoundary>);

    expect(screen.getByRole('alert')).toHaveTextContent('Map unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('Search, settings, and the evidence panel still work.');
    const reloadButton = screen.getByRole('button', { name: 'Reload map' });
    expect(reloadButton).toHaveClass('button');
    await userEvent.click(reloadButton);
    expect(reload).toHaveBeenCalledOnce();
  });
});
