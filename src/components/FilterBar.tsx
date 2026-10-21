import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CRIME_GROUPS, GROUP_LABELS } from '../domain/categories';
import { radiusLabel } from '../domain/presentation';
import { RADIUS_OPTIONS, WINDOW_OPTIONS } from '../domain/urlState';
import type { CrimeGroup, RadiusMeters, WindowDays } from '../types';
import { CheckIcon, ChevronIcon } from './Icons';

export interface FilterBarProps {
  radiusMeters: RadiusMeters;
  windowDays: WindowDays;
  activeGroups: readonly CrimeGroup[];
  onRadiusChange(radius: RadiusMeters): void;
  onWindowChange(days: WindowDays): void;
  onToggleGroup(group: CrimeGroup): void;
}

type FilterId = 'radius' | 'window' | 'groups';

const RADIUS_HINTS: Record<RadiusMeters, string> = {
  500: 'A few blocks',
  1000: 'About a 12-minute walk',
  2000: 'The wider neighborhood',
};

export const GROUP_HINTS: Record<CrimeGroup, string> = {
  violent: 'Assault, robbery, sexual offense, homicide',
  property: 'Theft and burglary',
  vehicle: 'Stolen vehicles',
  weapons: 'Weapons offenses',
  other: 'Everything else the publisher reports',
};

export function groupsSummary(activeGroups: readonly CrimeGroup[]): string {
  if (activeGroups.length === CRIME_GROUPS.length) return 'All types';
  if (activeGroups.length === 1) return `${GROUP_LABELS[activeGroups[0]!]} only`;
  return `${activeGroups.length} of ${CRIME_GROUPS.length} types`;
}

function FilterChip({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: FilterId;
  label: string;
  open: boolean;
  onToggle(id: FilterId): void;
  children: ReactNode;
}) {
  const popoverId = useId();
  return (
    <div className="filter">
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        className={`filter__chip${open ? ' is-open' : ''}`}
        data-filter={id}
        onClick={() => onToggle(id)}
        type="button"
      >
        {label}
        <ChevronIcon className="filter__chevron" size={16} />
      </button>
      {open ? (
        <div className="filter__popover" id={popoverId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Option({
  selected,
  label,
  hint,
  swatch,
  onSelect,
}: {
  selected: boolean;
  label: string;
  hint?: string;
  swatch?: CrimeGroup;
  onSelect(): void;
}) {
  return (
    <button aria-pressed={selected} className="filter__option" onClick={onSelect} type="button">
      {swatch ? <span aria-hidden="true" className={`swatch swatch--${swatch}`} /> : null}
      <span className="filter__option-text">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      <CheckIcon className="filter__check" size={18} />
    </button>
  );
}

export function FilterBar({
  radiusMeters,
  windowDays,
  activeGroups,
  onRadiusChange,
  onWindowChange,
  onToggleGroup,
}: FilterBarProps) {
  const [openId, setOpenId] = useState<FilterId | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openId) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const chip = rootRef.current?.querySelector<HTMLButtonElement>(`[data-filter="${openId}"]`);
      setOpenId(null);
      chip?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openId]);

  const toggle = (id: FilterId) => setOpenId((current) => (current === id ? null : id));

  return (
    <div aria-label="Analysis settings" className="filters" ref={rootRef} role="group">
      <FilterChip id="radius" label={`Within ${radiusLabel(radiusMeters)}`} onToggle={toggle} open={openId === 'radius'}>
        <p className="filter__title" id="filter-radius-title">Area around the point</p>
        <div aria-labelledby="filter-radius-title" role="group">
          {RADIUS_OPTIONS.map((radius) => (
            <Option
              hint={RADIUS_HINTS[radius]}
              key={radius}
              label={radiusLabel(radius)}
              onSelect={() => {
                onRadiusChange(radius);
                setOpenId(null);
              }}
              selected={radiusMeters === radius}
            />
          ))}
        </div>
      </FilterChip>

      <FilterChip id="window" label={`Last ${windowDays} days`} onToggle={toggle} open={openId === 'window'}>
        <p className="filter__title" id="filter-window-title">Published reports from the last</p>
        <div aria-labelledby="filter-window-title" role="group">
          {WINDOW_OPTIONS.map((days) => (
            <Option
              key={days}
              label={`${days} days`}
              onSelect={() => {
                onWindowChange(days);
                setOpenId(null);
              }}
              selected={windowDays === days}
            />
          ))}
        </div>
      </FilterChip>

      <FilterChip id="groups" label={groupsSummary(activeGroups)} onToggle={toggle} open={openId === 'groups'}>
        <p className="filter__title" id="filter-groups-title">Types of report</p>
        <div aria-labelledby="filter-groups-title" role="group">
          {CRIME_GROUPS.map((group) => (
            <Option
              hint={GROUP_HINTS[group]}
              key={group}
              label={GROUP_LABELS[group]}
              onSelect={() => onToggleGroup(group)}
              selected={activeGroups.includes(group)}
              swatch={group}
            />
          ))}
        </div>
      </FilterChip>
    </div>
  );
}
