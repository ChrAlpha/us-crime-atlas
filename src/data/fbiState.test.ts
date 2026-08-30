import { describe, expect, it } from 'vitest';
import { FBI_STATE_CODES, FBI_STATE_NAMES } from './fbiState.constants';
import { findFbiStateEstimate, parseFbiStateEstimates } from './fbiState';

function validRows(): Record<string, unknown>[] {
  return FBI_STATE_CODES.map((stateCode, index) => ({
    year: '2024',
    state_abbr: stateCode.toLowerCase(),
    state_name: FBI_STATE_NAMES[stateCode],
    population: (1_000_000 + index).toLocaleString('en-US'),
    violent_crime: String(10_000 + index),
    homicide: String(10 + index),
    rape_legacy: '999',
    rape_revised: String(30 + index),
    robbery: String(1_000 + index),
    aggravated_assault: String(8_000 + index),
    property_crime: String(50_000 + index),
    burglary: String(5_000 + index),
    larceny: String(40_000 + index),
    motor_vehicle_theft: String(5_000 + index),
    caveats: index === 0 ? '  Estimated from incomplete reporting.  ' : '',
  }));
}

describe('FBI state estimate snapshot', () => {
  it('normalizes exactly 50 states and DC, rates, revised rape, and caveats', () => {
    const rows = [
      ...validRows(),
      { ...validRows()[0], year: '2023' },
    ];

    const snapshot = parseFbiStateEstimates(rows, 2024);

    expect(snapshot.year).toBe(2024);
    expect(snapshot.states).toHaveLength(51);
    expect(snapshot.states.map((state) => state.stateCode)).toEqual(FBI_STATE_CODES);
    expect(snapshot.states[0]).toMatchObject({
      stateCode: 'AL',
      stateName: 'Alabama',
      population: 1_000_000,
      counts: { violentCrime: 10_000, rape: 30 },
      ratesPer100k: { violentCrime: 1_000, rape: 3 },
      caveats: 'Estimated from incomplete reporting.',
    });
    expect(snapshot.states[1]?.ratesPer100k.violentCrime).toBeCloseTo(1_000.099, 3);
    expect(findFbiStateEstimate(snapshot, 'tx')?.stateCode).toBe('TX');
    expect(findFbiStateEstimate(snapshot, 'PR')).toBeNull();
  });

  it('rejects duplicate, missing, and unexpected jurisdictions', () => {
    const rows = validRows();
    expect(() => parseFbiStateEstimates([
      ...rows,
      { ...rows[0], state_abbr: ' al ' },
    ], 2024)).toThrow(/duplicate AL/i);
    expect(() => parseFbiStateEstimates(rows.slice(1), 2024)).toThrow(/expected 51.+received 50/i);
    expect(() => parseFbiStateEstimates([
      ...rows,
      { ...rows[0], state_abbr: 'PR', state_name: 'Puerto Rico' },
    ], 2024)).toThrow(/unexpected jurisdiction PR/i);
    expect(() => parseFbiStateEstimates([
      ...rows,
      { ...rows[0], state_abbr: 'VI', state_name: 'United States Virgin Islands' },
    ], 2024)).toThrow(/unexpected jurisdiction VI/i);
    expect(() => parseFbiStateEstimates([
      ...rows,
      { ...rows[0], state_abbr: 'AL', state_name: 'United States-Total' },
    ], 2024)).toThrow(/state_name/i);
    expect(() => parseFbiStateEstimates([
      ...rows,
      { ...rows[0], state_abbr: '', state_name: 'United States-Total' },
    ], 2024)).toThrow(/state_abbr/i);
  });

  it('fails closed on malformed identities and numeric values', () => {
    const blankName = validRows();
    blankName[0] = { ...blankName[0], state_name: ' ' };
    expect(() => parseFbiStateEstimates(blankName, 2024)).toThrow(/state_name/i);

    const mismatchedName = validRows();
    mismatchedName[0] = { ...mismatchedName[0], state_name: 'Alaska' };
    expect(() => parseFbiStateEstimates(mismatchedName, 2024)).toThrow(/state_name/i);

    const badPopulation = validRows();
    badPopulation[0] = { ...badPopulation[0], population: 'not available' };
    expect(() => parseFbiStateEstimates(badPopulation, 2024)).toThrow(/population/i);

    const zeroPopulation = validRows();
    zeroPopulation[0] = { ...zeroPopulation[0], population: '0' };
    expect(() => parseFbiStateEstimates(zeroPopulation, 2024)).toThrow(/population/i);

    const negativeCount = validRows();
    negativeCount[0] = { ...negativeCount[0], violent_crime: '-1' };
    expect(() => parseFbiStateEstimates(negativeCount, 2024)).toThrow(/violent_crime/i);

    const decimalCount = validRows();
    decimalCount[0] = { ...decimalCount[0], burglary: '1.5' };
    expect(() => parseFbiStateEstimates(decimalCount, 2024)).toThrow(/burglary/i);

    for (const population of ['1,2', '12x', '1e6', Number.NaN, Number.POSITIVE_INFINITY, 2 ** 54]) {
      const malformed = validRows();
      malformed[0] = { ...malformed[0], population };
      expect(() => parseFbiStateEstimates(malformed, 2024)).toThrow(/population/i);
    }

    const missingRevisedRape = validRows();
    missingRevisedRape[0] = { ...missingRevisedRape[0], rape_revised: '', rape_legacy: '42' };
    expect(() => parseFbiStateEstimates(missingRevisedRape, 2024)).toThrow(/rape_revised/i);

    const zeroRevisedRape = validRows();
    zeroRevisedRape[0] = { ...zeroRevisedRape[0], rape_revised: '0', rape_legacy: '42' };
    expect(parseFbiStateEstimates(zeroRevisedRape, 2024).states[0]?.counts.rape).toBe(0);

    const groupedYear = validRows();
    groupedYear[0] = { ...groupedYear[0], year: '2,024' };
    expect(() => parseFbiStateEstimates(groupedYear, 2024)).toThrow(/year/i);

    const missingCaveats = validRows();
    delete missingCaveats[0]?.caveats;
    expect(() => parseFbiStateEstimates(missingCaveats, 2024)).toThrow(/caveats/i);

    const missingLegacyRape = validRows();
    delete missingLegacyRape[0]?.rape_legacy;
    expect(() => parseFbiStateEstimates(missingLegacyRape, 2024)).toThrow(/rape_legacy/i);

    expect(() => parseFbiStateEstimates({ rows: validRows() }, 2024)).toThrow(/array/i);
  });
});
