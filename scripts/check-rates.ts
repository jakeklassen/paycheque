/**
 * Check the hand-maintained rates in src/lib/constants.ts, and the brackets the
 * scraper pulls from CRA's public tax-rates page, against CRA's T4127 Payroll
 * Deductions Formulas. CRA publishes a January and a July edition each year;
 * run this after each one comes out:
 *
 *   pnpm check:rates
 *
 * Exits with code 1 when anything needs updating or could not be verified.
 */
import { load, type CheerioAPI } from 'cheerio';
import {
	CANADA_EMPLOYMENT_AMOUNT,
	CPP_ENHANCED_RATE,
	FALLBACK_CONFIG,
	FALLBACK_PROVINCE_BRACKETS,
	NO_LIMIT,
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
 * catch up for January–June. The app uses annual values, so a difference is
 * expected only when CRA shows exactly `cra` AND the code holds exactly
 * `annual` (from the edition's "What's new" text). Keyed by
 * "<year>-<month> <check>".
 */
const PRORATED_EXCEPTIONS: Record<string, { cra: number; annual: number }> = {
	'2026-07 BC bracket 1 rate': { cra: 0.0614, annual: 0.056 },
	'2026-07 BC tax reduction basic amount': { cra: 805, annual: 690 },
	'2026-07 NL basic personal amount': { cra: 15_000, annual: 13_094 },
	'2026-07 PE bracket 6 rate': { cra: 0.21, annual: 0.2 }
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
	/** Text under each heading, keyed by lowercased heading (repeats concatenated) */
	sections: Map<string, string>;
	/** Text between each heading and the next, in document order */
	segments: Segment[];
}

interface Segment {
	/** Lowercased heading text */
	heading: string;
	level: number;
	text: string;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Parse "$1,234.50", "0.0595", "142,520*" etc. Returns NaN for blanks and dashes. */
const num = (s: string | undefined) => (s ? parseFloat(s.replace(/[$,*\s]/g, '')) : NaN);

async function fetchEdition(url: string): Promise<Edition> {
	const res = await fetchWithTimeout(url);
	if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
	const $ = load(res.body);
	const title = clean($('h1').first().text());
	const m = title.match(/Effective (January|July) 1, (\d{4})/);
	if (!m) throw new Error(`unrecognised page title "${title}"`);
	const segments = parseSegments($('main').html() ?? '');
	return {
		url,
		title,
		year: Number(m[2]),
		month: m[1] === 'January' ? 1 : 7,
		$,
		text: clean($('main').text()),
		sections: groupSections(segments),
		segments
	};
}

/**
 * Split the page at its h2–h5 headings. CRA wraps headings and their content
 * in separate divs, so this works on document order rather than siblings.
 */
function parseSegments(html: string): Segment[] {
	const headings = [...html.matchAll(/<h([2-5])[^>]*>([\s\S]*?)<\/h\1>/g)];
	return headings.map((h, i) => ({
		heading: clean(load(h[2]).text()).toLowerCase(),
		level: Number(h[1]),
		text: clean(
			load(html.slice(h.index + h[0].length, headings[i + 1]?.index ?? html.length)).text()
		)
	}));
}

/** A heading's section runs until the next heading of the same or higher level */
function groupSections(segments: Segment[]): Map<string, string> {
	const out = new Map<string, string>();
	segments.forEach((seg, i) => {
		const end = segments.findIndex((n, j) => j > i && n.level <= seg.level);
		const body = segments
			.slice(i, end === -1 ? undefined : end)
			.map((x) => x.text)
			.join(' ');
		out.set(seg.heading, `${out.get(seg.heading) ?? ''} ${body}`.trim());
	});
	return out;
}

/** Headings enclosing segment `i`: its own, then each earlier heading of a higher level */
function enclosingHeadings(segments: Segment[], i: number): string[] {
	const out = [segments[i].heading];
	let level = segments[i].level;
	for (let j = i - 1; j >= 0 && level > 2; j--) {
		if (segments[j].level < level) {
			out.push(segments[j].heading);
			level = segments[j].level;
		}
	}
	return out;
}

/** Rows of the first table whose caption starts with `caption` */
function table(ed: Edition, caption: string): string[][] {
	const { $ } = ed;
	const el = $('table')
		.filter((_, t) =>
			clean($(t).find('caption').text()).toLowerCase().startsWith(caption.toLowerCase())
		)
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
function parseRateTable(rows: string[][]): Map<string, CraBrackets> {
	const out = new Map<string, CraBrackets>();
	let current: CraBrackets | null = null;
	for (const row of rows) {
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
function parseOtherTable(rows: string[][]): Map<string, OtherAmounts> {
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

/** "Where NI* ≤ $X, NAME = $Y" … "Where NI* ≥ $Z, NAME = $W"; null unless fully parsed */
function parseBpaFormula(text: string, name: string) {
	const clause = (op: string) =>
		new RegExp(`Where NI\\*? ${op} \\$([\\d,]+), ${name}\\s*=\\s*\\$([\\d,]+)`, 'i');
	const low = text.match(clause('≤'));
	const high = text.match(clause('≥'));
	if (!low || !high) return null;
	return {
		amountMax: num(low[2]),
		start: num(low[1]),
		end: num(high[1]),
		amountMin: num(high[2])
	};
}

type ReductionFormula =
	| { kind: 'ontario'; multiplier: number }
	| { kind: 'income-tested'; threshold: number; rate: number };

/** Which factor S formula a province section uses, with its threshold and rate */
function parseReduction(text: string): ReductionFormula | null {
	const incomeTested = text.match(/Where A ≤ \$([\d,]+), S is equal to the lesser of/i);
	if (incomeTested) {
		const rate = text.match(/\(A – \$[\d,]+\) × ([\d.]+)%/);
		return {
			kind: 'income-tested',
			threshold: num(incomeTested[1]),
			rate: num(rate?.[1]) / 100
		};
	}
	const ontario = text.match(/\[(\d+) × \(\$[\d,]+ \+ Y\)\]/i);
	if (ontario) return { kind: 'ontario', multiplier: num(ontario[1]) };
	return null;
}

interface PremiumTier {
	start: number;
	cap: number;
	base: number;
	rate: number;
}

/** Ontario Health Premium (V2): "the lesser of: (i) $cap; (ii) $base + (rate × (A – $start))" */
function parseHealthPremium(text: string): PremiumTier[] {
	const from = text.search(/V2\s*=\s*Where A/i);
	if (from === -1) return [];
	const to = text.slice(from).search(/Note:/i);
	const block = to === -1 ? text.slice(from) : text.slice(from, from + to);
	const tierPattern =
		/\(i\) \$([\d,]+); \(ii\) (?:\$([\d,]+) \+ \()?([\d.]+) × \(A – \$([\d,]+)\)/gi;
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
const unverified: string[] = [];
const notes: string[] = [];
let editionKey = '';

const money = (n: number) =>
	n >= NO_LIMIT ? 'no limit' : `$${n.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`;
const pct = (r: number) => `${+(r * 100).toFixed(4)}%`;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const pass = (section: string) => passed.set(section, (passed.get(section) ?? 0) + 1);

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
		return;
	}
	const finding = { section, item, code: codeText, cra: fmt(cra) };
	const exception = PRORATED_EXCEPTIONS[`${editionKey} ${item}`];
	if (exception && same(exception.cra, cra)) {
		// CRA shows the prorated payroll value; the code must hold the annual one
		if (code !== undefined && same(code, exception.annual)) {
			expected.push({ ...finding, note: `prorated; the annual value is ${fmt(exception.annual)}` });
		} else {
			mismatches.push({
				...finding,
				note: `CRA's value is prorated; the code should hold the annual ${fmt(exception.annual)}`
			});
		}
	} else if (code !== undefined && same(code, cra)) {
		pass(section);
	} else {
		mismatches.push(finding);
	}
}

const describe = (b: readonly TaxBracket[]) =>
	b
		.map((x) => `${pct(x.rate)} ${money(x.min)}–${x.max >= NO_LIMIT ? '' : money(x.max)}`)
		.join(', ');

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
		compare(
			section,
			`${label} bracket ${i + 1} to`,
			code[i]?.max,
			cra.thresholds[i + 1] ?? NO_LIMIT
		);
		compare(section, `${label} bracket ${i + 1} rate`, code[i]?.rate, cra.rates[i] ?? NaN, pct);
	}
}

const bracketsEqual = (a: readonly TaxBracket[], b: readonly TaxBracket[]) =>
	a.length === b.length &&
	a.every((x, i) => same(x.min, b[i].min) && same(x.max, b[i].max) && same(x.rate, b[i].rate));

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Reads prefer the latest edition and fall back to January for sections July doesn't reprint */
class Sources {
	constructor(
		readonly latest: Edition,
		readonly jan: Edition
	) {}

	get editions() {
		return this.latest === this.jan ? [this.jan] : [this.latest, this.jan];
	}

	table(caption: string): string[][] {
		for (const ed of this.editions) {
			const rows = table(ed, caption);
			if (rows.length > 0) return rows;
		}
		return [];
	}

	/**
	 * Find a formula in the latest edition that contains it, falling back to
	 * January only when the latest edition doesn't reprint it. Once an edition
	 * contains the formula its version is authoritative: if it can't be parsed,
	 * that's recorded as unverified rather than falling back.
	 *
	 * @param locate the text holding the formula, or null if the edition lacks it
	 * @returns the parsed formula; null if present but unparsable; undefined if absent
	 */
	formula<T>(
		label: string,
		locate: (ed: Edition) => string | null,
		parse: (text: string) => T | null
	): T | null | undefined {
		for (const ed of this.editions) {
			const text = locate(ed);
			if (text === null) continue;
			const parsed = parse(text);
			if (parsed === null) unverified.push(`${label} in ${ed.title} (present but not parsable)`);
			return parsed;
		}
		return undefined;
	}
}

/** An edition's whole text, if it defines `name` anywhere (any case, any heading) */
function definedIn(ed: Edition, name: string): string | null {
	return new RegExp(`\\b${name}\\s*\\**\\s*=`, 'i').test(ed.text) || hasFormulaHeading(ed, name)
		? ed.text
		: null;
}

/** A heading like "Federal Basic Personal Amount (BPAF) Formula", in any case */
function hasFormulaHeading(ed: Edition, name: string): boolean {
	const tag = `(${name.toLowerCase()})`;
	return ed.segments.some((seg) => seg.heading.includes(tag) && seg.heading.includes('formula'));
}

/** A province's own section, when it defines `marker` */
function provinceSection(ed: Edition, name: string, marker: RegExp): string | null {
	const text = ed.sections.get(name.toLowerCase());
	return text && marker.test(text) ? text : null;
}

/** A required basic personal amount formula; missing from every edition is unverified too */
function bpaFormula(src: Sources, name: string) {
	const label = `${name} formula`;
	const formula = src.formula(
		label,
		(ed) => definedIn(ed, name),
		(t) => parseBpaFormula(t, name)
	);
	if (formula === undefined) unverified.push(`${label} (not found in any edition)`);
	return formula ?? { amountMax: NaN, amountMin: NaN, start: NaN, end: NaN };
}

/** Text of each innermost element that defines BPAYT, one per line */
function yukonRules(ed: Edition): string | null {
	const { $ } = ed;
	const defines = (el: Parameters<typeof $>[0]) => /\bBPAYT\s*=/i.test($(el).text());
	const rules = $('main *')
		.filter(
			(_, el) =>
				defines(el) &&
				$(el)
					.children()
					.filter((_, c) => defines(c)).length === 0
		)
		.toArray()
		.map((el) => clean($(el).text()));
	if (rules.length > 0) return rules.join('\n');
	// A BPAYT formula heading without a recognisable rule must not fall back to January
	return hasFormulaHeading(ed, 'BPAYT') ? '' : null;
}

const FACTOR_S = /(?:^|\s)S\s*=/i;

/** Factor S formulas must sit under a recognised province heading to be checked */
function checkReductionAttribution(src: Sources) {
	const provinces = new Set(PROVINCES.map((c) => PROVINCE_EXTRAS[c].name.toLowerCase()));
	for (const ed of src.editions) {
		ed.segments.forEach((seg, i) => {
			if (!FACTOR_S.test(seg.text)) return;
			if (enclosingHeadings(ed.segments, i).some((h) => provinces.has(h))) return;
			unverified.push(
				`a factor S formula under "${seg.heading}" in ${ed.title} (no province heading)`
			);
		});
	}
}

async function main() {
	let jan: Edition;
	try {
		jan = await fetchEdition(JAN_URL);
	} catch (err) {
		console.error(
			`Could not load the January T4127 edition (${(err as Error).message}):\n  ${JAN_URL}`
		);
		process.exit(1);
	}
	let jul: Edition | null = null;
	try {
		jul = await fetchEdition(JUL_URL);
	} catch (err) {
		unverified.push(
			`July T4127 edition (${(err as Error).message}); mid-year changes were not checked`
		);
	}

	// Before July, the July URL still holds last year's edition
	const latest = jul && jul.year === jan.year ? jul : jan;
	const src = new Sources(latest, jan);
	editionKey = `${latest.year}-${String(latest.month).padStart(2, '0')}`;

	console.log(`Rate tables: ${latest.title}\n  ${latest.url}`);
	if (latest !== jan) console.log(`Also:        ${jan.title}\n  ${jan.url}`);
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

	const rates = parseRateTable(src.table('Table 8.1 '));
	const other = parseOtherTable(src.table('Table 8.2 '));
	const otherRow = (key: string, section: string) => {
		const value = other.get(key);
		if (!value) mismatches.push({ section, item: `${key} row`, code: '—', cra: 'not found' });
		return value;
	};

	// Federal
	const fed = 'Federal';
	compareBrackets(fed, 'Federal', FALLBACK_CONFIG.federalBrackets, rates.get('Federal'));
	const bpaf = bpaFormula(src, 'BPAF');
	const fp = FALLBACK_CONFIG.federalPersonal;
	compare(fed, 'Federal basic personal amount', fp.amountMax, bpaf.amountMax);
	compare(fed, 'Federal basic personal amount minimum', fp.amountMin, bpaf.amountMin);
	compare(fed, 'Federal BPA clawback start', fp.clawbackStart, bpaf.start);
	compare(fed, 'Federal BPA clawback end', fp.clawbackEnd, bpaf.end);
	compare(
		fed,
		'Canada employment amount',
		CANADA_EMPLOYMENT_AMOUNT,
		otherRow('Federal', fed)?.cea ?? NaN
	);
	compare(fed, 'Quebec abatement', QUEBEC_ABATEMENT, otherRow('QC', fed)?.abatement ?? NaN, pct);

	// CPP / CPP2 / EI (scraped live; these are the fallback values)
	checkContributions(src);

	// Provinces
	const bpamb = bpaFormula(src, 'BPAMB');
	// The latest edition that defines BPAYT decides whether it still mirrors BPAF
	const yukonMirrorsFederal = src.formula(
		'BPAYT formula',
		yukonRules,
		// Every BPAYT rule must be exactly the equality the app implements
		(rules) => rules.split('\n').every((r) => /^BPAYT\s*=\s*BPAF$/i.test(r))
	);
	for (const code of PROVINCES) {
		const extras = PROVINCE_EXTRAS[code];
		const section = 'Personal amounts';
		const amounts = otherRow(code, section);
		const clawback = extras.personalAmountClawback;

		if (amounts?.basic === 'BPAMB' || amounts?.basic === 'BPAYT') {
			const formula = amounts.basic === 'BPAMB' ? bpamb : bpaf;
			if (amounts.basic === 'BPAYT' && yukonMirrorsFederal !== true) {
				mismatches.push({
					section,
					item: `${code} basic personal amount`,
					code: 'mirrors federal',
					cra: '"BPAYT = BPAF" is not in the latest BPAYT formula; read it and update YT'
				});
			}
			compare(section, `${code} basic personal amount`, extras.personalAmount, formula.amountMax);
			compare(section, `${code} BPA minimum`, clawback?.amountMin, formula.amountMin);
			compare(section, `${code} BPA clawback start`, clawback?.start, formula.start);
			compare(section, `${code} BPA clawback end`, clawback?.end, formula.end);
		} else if (amounts) {
			compare(section, `${code} basic personal amount`, extras.personalAmount, num(amounts.basic));
			if (clawback) {
				mismatches.push({
					section,
					item: `${code} BPA clawback`,
					code: 'has a clawback',
					cra: `flat ${amounts.basic}`
				});
			}
		}

		if (amounts) checkProvincialExtras(src, code, amounts);
		compareBrackets('Provincial brackets', code, FALLBACK_PROVINCE_BRACKETS[code], rates.get(code));
	}

	checkReductionAttribution(src);
	checkHealthPremium(src);
	await checkRatesPage(latest.year);
	report(yearBehind);
}

function checkContributions(src: Sources) {
	const section = 'CPP / EI fallback';
	const { cpp, cpp2, ei, eiQuebec } = FALLBACK_CONFIG;
	const cppRow = src.table('Table 8.3 ').find((r) => r[0].startsWith('CPP ('));
	compare(section, 'CPP YMPE', cpp.ympe, num(cppRow?.[1]));
	compare(section, 'CPP basic exemption', cpp.exemption, num(cppRow?.[2]));
	compare(section, 'CPP rate', cpp.rate, num(cppRow?.[4]), pct);
	compare(section, 'CPP maximum', cpp.maxEmployee, num(cppRow?.[5]));

	const enhancedRow = src.table('Table 8.5 ').find((r) => r[0].startsWith('CPP ('));
	compare(section, 'Enhanced CPP rate', CPP_ENHANCED_RATE, num(enhancedRow?.[2]), pct);

	const cpp2Row = src.table('Table 8.6 ').find((r) => r[0].startsWith('CPP ('));
	compare(section, 'CPP2 floor (YMPE)', cpp2.floor, num(cpp2Row?.[1]));
	compare(section, 'CPP2 ceiling (YAMPE)', cpp2.yampe, num(cpp2Row?.[2]));
	compare(section, 'CPP2 rate', cpp2.rate, num(cpp2Row?.[4]), pct);
	compare(section, 'CPP2 maximum', cpp2.maxEmployee, num(cpp2Row?.[5]));

	const eiRows = src.table('Table 8.7 ');
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

function checkProvincialExtras(src: Sources, code: ProvinceCode, amounts: OtherAmounts) {
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

	// Low-income tax reduction (factor S): formula kind from the province's own
	// section, basic amount from Table 8.2 (S2)
	const section = 'Tax reductions';
	const reduction = extras.taxReduction;
	const formula = src.formula(
		`${code} tax reduction (factor S)`,
		(ed) => provinceSection(ed, extras.name, FACTOR_S),
		parseReduction
	);
	if (formula === null) return; // present but not parsable: already unverified
	if (formula === undefined && Number.isNaN(amounts.s2)) {
		if (reduction) {
			mismatches.push({
				section,
				item: `${code} tax reduction`,
				code: reduction.kind,
				cra: 'none in T4127'
			});
		} else {
			pass(section);
		}
		return;
	}
	if (!formula) {
		mismatches.push({
			section,
			item: `${code} tax reduction formula`,
			code: reduction?.kind ?? 'none',
			cra: `S2 of ${money(amounts.s2)} but no factor S formula found (has the CRA page changed?)`
		});
		return;
	}
	if (reduction?.kind !== formula.kind) {
		mismatches.push({
			section,
			item: `${code} tax reduction formula`,
			code: reduction?.kind ?? 'none',
			cra: formula.kind
		});
		return;
	}
	pass(section);
	compare(section, `${code} tax reduction basic amount`, reduction.basic, amounts.s2);
	if (formula.kind === 'ontario') {
		// calcTaxReduction applies the ontario kind as 2 × basic
		compare(section, `${code} tax reduction multiplier`, 2, formula.multiplier, String);
	}
	if (reduction.kind === 'income-tested' && formula.kind === 'income-tested') {
		compare(section, `${code} tax reduction threshold`, reduction.threshold, formula.threshold);
		compare(section, `${code} tax reduction rate`, reduction.rate, formula.rate, pct);
	}
}

function checkHealthPremium(src: Sources) {
	const section = 'Ontario Health Premium';
	const tiers = src.formula(
		'Ontario Health Premium (V2) formula',
		(ed) => definedIn(ed, 'V2'),
		(t) => {
			const parsed = parseHealthPremium(t);
			return parsed.length > 0 ? parsed : null;
		}
	);
	if (tiers === undefined) {
		unverified.push('Ontario Health Premium (V2) formula (not found in any edition)');
	}
	if (!tiers) return;
	const config = { ...FALLBACK_CONFIG } as RateConfig;
	for (let income = 0; income <= 300_000; income += 50) {
		const code = calcHealthPremium(income, 'ON', config);
		const cra = evalPremium(tiers, income);
		if (Math.abs(code - cra) > 0.005) {
			compare(section, `premium at ${money(income)} taxable income`, code, cra);
			return;
		}
	}
	pass(section);
}

/** Compare what the scraper serves (CRA's public rates page) with the verified brackets */
async function checkRatesPage(year: number) {
	const section = 'CRA rates page';
	let scraped: Awaited<ReturnType<typeof fetchTaxBrackets>>;
	try {
		scraped = await fetchTaxBrackets(year);
	} catch (err) {
		unverified.push(`CRA's public rates page (${(err as Error).message})`);
		return;
	}
	// Federal brackets are still checked when the page has no provincial ones yet
	if (Object.keys(scraped.provinces).length === 0) {
		notes.push(`CRA's public rates page has no ${year} provincial brackets yet.`);
	}
	if (scraped.federal.length === 0) {
		notes.push(`CRA's public rates page has no ${year} federal brackets yet.`);
	}
	type Pair = [string, readonly TaxBracket[] | undefined, readonly TaxBracket[], boolean];
	const pairs: Pair[] = [];
	if (scraped.federal.length > 0) {
		pairs.push(['Federal', scraped.federal, FALLBACK_CONFIG.federalBrackets, false]);
	}
	if (Object.keys(scraped.provinces).length > 0) {
		for (const code of PROVINCES) {
			pairs.push([
				code,
				scraped.provinces[code],
				FALLBACK_PROVINCE_BRACKETS[code],
				code in PROVINCE_BRACKET_OVERRIDES
			]);
		}
	}
	for (const [label, live, verified, overridden] of pairs) {
		const matches = live !== undefined && bracketsEqual(live, verified);
		if (overridden && matches) {
			notes.push(
				`${label}: CRA's rates page now matches, so its PROVINCE_BRACKET_OVERRIDES entry can go.`
			);
		} else if (overridden || matches) {
			pass(section);
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

	if (unverified.length) {
		console.log('\n✗ Could not verify:');
		for (const u of unverified) console.log(`    ${u}`);
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

	const failed = mismatches.length > 0 || unverified.length > 0 || yearBehind;
	if (failed) {
		console.log(
			unverified.length && !mismatches.length
				? '\n✗ Some rates could not be verified.'
				: '\n✗ Rates need updating.'
		);
	} else {
		console.log('\n✓ All checked rates match T4127.');
	}
	process.exit(failed ? 1 : 0);
}

await main();
