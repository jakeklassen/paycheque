import type { ProvinceCode, RateConfig } from '#lib/types.js';
import { FALLBACK_CONFIG, PROVINCE_EXTRAS } from '#lib/constants.js';
import { fetchTaxBrackets } from './tax-brackets';
import { fetchCppRates } from './cpp-rates';
import { fetchEiRates } from './ei-rates';

/**
 * Scrape all CRA sources and assemble a complete RateConfig.
 *
 * - Tax brackets: CRA JSON API (all provinces except Quebec)
 * - CPP/CPP2: HTML tables with cheerio
 * - EI: HTML tables with cheerio (federal + Quebec rates)
 * - Personal amounts, surtaxes, health premiums: hardcoded in PROVINCE_EXTRAS
 */
export async function scrapeAllRates(year: number): Promise<RateConfig> {
	const [brackets, cppData, eiData] = await Promise.all([
		fetchTaxBrackets(year),
		fetchCppRates(year),
		fetchEiRates(year)
	]);

	// Build province configs: scraped brackets + hardcoded extras
	const provinces: Record<string, (typeof FALLBACK_CONFIG)['provinces'][string]> = {};

	for (const [code, scrapedBrackets] of Object.entries(brackets.provinces)) {
		const extras = PROVINCE_EXTRAS[code as ProvinceCode];
		if (!extras) continue;

		provinces[code] = {
			name: extras.name,
			brackets: scrapedBrackets,
			personalAmount: extras.personalAmount,
			surtax: extras.surtax,
			healthPremiumTiers: extras.healthPremiumTiers
		};
	}

	// Include provinces not available from scraper (Quebec, plus any fallback-only)
	for (const [code, fallbackProv] of Object.entries(FALLBACK_CONFIG.provinces)) {
		if (!provinces[code]) {
			provinces[code] = fallbackProv;
		}
	}

	return {
		year,
		cpp: cppData.cpp,
		cpp2: cppData.cpp2,
		ei: eiData.federal,
		eiQuebec: eiData.quebec,
		federalBrackets:
			brackets.federal.length > 0 ? brackets.federal : [...FALLBACK_CONFIG.federalBrackets],
		federalPersonal: FALLBACK_CONFIG.federalPersonal,
		provinces,
		meta: {
			lastUpdated: new Date().toISOString(),
			source: 'scrape',
			stale: false
		}
	};
}
