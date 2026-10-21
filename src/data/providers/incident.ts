import { categoryGroup, isViolentCategory, normalizeCategory, severityForCategory } from '../../domain/categories';
import { hourFromTimestamp, sourceTimestampToEpoch } from '../../domain/time';
import type { Coordinates, Incident, ProviderMeta } from '../../types';

export interface IncidentFields {
  /** Publisher identity; namespaced by provider id in the result. */
  sourceId: string;
  /** Zone-free local wall-clock timestamp. */
  occurredAt: string;
  rawCategory: string;
  description: string;
  locationLabel: string;
  coordinates: Coordinates;
  /** Text used for category normalization; defaults to category plus description. */
  classificationText?: string | undefined;
  /** False when the publisher gave only a date; the incident then has no local hour. */
  timeKnown?: boolean | undefined;
}

/**
 * Builds the normalized incident shared by every adapter, or `null` when identity,
 * timestamp or coordinates are unusable.
 */
export function buildIncident(meta: ProviderMeta, fields: IncidentFields): Incident | null {
  const occurredAtEpochMs = sourceTimestampToEpoch(fields.occurredAt);
  if (!fields.sourceId || !Number.isFinite(occurredAtEpochMs)) return null;
  const category = normalizeCategory(fields.classificationText ?? `${fields.rawCategory} ${fields.description}`);
  return {
    id: `${meta.id}:${fields.sourceId}`,
    providerId: meta.id,
    occurredAt: fields.occurredAt,
    occurredAtEpochMs,
    localHour: fields.timeKnown === false ? null : hourFromTimestamp(fields.occurredAt),
    category,
    group: categoryGroup(category),
    rawCategory: fields.rawCategory,
    description: fields.description,
    locationLabel: fields.locationLabel,
    coordinates: fields.coordinates,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: meta.precision,
  };
}

export function joinLabels(values: readonly string[], fallback: string): string {
  return values.filter(Boolean).join(' · ') || fallback;
}

/** Rounds a coordinate pair to `digits` decimals (≈110 m at three digits). */
export function roundCoordinates(coordinates: Coordinates, digits: number): Coordinates {
  return [Number(coordinates[0].toFixed(digits)), Number(coordinates[1].toFixed(digits))];
}
