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

export interface ProvinceConfig {
	readonly name: string;
	readonly brackets: readonly TaxBracket[];
	readonly personalAmount: number;
	readonly personalAmountClawback?: PersonalAmountClawback;
	readonly surtax?: readonly SurtaxBracket[];
	/** Ontario tax reduction basic amount (T4127 S2) */
	readonly taxReductionBasic?: number;
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
	readonly employmentAmount: number;
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

export interface WeekData {
	readonly week: number;
	readonly gross: number;
	readonly cpp: number;
	readonly cpp2: number;
	readonly ei: number;
	readonly tax: number;
	readonly rrsp: number;
	readonly net: number;
}

export interface MonthData {
	readonly month: string;
	readonly net: number;
	readonly gross: number;
	readonly cpp: number;
	readonly cpp2: number;
	readonly ei: number;
	readonly tax: number;
	readonly rrsp: number;
}

export interface SimulationResult {
	readonly weeks: readonly WeekData[];
	readonly months: readonly MonthData[];
	readonly cppMaxedWeek: number | null;
	readonly cpp2MaxedWeek: number | null;
	readonly eiMaxedWeek: number | null;
	readonly totalCPP: number;
	readonly totalCPP2: number;
	readonly totalEI: number;
	readonly federalTax: number;
	readonly provincialTax: number;
	readonly healthPremium: number;
	readonly totalAnnualTax: number;
	readonly totalAnnualNet: number;
	readonly avgMonthlyNet: number;
	readonly earlyMonthlyNet: number;
	readonly lateMonthlyNet: number;
	readonly annualRRSP: number;
}
