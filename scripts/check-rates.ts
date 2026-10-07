/**
 * Check the hand-maintained rates in src/lib/constants.ts, and the brackets the
 * scraper pulls from CRA's public tax-rates page, against CRA's T4127 Payroll
 * Deductions Formulas. CRA publishes a January and a July edition each year;
 * run this after each one comes out:
 *
 *   pnpm check:rates
 *
 * Exits with code 1 when anything needs updating.
 */
import { load, type CheerioAPI } from 'cheerio';
import {
	CANADA_EMPLOYMENT_AMOUNT,
	CPP_ENHANCED_RATE,
	FALLBACK_CONFIG,
	FALLBACK_PROVINCE_BRACKETS,
	PROVINCE_BRACKET_OVERRIDES,
	PROVINCE_EXTRAS,
	QUEBEC_ABATEMENT,
	YEAR
} from '../src/lib/constants.ts';
import { calcHealthPremium } from '../src/lib/tax.ts';
import { fetchTaxBrackets } from '../src/lib/server/scraper/tax-brackets.ts';
import { fetchWithTimeout } from '../src/lib/server/scraper/parse-utils.ts';
import type { ProvinceCode, RateConfig, TaxBracket } from '../src/lib/types.ts';

const T4127 =
	'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas';
const JAN_URL = `${T4127}/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html`;
const JUL_URL = `${T4127}/t4127-jul/t4127-jul-payroll-deductions-formulas.html`;

/**
 * The July edition's tables hold prorated July–December payroll values that
 * catch up for January–June. The app uses the annual values, so these known
 * differences are reported as expected rather than as mismatches. Keyed by
 * "<year>-<month> <check>"; each only applies while CRA shows exactly `cra`.
 */
const PRORATED_EXCEPTIONS: Record<string, { cra: number; note: string }> = {
	'2026-07 BC bracket 1 rate': { cra: 0.0614, note: 'prorated; the annual rate is 5.60%' },
	'2026-07 BC tax reduction basic amount': {
		cra: 805,
		note: 'prorated; the annual amount is $690'
	},
	'2026-07 NL basic personal amount': {
		cra: 15_000,
		note: 'prorated; the annual amount is $13,094'
	},
	'2026-07 PE bracket 6 rate': { cra: 0.21, note: 'prorated; the annual rate is 20%' }
};

const PROVINCES = (Object.keys(PROVINCE_EXTRAS) as ProvinceCode[]).filter((c) => c !== 'QC');

// ---------------------------------------------------------------------------
// Fetching and parsing
// ---------------------------------------------------------------------------

