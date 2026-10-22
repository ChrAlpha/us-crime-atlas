import { describe, expect, it } from 'vitest';
import type { AgencyRecord } from '../data/agencyStats.types';
import {
  FULL_AGENCY,
  LAGGING_AGENCY,
  UNPOPULATED_AGENCY,
  fixtureSnapshot,
  matchFor,
} from '../test/agencyFixtures';
import {
  agencyFinding,
  agencyMethodLine,
  agencyNotes,
  agencyTrendCopy,
  areaLabel,
  monthRangeLabel,
  rateLine,
  STALE_AGENCY_MONTHS,
  stateFinding,
  wholeNumber,
} from './agencyPresentation';
import { summarizeAgency, summarizeState, type AgencySummary } from './agencySummary';

const nulls = (length: number) => Array.from({ length }, () => null);
const months = (value: number | null, length = 24) => Array.from({ length }, () => value);

/** Reported only the newest five months of the snapshot. */
const FEW_MONTHS_AGENCY: AgencyRecord = {
  ...FULL_AGENCY,
  violent: [...nulls(19), 1, 1, 1, 1, 1],
  property: [...nulls(19), 1, 1, 1, 1, 1],
};

/** No violent offenses at all, but property offenses every month. */
const QUIET_AGENCY: AgencyRecord = { ...FULL_AGENCY, violent: months(0) };

function summarize(agency: AgencyRecord, overrides: Parameters<typeof matchFor>[1] = {}, snapshot = fixtureSnapshot()) {
  return summarizeAgency(matchFor(agency, overrides), snapshot)!;
}

const full = summarize(FULL_AGENCY);
const lagging = summarize(LAGGING_AGENCY, { ori: 'CA0000002', basis: 'county-subdivision', areaName: 'Lagging town' });
const unpopulated = summarize(UNPOPULATED_AGENCY, { ori: 'CA0000003', basis: 'county', areaName: 'Fixture County' });
const fewMonths = summarize(FEW_MONTHS_AGENCY);
/** The state has no violent rate, so the agency has a rate but nothing to compare it with. */
const withoutState = summarize(FULL_AGENCY, {}, fixtureSnapshot({
  stateRates: { violent: months(null), property: months(150 / 12) },
}));

function relativeTo(violent: number): AgencySummary {
  return { ...full, relativeToState: { violent, property: 1 } };
}

describe('wholeNumber', () => {
  it.each<[number, string]>([
    [0, '0'],
    [7.4, '7'],
    [1234.5, '1,235'],
    [1_234_567.4, '1,234,567'],
  ])('rounds %s to %s with thousands separators', (value, text) => {
    expect(wholeNumber(value)).toBe(text);
  });
});

describe('areaLabel', () => {
  it.each<[string, string]>([
    ['Jersey City city', 'Jersey City'],
    ['Oklahoma City city', 'Oklahoma City'],
    ['South Gate-East Los Angeles CCD', 'South Gate-East Los Angeles'],
    ['Nashville-Davidson metropolitan government (balance)', 'Nashville-Davidson'],
    ['Los Angeles County', 'Los Angeles County'],
    ['Isle of Palms town', 'Isle of Palms'],
    ['East Los Angeles CDP', 'East Los Angeles'],
    ['Lexington-Fayette urban county', 'Lexington-Fayette'],
  ])('calls %j %j', (censusName, label) => {
    expect(areaLabel(censusName)).toBe(label);
  });

  it('keeps the full name when stripping the description would leave nothing', () => {
    expect(areaLabel(' CDP')).toBe(' CDP');
    expect(areaLabel(' city')).toBe(' city');
  });
});

describe('monthRangeLabel', () => {
  it('spans two formatted months', () => {
    expect(monthRangeLabel('2025-08', '2026-07')).toBe('Aug 2025 – Jul 2026');
    expect(monthRangeLabel('2025-01', '2025-12')).toBe('Jan 2025 – Dec 2025');
  });
});

