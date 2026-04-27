import type { HealthPremiumTier, RateConfig, TaxBracket } from './types';

export function calcBracketTax(taxableIncome: number, brackets: readonly TaxBracket[]): number {
	let tax = 0;
	for (const b of brackets) {
		if (taxableIncome <= b.min) break;
		tax += (Math.min(taxableIncome, b.max) - b.min) * b.rate;
	}
	return tax;
}

export function calcFederalTax(taxableIncome: number, config: RateConfig): number {
	const basicTax = calcBracketTax(taxableIncome, config.federalBrackets);
	const fp = config.federalPersonal;

	let personalAmount = fp.amountMax;
	if (taxableIncome > fp.clawbackStart) {
		const extra = fp.amountMax - fp.amountMin;
		const clawbackRange = fp.clawbackEnd - fp.clawbackStart;
		const reduction = Math.min(extra, (extra * (taxableIncome - fp.clawbackStart)) / clawbackRange);
		personalAmount = fp.amountMax - reduction;
	}
	const personalCredit = personalAmount * config.federalBrackets[0].rate;

	return Math.max(0, basicTax - personalCredit);
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

export function calcProvincialTax(
	taxableIncome: number,
	province: string,
	config: RateConfig
): number {
	const prov = config.provinces[province];
	if (!prov) return 0;

	const basicTax = calcBracketTax(taxableIncome, prov.brackets);
	const personalCredit = prov.personalAmount * prov.brackets[0].rate;
	let provTax = Math.max(0, basicTax - personalCredit);

	if (prov.surtax) {
		let surtax = 0;
		for (const s of prov.surtax) {
			if (provTax > s.threshold) {
				surtax += (provTax - s.threshold) * s.rate;
			}
		}
		provTax += surtax;
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
