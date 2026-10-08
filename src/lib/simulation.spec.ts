import { describe, expect, it } from 'vitest';
import type { PayFrequency, RatesData } from './types';
import { buildConfig, PAY_FREQUENCIES, PROVINCE_NAMES, RATES } from './constants';
import { simulate } from './simulation';
import rates2026 from './test-fixtures/rates-2026.json';
import currentRates from './rates.json';

// Expected values are for 2026, so the tests use a frozen copy of the 2026
// rates; updates to src/lib/rates.json don't change them
const CONFIG = buildConfig(rates2026 as unknown as RatesData);

describe('simulate', () => {
	const result = simulate(100_000, 0, 'ON', CONFIG, 'semi-monthly');

	it('applies CPP/EI deductions and credits to income tax', () => {
		expect(result.federalTax).toBeCloseTo(13_301.6, 2);
		expect(result.provincialTax).toBeCloseTo(5_972.75, 2);
		expect(result.healthPremium).toBe(750);
		expect(result.totalAnnualNet).toBeCloseTo(74_206.13, 2);
	});

	// Holds here because every contribution reaches its maximum; at lower
	// salaries per-cheque rounding can move the total by a few cents
	it('annual net is the same for every pay frequency at $100,000', () => {
		for (const frequency of Object.keys(PAY_FREQUENCIES) as PayFrequency[]) {
			const r = simulate(100_000, 0, 'ON', CONFIG, frequency);
			expect(r.totalAnnualNet).toBeCloseTo(74_206.13, 2);
			expect(r.months.reduce((s, m) => s + m.net, 0)).toBeCloseTo(r.paychequeNet, 1);
		}
	});
});

// Per-cheque payroll computed independently from the T4127 Option 1 text,
// including its recommended CPP/EI credit handling after max-out
describe('paycheques', () => {
	it.each([
		// frequency, first cheque net, last cheque net, take-home in cheques, refund
		['semi-monthly', 3_023.04, 3_317.54, 74_203.94, 2.19],
		['biweekly', 2_790.49, 3_062.34, 74_204.03, 2.1]
	] as const)('%s at $100,000 in Ontario', (frequency, first, last, paycheques, refund) => {
		const r = simulate(100_000, 0, 'ON', CONFIG, frequency);
		expect(r.firstChequeNet).toBeCloseTo(first, 2);
		expect(r.lastChequeNet).toBeCloseTo(last, 2);
		expect(r.paychequeNet).toBeCloseTo(paycheques, 2);
		expect(r.refund).toBeCloseTo(refund, 2);
		expect(r.totalCPP).toBeCloseTo(4_230.45, 2);
		expect(r.totalCPP2).toBeCloseTo(416, 2);
		expect(r.totalEI).toBeCloseTo(1_123.07, 2);
	});

	it('maxes out on the expected twice-a-month cheques', () => {
		const r = simulate(100_000, 0, 'ON', CONFIG, 'semi-monthly');
		expect(r.eiMaxed).toMatchObject({ period: 17, date: { label: 'Sep 15' } });
		expect(r.cppMaxed).toMatchObject({ period: 18, date: { label: 'Sep 30' } });
		expect(r.cpp2Maxed).toMatchObject({ period: 21, date: { label: 'Nov 15' } });
	});

	it('collects the full CPP2 despite per-cheque rounding', () => {
		const r = simulate(90_000, 0, 'ON', CONFIG, 'weekly');
		expect(r.totalCPP2).toBeCloseTo(416, 2);
		expect(r.cpp2Maxed).toMatchObject({ period: 50, date: { label: 'Dec 11' } });
	});

	it('truncates the per-cheque CPP exemption to cents', () => {
		const r = simulate(74_600, 0, 'ON', CONFIG, 'weekly');
		expect(r.totalCPP).toBeCloseTo(4_230.45, 2);
		expect(r.cppMaxed?.period).toBe(52);
	});

	it('puts a third biweekly cheque in two months', () => {
		const r = simulate(100_000, 0, 'ON', CONFIG, 'biweekly');
		expect(r.months.filter((m) => m.cheques === 3).map((m) => m.month)).toEqual(['Jan', 'Jul']);
	});
});

// Expected values computed independently from the T4127 2026 formulas
describe('provincial rules', () => {
	it.each([
		['ON', 20_000, 103.49, 0], // Ontario tax reduction wipes out provincial tax
		['MB', 300_000, 69_667.99, 45_074.29], // Manitoba BPA phase-out
		['BC', 25_000, 750.44, 0], // BC tax reduction wipes out provincial tax
		['BC', 35_000, 2_044.32, 717.49], // BC tax reduction partially phased out
		['BC', 50_000, 3_985.14, 1_859.33], // BC lowest rate 5.60%, reduction fully phased out
		['PE', 250_000, 53_524.01, 39_444.4], // PEI 20% bracket, no surtax
		['BC', 100_000, 13_301.6, 5_555.52],
		['YT', 100_000, 13_301.6, 5_930.86], // Yukon employment credit
		['YT', 220_000, 44_735.53, 19_427.29], // Yukon BPA clawback
		// Quebec abatement and 2026 brackets only — QPP and QPIP are not modelled,
		// so this is not a complete Quebec estimate
		['QC', 100_000, 11_133.41, 13_415.34]
	] as const)('%s at $%i', (province, salary, federal, provincial) => {
		const r = simulate(salary, 0, province, CONFIG, 'semi-monthly');
		expect(r.federalTax).toBeCloseTo(federal, 2);
		expect(r.provincialTax).toBeCloseTo(provincial, 2);
	});
});

describe('rates.json', () => {
	const data = currentRates as unknown as RatesData;

	it('has well-formed brackets for federal and every province', () => {
		const all = [data.federal.brackets, ...Object.values(data.provinces).map((p) => p.brackets)];
		for (const rows of all) {
			expect(rows[0]).toEqual([0, expect.any(Number)]);
			for (const [i, row] of rows.entries()) {
				expect(row).toHaveLength(2);
				expect(row[1]).toBeGreaterThan(0);
				expect(row[1]).toBeLessThan(1);
				if (i > 0) expect(row[0]).toBeGreaterThan(rows[i - 1][0]);
			}
		}
	});

	it('builds a config for every province', () => {
		expect(Object.keys(data.provinces).sort()).toEqual(Object.keys(PROVINCE_NAMES).sort());
		for (const code of Object.keys(PROVINCE_NAMES)) {
			const r = simulate(100_000, 0, code, RATES, 'semi-monthly');
			expect(r.totalAnnualNet).toBeGreaterThan(50_000);
			expect(r.totalAnnualNet).toBeLessThan(100_000);
		}
	});
});