describe('agencyFinding', () => {
  it('compares a much higher rate with the state as a ratio', () => {
    expect(full.relativeToState!.violent).toBeCloseTo(3);
    const result = agencyFinding(full);

    expect(result.headline).toBe('3.0× as many violent offenses per resident as California overall');
    expect(result.reason).toBeNull();
    expect(result.ratio).toBeCloseTo(3);
    expect(result.band).toBe('markedly-elevated');
  });

  it('words an elevated rate as a ratio', () => {
    expect(agencyFinding(relativeTo(1.6))).toEqual({
      headline: '1.6× as many violent offenses per resident as California overall',
      reason: null,
      ratio: 1.6,
      band: 'elevated',
    });
  });

  it.each([0.65, 1, 1.24])('calls a %s× rate about the same', (ratio) => {
    expect(agencyFinding(relativeTo(ratio))).toEqual({
      headline: 'About as many violent offenses per resident as California overall',
      reason: null,
      ratio,
      band: 'similar',
    });
  });

  it.each<[number, string]>([
    [0.64, '36% fewer violent offenses per resident than California overall'],
    [0.4, '60% fewer violent offenses per resident than California overall'],
    [0.011, '99% fewer violent offenses per resident than California overall'],
    // 99.6% fewer rounds to 100%, but the jurisdiction did report some.
    [0.004, '99% fewer violent offenses per resident than California overall'],
  ])('words a lower %s× rate as a percentage', (ratio, headline) => {
    expect(agencyFinding(relativeTo(ratio))).toEqual({ headline, reason: null, ratio, band: 'lower' });
  });

  it('says so when the jurisdiction reported no violent offenses at all', () => {
    const quiet = summarize(QUIET_AGENCY);
    expect(quiet.relativeToState).toEqual({ violent: 0, property: expect.closeTo(2) });

    expect(agencyFinding(quiet)).toEqual({
      headline: 'No violent offenses in the 12 reported months',
      reason: null,
      ratio: 0,
      band: 'lower',
    });
  });

  it('gives the rate alone when the state has none for the same months', () => {
    expect(withoutState.relativeToState).toBeNull();
    expect(agencyFinding(withoutState)).toEqual({
      headline: '120 violent offenses per 100,000 residents a year',
      reason: 'No California rate covers the same months, so there is no comparison.',
      ratio: null,
      band: 'insufficient',
    });
  });

  it('withholds a rate from too few reported months', () => {
    expect(fewMonths.ratesPer100k).toBeNull();
    expect(agencyFinding(fewMonths)).toEqual({
      headline: 'Too few months reported for a rate',
      reason: 'Fixture City Police Department sent 5 of 12 months to the FBI.',
      ratio: null,
      band: 'insufficient',
    });
  });

  it('counts offenses for an agency the FBI lists no population for', () => {
    expect(agencyFinding(unpopulated)).toEqual({
      headline: '36 violent offenses reported',
      reason: 'The FBI lists no population for this agency, so there is no rate to compare.',
      ratio: null,
      band: 'insufficient',
    });
  });

  it('separates large counts with commas', () => {
    const busy = { ...unpopulated, counts: { violent: 12_345, property: 0 } };
    expect(agencyFinding(busy).headline).toBe('12,345 violent offenses reported');
  });
});

describe('agencyMethodLine', () => {
  it('names the whole area, the months, and the state comparison', () => {
    expect(agencyMethodLine(full)).toBe(
      'FBI totals for all of Fixture, Aug 2025 – Jul 2026, per resident vs. California overall. Not a safety rating.',
    );
  });

  it('dates a lagging agency by its own months', () => {
    expect(agencyMethodLine(lagging)).toBe(
      'FBI totals for all of Lagging, Jan 2025 – Dec 2025, per resident vs. California overall. Not a safety rating.',
    );
  });

  it.each<[string, AgencySummary]>([
    ['without a population', unpopulated],
    ['without a state rate', withoutState],
  ])('leaves out the comparison %s', (_, summary) => {
    expect(agencyMethodLine(summary)).toBe(
      `FBI totals for all of ${summary === unpopulated ? 'Fixture County' : 'Fixture'}, Aug 2025 – Jul 2026. Not a safety rating.`,
    );
  });
});

describe('rateLine', () => {
  it('pairs the rate with the state rate', () => {
    expect(rateLine(1234.4, 456.6, 'Oklahoma')).toBe('1,234 per 100k a year · Oklahoma 457');
  });

  it('gives the rate alone without a state rate', () => {
    expect(rateLine(120, undefined, 'California')).toBe('120 per 100k a year');
  });

  it.each([undefined, 40])('says there is no rate (state rate %s)', (stateRate) => {
    expect(rateLine(undefined, stateRate, 'California')).toBe('No rate per resident');
  });

  it('shows a zero rate rather than none', () => {
    expect(rateLine(0, 40, 'California')).toBe('0 per 100k a year · California 40');
  });
});

describe('agencyTrendCopy', () => {
  it('needs two complete years', () => {
    expect(agencyTrendCopy(null)).toBe('No trend: needs two complete years');
  });

  it.each<[number, string]>([
    [-16, '16% fewer than the 12 months before'],
    [20.4, '20% more than the 12 months before'],
    [0.4, 'Same as the 12 months before'],
    [-0.4, 'Same as the 12 months before'],
    [0.5, '1% more than the 12 months before'],
  ])('words a %s% change', (total, copy) => {
    expect(agencyTrendCopy({ violent: 0, property: 0, total })).toBe(copy);
  });

  it('words a real year-over-year change', () => {
    expect(agencyTrendCopy(full.trendPercent)).toBe('16% fewer than the 12 months before');
  });
});

