import type { CrimeGroup } from '../types';

export type ThemeName = 'light' | 'dark';

/**
 * Incident-group colors, validated as a set for protanopia and deuteranopia across all pairs
 * (dots on a map can sit beside any other dot). `other` is a neutral, not a fifth hue.
 * The same values are declared as `--group-*` in `styles/tokens.css`.
 */
export const GROUP_COLORS: Record<ThemeName, Record<CrimeGroup, string>> = {
  light: {
    violent: '#ae2c77',
    property: '#d29922',
    vehicle: '#4064b9',
    weapons: '#00a29f',
    other: '#83807a',
  },
  dark: {
    violent: '#b13a80',
    property: '#b88715',
    vehicle: '#5176cd',
    weapons: '#27a98e',
    other: '#89867f',
  },
};

/** Ink and surface for marks drawn on the map; the map cannot read CSS custom properties. */
export const MAP_INK: Record<ThemeName, { ink: string; surface: string }> = {
  light: { ink: '#221f19', surface: '#fdfcf9' },
  dark: { ink: '#f0eeea', surface: '#181714' },
};
