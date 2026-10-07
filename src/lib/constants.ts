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
	BC: {
		name: 'British Columbia',
		personalAmount: 13_216,
		// Basic reduction raised from $575 to $690 for 2026 (announced Feb 17, 2026)
		taxReduction: { kind: 'income-tested', basic: 690, threshold: 25_570, rate: 0.0356 }
	},
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
		taxReduction: { kind: 'ontario', basic: 300 },
		healthPremiumTiers: ONTARIO_HEALTH_PREMIUM
	},
	PE: { name: 'Prince Edward Island', personalAmount: 15_000 },
	QC: { name: 'Quebec', personalAmount: 18_952 },
	SK: { name: 'Saskatchewan', personalAmount: 20_381 },
	// Yukon's basic personal amount mirrors the federal one, including its clawback
	YT: {
		name: 'Yukon',
		personalAmount: 16_452,
		personalAmountClawback: { amountMin: 14_829, start: 181_440, end: 258_482 },
		employmentAmount: CANADA_EMPLOYMENT_AMOUNT
	}
};

/** Build contiguous brackets from [lower threshold, rate] pairs */
function brackets(rows: readonly (readonly [number, number])[]): readonly TaxBracket[] {
	return rows.map(([min, rate], i) => ({ min, max: rows[i + 1]?.[0] ?? NO_LIMIT, rate }));
}

// ---------------------------------------------------------------------------
// Bracket overrides: legislated 2026 changes that CRA's public tax-rates page
// (the scraper's source) does not yet reflect. Annual values from T4127
// 123rd ed. (Jul 2026); the prorated July–December payroll rates are not used.
// ---------------------------------------------------------------------------

// BC raised its lowest rate from 5.06% to 5.60% for 2026 (announced Feb 17, 2026)
const BC_BRACKETS = brackets([
	[0, 0.056],
	[50_363, 0.077],
	[100_728, 0.105],
	[115_648, 0.1229],
	[140_430, 0.147],
	[190_405, 0.168],
	[265_545, 0.205]
]);

// PEI added a 20% bracket over $200,000 for 2026 (announced Apr 14, 2026).
// CRA's tax-rates page also lists the 19% threshold as $142,250; T4127 has $142,520.
const PEI_BRACKETS = brackets([
	[0, 0.095],
	[33_928, 0.1347],
	[65_820, 0.166],
	[106_890, 0.1762],
	[142_520, 0.19],
	[200_000, 0.2]
]);

// Quebec (Revenu Québec, not on CRA) — Quebec Finance 2026 parameters
const QUEBEC_BRACKETS = brackets([
	[0, 0.14],
	[54_345, 0.19],
	[108_680, 0.24],
	[132_245, 0.2575]
]);

/** Brackets that take precedence over scraped (or cached) data */
export const PROVINCE_BRACKET_OVERRIDES: Partial<Record<ProvinceCode, readonly TaxBracket[]>> = {
	BC: BC_BRACKETS,
	PE: PEI_BRACKETS,
	QC: QUEBEC_BRACKETS
};

/** Federal tax reduction for Quebec residents (T4127 Table 8.2) */
export const QUEBEC_ABATEMENT = 0.165;

// ---------------------------------------------------------------------------
// Fallback bracket data (CRA T4127 122nd ed., Jan 2026, Table 8.1). Used when
// neither a scrape nor the cache has a province. Checked by `pnpm check:rates`.
// ---------------------------------------------------------------------------

const FEDERAL_BRACKETS = brackets([
	[0, 0.14],
	[58_523, 0.205],
	[117_045, 0.26],
	[181_440, 0.29],
	[258_482, 0.33]
]);

export const FALLBACK_PROVINCE_BRACKETS: Record<ProvinceCode, readonly TaxBracket[]> = {
	AB: brackets([
		[0, 0.08],
		[61_200, 0.1],
		[154_259, 0.12],
		[185_111, 0.13],
		[246_813, 0.14],
		[370_220, 0.15]
	]),
	BC: BC_BRACKETS,
	MB: brackets([
		[0, 0.108],
		[47_000, 0.1275],
		[100_000, 0.174]
	]),
	NB: brackets([
		[0, 0.094],
		[52_333, 0.14],
		[104_666, 0.16],
		[193_861, 0.195]
	]),
	NL: brackets([
		[0, 0.087],
		[44_678, 0.145],
		[89_354, 0.158],
		[159_528, 0.178],
		[223_340, 0.198],
		[285_319, 0.208],
		[570_638, 0.213],
		[1_141_275, 0.218]
	]),
	NS: brackets([
		[0, 0.0879],
		[30_995, 0.1495],
		[61_991, 0.1667],
		[97_417, 0.175],
		[157_124, 0.21]
	]),
	NT: brackets([
		[0, 0.059],
		[53_003, 0.086],
		[106_009, 0.122],
		[172_346, 0.1405]
	]),
	NU: brackets([
		[0, 0.04],
		[55_801, 0.07],
		[111_602, 0.09],
		[181_439, 0.115]
	]),
	ON: brackets([
		[0, 0.0505],
		[53_891, 0.0915],
		[107_785, 0.1116],
		[150_000, 0.1216],
		[220_000, 0.1316]
	]),
	PE: PEI_BRACKETS,
	QC: QUEBEC_BRACKETS,
	SK: brackets([
		[0, 0.105],
		[54_532, 0.125],
		[155_805, 0.145]
	]),
	YT: brackets([
		[0, 0.064],
		[58_523, 0.09],
		[117_045, 0.109],
		[181_440, 0.128],
		[500_000, 0.15]
	])
};

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
	provinces: Object.fromEntries(
		(Object.keys(PROVINCE_EXTRAS) as ProvinceCode[]).map((code) => [
			code,
			{ ...PROVINCE_EXTRAS[code], brackets: FALLBACK_PROVINCE_BRACKETS[code] }
		])
	),
	meta: { lastUpdated: null, source: 'fallback', stale: false }
};
