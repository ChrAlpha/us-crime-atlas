import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CRIME_GROUPS } from '../domain/categories';
import type { CrimeGroup } from '../types';
import { FilterBar, GROUP_HINTS, groupsSummary, type FilterBarProps } from './FilterBar';

function props(overrides: Partial<FilterBarProps> = {}): FilterBarProps {
  return {
    radiusMeters: 1000,
    windowDays: 30,
    activeGroups: [...CRIME_GROUPS],
    onRadiusChange: vi.fn(),
    onWindowChange: vi.fn(),
    onToggleGroup: vi.fn(),
    ...overrides,
  };
}

const chip = (name: string | RegExp) => screen.getByRole('button', { name });
const popover = (title: string) => screen.queryByRole('group', { name: title });
const optionLabels = (group: HTMLElement) => within(group).getAllByRole('button')
  .map((button) => button.querySelector('strong')!.textContent);

describe('groupsSummary', () => {
  it('names all, one, or a count of report types', () => {
    expect(groupsSummary(CRIME_GROUPS)).toBe('All types');
    expect(groupsSummary(['violent'])).toBe('Violent only');
    expect(groupsSummary(['other'])).toBe('Other only');
    expect(groupsSummary(['violent', 'property', 'other'])).toBe('3 of 5 types');
    expect(groupsSummary([])).toBe('0 of 5 types');
  });
});

describe('GROUP_HINTS', () => {
  it('explains every report type', () => {
    expect(Object.keys(GROUP_HINTS).sort()).toEqual([...CRIME_GROUPS].sort());
    for (const group of CRIME_GROUPS) expect(GROUP_HINTS[group]).not.toBe('');
    expect(GROUP_HINTS.violent).toBe('Assault, robbery, sexual offense, homicide');
  });
});

