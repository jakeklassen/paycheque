import type {
	HealthPremiumTier,
	PersonalAmountClawback,
	RateConfig,
	TaxBracket,
	TaxCredits,
	TaxReduction
} from './types';
import { CANADA_EMPLOYMENT_AMOUNT, QUEBEC_ABATEMENT } from './constants';

export function calcBracketTax(taxableIncome: number, brackets: readonly TaxBracket[]): number {
	let tax = 0;
	for (const b of brackets) {
		if (taxableIncome <= b.min) break;
		tax += (Math.min(taxableIncome, b.max) - b.min) * b.rate;
	}
	return tax;
}

function reducedPersonalAmount(
	income: number,
	amountMax: number,
	clawback: PersonalAmountClawback | undefined
): number {
	if (!clawback || income <= clawback.start) return amountMax;
	const extra = amountMax - clawback.amountMin;
	const fraction = Math.min(1, (income - clawback.start) / (clawback.end - clawback.start));
	return amountMax - extra * fraction;
}

export function calcFederalTax(
	taxableIncome: number,
	province: string,
	credits: TaxCredits,
	config: RateConfig
): number {
	const basicTax = calcBracketTax(taxableIncome, config.federalBrackets);
	const fp = config.federalPersonal;

	const personalAmount = reducedPersonalAmount(taxableIncome, fp.amountMax, {
		amountMin: fp.amountMin,
		start: fp.clawbackStart,
		end: fp.clawbackEnd
	});
	const employmentAmount = Math.min(CANADA_EMPLOYMENT_AMOUNT, credits.employmentIncome);
	const creditBase = personalAmount + credits.cppBase + credits.ei + employmentAmount;
	const nonRefundableCredits = creditBase * config.federalBrackets[0].rate;
	const fedTax = Math.max(0, basicTax - nonRefundableCredits);

	return province === 'QC' ? fedTax * (1 - QUEBEC_ABATEMENT) : fedTax;
}

function calcHealthPremiumFromTiers(income: number, tiers: readonly HealthPremiumTier[]): number {
	for (const tier of tiers) {
		if (income <= tier.upTo) {
			if (tier.marginalRate > 0) {
				return tier.flat + Math.max(0, income - tier.marginalBase) * tier.marginalRate;
			}
			return tier.flat;
		}
	}
	return tiers[tiers.length - 1].flat;
}

/** Low-income tax reduction (T4127 factor S), for filers with no dependants */
function calcTaxReduction(provTax: number, taxableIncome: number, r: TaxReduction): number {
	const limit =
		r.kind === 'ontario'
			? 2 * r.basic - provTax
			: r.basic - Math.max(0, taxableIncome - r.threshold) * r.rate;
	return Math.min(provTax, Math.max(0, limit));
}

export function calcProvincialTax(
	taxableIncome: number,
	province: string,
	credits: TaxCredits,
	config: RateConfig
): number {
	const prov = config.provinces[province];
	if (!prov) return 0;

	const basicTax = calcBracketTax(taxableIncome, prov.brackets);
	// Quebec has no provincial credit for QPP/EI contributions
	const contributionAmounts = province === 'QC' ? 0 : credits.cppBase + credits.ei;
	const personalAmount = reducedPersonalAmount(
		taxableIncome,
		prov.personalAmount,
		prov.personalAmountClawback
	);
	const employmentAmount = prov.employmentAmount
		? Math.min(prov.employmentAmount, credits.employmentIncome)
		: 0;
	const creditBase = personalAmount + contributionAmounts + employmentAmount;
	let provTax = Math.max(0, basicTax - creditBase * prov.brackets[0].rate);

	if (prov.surtax) {
		let surtax = 0;
		for (const s of prov.surtax) {
			if (provTax > s.threshold) {
				surtax += (provTax - s.threshold) * s.rate;
			}
		}
		provTax += surtax;
	}

	if (prov.taxReduction) {
		provTax -= calcTaxReduction(provTax, taxableIncome, prov.taxReduction);
	}

	return provTax;
}

export function calcHealthPremium(
	taxableIncome: number,
	province: string,
	config: RateConfig
): number {
	const prov = config.provinces[province];
	if (!prov?.healthPremiumTiers?.length) return 0;
	return calcHealthPremiumFromTiers(taxableIncome, prov.healthPremiumTiers);
}