describe('agencyNotes', () => {
  it('always flags the lower precision of jurisdiction totals', () => {
    expect(agencyNotes(full)).toEqual([
      {
        id: 'precision',
        title: 'Lower precision',
        body: "No local incident feed covers this point, so the FBI's totals for all of Fixture stand in. They cannot "
          + 'tell one block from another, and the radius, dates, and report types do not apply.',
        prominent: true,
      },
    ]);
  });

  it('orders every applicable note, prominent ones first', () => {
    const summary = summarize(LAGGING_AGENCY, {
      ori: 'CA0000002',
      basis: 'county',
      areaName: 'Fixture County',
      placeWithoutAgency: 'Smallville town',
    });
    const notes = agencyNotes(summary);

    expect(notes.map((note) => [note.id, note.prominent])).toEqual([
      ['precision', true],
      ['no-city-agency', true],
      ['small-population', true],
      ['partial-months', false],
      ['agency-behind', false],
    ]);
    expect(notes[0]!.body).toContain('the FBI\'s totals for all of Fixture County stand in.');
    expect(notes[1]).toMatchObject({
      title: 'No city agency matched',
      body: 'Smallville has no police agency of its own in the FBI data, so Lagging Town Police Department\'s totals '
        + 'are shown. They may not include the city.',
    });
    expect(notes[2]).toMatchObject({
      title: 'Small population',
      body: 'Fewer than 10,000 residents: a handful of offenses moves this rate a long way.',
    });
    expect(notes[3]).toMatchObject({
      title: '11 of 12 months reported',
      body: 'Rates are annualized from the months that were sent, and the trend is left out.',
    });
    expect(notes[4]).toMatchObject({
      title: 'Agency is 7 months behind',
      body: 'Lagging Town Police Department\'s newest FBI submission is for Dec 2025, 7 months before the newest month '
        + 'in this snapshot.',
    });
  });

  it('flags a city without its own agency under its plain name', () => {
    const summary = summarize(UNPOPULATED_AGENCY, {
      basis: 'county',
      areaName: 'Fixture County',
      placeWithoutAgency: 'East Los Angeles CDP',
    });
    expect(agencyNotes(summary).map((note) => note.id)).toEqual(['precision', 'no-city-agency']);
    expect(agencyNotes(summary)[1]!.body).toMatch(/^East Los Angeles has no police agency of its own/);
  });

  it('cannot annualize too few months', () => {
    const note = agencyNotes(fewMonths).find((entry) => entry.id === 'partial-months')!;
    expect(note).toEqual({
      id: 'partial-months',
      title: '5 of 12 months reported',
      body: 'Too few months to annualize into a rate, and the trend is left out.',
      prominent: false,
    });
  });

  it('annualizes from exactly the minimum number of months', () => {
    const note = agencyNotes({ ...full, reportedMonths: 6 }).find((entry) => entry.id === 'partial-months')!;
    expect(note.title).toBe('6 of 12 months reported');
    expect(note.body).toBe('Rates are annualized from the months that were sent, and the trend is left out.');
  });

  it(`calls out an agency from ${STALE_AGENCY_MONTHS} months behind`, () => {
    expect(STALE_AGENCY_MONTHS).toBe(3);
    const ids = (monthsBehind: number) => agencyNotes({ ...full, monthsBehind }).map((note) => note.id);
    expect(ids(2)).toEqual(['precision']);
    expect(ids(3)).toEqual(['precision', 'agency-behind']);
    expect(agencyNotes({ ...full, monthsBehind: 3 })[1]!.title).toBe('Agency is 3 months behind');
  });

  it('does not call a missing population small', () => {
    expect(unpopulated.smallPopulation).toBe(false);
    expect(agencyNotes(unpopulated).map((note) => note.id)).toEqual(['precision']);
  });
});

describe('stateFinding', () => {
  const state = summarizeState(fixtureSnapshot());

  it('names the agency that sent nothing and frames the state rate as context', () => {
    expect(stateFinding(state, 'Silent City Police Department')).toEqual({
      headline: 'No local police totals for this point',
      reason: 'Silent City Police Department sent no months to the FBI in this snapshot.',
      context: 'California overall: 40 violent offenses per 100,000 residents a year (US: 30). That is context only; '
        + 'it says nothing about this area.',
    });
  });

  it('explains that no agency matched', () => {
    expect(stateFinding(state, null).reason).toBe(
      'No city, town, or county police agency in the FBI data matched this point.',
    );
  });

  it('leaves out the national rate when there is none', () => {
    expect(stateFinding({ ...state, nationalRatesPer100k: null }, null).context).toBe(
      'California overall: 40 violent offenses per 100,000 residents a year. That is context only; it says nothing '
        + 'about this area.',
    );
  });

  it('says when the state has no rate for these months', () => {
    const result = stateFinding({ ...state, ratesPer100k: null }, null);
    expect(result.headline).toBe('No local police totals for this point');
    expect(result.context).toBe('California has no statewide rate for these months.');
  });

  it('separates large statewide rates with commas', () => {
    const busy = { ...state, ratesPer100k: { violent: 1234.6, property: 0 }, nationalRatesPer100k: { violent: 1000, property: 0 } };
    expect(stateFinding(busy, null).context).toMatch(/^California overall: 1,235 violent .* \(US: 1,000\)\./);
  });
});
