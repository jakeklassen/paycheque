import type {
	MonthData,
	PayFrequency,
	PeriodData,
	PeriodMarker,
	RateConfig,
	SimulationResult,
	TaxCredits
} from './types';
import { CPP_ENHANCED_RATE, PAY_FREQUENCIES } from './constants';
import { MONTH_NAMES, payDates } from './pay-schedule';
import { calcFederalTax, calcHealthPremium, calcProvincialTax } from './tax';

/** Cents, ignoring floating-point noise (so 81.355 isn't stored as 81.35499…) */
const cents = (v: number) => Number((v * 100).toPrecision(12));

/** Round half up to cents (T4127 rounding rules) */
function round2(v: number): number {
	return Math.round(cents(v)) / 100;
}

/** Drop digits past the cents (T4127 rule for the per-period CPP exemption) */
function truncate2(v: number): number {
	return Math.trunc(cents(v)) / 100;
}

/** Income tax on an annual (or annualized) basis: federal, provincial, health premium */
function annualTax(
	taxableIncome: number,
	credits: TaxCredits,
	province: string,
	config: RateConfig
) {
	return {
		federal: calcFederalTax(taxableIncome, province, credits, config),
		provincial: calcProvincialTax(taxableIncome, province, credits, config),
		healthPremium: calcHealthPremium(taxableIncome, province, config)
	};
}

/**
 * Simulate a year of paycheques following CRA's T4127 payroll formulas
 * (Option 1): CPP's basic exemption is spread across pay periods, CPP2 starts
 * once earnings pass the YMPE, and each cheque's income tax is the annualized
 * tax on that cheque. CPP/EI credits follow T4127's recommendation: the
 * greater of the annualized and year-to-date amounts, and the annual maximum
 * from the cheque where contributions max out. Withholding still rises a
 * little after that because the enhanced CPP and CPP2 deductions stop. The
 * annual tax actually owed is computed separately; the difference is the
 * refund (or balance owing) at filing time.
 */
