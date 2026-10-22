import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { stubBox } from '../../test/panelFixtures';
import { BarChart, type BarChartProps } from './BarChart';

const unit = (count: number) => (count === 1 ? '1 report' : `${count} reports`);

function renderChart(overrides: Partial<BarChartProps> = {}) {
  const props: BarChartProps = {
    values: [0, 1, 50, 100],
    labels: ['Mon', 'Tue', 'Wed', 'Thu'],
    ticks: [{ index: 0, label: 'Mon' }],
    summary: 'Reports by weekday',
    idleReadout: 'Busiest day: Thu, 100 reports',
    unit,
    ...overrides,
  };
  const { container } = render(<BarChart {...props} />);
  const plot = screen.getByRole('img', { name: props.summary });
  return {
    plot,
    readout: container.querySelector('.bars__readout')!,
    columns: () => [...plot.querySelectorAll<HTMLElement>('.bars__col')],
    ticks: [...container.querySelectorAll<HTMLElement>('.bars__axis span')],
  };
}

describe('BarChart', () => {
  it('describes the whole chart as one image with an idle readout', () => {
    const { plot, readout } = renderChart();

    expect(plot).toHaveClass('bars__plot');
    expect(plot.closest('figure')).toHaveClass('bars');
    expect(readout).toHaveTextContent('Busiest day: Thu, 100 reports');
    expect(readout).toHaveAttribute('aria-hidden', 'true');
  });

  it('scales bars to the tallest value with a visible minimum', () => {
    const { columns } = renderChart();

    expect(columns().map((column) => column.style.getPropertyValue('--h'))).toEqual(['0%', '4%', '50%', '100%']);
    expect(columns().every((column) => column.querySelector('i'))).toBe(true);
  });

  it('draws an all-zero series flat', () => {
    const { columns } = renderChart({ values: [0, 0, 0, 0] });
    expect(columns().map((column) => column.style.getPropertyValue('--h'))).toEqual(['0%', '0%', '0%', '0%']);
  });

  it('draws an unreported period as a hollow stub rather than a zero', () => {
    const { columns } = renderChart({ values: [0, null, 50, 100], shaded: (index) => index === 1 });

    expect(columns().map((column) => column.className)).toEqual([
      'bars__col',
      'bars__col is-missing is-shaded',
      'bars__col',
      'bars__col',
    ]);
    expect(columns().map((column) => column.style.getPropertyValue('--h'))).toEqual(['0%', '0%', '50%', '100%']);
  });

  it('scales to the tallest reported value, ignoring unreported periods', () => {
    const { columns } = renderChart({ values: [null, 20, null, 10] });

    expect(columns().map((column) => column.style.getPropertyValue('--h'))).toEqual(['0%', '100%', '0%', '50%']);
    expect(columns().map((column) => column.classList.contains('is-missing'))).toEqual([true, false, true, false]);
  });

  it('draws a series with nothing reported flat and hollow', () => {
    const { columns } = renderChart({ values: [null, null, null, null] });

    expect(columns().map((column) => column.style.getPropertyValue('--h'))).toEqual(['0%', '0%', '0%', '0%']);
    expect(columns().every((column) => column.classList.contains('is-missing'))).toBe(true);
  });

  it('reads out an unreported period under the pointer', () => {
    const { plot, readout, columns } = renderChart({ values: [0, null, 50, 100] });
    stubBox(plot, { left: 0, width: 400 });

    fireEvent.pointerMove(plot, { clientX: 150 });
    expect(readout).toHaveTextContent(/^Tue: not reported$/);
    expect(columns()[1]).toHaveClass('is-missing', 'is-active');

    fireEvent.pointerMove(plot, { clientX: 50 });
    expect(readout).toHaveTextContent(/^Mon: 0 reports$/);
    expect(columns()[0]).not.toHaveClass('is-missing');
  });

  it('shades the bars the caller marks', () => {
    const { columns } = renderChart({ shaded: (index) => index % 2 === 1 });
    expect(columns().map((column) => column.className)).toEqual([
      'bars__col',
      'bars__col is-shaded',
      'bars__col',
      'bars__col is-shaded',
    ]);
  });

  it('shades nothing by default', () => {
    const { columns } = renderChart();
    expect(columns().some((column) => column.classList.contains('is-shaded'))).toBe(false);
  });

  it('reads out the bar under the pointer', () => {
    const { plot, readout, columns } = renderChart();
    stubBox(plot, { left: 100, width: 400 });

    fireEvent.pointerMove(plot, { clientX: 250 });
    expect(readout).toHaveTextContent(/^Tue: 1 report$/);
    expect(columns().map((column) => column.classList.contains('is-active'))).toEqual([false, true, false, false]);

    fireEvent.pointerMove(plot, { clientX: 499 });
    expect(readout).toHaveTextContent(/^Thu: 100 reports$/);
    expect(columns()[3]).toHaveClass('is-active');
    expect(columns()[1]).not.toHaveClass('is-active');
  });

  it('clamps pointer positions outside the plot to the end bars', () => {
    const { plot, readout, columns } = renderChart();
    stubBox(plot, { left: 100, width: 400 });

    fireEvent.pointerMove(plot, { clientX: 20 });
    expect(readout).toHaveTextContent('Mon: 0 reports');
    expect(columns()[0]).toHaveClass('is-active');

    fireEvent.pointerMove(plot, { clientX: 500 });
    expect(readout).toHaveTextContent('Thu: 100 reports');

    fireEvent.pointerMove(plot, { clientX: 900 });
    expect(readout).toHaveTextContent('Thu: 100 reports');
    expect(columns()[3]).toHaveClass('is-active');
  });

  it('ignores the pointer while the plot has no width', () => {
    const { plot, readout, columns } = renderChart();
    stubBox(plot, { left: 100, width: 0 });

    fireEvent.pointerMove(plot, { clientX: 150 });
    expect(readout).toHaveTextContent('Busiest day: Thu, 100 reports');
    expect(columns().some((column) => column.classList.contains('is-active'))).toBe(false);
  });

  it('ignores the pointer when there are no bars', () => {
    const { plot, readout } = renderChart({ values: [], labels: [], ticks: [], idleReadout: 'No reports yet' });
    stubBox(plot, { left: 0, width: 200 });

    fireEvent.pointerMove(plot, { clientX: 50 });
    expect(readout).toHaveTextContent('No reports yet');
  });

  it('returns to the idle readout when the pointer leaves', () => {
    const { plot, readout, columns } = renderChart();
    stubBox(plot, { left: 0, width: 400 });

    fireEvent.pointerMove(plot, { clientX: 250 });
    expect(readout).toHaveTextContent('Wed: 50 reports');

    fireEvent.pointerLeave(plot);
    expect(readout).toHaveTextContent('Busiest day: Thu, 100 reports');
    expect(columns().some((column) => column.classList.contains('is-active'))).toBe(false);
  });

  it('aligns axis labels at either end inward', () => {
    const values = Array.from({ length: 24 }, (_, index) => index);
    const { ticks } = renderChart({
      values,
      labels: values.map((hour) => `h${hour}`),
      ticks: [
        { index: 0, label: '12a' },
        { index: 2, label: '2a' },
        { index: 12, label: '12p' },
        { index: 21, label: '9p' },
        { index: 23, label: '11p' },
      ],
    });

    expect(ticks.map((tick) => [tick.textContent, tick.dataset.align])).toEqual([
      ['12a', 'start'],
      ['2a', 'center'],
      ['12p', 'center'],
      ['9p', 'center'],
      ['11p', 'end'],
    ]);
    expect(ticks[0]!.style.getPropertyValue('--x')).toBe(`${(0.5 / 24) * 100}%`);
    expect(ticks[2]!.style.getPropertyValue('--x')).toBe(`${(12.5 / 24) * 100}%`);
    expect(ticks[0]!.parentElement).toHaveAttribute('aria-hidden', 'true');
  });
});
