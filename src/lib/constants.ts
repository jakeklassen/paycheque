import type {
	HealthPremiumTier,
	ProvinceCode,
	ProvinceConfig,
	RateConfig,
	SurtaxBracket,
	TaxBracket
} from './types';

/** Sentinel for the highest bracket's upper bound (serializable, unlike Infinity) */
export const NO_LIMIT = 1e15;

export const YEAR = 2026;

// ---------------------------------------------------------------------------
// Province metadata: names, personal amounts, surtaxes, health premiums.
// Brackets come from the scraper; these extras are hardcoded.
// ---------------------------------------------------------------------------

const ONTARIO_HEALTH_PREMIUM: readonly HealthPremiumTier[] = [
	{ upTo: 20_000, flat: 0, marginalRate: 0, marginalBase: 0 },
	{ upTo: 25_000, flat: 0, marginalRate: 0.06, marginalBase: 20_000 },
	{ upTo: 36_000, flat: 300, marginalRate: 0, marginalBase: 0 },
	{ upTo: 38_500, flat: 300, marginalRate: 0.06, marginalBase: 36_000 },
	{ upTo: 48_000, flat: 450, marginalRate: 0, marginalBase: 0 },
	{ upTo: 48_600, flat: 450, marginalRate: 0.25, marginalBase: 48_000 },
	{ upTo: 72_000, flat: 600, marginalRate: 0, marginalBase: 0 },
	{ upTo: 72_600, flat: 600, marginalRate: 0.25, marginalBase: 72_000 },
	{ upTo: 200_000, flat: 750, marginalRate: 0, marginalBase: 0 },
	{ upTo: 200_600, flat: 750, marginalRate: 0.25, marginalBase: 200_000 },
	{ upTo: NO_LIMIT, flat: 900, marginalRate: 0, marginalBase: 0 }
];

const ONTARIO_SURTAX: readonly SurtaxBracket[] = [
	{ threshold: 5_818, rate: 0.2 },
	{ threshold: 7_446, rate: 0.36 }
];

/** Province-specific extras used to enrich scraped bracket data */
export const PROVINCE_EXTRAS: Record<ProvinceCode, Omit<ProvinceConfig, 'brackets'>> = {
	AB: { name: 'Alberta', personalAmount: 22_323 },
	BC: { name: 'British Columbia', personalAmount: 12_580 },
	MB: { name: 'Manitoba', personalAmount: 15_780 },
	NB: { name: 'New Brunswick', personalAmount: 13_044 },
	NL: { name: 'Newfoundland and Labrador', personalAmount: 10_818 },
	NS: { name: 'Nova Scotia', personalAmount: 8_481 },
	NT: { name: 'Northwest Territories', personalAmount: 17_373 },
	NU: { name: 'Nunavut', personalAmount: 18_767 },
	ON: {
		name: 'Ontario',
		personalAmount: 12_989,
		surtax: ONTARIO_SURTAX,
		healthPremiumTiers: ONTARIO_HEALTH_PREMIUM
	},
	PE: {
		name: 'Prince Edward Island',
		personalAmount: 13_500,
		surtax: [{ threshold: 12_500, rate: 0.1 }]
	},
	QC: { name: 'Quebec', personalAmount: 18_056 },
	SK: { name: 'Saskatchewan', personalAmount: 18_491 },
	YT: { name: 'Yukon', personalAmount: 16_452 }
};

// ---------------------------------------------------------------------------
// Fallback bracket data (CRA-confirmed 2026 for Ontario; approximate for
// other provinces). The scraper replaces these with fresh CRA data.
// ---------------------------------------------------------------------------

const FEDERAL_BRACKETS: readonly TaxBracket[] = [
	{ min: 0, max: 58_523, rate: 0.14 },
	{ min: 58_523, max: 117_045, rate: 0.205 },
	{ min: 117_045, max: 181_440, rate: 0.26 },
	{ min: 181_440, max: 258_482, rate: 0.29 },
	{ min: 258_482, max: NO_LIMIT, rate: 0.33 }
];

const ONTARIO_BRACKETS: readonly TaxBracket[] = [
	{ min: 0, max: 53_891, rate: 0.0505 },
	{ min: 53_891, max: 107_785, rate: 0.0915 },
	{ min: 107_785, max: 150_000, rate: 0.1116 },
	{ min: 150_000, max: 220_000, rate: 0.1216 },
	{ min: 220_000, max: NO_LIMIT, rate: 0.1316 }
];

// Quebec brackets (Revenu Quebec, not on CRA) — approximate 2026
const QUEBEC_BRACKETS: readonly TaxBracket[] = [
	{ min: 0, max: 53_255, rate: 0.14 },
	{ min: 53_255, max: 106_495, rate: 0.19 },
	{ min: 106_495, max: 129_590, rate: 0.24 },
	{ min: 129_590, max: NO_LIMIT, rate: 0.2575 }
];

/** Complete fallback config — used when scraping fails entirely */
export const FALLBACK_CONFIG: RateConfig = {
	year: YEAR,
	cpp: { rate: 0.0595, ympe: 74_600, exemption: 3_500, maxEmployee: 4_230.45 },
	cpp2: { rate: 0.04, floor: 74_600, yampe: 85_000, maxEmployee: 416.0 },
	ei: { rate: 0.0163, mie: 68_900, maxEmployee: 1_123.07 },
	eiQuebec: { rate: 0.013, mie: 68_900, maxEmployee: 895.7 },
	federalBrackets: FEDERAL_BRACKETS,
	federalPersonal: {
		amountMax: 16_452,
		amountMin: 14_829,
		clawbackStart: 181_440,
		clawbackEnd: 258_482
	},
	provinces: {
		ON: { ...PROVINCE_EXTRAS.ON, brackets: ONTARIO_BRACKETS },
		QC: { ...PROVINCE_EXTRAS.QC, brackets: QUEBEC_BRACKETS }
	},
	meta: { lastUpdated: null, source: 'fallback', stale: false }
};
