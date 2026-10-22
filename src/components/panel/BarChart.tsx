import { useState, type CSSProperties, type PointerEvent } from 'react';

export interface BarChartProps {
  /** `null` marks a period with no published value, drawn as a hollow stub rather than a zero. */
  values: ReadonlyArray<number | null>;
  /** Readout label for each bar, e.g. `Jun 12` or `3 PM`. */
  labels: readonly string[];
  ticks: ReadonlyArray<{ index: number; label: string }>;
  /** Bars drawn on a shaded band, e.g. night hours. */
  shaded?: (index: number) => boolean;
  /** Text alternative describing the whole chart. */
  summary: string;
  /** Shown when no bar is hovered. */
  idleReadout: string;
  unit: (count: number) => string;
}

/** A single-series column chart with a hover readout; one hue, thin marks, recessive axis. */
export function BarChart({ values, labels, ticks, shaded, summary, idleReadout, unit }: BarChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...values.map((value) => value ?? 0));

  const track = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || values.length === 0) return;
    const index = Math.floor(((event.clientX - box.left) / box.width) * values.length);
    setActive(Math.min(values.length - 1, Math.max(0, index)));
  };

  let readout = idleReadout;
  if (active !== null) {
    const value = values[active];
    readout = `${labels[active]}: ${value === null || value === undefined ? 'not reported' : unit(value)}`;
  }

  return (
    <figure className="bars">
      <p aria-hidden="true" className="bars__readout">{readout}</p>
      <div
        aria-label={summary}
        className="bars__plot"
        onPointerLeave={() => setActive(null)}
        onPointerMove={track}
        role="img"
      >
        {values.map((value, index) => {
          const style = { '--h': `${!value ? 0 : Math.max(4, (value / max) * 100)}%` } as CSSProperties;
          const classes = ['bars__col'];
          if (value === null) classes.push('is-missing');
          if (shaded?.(index)) classes.push('is-shaded');
          if (active === index) classes.push('is-active');
          return (
            <span className={classes.join(' ')} key={labels[index]} style={style}>
              <i />
            </span>
          );
        })}
      </div>
      <div aria-hidden="true" className="bars__axis">
        {ticks.map((tick) => {
          const x = (tick.index + 0.5) / values.length;
          const style = { '--x': `${x * 100}%` } as CSSProperties;
          // Labels at either end grow inward so they never spill past the plot.
          const align = x < 0.1 ? 'start' : x > 0.9 ? 'end' : 'center';
          return <span data-align={align} key={tick.index} style={style}>{tick.label}</span>;
        })}
      </div>
    </figure>
  );
}
