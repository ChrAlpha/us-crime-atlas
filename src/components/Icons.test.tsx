import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Icons from './Icons';

const icons = Object.entries(Icons);

describe('Icons', () => {
  it('exports the full icon set', () => {
    expect(icons.map(([name]) => name).sort()).toEqual([
      'AtlasIcon',
      'ChevronIcon',
      'CloseIcon',
      'ExternalIcon',
      'InfoIcon',
      'LayersIcon',
      'LocateIcon',
      'MoonIcon',
      'RefreshIcon',
      'SearchIcon',
      'SlidersIcon',
      'SunIcon',
      'WarningIcon',
    ]);
  });

  it.each(icons)('renders %s as a decorative 18 px glyph by default', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg')!;

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '18');
    expect(svg).toHaveAttribute('height', '18');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg.childElementCount).toBeGreaterThan(0);
  });

  it.each(icons)('passes size and SVG props through for %s', (_name, Icon) => {
    const { container } = render(<Icon className="is-spinning" data-testid="glyph" size={24} />);
    const svg = container.querySelector('svg')!;

    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
    expect(svg).toHaveClass('is-spinning');
    expect(svg).toHaveAttribute('data-testid', 'glyph');
  });
});
