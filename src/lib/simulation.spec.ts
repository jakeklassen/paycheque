import { describe, expect, it } from 'vitest';
import type { PayFrequency, RateConfig } from './types';
import { FALLBACK_CONFIG, NO_LIMIT, PAY_FREQUENCIES, PROVINCE_EXTRAS } from './constants';
import { applyHandMaintainedRates } from './server/scraper';
import { simulate } from './simulation';

// A stale cached config: scraped brackets plus outdated hand-maintained values.
// applyHandMaintainedRates must replace the outdated parts.
const CONFIG: RateConfig = applyHandMaintainedRates({
	...FALLBACK_CONFIG,
	provinces: {
		...FALLBACK_CONFIG.provinces,
		MB: {
			name: 'Manitoba',
			personalAmount: 15_780,
			brackets: [
				{ min: 0, max: 47_000, rate: 0.108 },
				{ min: 47_000, max: 100_000, rate: 0.1275 },
				{ min: 100_000, max: NO_LIMIT, rate: 0.174 }
			]
		},
		BC: {
			name: 'British Columbia',
			personalAmount: 12_580,
			brackets: [{ min: 0, max: NO_LIMIT, rate: 0.0506 }]
		},
		PE: {
			name: 'Prince Edward Island',
			personalAmount: 13_500,
			surtax: [{ threshold: 12_500, rate: 0.1 }],
			brackets: [{ min: 0, max: NO_LIMIT, rate: 0.095 }]
		}
	}
});

describe('simulate', () => {
	const result = simulate(170_000, 0, 'ON', CONFIG, 'semi-monthly');

	it('applies CPP/EI deductions and credits to income tax', () => {
		expect(result.federalTax).toBeCloseTo(30_502.14, 2);
		expect(result.provincialTax).toBeCloseTo(17_634.79, 2);
		expect(result.healthPremium).toBe(750);
		expect(result.totalAnnualNet).toBeCloseTo(115_343.56, 2);
	});

	it('annual net is the same for every pay frequency', () => {
		for (const frequency of Object.keys(PAY_FREQUENCIES) as PayFrequency[]) {
			const r = simulate(170_000, 0, 'ON', CONFIG, frequency);
			expect(r.totalAnnualNet).toBeCloseTo(115_343.56, 2);
			expect(r.months.reduce((s, m) => s + m.net, 0)).toBeCloseTo(r.paychequeNet, 1);
		}
	});
});

// Per-cheque withholding computed independently from the T4127 Option 1 formulas
describe('paycheques', () => {
	it.each([
		// frequency, first cheque net, last cheque net, take-home in cheques, refund
		['semi-monthly', 4_528.22, 4_982.94, 114_769.83, 573.73],
		['biweekly', 4_179.89, 4_599.64, 114_764.76, 578.8]
	] as const)('%s at $170,000 in Ontario', (frequency, first, last, paycheques, refund) => {
		const r = simulate(170_000, 0, 'ON', CONFIG, frequency);
		expect(r.firstChequeNet).toBeCloseTo(first, 2);
		expect(r.lastChequeNet).toBeCloseTo(last, 2);
		expect(r.paychequeNet).toBeCloseTo(paycheques, 2);
		expect(r.refund).toBeCloseTo(refund, 2);
		expect(r.totalCPP).toBeCloseTo(4_230.45, 2);
		expect(r.totalCPP2).toBeCloseTo(416, 2);
		expect(r.totalEI).toBeCloseTo(1_123.07, 2);
	});

	it('maxes out on the expected twice-a-month cheques', () => {
		const r = simulate(170_000, 0, 'ON', CONFIG, 'semi-monthly');
		expect(r.eiMaxed).toMatchObject({ period: 10, date: { label: 'May 31' } });
		expect(r.cppMaxed).toMatchObject({ period: 11, date: { label: 'Jun 15' } });
		expect(r.cpp2Maxed).toMatchObject({ period: 12, date: { label: 'Jun 30' } });
	});

	it('puts a third biweekly cheque in two months', () => {
		const r = simulate(170_000, 0, 'ON', CONFIG, 'biweekly');
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
		['YT', 170_000, 30_502.14, 13_215.59], // Yukon employment credit
		['YT', 220_000, 44_735.53, 19_427.29], // Yukon BPA clawback
		// Quebec abatement and 2026 brackets only — QPP and QPIP are not modelled,
		// so this is not a complete Quebec estimate
		['QC', 170_000, 25_495.86, 30_365.98]
	] as const)('%s at $%i', (province, salary, federal, provincial) => {
		const r = simulate(salary, 0, province, CONFIG, 'semi-monthly');
		expect(r.federalTax).toBeCloseTo(federal, 2);
		expect(r.provincialTax).toBeCloseTo(provincial, 2);
	});

	it('fills every province when only fallback data is available', () => {
		const fallback = applyHandMaintainedRates(FALLBACK_CONFIG);
		expect(Object.keys(fallback.provinces).sort()).toEqual(Object.keys(PROVINCE_EXTRAS).sort());
		expect(simulate(170_000, 0, 'BC', fallback, 'semi-monthly').provincialTax).toBeCloseTo(
			14_491.78,
			2
		);
	});

	it('replaces outdated cached personal amounts and surtaxes', () => {
		expect(CONFIG.provinces.BC.personalAmount).toBe(PROVINCE_EXTRAS.BC.personalAmount);
		expect(CONFIG.provinces.PE.surtax).toBeUndefined();
	});
});
