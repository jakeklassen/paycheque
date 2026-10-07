import type { MonthData, RateConfig, SimulationResult, TaxCredits, WeekData } from './types';
import { CPP_ENHANCED_RATE } from './constants';
import { calcFederalTax, calcHealthPremium, calcProvincialTax } from './tax';

const MONTH_NAMES = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
] as const;

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

export function simulate(
	annualGross: number,
	rrspWeekly: number,
	province: string,
	config: RateConfig
): SimulationResult {
	const weeklyGross = annualGross / 52;
	const annualRRSP = rrspWeekly * 52;

	// Quebec uses different EI rates
	const ei = province === 'QC' ? config.eiQuebec : config.ei;
	const { cpp, cpp2 } = config;

	// Full-year contributions drive the tax deductions and credits
	const annualCPP = Math.min(
		Math.max(0, Math.min(annualGross, cpp.ympe) - cpp.exemption) * cpp.rate,
		cpp.maxEmployee
	);
	const annualCPP2 = Math.min(
		Math.max(0, Math.min(annualGross, cpp2.yampe) - cpp2.floor) * cpp2.rate,
		cpp2.maxEmployee
	);
	const annualEI = Math.min(Math.min(annualGross, ei.mie) * ei.rate, ei.maxEmployee);
	const cppEnhanced = annualCPP * (CPP_ENHANCED_RATE / cpp.rate);

	// Enhanced CPP and all of CPP2 are deductions; base CPP and EI are credits
	const taxableIncome = Math.max(0, annualGross - annualRRSP - cppEnhanced - annualCPP2);
	const credits: TaxCredits = {
		cppBase: annualCPP - cppEnhanced,
		ei: annualEI,
		employmentIncome: annualGross
	};

	const federalTax = calcFederalTax(taxableIncome, province, credits, config);
	const provincialTax = calcProvincialTax(taxableIncome, province, credits, config);
	const healthPremium = calcHealthPremium(taxableIncome, province, config);
	const totalAnnualTax = federalTax + provincialTax + healthPremium;
	const weeklyTax = totalAnnualTax / 52;

	// Week-by-week CPP/CPP2/EI simulation
	const weeks: WeekData[] = [];
	let cumGross = 0;
	let cumCPP = 0;
	let cumCPP2 = 0;
	let cumEI = 0;
	let cppMaxedWeek: number | null = null;
	let cpp2MaxedWeek: number | null = null;
	let eiMaxedWeek: number | null = null;

	for (let w = 1; w <= 52; w++) {
		cumGross += weeklyGross;

		let cppW = 0;
		if (cumCPP < cpp.maxEmployee) {
			const pensionable = Math.min(cumGross, cpp.ympe) - cpp.exemption;
			const owed = Math.min(Math.max(0, pensionable) * cpp.rate, cpp.maxEmployee);
			cppW = Math.max(0, owed - cumCPP);
			cumCPP += cppW;
			if (cumCPP >= cpp.maxEmployee && cppMaxedWeek === null) cppMaxedWeek = w;
		}

		let cpp2W = 0;
		if (cumCPP2 < cpp2.maxEmployee) {
			const above = Math.max(0, Math.min(cumGross, cpp2.yampe) - cpp2.floor);
			const owed = Math.min(above * cpp2.rate, cpp2.maxEmployee);
			cpp2W = Math.max(0, owed - cumCPP2);
			cumCPP2 += cpp2W;
			if (cumCPP2 >= cpp2.maxEmployee && cpp2MaxedWeek === null) cpp2MaxedWeek = w;
		}

		let eiW = 0;
		if (cumEI < ei.maxEmployee) {
			const insurable = Math.min(cumGross, ei.mie);
			const owed = Math.min(insurable * ei.rate, ei.maxEmployee);
			eiW = Math.max(0, owed - cumEI);
			cumEI += eiW;
			if (cumEI >= ei.maxEmployee && eiMaxedWeek === null) eiMaxedWeek = w;
		}

		weeks.push({
			week: w,
			gross: weeklyGross,
			cpp: cppW,
			cpp2: cpp2W,
			ei: eiW,
			tax: weeklyTax,
			rrsp: rrspWeekly,
			net: weeklyGross - cppW - cpp2W - eiW - weeklyTax - rrspWeekly
		});
	}

	// Aggregate to months using uniform month length. 52 weeks span 364 days,
	// so months must split 364 days for monthly nets to sum to the annual net.
	const uniformDays = (52 * 7) / 12;
	const months: MonthData[] = [];

	for (let m = 0; m < 12; m++) {
		const monthStartDay = m * uniformDays;
		const monthEndDay = (m + 1) * uniformDays;
		let mNet = 0;
		let mGross = 0;
		let mCPP = 0;
		let mCPP2 = 0;
		let mEI = 0;
		let mTax = 0;
		let mRRSP = 0;

		for (let day = Math.floor(monthStartDay); day < Math.ceil(monthEndDay); day++) {
			const dayStart = Math.max(day, monthStartDay);
			const dayEnd = Math.min(day + 1, monthEndDay);
			const fraction = (dayEnd - dayStart) / 7;

			const weekIdx = Math.min(Math.floor(day / 7), 51);
			const wk = weeks[weekIdx];
			mNet += wk.net * fraction;
			mGross += wk.gross * fraction;
			mCPP += wk.cpp * fraction;
			mCPP2 += wk.cpp2 * fraction;
			mEI += wk.ei * fraction;
			mTax += wk.tax * fraction;
			mRRSP += wk.rrsp * fraction;
		}

		months.push({
			month: MONTH_NAMES[m],
			net: round2(mNet),
			gross: round2(mGross),
			cpp: round2(mCPP),
			cpp2: round2(mCPP2),
			ei: round2(mEI),
			tax: round2(mTax),
			rrsp: round2(mRRSP)
		});
	}

	const totalAnnualNet = weeks.reduce((s, w) => s + w.net, 0);
	const earlyMonthly = (months[0].net + months[1].net + months[2].net) / 3;
	const lateMonthly = (months[9].net + months[10].net + months[11].net) / 3;

	return {
		weeks,
		months,
		cppMaxedWeek,
		cpp2MaxedWeek,
		eiMaxedWeek,
		totalCPP: cumCPP,
		totalCPP2: cumCPP2,
		totalEI: cumEI,
		federalTax,
		provincialTax,
		healthPremium,
		totalAnnualTax,
		totalAnnualNet,
		avgMonthlyNet: totalAnnualNet / 12,
		earlyMonthlyNet: earlyMonthly,
		lateMonthlyNet: lateMonthly,
		annualRRSP
	};
}
