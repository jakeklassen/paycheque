import type { PayFrequency, ProvinceCode, RateConfig, RatesData, TaxBracket } from './types';
import rates from './rates.json';

/** Sentinel for the highest bracket's upper bound (serializable, unlike Infinity) */
export const NO_LIMIT = 1e15;

export const PAY_FREQUENCIES: Record<PayFrequency, { label: string; periods: number }> = {
	weekly: { label: 'Weekly', periods: 52 },
	biweekly: { label: 'Biweekly', periods: 26 },
	'semi-monthly': { label: 'Semi-monthly', periods: 24 },
	monthly: { label: 'Monthly', periods: 12 },
	annually: { label: 'Annually', periods: 1 }
};

export const PROVINCE_NAMES: Record<ProvinceCode, string> = {
	AB: 'Alberta',
	BC: 'British Columbia',
	MB: 'Manitoba',
	NB: 'New Brunswick',
	NL: 'Newfoundland and Labrador',
	NS: 'Nova Scotia',
	NT: 'Northwest Territories',
	NU: 'Nunavut',
	ON: 'Ontario',
	PE: 'Prince Edward Island',
	QC: 'Quebec',
	SK: 'Saskatchewan',
	YT: 'Yukon'
};

/** Build contiguous brackets from [lower threshold, rate] pairs */
function brackets(rows: RatesData['federal']['brackets']): readonly TaxBracket[] {
	return rows.map(([min, rate], i) => ({ min, max: rows[i + 1]?.[0] ?? NO_LIMIT, rate }));
}

/** Turn rate data (src/lib/rates.json, or a test fixture) into the calculator's config */
export function buildConfig(data: RatesData): RateConfig {
	return {
		year: data.year,
		cpp: data.cpp,
		cpp2: data.cpp2,
		ei: data.ei,
		eiQuebec: data.eiQuebec,
		federalBrackets: brackets(data.federal.brackets),
		federalPersonal: data.federal.personalAmount,
		canadaEmploymentAmount: data.federal.canadaEmploymentAmount,
		quebecAbatement: data.federal.quebecAbatement,
		quebecYear: data.quebecYear,
		provinces: Object.fromEntries(
			(Object.keys(PROVINCE_NAMES) as ProvinceCode[]).map((code) => {
				const { brackets: rows, ...rest } = data.provinces[code];
				return [code, { name: PROVINCE_NAMES[code], brackets: brackets(rows), ...rest }];
			})
		)
	};
}

/** Rates for the current tax year, from src/lib/rates.json (shape checked in simulation.spec.ts) */
export const RATES: RateConfig = buildConfig(rates as unknown as RatesData);