describe('FilterBar', () => {
  it('summarizes the current settings on closed chips', () => {
    const { rerender } = render(<FilterBar {...props()} />);

    const bar = within(screen.getByRole('group', { name: 'Analysis settings' }));
    expect(bar.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Within 1 km',
      'Last 30 days',
      'All types',
    ]);
    for (const button of bar.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).not.toHaveAttribute('aria-controls');
      expect(button).not.toHaveClass('is-open');
    }

    rerender(<FilterBar {...props({ radiusMeters: 500, windowDays: 90, activeGroups: ['violent'] })} />);
    expect(chip('Within 500 m')).toBeInTheDocument();
    expect(chip('Last 90 days')).toBeInTheDocument();
    expect(chip('Violent only')).toBeInTheDocument();

    rerender(<FilterBar {...props({ radiusMeters: 2000, activeGroups: ['violent', 'property', 'weapons'] })} />);
    expect(chip('Within 2 km')).toBeInTheDocument();
    expect(chip('3 of 5 types')).toBeInTheDocument();
  });

  it('opens one popover at a time and closes it from the same chip', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...props()} />);

    await user.click(chip('Within 1 km'));
    expect(chip('Within 1 km')).toHaveAttribute('aria-expanded', 'true');
    expect(chip('Within 1 km')).toHaveClass('is-open');
    const radius = popover('Area around the point')!;
    expect(radius.parentElement).toHaveAttribute('id', chip('Within 1 km').getAttribute('aria-controls'));
    expect(radius.parentElement).toHaveClass('filter__popover');

    await user.click(chip('Last 30 days'));
    expect(chip('Within 1 km')).toHaveAttribute('aria-expanded', 'false');
    expect(chip('Within 1 km')).not.toHaveAttribute('aria-controls');
    expect(popover('Area around the point')).not.toBeInTheDocument();
    expect(chip('Last 30 days')).toHaveAttribute('aria-expanded', 'true');
    expect(popover('Published reports from the last')).toBeInTheDocument();

    await user.click(chip('Last 30 days'));
    expect(chip('Last 30 days')).toHaveAttribute('aria-expanded', 'false');
    expect(popover('Published reports from the last')).not.toBeInTheDocument();
  });

  it('gives each chip its own popover id', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...props()} />);

    const ids = new Set<string | null>();
    for (const name of ['Within 1 km', 'Last 30 days', 'All types']) {
      await user.click(chip(name));
      ids.add(chip(name).getAttribute('aria-controls'));
    }
    expect(ids.size).toBe(3);
  });

  it('picks a radius and closes the popover', async () => {
    const onRadiusChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar {...props({ onRadiusChange })} />);

    await user.click(chip('Within 1 km'));
    const radius = popover('Area around the point')!;
    expect(optionLabels(radius)).toEqual(['500 m', '1 km', '2 km']);
    expect(within(radius).getByText('A few blocks')).toBeInTheDocument();
    expect(within(radius).getByText('About a 12-minute walk')).toBeInTheDocument();
    expect(within(radius).getByText('The wider neighborhood')).toBeInTheDocument();
    expect(within(radius).getByRole('button', { name: /^1 km/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(radius).getByRole('button', { name: /^500 m/ })).toHaveAttribute('aria-pressed', 'false');
    expect(radius.querySelector('.swatch')).toBeNull();

    await user.click(within(radius).getByRole('button', { name: /^2 km/ }));

    expect(onRadiusChange).toHaveBeenCalledExactlyOnceWith(2000);
    expect(popover('Area around the point')).not.toBeInTheDocument();
    expect(chip('Within 1 km')).toHaveAttribute('aria-expanded', 'false');
  });

  it('picks a window and closes the popover', async () => {
    const onWindowChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar {...props({ windowDays: 60, onWindowChange })} />);

    await user.click(chip('Last 60 days'));
    const windows = popover('Published reports from the last')!;
    expect(within(windows).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['14 days', '30 days', '60 days', '90 days']);
    expect(windows.querySelector('small')).toBeNull();
    expect(within(windows).getByRole('button', { name: '60 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(windows).getByRole('button', { name: '14 days' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(within(windows).getByRole('button', { name: '14 days' }));

    expect(onWindowChange).toHaveBeenCalledExactlyOnceWith(14);
    expect(popover('Published reports from the last')).not.toBeInTheDocument();
  });

  it('toggles report types and keeps the popover open', async () => {
    const onToggleGroup = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar {...props({ activeGroups: ['violent', 'weapons'], onToggleGroup })} />);

    await user.click(chip('2 of 5 types'));
    const groups = popover('Types of report')!;
    expect(optionLabels(groups)).toEqual(['Violent', 'Property', 'Vehicle', 'Weapons', 'Other']);
    const pressed = Object.fromEntries(within(groups).getAllByRole('button').map((button) => [
      button.querySelector('strong')!.textContent,
      button.getAttribute('aria-pressed'),
    ]));
    expect(pressed).toEqual({ Violent: 'true', Property: 'false', Vehicle: 'false', Weapons: 'true', Other: 'false' });
    for (const group of CRIME_GROUPS) {
      const option = within(groups).getByText(GROUP_HINTS[group]).closest('button')!;
      expect(option.querySelector(`.swatch.swatch--${group}`)).toHaveAttribute('aria-hidden', 'true');
    }

    await user.click(within(groups).getByRole('button', { name: /^Property/ }));
    await user.click(within(groups).getByRole('button', { name: /^Violent/ }));

    expect(onToggleGroup.mock.calls).toEqual<[CrimeGroup][]>([['property'], ['violent']]);
    expect(popover('Types of report')).toBeInTheDocument();
    expect(chip('2 of 5 types')).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes with Escape and returns focus to the chip', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...props()} />);

    await user.click(chip('All types'));
    const option = within(popover('Types of report')!).getByRole('button', { name: /^Vehicle/ });
    option.focus();

    await user.keyboard('a');
    expect(popover('Types of report')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(popover('Types of report')).not.toBeInTheDocument();
    expect(chip('All types')).toHaveFocus();
    expect(chip('All types')).toHaveAttribute('aria-expanded', 'false');
  });

  it('ignores Escape while every popover is closed', async () => {
    const user = userEvent.setup();
    render(
      <>
        <FilterBar {...props()} />
        <button type="button">Map</button>
      </>,
    );

    await user.click(chip('Within 1 km'));
    await user.click(chip('Within 1 km'));
    screen.getByRole('button', { name: 'Map' }).focus();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Map' })).toHaveFocus();
  });

  it('closes on a pointer press outside the bar', async () => {
    const user = userEvent.setup();
    render(
      <>
        <FilterBar {...props()} />
        <button type="button">Map</button>
      </>,
    );

    await user.click(chip('Last 30 days'));
    fireEvent.pointerDown(within(popover('Published reports from the last')!).getByRole('button', { name: '90 days' }));
    expect(popover('Published reports from the last')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Map' }));
    expect(popover('Published reports from the last')).not.toBeInTheDocument();
    expect(chip('Last 30 days')).toHaveAttribute('aria-expanded', 'false');
  });
});
