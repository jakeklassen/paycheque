import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUTS, parseSavedInputs } from './saved-inputs';

describe('parseSavedInputs', () => {
	it('uses the defaults when nothing is saved', () => {
		expect(parseSavedInputs(null)).toEqual(DEFAULT_INPUTS);
		expect(parseSavedInputs('not json')).toEqual(DEFAULT_INPUTS);
	});

	it('keeps valid saved values', () => {
		const saved = { salary: 85_000, rrsp: 50, province: 'BC', frequency: 'semi-monthly' };
		expect(parseSavedInputs(JSON.stringify(saved))).toEqual(saved);
	});

	it('replaces invalid values with the defaults', () => {
		const saved = { salary: -1, rrsp: '50', province: 'toString', frequency: 'daily' };
		expect(parseSavedInputs(JSON.stringify(saved))).toEqual(DEFAULT_INPUTS);
	});
});
