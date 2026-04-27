import { load } from 'cheerio';
import type { EiRates } from '$lib/types';
import { fetchWithTimeout, parseDollar, parseRate } from './parse-utils';

const EI_URL =
	'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html';

/**
 * Parse an EI rate table.
 * Columns: Year | MIE | Rate (%) | Max employee premium | Max employer premium
 * Note: the newest year's cell may contain <span class="label label-info">New</span>.
 */
function parseEiTable(html: string, tableSelector: string, year: number): EiRates {
	const $ = load(html);
	const rows = $(`${tableSelector} tbody tr`);

	for (let i = 0; i < rows.length; i++) {
		const cells = $(rows[i]).find('td');
		if (cells.length < 4) continue;

		// Year cell might have "<span>New</span> 2026" — strip non-digits
		const yearText = $(cells[0]).text().replace(/\D/g, '');
		const rowYear = parseInt(yearText, 10);
		if (rowYear !== year) continue;

		return {
			mie: parseDollar($(cells[1]).text()),
			rate: parseRate($(cells[2]).text()) / 100,
			maxEmployee: parseDollar($(cells[3]).text())
		};
	}

	throw new Error(`EI data not found for year ${year} in table ${tableSelector}`);
}

export async function fetchEiRates(year: number): Promise<{ federal: EiRates; quebec: EiRates }> {
	const res = await fetchWithTimeout(EI_URL);
	if (res.status !== 200) throw new Error(`EI page returned ${res.status}`);

	return {
		federal: parseEiTable(res.body, '#tb1', year),
		quebec: parseEiTable(res.body, '#tb2', year)
	};
}
