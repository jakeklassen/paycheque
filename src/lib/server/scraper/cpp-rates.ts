import { load } from 'cheerio';
import type { CppRates, Cpp2Rates } from '#lib/types.js';
import { fetchWithTimeout, parseDollar, parseRate } from './parse-utils';

const CPP_URL =
	'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html';
const CPP2_URL =
	'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/calculating-deductions/making-deductions/second-additional-cpp-contribution-rates-maximums.html';

/**
 * Parse CPP base table (#ajax-cpprate-tbl).
 * Columns: Year | YMPE | Exemption | Max contributory | Rate | Max employee | Max self-employed
 */
function parseCppTable(html: string, year: number): CppRates {
	const $ = load(html);
	const rows = $('table#ajax-cpprate-tbl tbody tr');

	for (let i = 0; i < rows.length; i++) {
		const cells = $(rows[i]).find('td');
		if (cells.length < 6) continue;

		const rowYear = parseInt($(cells[0]).text().trim(), 10);
		if (rowYear !== year) continue;

		return {
			ympe: parseDollar($(cells[1]).text()),
			exemption: parseDollar($(cells[2]).text()),
			rate: parseRate($(cells[4]).text()) / 100,
			maxEmployee: parseDollar($(cells[5]).text())
		};
	}

	throw new Error(`CPP data not found for year ${year}`);
}

/**
 * Parse CPP2 table (#ajax-cpprate2-tbl).
 * Columns: Year | YAMPE | Rate (with %) | Max employee | Max self-employed
 * Note: cells may contain stray <br> and &nbsp; — cheerio .text() handles this.
 */
function parseCpp2Table(html: string, year: number): Omit<Cpp2Rates, 'floor'> {
	const $ = load(html);
	const rows = $('table#ajax-cpprate2-tbl tbody tr');

	for (let i = 0; i < rows.length; i++) {
		const cells = $(rows[i]).find('td');
		if (cells.length < 4) continue;

		const rowYear = parseInt($(cells[0]).text().trim(), 10);
		if (rowYear !== year) continue;

		return {
			yampe: parseDollar($(cells[1]).text()),
			rate: parseRate($(cells[2]).text()) / 100,
			maxEmployee: parseDollar($(cells[3]).text())
		};
	}

	throw new Error(`CPP2 data not found for year ${year}`);
}

export async function fetchCppRates(year: number): Promise<{ cpp: CppRates; cpp2: Cpp2Rates }> {
	const [cppRes, cpp2Res] = await Promise.all([
		fetchWithTimeout(CPP_URL),
		fetchWithTimeout(CPP2_URL)
	]);

	if (cppRes.status !== 200) throw new Error(`CPP page returned ${cppRes.status}`);
	if (cpp2Res.status !== 200) throw new Error(`CPP2 page returned ${cpp2Res.status}`);

	const cpp = parseCppTable(cppRes.body, year);
	const cpp2Partial = parseCpp2Table(cpp2Res.body, year);

	return {
		cpp,
		cpp2: { ...cpp2Partial, floor: cpp.ympe }
	};
}
