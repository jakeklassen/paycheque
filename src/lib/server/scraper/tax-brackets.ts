import { load } from 'cheerio';
import type { ProvinceCode, TaxBracket } from '$lib/types';
import { NO_LIMIT } from '$lib/constants';
import { fetchWithTimeout } from './parse-utils';

const API_URL = 'https://www.canada.ca/api/assets/cra-arc/content-fragments/income-tax-rates.json';

/** Maps JSON API keys to province codes (Quebec excluded — uses Revenu Quebec) */
const JSON_KEY_TO_PROVINCE: Record<string, ProvinceCode> = {
	alberta: 'AB',
	britishColumbia: 'BC',
	manitoba: 'MB',
	newBrunswick: 'NB',
	newfoundlandAndLabrador: 'NL',
	novaScotia: 'NS',
	northwestTerritories: 'NT',
	nunavut: 'NU',
	ontario: 'ON',
	princeEdwardIsland: 'PE',
	saskatchewan: 'SK',
	yukon: 'YT'
};

/**
 * Parse bracket data from an HTML table fragment returned by the CRA JSON API.
 *
 * Each row has two cells:
 *   <td>14%</td>
 *   <td>on the portion of taxable income that is $58,523 or less, plus</td>
 *
 * Three patterns:
 *   - "or less"  → first bracket (min = 0, max = amount)
 *   - "up to"    → middle bracket (min = first $, max = second $)
 *   - neither    → last bracket (min = amount, max = NO_LIMIT)
 */
function parseBracketsFromHtml(html: string): TaxBracket[] {
	const $ = load(html);
	const brackets: TaxBracket[] = [];

	$('table tbody tr').each((_, row) => {
		const cells = $(row).find('td');
		if (cells.length < 2) return;

		const rateText = $(cells[0]).text().trim();
		const thresholdText = $(cells[1]).text().trim();

		const rate = parseFloat(rateText.replace('%', '')) / 100;
		if (isNaN(rate)) return;

		const amounts =
			thresholdText.match(/\$([\d,]+)/g)?.map((s) => parseFloat(s.replace(/[$,]/g, ''))) ?? [];

		if (thresholdText.includes('or less')) {
			brackets.push({ min: 0, max: amounts[0] ?? 0, rate });
		} else if (thresholdText.includes('up to')) {
			brackets.push({ min: amounts[0] ?? 0, max: amounts[1] ?? 0, rate });
		} else if (amounts.length > 0) {
			brackets.push({ min: amounts[0], max: NO_LIMIT, rate });
		}
	});

	return brackets;
}

export interface BracketResult {
	federal: TaxBracket[];
	provinces: Partial<Record<ProvinceCode, TaxBracket[]>>;
}

export async function fetchTaxBrackets(year: number): Promise<BracketResult> {
	const res = await fetchWithTimeout(API_URL);
	if (res.status !== 200) throw new Error(`Tax brackets API returned ${res.status}`);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const json = JSON.parse(res.body) as any;
	const elements = json?.properties?.elements;
	if (!elements) throw new Error('Unexpected tax brackets JSON structure');

	// Federal brackets
	const federalHtml = elements?.federalRates?.variations?.[String(year)]?.value;
	const federal = typeof federalHtml === 'string' ? parseBracketsFromHtml(federalHtml) : [];

	// Provincial brackets
	const provinces: Partial<Record<ProvinceCode, TaxBracket[]>> = {};
	for (const [jsonKey, code] of Object.entries(JSON_KEY_TO_PROVINCE)) {
		const html = elements?.[jsonKey]?.variations?.[String(year)]?.value;
		if (typeof html !== 'string') continue;
		const brackets = parseBracketsFromHtml(html);
		if (brackets.length > 0) provinces[code] = brackets;
	}

	return { federal, provinces };
}
