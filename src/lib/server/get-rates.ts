import type { PayFrequency, ProvinceCode, RateConfig } from '#lib/types.js';
import { FALLBACK_CONFIG, PAY_FREQUENCIES } from '#lib/constants.js';
import { readCache, writeCache } from './cache';
import { applyHandMaintainedRates, scrapeAllRates } from './scraper';

export interface SavedInputs {
	salary: number;
	rrsp: number;
	province: ProvinceCode;
	frequency: PayFrequency;
}

export interface LoaderData {
	config: RateConfig;
	savedInputs: SavedInputs | null;
}

function refreshInBackground(): void {
	scrapeAllRates(FALLBACK_CONFIG.year)
		.then((scraped) => writeCache(scraped))
		.catch((err) => console.error('[getRates] Background scrape failed:', err));
}

function parseSavedInputs(raw: string | undefined): SavedInputs | null {
	try {
		if (!raw) return null;
		const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<SavedInputs>;
		if (typeof parsed.salary !== 'number' || typeof parsed.rrsp !== 'number') return null;
		return {
			salary: parsed.salary,
			rrsp: parsed.rrsp,
			province: typeof parsed.province === 'string' ? (parsed.province as ProvinceCode) : 'ON',
			frequency:
				typeof parsed.frequency === 'string' && parsed.frequency in PAY_FREQUENCIES
					? parsed.frequency
					: 'biweekly'
		};
	} catch {
		return null;
	}
}

export async function getRates(cookieValue: string | undefined): Promise<LoaderData> {
	const savedInputs = parseSavedInputs(cookieValue);
	const cached = await readCache();

	// Fresh cache — return immediately
	if (cached?.fresh) {
		return { config: applyHandMaintainedRates(cached.config), savedInputs };
	}

	// Stale cache — return immediately, refresh in background
	if (cached) {
		refreshInBackground();
		return { config: applyHandMaintainedRates(cached.config), savedInputs };
	}

	// No cache at all — return fallback, scrape in background for next request
	refreshInBackground();
	return {
		config: applyHandMaintainedRates(JSON.parse(JSON.stringify(FALLBACK_CONFIG)) as RateConfig),
		savedInputs
	};
}
