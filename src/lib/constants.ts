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

/** Enhanced ("first additional") CPP rate — deducted from income rather than credited */
export const CPP_ENHANCED_RATE = 0.01;

/** Federal Canada employment amount (non-refundable credit, 2026) */
export const CANADA_EMPLOYMENT_AMOUNT = 1_501;

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

/**
 * Province-specific extras used to enrich scraped bracket data.
 * Personal amounts: CRA T4127 (122nd ed., Jan 2026) Table 8.2, except NL, whose
 * $13,094 was announced Apr 29, 2026 (T4127 123rd ed., Jul 2026), and QC, which
 * is from Quebec Finance's 2026 personal income tax parameters.
 */
export const PROVINCE_EXTRAS: Record<ProvinceCode, Omit<ProvinceConfig, 'brackets'>> = {
	AB: { name: 'Alberta', personalAmount: 22_769 },
	BC: { name: 'British Columbia', personalAmount: 13_216 },
	MB: {
		name: 'Manitoba',
		personalAmount: 15_780,
		personalAmountClawback: { amountMin: 0, start: 200_000, end: 400_000 }
	},
	NB: { name: 'New Brunswick', personalAmount: 13_664 },
	NL: { name: 'Newfoundland and Labrador', personalAmount: 13_094 },
	NS: { name: 'Nova Scotia', personalAmount: 11_932 },
	NT: { name: 'Northwest Territories', personalAmount: 18_198 },
	NU: { name: 'Nunavut', personalAmount: 19_659 },
	ON: {
		name: 'Ontario',
		personalAmount: 12_989,
		surtax: ONTARIO_SURTAX,
		taxReductionBasic: 300,
		healthPremiumTiers: ONTARIO_HEALTH_PREMIUM
	},
	PE: { name: 'Prince Edward Island', personalAmount: 15_000 },
	QC: { name: 'Quebec', personalAmount: 18_952 },
	SK: { name: 'Saskatchewan', personalAmount: 20_381 },
	// Yukon's basic personal amount mirrors the federal one, including its clawback
	YT: {
		name: 'Yukon',
		personalAmount: 16_452,
		personalAmountClawback: { amountMin: 14_829, start: 181_440, end: 258_482 }
	}
};

// ---------------------------------------------------------------------------
// Bracket overrides: legislated 2026 changes that CRA's public tax-rates page
// (the scraper's source) does not yet reflect. Annual values from T4127
// 123rd ed. (Jul 2026); the prorated July–December payroll rates are not used.
// ---------------------------------------------------------------------------

/** BC raised its lowest rate from 5.06% to 5.60% for 2026 (announced Feb 17, 2026) */
const BC_BRACKETS: readonly TaxBracket[] = [
	{ min: 0, max: 50_363, rate: 0.056 },
	{ min: 50_363, max: 100_728, rate: 0.077 },
	{ min: 100_728, max: 115_648, rate: 0.105 },
	{ min: 115_648, max: 140_430, rate: 0.1229 },
	{ min: 140_430, max: 190_405, rate: 0.147 },
	{ min: 190_405, max: 265_545, rate: 0.168 },
	{ min: 265_545, max: NO_LIMIT, rate: 0.205 }
];

/**
 * PEI added a 20% bracket over $200,000 for 2026 (announced Apr 14, 2026).
 * CRA's tax-rates page also lists the 19% threshold as $142,250; T4127 has $142,520.
 */
const PEI_BRACKETS: readonly TaxBracket[] = [
	{ min: 0, max: 33_928, rate: 0.095 },
	{ min: 33_928, max: 65_820, rate: 0.1347 },
	{ min: 65_820, max: 106_890, rate: 0.166 },
	{ min: 106_890, max: 142_520, rate: 0.1762 },
	{ min: 142_520, max: 200_000, rate: 0.19 },
	{ min: 200_000, max: NO_LIMIT, rate: 0.2 }
];

/** Quebec brackets (Revenu Québec, not on CRA) — Quebec Finance 2026 parameters */
const QUEBEC_BRACKETS: readonly TaxBracket[] = [
	{ min: 0, max: 54_345, rate: 0.14 },
	{ min: 54_345, max: 108_680, rate: 0.19 },
	{ min: 108_680, max: 132_245, rate: 0.24 },
	{ min: 132_245, max: NO_LIMIT, rate: 0.2575 }
];

/** Brackets that take precedence over scraped (or cached) data */
export const PROVINCE_BRACKET_OVERRIDES: Partial<Record<ProvinceCode, readonly TaxBracket[]>> = {
	BC: BC_BRACKETS,
	PE: PEI_BRACKETS,
	QC: QUEBEC_BRACKETS
};

/** Federal tax reduction for Quebec residents (T4127 Table 8.2) */
export const QUEBEC_ABATEMENT = 0.165;

// ---------------------------------------------------------------------------
// Fallback bracket data (CRA T4127 2026). The scraper replaces these with
// fresh CRA data.
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