interface Edition {
	url: string;
	title: string;
	year: number;
	month: 1 | 7;
	$: CheerioAPI;
	/** Whole-page text with whitespace collapsed, for formula regexes */
	text: string;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Parse "$1,234.50", "0.0595", "142,520*" etc. Returns NaN for blanks and dashes. */
const num = (s: string | undefined) => (s ? parseFloat(s.replace(/[$,*\s]/g, '')) : NaN);

async function fetchEdition(url: string): Promise<Edition | null> {
	const res = await fetchWithTimeout(url).catch(() => null);
	if (res?.status !== 200) return null;
	const $ = load(res.body);
	const title = clean($('h1').first().text());
	const m = title.match(/Effective (January|July) 1, (\d{4})/);
	if (!m) return null;
	return {
		url,
		title,
		year: Number(m[2]),
		month: m[1] === 'January' ? 1 : 7,
		$,
		text: clean($('main').text())
	};
}

/** Rows of the first table whose caption starts with `caption` */
function table(ed: Edition, caption: string): string[][] {
	const { $ } = ed;
	const el = $('table')
		.filter((_, t) => clean($(t).find('caption').text()).startsWith(caption))
		.first();
	return el
		.find('tr')
		.toArray()
		.map((tr) =>
			$(tr)
				.find('th, td')
				.toArray()
				.map((c) => clean($(c).text()))
		);
}

interface CraBrackets {
	thresholds: number[];
	rates: number[];
}

/** Table 8.1: thresholds (A) and rates (R or V) per jurisdiction */
function parseRateTable(ed: Edition): Map<string, CraBrackets> {
	const out = new Map<string, CraBrackets>();
	let current: CraBrackets | null = null;
	for (const row of table(ed, 'Table 8.1 ')) {
		const values = (cells: string[]) => cells.filter((c) => c !== '').map(num);
		if (row[1] === 'A') {
			current = { thresholds: values(row.slice(2)), rates: [] };
			out.set(row[0], current);
		} else if (current && (row[0] === 'R' || row[0] === 'V')) {
			current.rates = values(row.slice(1));
		}
	}
	return out;
}

interface OtherAmounts {
	basic: string;
	cea: number;
	s2: number;
	abatement: number;
	surtax: { threshold: number; rate: number }[];
}

/** Table 8.2: basic amounts, CEA, tax reduction (S2), surtax and abatement */
function parseOtherTable(ed: Edition): Map<string, OtherAmounts> {
	const rows = table(ed, 'Table 8.2 ');
	const out = new Map<string, OtherAmounts>();
	if (rows.length === 0) return out;
	const col = (name: string) => rows[0].indexOf(name);
	const [iBasic, iCea, iS2, iT4, iV1, iAbate] = [
		'Basic amount',
		'CEA',
		'S2',
		'T4 to V1',
		'V1 rate',
		'Abatement'
	].map(col);
	let current: OtherAmounts | null = null;
	for (const row of rows.slice(1)) {
		const isJurisdiction = row[0] === 'Federal' || /^[A-Z]{2}$/.test(row[0]);
		if (isJurisdiction) {
			current = {
				basic: row[iBasic],
				cea: num(row[iCea]),
				s2: num(row[iS2]),
				abatement: num(row[iAbate]),
				surtax: [{ threshold: num(row[iT4]), rate: num(row[iV1]) }]
			};
			out.set(row[0], current);
		} else if (current && row[0] !== '' && !row[0].startsWith('Outside')) {
			// Continuation rows hold further surtax steps: "T4 to V1 | V1 rate"
			current.surtax.push({ threshold: num(row[0]), rate: num(row[1]) });
		}
	}
	for (const amounts of out.values()) {
		amounts.surtax = amounts.surtax.filter((s) => s.rate > 0);
	}
	return out;
}

/** "Where NI* ≤ $X, NAME = $Y" … "Where NI* ≥ $Z, NAME = $W" */
function parseBpaFormula(text: string, name: string) {
	const low = text.match(new RegExp(`Where NI\\* ≤ \\$([\\d,]+), ${name} = \\$([\\d,]+)`));
	const high = text.match(new RegExp(`Where NI\\* ≥ \\$([\\d,]+), ${name} = \\$([\\d,]+)`));
	return {
		amountMax: num(low?.[2]),
		start: num(low?.[1]),
		end: num(high?.[1]),
		amountMin: num(high?.[2])
	};
}

interface PremiumTier {
	start: number;
	cap: number;
	base: number;
	rate: number;
}

/** Ontario Health Premium (V2): "the lesser of: (i) $cap; (ii) $base + (rate × (A – $start))" */
function parseHealthPremium(text: string): PremiumTier[] {
	const block = text.slice(
		text.indexOf('V2 = Where A'),
		text.indexOf('The Ontario Health Premium (OHP) is not')
	);
	const tierPattern =
		/\(i\) \$([\d,]+); \(ii\) (?:\$([\d,]+) \+ \()?([\d.]+) × \(A – \$([\d,]+)\)/g;
	return [...block.matchAll(tierPattern)].map((m) => ({
		cap: num(m[1]),
		base: m[2] ? num(m[2]) : 0,
		rate: num(m[3]),
		start: num(m[4])
	}));
}

function evalPremium(tiers: PremiumTier[], income: number): number {
	const tier = tiers.findLast((t) => income > t.start);
	return tier ? Math.min(tier.cap, tier.base + tier.rate * (income - tier.start)) : 0;
}

// ---------------------------------------------------------------------------
// Comparison and reporting
// ---------------------------------------------------------------------------

interface Finding {
	section: string;
	item: string;
	code: string;
	cra: string;
	note?: string;
}

const passed = new Map<string, number>();
const mismatches: Finding[] = [];
const expected: Finding[] = [];
const notes: string[] = [];
let editionKey = '';

const money = (n: number) => `$${n.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`;
const pct = (r: number) => `${+(r * 100).toFixed(4)}%`;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function compare(
	section: string,
	item: string,
	code: number | undefined,
	cra: number,
	fmt: (n: number) => string = money
) {
	const codeText = code === undefined ? 'not in code' : fmt(code);
	if (Number.isNaN(cra)) {
		mismatches.push({
			section,
			item,
			code: codeText,
			cra: 'not found (has the CRA page changed?)'
		});
	} else if (code !== undefined && same(code, cra)) {
		passed.set(section, (passed.get(section) ?? 0) + 1);
	} else {
		const finding = { section, item, code: codeText, cra: fmt(cra) };
		const exception = PRORATED_EXCEPTIONS[`${editionKey} ${item}`];
		if (exception && same(exception.cra, cra)) expected.push({ ...finding, note: exception.note });
		else mismatches.push(finding);
	}
}

function compareBrackets(
	section: string,
	label: string,
	code: readonly TaxBracket[],
	cra: CraBrackets | undefined
) {
	if (!cra) {
		mismatches.push({ section, item: `${label} brackets`, code: describe(code), cra: 'not found' });
		return;
	}
	compare(section, `${label} bracket count`, code.length, cra.rates.length, String);
	for (let i = 0; i < Math.max(code.length, cra.rates.length); i++) {
		compare(section, `${label} bracket ${i + 1} from`, code[i]?.min, cra.thresholds[i] ?? NaN);
		compare(section, `${label} bracket ${i + 1} rate`, code[i]?.rate, cra.rates[i] ?? NaN, pct);
	}
}

const describe = (b: readonly TaxBracket[]) =>
	b.map((x) => `${pct(x.rate)} from ${money(x.min)}`).join(', ');

const bracketsEqual = (a: readonly TaxBracket[], b: readonly TaxBracket[]) =>
	a.length === b.length && a.every((x, i) => same(x.min, b[i].min) && same(x.rate, b[i].rate));

function row<T>(map: Map<string, T>, key: string, section: string): T | undefined {
	const value = map.get(key);
	if (!value) mismatches.push({ section, item: `${key} row`, code: '—', cra: 'not found' });
	return value;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function main() {
	const [jan, jul] = await Promise.all([fetchEdition(JAN_URL), fetchEdition(JUL_URL)]);
	if (!jan) {
		console.error(`Could not load the January T4127 edition:\n  ${JAN_URL}`);
		process.exit(1);
	}
	// The latest edition supplies the rate tables; formula text lives in the
	// January edition (July only reproduces the sections that changed).
	const latest = jul && jul.year === jan.year ? jul : jan;
	editionKey = `${latest.year}-${String(latest.month).padStart(2, '0')}`;

	console.log(`Rate tables: ${latest.title}\n  ${latest.url}`);
	if (latest !== jan) console.log(`Formulas:    ${jan.title}\n  ${jan.url}`);
	console.log();

	let yearBehind = false;
	if (latest.year > YEAR) {
		yearBehind = true;
		console.log(
			`⚠ CRA has published T4127 for ${latest.year}, but YEAR in src/lib/constants.ts is ${YEAR}.\n` +
				`  Bump YEAR and update the values flagged below.\n`
		);
	} else if (latest.year < YEAR) {
		console.log(
			`ℹ CRA hasn't published T4127 for ${YEAR} yet; comparing against ${latest.year}.\n`
		);
	}

	const rates = parseRateTable(latest);
	const other = parseOtherTable(latest);
	const formulas = jan.text;

	// Federal
	const fed = 'Federal';
	compareBrackets(fed, 'Federal', FALLBACK_CONFIG.federalBrackets, rates.get('Federal'));
	const bpaf = parseBpaFormula(formulas, 'BPAF');
	const fp = FALLBACK_CONFIG.federalPersonal;
	compare(fed, 'Federal basic personal amount', fp.amountMax, bpaf.amountMax);
	compare(fed, 'Federal basic personal amount minimum', fp.amountMin, bpaf.amountMin);
	compare(fed, 'Federal BPA clawback start', fp.clawbackStart, bpaf.start);
	compare(fed, 'Federal BPA clawback end', fp.clawbackEnd, bpaf.end);
	compare(
		fed,
		'Canada employment amount',
		CANADA_EMPLOYMENT_AMOUNT,
		row(other, 'Federal', fed)?.cea ?? NaN
	);
	compare(fed, 'Quebec abatement', QUEBEC_ABATEMENT, row(other, 'QC', fed)?.abatement ?? NaN, pct);

	// CPP / CPP2 / EI (scraped live; these are the fallback values)
	checkContributions(jan);

	// Provinces
	const bpamb = parseBpaFormula(formulas, 'BPAMB');
	const yukonMirrorsFederal = /BPAYT\s*=\s*BPAF/.test(formulas);
	for (const code of PROVINCES) {
		const extras = PROVINCE_EXTRAS[code];
		const amounts = row(other, code, 'Personal amounts');
		const section = 'Personal amounts';

		if (amounts?.basic === 'BPAMB') {
			compare(section, `${code} basic personal amount`, extras.personalAmount, bpamb.amountMax);
			compare(
				section,
				`${code} BPA minimum`,
				extras.personalAmountClawback?.amountMin,
				bpamb.amountMin
			);
			compare(
				section,
				`${code} BPA clawback start`,
				extras.personalAmountClawback?.start,
				bpamb.start
			);
			compare(section, `${code} BPA clawback end`, extras.personalAmountClawback?.end, bpamb.end);
		} else if (amounts?.basic === 'BPAYT') {
			if (!yukonMirrorsFederal) {
				mismatches.push({
					section,
					item: `${code} basic personal amount`,
					code: 'mirrors federal',
					cra: '"BPAYT = BPAF" not found; read the BPAYT formula'
				});
			}
			compare(section, `${code} basic personal amount`, extras.personalAmount, bpaf.amountMax);
			compare(
				section,
				`${code} BPA minimum`,
				extras.personalAmountClawback?.amountMin,
				bpaf.amountMin
			);
			compare(
				section,
				`${code} BPA clawback start`,
				extras.personalAmountClawback?.start,
				bpaf.start
			);
			compare(section, `${code} BPA clawback end`, extras.personalAmountClawback?.end, bpaf.end);
		} else if (amounts) {
			compare(section, `${code} basic personal amount`, extras.personalAmount, num(amounts.basic));
			if (extras.personalAmountClawback) {
				mismatches.push({
					section,
					item: `${code} BPA clawback`,
					code: 'has a clawback',
					cra: `flat ${amounts.basic}`
				});
			}
		}

		if (amounts) checkProvincialExtras(code, amounts, latest, jan);
		compareBrackets('Provincial brackets', code, FALLBACK_PROVINCE_BRACKETS[code], rates.get(code));
	}

	checkHealthPremium(formulas);
	await checkRatesPage(latest.year);
	report(yearBehind);
}

function checkContributions(jan: Edition) {
	const section = 'CPP / EI fallback';
	const { cpp, cpp2, ei, eiQuebec } = FALLBACK_CONFIG;
	const cppRow = table(jan, 'Table 8.3 ').find((r) => r[0].startsWith('CPP ('));
	compare(section, 'CPP YMPE', cpp.ympe, num(cppRow?.[1]));
	compare(section, 'CPP basic exemption', cpp.exemption, num(cppRow?.[2]));
	compare(section, 'CPP rate', cpp.rate, num(cppRow?.[4]), pct);
	compare(section, 'CPP maximum', cpp.maxEmployee, num(cppRow?.[5]));

	const enhancedRow = table(jan, 'Table 8.5 ').find((r) => r[0].startsWith('CPP ('));
	compare(section, 'Enhanced CPP rate', CPP_ENHANCED_RATE, num(enhancedRow?.[2]), pct);

	const cpp2Row = table(jan, 'Table 8.6 ').find((r) => r[0].startsWith('CPP ('));
	compare(section, 'CPP2 floor (YMPE)', cpp2.floor, num(cpp2Row?.[1]));
	compare(section, 'CPP2 ceiling (YAMPE)', cpp2.yampe, num(cpp2Row?.[2]));
	compare(section, 'CPP2 rate', cpp2.rate, num(cpp2Row?.[4]), pct);
	compare(section, 'CPP2 maximum', cpp2.maxEmployee, num(cpp2Row?.[5]));

	const eiRows = table(jan, 'Table 8.7 ');
	for (const [label, rates, prefix] of [
		['EI', ei, 'Canada'],
		['EI (Quebec)', eiQuebec, 'QC']
	] as const) {
		const r = eiRows.find((x) => x[0].startsWith(prefix));
		compare(section, `${label} maximum insurable earnings`, rates.mie, num(r?.[1]));
		compare(section, `${label} rate`, rates.rate, num(r?.[2]), pct);
		compare(section, `${label} maximum`, rates.maxEmployee, num(r?.[4]));
	}
}

function checkProvincialExtras(
	code: ProvinceCode,
	amounts: OtherAmounts,
	latest: Edition,
	jan: Edition
) {
	const extras = PROVINCE_EXTRAS[code];

	// Surtax
	const surtax = extras.surtax ?? [];
	compare('Surtax', `${code} surtax steps`, surtax.length, amounts.surtax.length, String);
	amounts.surtax.forEach((s, i) => {
		compare('Surtax', `${code} surtax ${i + 1} threshold`, surtax[i]?.threshold, s.threshold);
		compare('Surtax', `${code} surtax ${i + 1} rate`, surtax[i]?.rate, s.rate, pct);
	});

	// Canada employment amount (provincial K4P)
	compare('Credits', `${code} employment amount`, extras.employmentAmount ?? 0, amounts.cea || 0);

	// Low-income tax reduction (factor S)
	const reduction = extras.taxReduction;
	if (Number.isNaN(amounts.s2)) {
		if (reduction) {
			mismatches.push({
				section: 'Tax reductions',
				item: `${code} tax reduction`,
				code: `${money(reduction.basic)} basic`,
				cra: 'none in Table 8.2'
			});
		}
		return;
	}
	compare('Tax reductions', `${code} tax reduction basic amount`, reduction?.basic, amounts.s2);
	if (reduction?.kind === 'income-tested') {
		// "Where A ≤ $25,570, S is equal to the lesser of" … "(A – $25,570) × 3.56%"
		const text = latest.text.includes('S is equal to the lesser of') ? latest.text : jan.text;
		const threshold = text.match(/Where A ≤ \$([\d,]+), S is equal to the lesser of/);
		const rate = text.match(/\(A – \$[\d,]+\) × ([\d.]+)%/);
		compare(
			'Tax reductions',
			`${code} tax reduction threshold`,
			reduction.threshold,
			num(threshold?.[1])
		);
		compare(
			'Tax reductions',
			`${code} tax reduction rate`,
			reduction.rate,
			num(rate?.[1]) / 100,
			pct
		);
	}
}

function checkHealthPremium(formulas: string) {
	const section = 'Ontario Health Premium';
	const tiers = parseHealthPremium(formulas);
	if (tiers.length === 0) {
		mismatches.push({
			section,
			item: 'V2 formula',
			code: '—',
			cra: 'not found (has the CRA page changed?)'
		});
		return;
	}
	const config = { ...FALLBACK_CONFIG } as RateConfig;
	for (let income = 0; income <= 300_000; income += 50) {
		const code = calcHealthPremium(income, 'ON', config);
		const cra = evalPremium(tiers, income);
		if (Math.abs(code - cra) > 0.005) {
			compare(section, `premium at ${money(income)} taxable income`, code, cra);
			return;
		}
	}
	passed.set(section, 1);
}

/** Compare what the scraper serves (CRA's public rates page) with the verified brackets */
async function checkRatesPage(year: number) {
	const section = 'CRA rates page';
	const scraped = await fetchTaxBrackets(year).catch(() => null);
	if (!scraped || Object.keys(scraped.provinces).length === 0) {
		notes.push(
			`CRA's public rates page has no ${year} brackets yet; the app will use fallback data.`
		);
		return;
	}
	const pairs: [string, readonly TaxBracket[] | undefined, readonly TaxBracket[], boolean][] = [
		['Federal', scraped.federal, FALLBACK_CONFIG.federalBrackets, false],
		...PROVINCES.map(
			(code) =>
				[
					code,
					scraped.provinces[code],
					FALLBACK_PROVINCE_BRACKETS[code],
					code in PROVINCE_BRACKET_OVERRIDES
				] as [string, readonly TaxBracket[] | undefined, readonly TaxBracket[], boolean]
		)
	];
	for (const [label, live, verified, overridden] of pairs) {
		const matches = live !== undefined && bracketsEqual(live, verified);
		if (overridden) {
			if (matches)
				notes.push(
					`${label}: CRA's rates page now matches, so its PROVINCE_BRACKET_OVERRIDES entry can go.`
				);
			else passed.set(section, (passed.get(section) ?? 0) + 1);
		} else if (matches) {
			passed.set(section, (passed.get(section) ?? 0) + 1);
		} else {
			mismatches.push({
				section,
				item: `${label} brackets`,
				code: describe(verified),
				cra: live ? `rates page serves ${describe(live)}` : 'missing from rates page',
				note: 'add a PROVINCE_BRACKET_OVERRIDES entry so the app serves the T4127 brackets'
			});
		}
	}
}

function report(yearBehind: boolean) {
	const sections = [...new Set([...passed.keys(), ...mismatches.map((m) => m.section)])];
	for (const section of sections) {
		const failures = mismatches.filter((m) => m.section === section);
		const okCount = passed.get(section) ?? 0;
		console.log(
			`${failures.length ? '✗' : '✓'} ${section}: ${okCount} match${failures.length ? `, ${failures.length} to update` : ''}`
		);
		for (const f of failures) {
			console.log(
				`    ${f.item}: code ${f.code} · CRA ${f.cra}${f.note ? `\n      → ${f.note}` : ''}`
			);
		}
	}

	if (expected.length) {
		console.log('\nExpected differences (prorated July values):');
		for (const f of expected)
			console.log(`    ${f.item}: code ${f.code} · CRA ${f.cra} — ${f.note}`);
	}
	if (notes.length) {
		console.log('\nNotes:');
		for (const n of notes) console.log(`    ${n}`);
	}

	const qc = PROVINCE_EXTRAS.QC;
	const qcBrackets = PROVINCE_BRACKET_OVERRIDES.QC ?? [];
	console.log(
		`\nQuebec (manual check): CRA doesn't publish Quebec's provincial values.\n` +
			`  Each November, Québec Finance publishes "Parameters of the personal income tax system"\n` +
			`  for the coming year (search finances.gouv.qc.ca or quebec.ca). Update QC in\n` +
			`  PROVINCE_EXTRAS and PROVINCE_BRACKET_OVERRIDES. Currently in code (${YEAR}):\n` +
			`    basic personal amount ${money(qc.personalAmount)}\n` +
			`    brackets ${describe(qcBrackets)}\n` +
			`  ${YEAR} source: https://cdn-contenu.quebec.ca/cdn-contenu/adm/min/finances/publications-adm/parametres/AUTEN_IncomeTax${YEAR}.pdf`
	);

	const failed = mismatches.length > 0 || yearBehind;
	console.log(failed ? '\n✗ Rates need updating.' : '\n✓ All checked rates match T4127.');
	process.exit(failed ? 1 : 0);
}

await main();
