export interface TaxBracket {
	readonly min: number;
	readonly max: number;
	readonly rate: number;
}

export interface SurtaxBracket {
	readonly threshold: number;
	readonly rate: number;
}

export interface HealthPremiumTier {
	readonly upTo: number;
	readonly flat: number;
	readonly marginalRate: number;
	readonly marginalBase: number;
}

/** Linear reduction of a basic personal amount between two income thresholds */
export interface PersonalAmountClawback {
	readonly amountMin: number;
	readonly start: number;
	readonly end: number;
}

/**
 * Provincial low-income tax reduction (T4127 factor S).
 * - ontario: lesser of tax and 2 × basic − tax (no dependants)
 * - income-tested: basic, reduced by rate × income over threshold
 */
export type TaxReduction =
	| { readonly kind: 'ontario'; readonly basic: number }
	| {
			readonly kind: 'income-tested';
			readonly basic: number;
			readonly threshold: number;
			readonly rate: number;
	  };

export interface ProvinceConfig {
	readonly name: string;
	readonly brackets: readonly TaxBracket[];
	readonly personalAmount: number;
	readonly personalAmountClawback?: PersonalAmountClawback;
	readonly surtax?: readonly SurtaxBracket[];
	readonly taxReduction?: TaxReduction;
	/** Provincial Canada employment amount (T4127 K4P), where one exists */
	readonly employmentAmount?: number;
	readonly healthPremiumTiers?: readonly HealthPremiumTier[];
}

export type ProvinceCode =
	'AB' | 'BC' | 'MB' | 'NB' | 'NL' | 'NS' | 'NT' | 'NU' | 'ON' | 'PE' | 'QC' | 'SK' | 'YT';

export interface CppRates {
	readonly rate: number;
	readonly ympe: number;
	readonly exemption: number;
	readonly maxEmployee: number;
}

export interface Cpp2Rates {
	readonly rate: number;
	readonly floor: number;
	readonly yampe: number;
	readonly maxEmployee: number;
}

export interface EiRates {
	readonly rate: number;
	readonly mie: number;
	readonly maxEmployee: number;
}

export interface FederalPersonal {
	readonly amountMax: number;
	readonly amountMin: number;
	readonly clawbackStart: number;
	readonly clawbackEnd: number;
}

/** Amounts (not credit values) eligible for non-refundable tax credits */
export interface TaxCredits {
	readonly cppBase: number;
	readonly ei: number;
	/** Gross employment income, which caps the Canada employment amount */
	readonly employmentIncome: number;
}

export interface RateMeta {
	readonly lastUpdated: string | null;
	readonly source: 'scrape' | 'cache' | 'fallback';
	readonly stale: boolean;
}

export interface RateConfig {
	readonly year: number;
	readonly cpp: CppRates;
	readonly cpp2: Cpp2Rates;
	readonly ei: EiRates;
	readonly eiQuebec: EiRates;
	readonly federalBrackets: readonly TaxBracket[];
	readonly federalPersonal: FederalPersonal;
	readonly provinces: Record<string, ProvinceConfig>;
	readonly meta: RateMeta;
}

export type PayFrequency = 'weekly' | 'biweekly' | 'semi-monthly' | 'monthly' | 'annually';

export interface PayDate {
	/** 0–11 */
	readonly month: number;
	readonly day: number;
	/** e.g. "Jun 15" */
	readonly label: string;
}

/** One paycheque */
export interface PeriodData {
	readonly date: PayDate;
	readonly gross: number;
	readonly cpp: number;
	readonly cpp2: number;
	readonly ei: number;
	/** Income tax withheld (federal + provincial + health premium) */
	readonly tax: number;
	readonly rrsp: number;
	readonly net: number;
}

export interface MonthData {
	readonly month: string;
	/** Number of paycheques dated in this month */
	readonly cheques: number;
	readonly net: number;
	readonly gross: number;
	readonly cpp: number;
	readonly cpp2: number;
	readonly ei: number;
	readonly tax: number;
	readonly rrsp: number;
}

/** A paycheque number (1-based) and its date */
export interface PeriodMarker {
	readonly period: number;
	readonly date: PayDate;
}

export interface SimulationResult {
	readonly frequency: PayFrequency;
	readonly periods: readonly PeriodData[];
	readonly months: readonly MonthData[];
	readonly cppMaxed: PeriodMarker | null;
	readonly cpp2Maxed: PeriodMarker | null;
	readonly eiMaxed: PeriodMarker | null;
	readonly totalCPP: number;
	readonly totalCPP2: number;
	readonly totalEI: number;
	/** Actual annual tax owed (as on the tax return) */
	readonly federalTax: number;
	readonly provincialTax: number;
	readonly healthPremium: number;
	readonly totalAnnualTax: number;
	/** Income tax withheld from paycheques over the year */
	readonly totalWithheld: number;
	/** Withheld minus owed: positive is a refund, negative is a balance owing */
	readonly refund: number;
	/** Take-home across all paycheques */
	readonly paychequeNet: number;
	/** Take-home after filing: paycheques plus refund */
	readonly totalAnnualNet: number;
	readonly avgMonthlyNet: number;
	/** First paycheque's net, as a monthly rate */
	readonly earlyMonthlyNet: number;
	/** Last paycheque's net, as a monthly rate */
	readonly lateMonthlyNet: number;
	readonly firstChequeNet: number;
	readonly lastChequeNet: number;
	readonly annualRRSP: number;
}