export function simulate(
	annualGross: number,
	rrspWeekly: number,
	province: string,
	config: RateConfig,
	frequency: PayFrequency
): SimulationResult {
	const P = PAY_FREQUENCIES[frequency].periods;
	const dates = payDates(config.year, frequency);
	const gross = annualGross / P;
	const annualRRSP = rrspWeekly * 52;
	const rrsp = annualRRSP / P;

	// Quebec uses different EI rates
	const ei = province === 'QC' ? config.eiQuebec : config.ei;
	const { cpp, cpp2 } = config;
	const enhancedShare = CPP_ENHANCED_RATE / cpp.rate;
	const cppBaseMax = cpp.maxEmployee * (1 - enhancedShare);
	const exemption = truncate2(cpp.exemption / P);

	// Full-year contributions drive the tax actually owed
	const annualCPP = Math.min(
		Math.max(0, Math.min(annualGross, cpp.ympe) - cpp.exemption) * cpp.rate,
		cpp.maxEmployee
	);
	const annualCPP2 = Math.min(
		Math.max(0, Math.min(annualGross, cpp2.yampe) - cpp2.floor) * cpp2.rate,
		cpp2.maxEmployee
	);
	const annualEI = Math.min(Math.min(annualGross, ei.mie) * ei.rate, ei.maxEmployee);

	// Enhanced CPP and all of CPP2 are deductions; base CPP and EI are credits
	const owed = annualTax(
		Math.max(0, annualGross - annualRRSP - annualCPP * enhancedShare - annualCPP2),
		{ cppBase: annualCPP * (1 - enhancedShare), ei: annualEI, employmentIncome: annualGross },
		province,
		config
	);
	const totalAnnualTax = owed.federal + owed.provincial + owed.healthPremium;

	const periods: PeriodData[] = [];
	let cumGross = 0;
	let cumCPP = 0;
	let cumCPP2 = 0;
	let cumEI = 0;
	let cppMaxed: PeriodMarker | null = null;
	let cpp2Maxed: PeriodMarker | null = null;
	let eiMaxed: PeriodMarker | null = null;

	for (let i = 0; i < P; i++) {
		const date = dates[i];

		const cppP = Math.max(
			0,
			Math.min(round2(cpp.rate * (gross - exemption)), round2(cpp.maxEmployee - cumCPP))
		);
		// CPP2 on earnings above the greater of YTD earnings and the YMPE (factor W)
		const cpp2Base = cumGross + gross - Math.max(cumGross, cpp2.floor);
		const cpp2P = Math.max(
			0,
			Math.min(round2(cpp2Base * cpp2.rate), round2(cpp2.maxEmployee - cumCPP2))
		);
		const eiP = Math.max(0, Math.min(round2(gross * ei.rate), round2(ei.maxEmployee - cumEI)));

		const cppReachesMax = cppP > 0 && cpp.maxEmployee - (cumCPP + cppP) < 0.005;
		const cpp2ReachesMax = cpp2P > 0 && cpp2.maxEmployee - (cumCPP2 + cpp2P) < 0.005;
		const eiReachesMax = eiP > 0 && ei.maxEmployee - (cumEI + eiP) < 0.005;
		if (cppReachesMax) cppMaxed = { period: i + 1, date };
		if (cpp2ReachesMax) cpp2Maxed = { period: i + 1, date };
		if (eiReachesMax) eiMaxed = { period: i + 1, date };

		// Withholding: annualize this cheque (T4127 factor A). Credits use the
		// greater of the annualized and year-to-date contributions, and the
		// annual maximum once it's reached (T4127's recommended approach). The
		// note compares against YTD CPP (D); we take its base share so both sides
		// measure base contributions, the amount the credit is based on.
		const cppCredit =
			cppMaxed !== null
				? cppBaseMax
				: Math.min(cppBaseMax, Math.max(P * cppP, cumCPP) * (1 - enhancedShare));
		const eiCredit =
			eiMaxed !== null ? ei.maxEmployee : Math.min(ei.maxEmployee, Math.max(P * eiP, cumEI));
		const perCheque = annualTax(
			Math.max(0, P * (gross - rrsp - cppP * enhancedShare - cpp2P)),
			{ cppBase: cppCredit, ei: eiCredit, employmentIncome: P * gross },
			province,
			config
		);
		const tax = round2((perCheque.federal + perCheque.provincial + perCheque.healthPremium) / P);

		cumGross += gross;
		cumCPP += cppP;
		cumCPP2 += cpp2P;
		cumEI += eiP;

		periods.push({
			date,
			gross,
			cpp: cppP,
			cpp2: cpp2P,
			ei: eiP,
			tax,
			rrsp,
			net: gross - cppP - cpp2P - eiP - tax - rrsp
		});
	}

	const months: MonthData[] = MONTH_NAMES.map((month, m) => {
		const inMonth = periods.filter((p) => p.date.month === m);
		const sum = (key: Exclude<keyof PeriodData, 'date'>) =>
			round2(inMonth.reduce((s, p) => s + p[key], 0));
		return {
			month,
			cheques: inMonth.length,
			net: sum('net'),
			gross: sum('gross'),
			cpp: sum('cpp'),
			cpp2: sum('cpp2'),
			ei: sum('ei'),
			tax: sum('tax'),
			rrsp: sum('rrsp')
		};
	});

	const totalWithheld = periods.reduce((s, p) => s + p.tax, 0);
	const paychequeNet = periods.reduce((s, p) => s + p.net, 0);
	const refund = totalWithheld - totalAnnualTax;
	const firstChequeNet = periods[0].net;
	const lastChequeNet = periods[P - 1].net;

	return {
		frequency,
		periods,
		months,
		cppMaxed,
		cpp2Maxed,
		eiMaxed,
		totalCPP: cumCPP,
		totalCPP2: cumCPP2,
		totalEI: cumEI,
		federalTax: owed.federal,
		provincialTax: owed.provincial,
		healthPremium: owed.healthPremium,
		totalAnnualTax,
		totalWithheld,
		refund,
		paychequeNet,
		totalAnnualNet: paychequeNet + refund,
		avgMonthlyNet: paychequeNet / 12,
		earlyMonthlyNet: (firstChequeNet * P) / 12,
		lateMonthlyNet: (lastChequeNet * P) / 12,
		firstChequeNet,
		lastChequeNet,
		annualRRSP
	};
}
