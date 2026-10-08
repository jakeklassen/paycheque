/**
 * Check src/lib/rates.json against CRA's T4127 Payroll Deductions Formulas.
 * CRA publishes a January and a July edition each year:
 *
 *   pnpm check:rates                      report differences
 *   pnpm check:rates --write              also update rates.json where it can
 *   pnpm check:rates --report report.md   also write a markdown summary
 *
 * --write only takes values from a January edition. July editions show
 * prorated July–December payroll values rather than annual ones, so their
 * differences are left for a person to resolve.
 *
 * Exit codes: 0 nothing left to do (after any --write), 1 something needs a
 * person, 2 CRA could not be reached, 3 the check itself failed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { parseArgs } from 'node:util';
import { load, type CheerioAPI } from 'cheerio';
import { format, resolveConfig } from 'prettier';
import { NO_LIMIT, PROVINCE_NAMES } from '../src/lib/constants.ts';
import type { BracketRow, ProvinceCode, RatesData } from '../src/lib/types.ts';

// An unexpected error means the check itself failed (3), not that rates need a person (1).
// Errors loading the modules (rates.json unreadable, say) happen before this and exit 1.
process.on('uncaughtException', (err) => {
	console.error(err);
	process.exit(3);
});

const T4127 =
	'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas';
const JAN_URL = `${T4127}/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html`;
const JUL_URL = `${T4127}/t4127-jul/t4127-jul-payroll-deductions-formulas.html`;
const QUEBEC_URL = (year: number) =>
	`https://cdn-contenu.quebec.ca/cdn-contenu/adm/min/finances/publications-adm/parametres/AUTEN_IncomeTax${year}.pdf`;

/**
 * The July edition's tables hold prorated July–December payroll values that
 * catch up for January–June. The app uses annual values, so a difference is
 * expected only when CRA shows exactly `cra` AND rates.json holds exactly
 * `annual` (from the edition's "What's new" text). Keyed by
 * "<year>-<month> <check>".
 */
const PRORATED_EXCEPTIONS: Record<string, { cra: number; annual: number }> = {
	'2026-07 BC bracket 1 rate': { cra: 0.0614, annual: 0.056 },
	'2026-07 BC tax reduction basic amount': { cra: 805, annual: 690 },
	'2026-07 NL basic personal amount': { cra: 15_000, annual: 13_094 },
	'2026-07 PE bracket 6 rate': { cra: 0.21, annual: 0.2 }
};

/**
 * Mid-year changes already in rates.json that the edition being checked
 * doesn't have yet: a change announced after the January edition, say, until
 * the July edition shows it. Differences in these are expected, and --write
 * leaves them alone. Keyed by "<year>-<month> <name>", where the name is an
 * item as the report names it ("NL basic personal amount"), the start of
 * several ("BC tax reduction" covers each of its items) or a set replaced as a
 * whole ("PE brackets", "ON health premium"). The value says what changed.
 */
const MID_YEAR_CHANGES: Record<string, string> = {};

const PROVINCES = (Object.keys(PROVINCE_NAMES) as ProvinceCode[]).filter((c) => c !== 'QC');

const RATES_FILE = new URL('../src/lib/rates.json', import.meta.url);
const current = JSON.parse(readFileSync(RATES_FILE, 'utf8')) as RatesData;

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
/** What rates.json becomes with --write */
const proposed = structuredClone(current) as Mutable<RatesData>;

const args = parseArgs({
	options: { write: { type: 'boolean', default: false }, report: { type: 'string' } }
}).values;

// ---------------------------------------------------------------------------
// Fetching and parsing
// ---------------------------------------------------------------------------

const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 20_000;

/** CRA couldn't be reached, as opposed to a page that changed shape */
class NetworkError extends Error {}

/**
 * Fetch with node:https rather than fetch: Canada.ca's Akamai CDN blocks
 * undici's TLS fingerprint. Follows redirects within the same host; any other
 * non-200 response means the page has moved, which needs a person.
 */
function fetchPage(url: string, redirects = 5): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = httpsGet(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
			const status = res.statusCode ?? 0;
			const location = res.headers.location;
			if (status !== 200) {
				res.resume();
				const next = location ? new URL(location, url) : null;
				if (status >= 300 && status < 400 && next?.host === new URL(url).host && redirects > 0) {
					resolve(fetchPage(next.href, redirects - 1));
				} else if (status >= 500 || status === 429) {
					reject(new NetworkError(`HTTP ${status}`));
				} else {
					reject(new Error(`HTTP ${status}${next ? ` to ${next.href}` : ''}; has the page moved?`));
				}
				return;
			}
			// Decode as a stream so a character split across chunks stays intact
			res.setEncoding('utf8');
			let data = '';
			res.on('data', (chunk: string) => (data += chunk));
			res.on('end', () => resolve(data));
			res.on('error', (err) => reject(new NetworkError(err.message)));
			res.on('close', () => {
				if (!res.complete) reject(new NetworkError('connection closed mid-download'));
			});
		});
		req.on('error', (err) => reject(new NetworkError(err.message)));
		req.setTimeout(FETCH_TIMEOUT_MS, () => {
			req.destroy(new Error(`timed out after ${FETCH_TIMEOUT_MS}ms`));
		});
	});
}

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

/**
 * Parse "$1,234.50", "0.0595", "142,520*" etc. Returns NaN for blanks, dashes
 * and anything else that isn't wholly a number ("3OO" isn't 3).
 */
const num = (s: string | undefined) => {
	const digits = s?.replace(/[$,*\s]/g, '');
	return digits ? Number(digits) : NaN;
};

/** A table cell's number: null when blank or a dash, NaN when unreadable or the column is missing */
const cell = (s: string | undefined) =>
	s === undefined ? NaN : /^[\s–—-]*$/.test(s) ? null : num(s);

async function fetchEdition(url: string): Promise<Edition> {
	const $ = load(await fetchPage(url));
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

/** Table 8.2 values: null where CRA leaves the cell blank, NaN where it can't be read */
interface OtherAmounts {
	/** A dollar amount, or the name of a formula such as BPAMB */
	basic: string;
	cea: number | null;
	s2: number | null;
	abatement: number | null;
	surtax: { threshold: number; rate: number }[];
}

/** Table 8.2: basic amounts, CEA, tax reduction (S2), surtax and abatement */
function parseOtherTable(rows: string[][]): Map<string, OtherAmounts> {
	const out = new Map<string, OtherAmounts>();
	if (rows.length === 0) return out;
	const col = (name: string) => {
		const i = rows[0].indexOf(name);
		if (i === -1) unverified.push(`Table 8.2 has no "${name}" column`);
		return i;
	};
	const [iBasic, iCea, iS2, iT4, iV1, iAbate] = [
		'Basic amount',
		'CEA',
		'S2',
		'T4 to V1',
		'V1 rate',
		'Abatement'
	].map(col);
	const surtax = new Map<string, { threshold: number | null; rate: number | null }[]>();
	let current: string | null = null;
	for (const row of rows.slice(1)) {
		const isJurisdiction = row[0] === 'Federal' || /^[A-Z]{2}$/.test(row[0]);
		if (isJurisdiction) {
			current = row[0];
			out.set(current, {
				basic: row[iBasic] ?? '',
				cea: cell(row[iCea]),
				s2: cell(row[iS2]),
				abatement: cell(row[iAbate]),
				surtax: []
			});
			surtax.set(current, [{ threshold: cell(row[iT4]), rate: cell(row[iV1]) }]);
		} else if (current && row[0] !== '' && !row[0].startsWith('Outside')) {
			// Continuation rows hold further surtax steps: "T4 to V1 | V1 rate"
			surtax.get(current)?.push({ threshold: cell(row[0]), rate: cell(row[1]) });
		}
	}
	for (const [code, steps] of surtax) {
		// A blank or zero rate is no step; an unreadable one stays (as NaN) so it can't be dropped
		out.get(code)!.surtax = steps
			.filter((s) => s.rate !== null && s.rate !== 0)
			.map((s) => ({ threshold: s.threshold ?? NaN, rate: s.rate ?? NaN }));
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

/**
 * Ontario Health Premium (V2): "the lesser of: (i) $cap; (ii) $base + (rate × (A – $start))".
 * Null unless every tier parses.
 */
function parseHealthPremium(text: string): PremiumTier[] | null {
	const from = text.search(/V2\s*=\s*Where A/i);
	if (from === -1) return null;
	const to = text.slice(from).search(/Note:/i);
	const block = to === -1 ? text.slice(from) : text.slice(from, from + to);
	const tierPattern =
		/\(i\) \$([\d,]+); \(ii\) (?:\$([\d,]+) \+ \()?([\d.]+) × \(A – \$([\d,]+)\)/gi;
	const tiers = [...block.matchAll(tierPattern)].map((m) => ({
		cap: num(m[1]),
		base: m[2] ? num(m[2]) : 0,
		rate: num(m[3]),
		start: num(m[4])
	}));
	// Every "lesser of" clause is a tier; one that didn't match must not be dropped
	const clauses = block.match(/the lesser of/gi)?.length ?? 0;
	return tiers.length > 0 && tiers.length === clauses ? tiers : null;
}

// ---------------------------------------------------------------------------
// Comparison and reporting
// ---------------------------------------------------------------------------

/** A change to rates.json that resolves a finding; one fix can resolve several */
interface Fix {
	key: string;
	apply: () => void;
}

interface Finding {
	section: string;
	item: string;
	code: string;
	cra: string;
	note?: string;
	fix?: Fix;
}

const passed = new Map<string, number>();
const mismatches: Finding[] = [];
const expected: Finding[] = [];
const unverified: string[] = [];
const notes: string[] = [];
/** Problems that need a person even after --write */
const manual: string[] = [];
let editionKey = '';

const money = (n: number) =>
	n >= NO_LIMIT ? 'no limit' : `$${n.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`;
const pct = (r: number) => `${+(r * 100).toFixed(4)}%`;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const pass = (section: string) => passed.set(section, (passed.get(section) ?? 0) + 1);
const allFinite = (...values: number[]) => values.every(Number.isFinite);

function compare(
	section: string,
	item: string,
	code: number | undefined,
	cra: number,
	fmt: (n: number) => string = money,
	fix?: Fix | ((value: number) => void)
) {
	const codeText = code === undefined ? 'not in rates.json' : fmt(code);
	if (Number.isNaN(cra)) {
		mismatches.push({
			section,
			item,
			code: codeText,
			// A group fix (CRA's whole bracket set, say) also removes entries CRA no longer has
			...(typeof fix === 'object'
				? { cra: 'none', fix }
				: { cra: 'not found (has the CRA page changed?)' })
		});
		return;
	}
	const finding = { section, item, code: codeText, cra: fmt(cra) };
	const exception = PRORATED_EXCEPTIONS[`${editionKey} ${item}`];
	if (exception && same(exception.cra, cra)) {
		// CRA shows the prorated payroll value; rates.json must hold the annual one
		if (code !== undefined && same(code, exception.annual)) {
			expected.push({ ...finding, note: `prorated; the annual value is ${fmt(exception.annual)}` });
		} else {
			mismatches.push({
				...finding,
				note: `CRA's value is prorated; rates.json should hold the annual ${fmt(exception.annual)}`
			});
		}
	} else if (code !== undefined && same(code, cra)) {
		pass(section);
	} else {
		const resolved =
			typeof fix === 'function' ? { key: `${section} ${item}`, apply: () => fix(cra) } : fix;
		mismatches.push({ ...finding, fix: resolved });
	}
}

const describe = (rows: readonly BracketRow[]) =>
	rows
		.map(
			([min, rate], i) => `${pct(rate)} ${money(min)}–${rows[i + 1] ? money(rows[i + 1][0]) : ''}`
		)
		.join(', ');

/** Compare brackets; any difference is fixed by taking CRA's whole set, if fully parsed */
function compareBrackets(
	section: string,
	label: string,
	code: readonly BracketRow[],
	cra: CraBrackets | undefined,
	set: (rows: [number, number][]) => void
) {
	if (!cra) {
		mismatches.push({ section, item: `${label} brackets`, code: describe(code), cra: 'not found' });
		return;
	}
	const rows = cra.rates.map((rate, i): [number, number] => [cra.thresholds[i], rate]);
	const parsed =
		cra.rates.length > 0 &&
		cra.thresholds.length === cra.rates.length &&
		cra.thresholds[0] === 0 &&
		allFinite(...cra.thresholds, ...cra.rates);
	const fix = parsed ? { key: `${label} brackets`, apply: () => set(rows) } : undefined;
	compare(section, `${label} bracket count`, code.length, cra.rates.length, String, fix);
	for (let i = 0; i < Math.max(code.length, cra.rates.length); i++) {
		compare(
			section,
			`${label} bracket ${i + 1} from`,
			code[i]?.[0],
			cra.thresholds[i] ?? NaN,
			money,
			fix
		);
		compare(section, `${label} bracket ${i + 1} rate`, code[i]?.[1], cra.rates[i] ?? NaN, pct, fix);
	}
}

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
	const provinces = new Set(PROVINCES.map((c) => PROVINCE_NAMES[c].toLowerCase()));
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

/** Exit, writing the markdown report first if one was asked for */
function finish(code: 0 | 1 | 2, markdown: string): never {
	if (args.report) writeFileSync(args.report, markdown);
	process.exit(code);
}

async function main() {
	let jan: Edition;
	try {
		jan = await fetchEdition(JAN_URL);
	} catch (err) {
		const message = `Could not load the January T4127 edition (${(err as Error).message}):\n  ${JAN_URL}`;
		console.error(message);
		finish(err instanceof NetworkError ? 2 : 1, `## T4127 rate check\n\n${message}\n`);
	}
	let jul: Edition | null = null;
	try {
		jul = await fetchEdition(JUL_URL);
	} catch (err) {
		if (err instanceof NetworkError) {
			const message = `Could not load the July T4127 edition (${err.message}):\n  ${JUL_URL}`;
			console.error(message);
			finish(2, `## T4127 rate check\n\n${message}\n`);
		}
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

	if (latest.year > current.year) {
		mismatches.push({
			section: 'Tax year',
			item: 'Tax year',
			code: String(current.year),
			cra: String(latest.year),
			fix: { key: 'year', apply: () => startYear(latest.year) }
		});
		const thisYear = new Date().getFullYear();
		if (latest.year > thisYear) {
			notes.push(
				`These are ${latest.year} rates, which take effect January 1, ${latest.year}. ` +
					`Merging before then switches the site to ${latest.year} during ${thisYear}.`
			);
		}
	} else if (latest.year < current.year) {
		console.log(
			`ℹ CRA hasn't published T4127 for ${current.year} yet; comparing against ${latest.year}.\n`
		);
	}

	const year = Math.max(current.year, latest.year);
	if (current.quebecYear < year) {
		manual.push(
			`Quebec: rates.json has Quebec's ${current.quebecYear} provincial brackets and basic personal ` +
				`amount, and CRA doesn't publish them. Update QC and quebecYear from Quebec Finance's ` +
				`${year} "Parameters of the personal income tax system": ${QUEBEC_URL(year)}`
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
	const target = proposed.federal;
	compareBrackets(
		fed,
		'Federal',
		current.federal.brackets,
		rates.get('Federal'),
		(rows) => (target.brackets = rows)
	);
	const bpaf = bpaFormula(src, 'BPAF');
	const fp = current.federal.personalAmount;
	const fpTarget = target.personalAmount;
	compare(fed, 'Federal basic personal amount', fp.amountMax, bpaf.amountMax, money, (v) => {
		fpTarget.amountMax = v;
	});
	compare(
		fed,
		'Federal basic personal amount minimum',
		fp.amountMin,
		bpaf.amountMin,
		money,
		(v) => {
			fpTarget.amountMin = v;
		}
	);
	compare(fed, 'Federal BPA clawback start', fp.clawbackStart, bpaf.start, money, (v) => {
		fpTarget.clawbackStart = v;
	});
	compare(fed, 'Federal BPA clawback end', fp.clawbackEnd, bpaf.end, money, (v) => {
		fpTarget.clawbackEnd = v;
	});
	compare(
		fed,
		'Canada employment amount',
		current.federal.canadaEmploymentAmount,
		otherRow('Federal', fed)?.cea ?? NaN,
		money,
		(v) => (target.canadaEmploymentAmount = v)
	);
	compare(
		fed,
		'Quebec abatement',
		current.federal.quebecAbatement,
		otherRow('QC', fed)?.abatement ?? NaN,
		pct,
		(v) => (target.quebecAbatement = v)
	);

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
		const prov = current.provinces[code];
		const provTarget = proposed.provinces[code];
		const section = 'Personal amounts';
		const amounts = otherRow(code, section);
		const clawback = prov.personalAmountClawback;

		// "BPAMB", or with a footnote marker, "BPAMB*"
		const basicFormula = amounts?.basic.replace(/[*\s]/g, '').toUpperCase();
		if (basicFormula === 'BPAMB' || basicFormula === 'BPAYT') {
			const formula = basicFormula === 'BPAMB' ? bpamb : bpaf;
			const mirrors = basicFormula !== 'BPAYT' || yukonMirrorsFederal === true;
			if (!mirrors) {
				mismatches.push({
					section,
					item: `${code} basic personal amount`,
					code: 'mirrors federal',
					cra: '"BPAYT = BPAF" is not in the latest BPAYT formula; read it and update YT'
				});
			}
			const { amountMax, amountMin, start, end } = formula;
			const fix =
				mirrors && allFinite(amountMax, amountMin, start, end)
					? {
							key: `${code} BPA`,
							apply: () => {
								provTarget.personalAmount = amountMax;
								provTarget.personalAmountClawback = { amountMin, start, end };
							}
						}
					: undefined;
			compare(section, `${code} basic personal amount`, prov.personalAmount, amountMax, money, fix);
			compare(section, `${code} BPA minimum`, clawback?.amountMin, amountMin, money, fix);
			compare(section, `${code} BPA clawback start`, clawback?.start, start, money, fix);
			compare(section, `${code} BPA clawback end`, clawback?.end, end, money, fix);
		} else if (amounts) {
			const flat = num(amounts.basic);
			compare(
				section,
				`${code} basic personal amount`,
				prov.personalAmount,
				flat,
				money,
				(v) => (provTarget.personalAmount = v)
			);
			// Only a readable flat amount shows the clawback is gone
			if (clawback && Number.isFinite(flat)) {
				mismatches.push({
					section,
					item: `${code} BPA clawback`,
					code: 'has a clawback',
					cra: `flat ${amounts.basic}`,
					fix: {
						key: `${code} BPA clawback`,
						apply: () => delete provTarget.personalAmountClawback
					}
				});
			}
		}

		if (amounts) checkProvincialExtras(src, code, amounts);
		compareBrackets(
			'Provincial brackets',
			code,
			prov.brackets,
			rates.get(code),
			(rows) => (provTarget.brackets = rows)
		);
	}

	checkReductionAttribution(src);
	checkHealthPremium(src);
	await report(latest, jan);
}

/** A new tax year: its January edition replaces last year's notes */
function startYear(year: number) {
	proposed.year = year;
	proposed.notes = [
		`Annual values from CRA T4127 Payroll Deductions Formulas (Jan ${year}) unless noted. Checked by \`pnpm check:rates\`.`,
		"QC: provincial brackets and basic personal amount are from Quebec Finance's personal income tax parameters for quebecYear; CRA doesn't publish them.",
		'YT: the basic personal amount mirrors the federal one, including its clawback (BPAYT = BPAF).'
	];
}

function checkContributions(src: Sources) {
	const section = 'CPP / EI';
	const { cpp, cpp2 } = current;
	const t = proposed;
	const cppRow = src.table('Table 8.3 ').find((r) => r[0].startsWith('CPP ('));
	compare(section, 'CPP YMPE', cpp.ympe, num(cppRow?.[1]), money, (v) => (t.cpp.ympe = v));
	compare(section, 'CPP basic exemption', cpp.exemption, num(cppRow?.[2]), money, (v) => {
		t.cpp.exemption = v;
	});
	compare(section, 'CPP rate', cpp.rate, num(cppRow?.[4]), pct, (v) => (t.cpp.rate = v));
	compare(section, 'CPP maximum', cpp.maxEmployee, num(cppRow?.[5]), money, (v) => {
		t.cpp.maxEmployee = v;
	});

	const enhancedRow = src.table('Table 8.5 ').find((r) => r[0].startsWith('CPP ('));
	compare(section, 'Enhanced CPP rate', cpp.enhancedRate, num(enhancedRow?.[2]), pct, (v) => {
		t.cpp.enhancedRate = v;
	});

	const cpp2Row = src.table('Table 8.6 ').find((r) => r[0].startsWith('CPP ('));
	compare(section, 'CPP2 floor (YMPE)', cpp2.floor, num(cpp2Row?.[1]), money, (v) => {
		t.cpp2.floor = v;
	});
	compare(section, 'CPP2 ceiling (YAMPE)', cpp2.yampe, num(cpp2Row?.[2]), money, (v) => {
		t.cpp2.yampe = v;
	});
	compare(section, 'CPP2 rate', cpp2.rate, num(cpp2Row?.[4]), pct, (v) => (t.cpp2.rate = v));
	compare(section, 'CPP2 maximum', cpp2.maxEmployee, num(cpp2Row?.[5]), money, (v) => {
		t.cpp2.maxEmployee = v;
	});

	const eiRows = src.table('Table 8.7 ');
	for (const [label, key, prefix] of [
		['EI', 'ei', 'Canada'],
		['EI (Quebec)', 'eiQuebec', 'QC']
	] as const) {
		const r = eiRows.find((x) => x[0].startsWith(prefix));
		const rates = current[key];
		compare(section, `${label} maximum insurable earnings`, rates.mie, num(r?.[1]), money, (v) => {
			t[key].mie = v;
		});
		compare(section, `${label} rate`, rates.rate, num(r?.[2]), pct, (v) => (t[key].rate = v));
		compare(section, `${label} maximum`, rates.maxEmployee, num(r?.[4]), money, (v) => {
			t[key].maxEmployee = v;
		});
	}
}

function checkProvincialExtras(src: Sources, code: ProvinceCode, amounts: OtherAmounts) {
	const prov = current.provinces[code];
	const target = proposed.provinces[code];

	// Surtax
	const surtax = prov.surtax ?? [];
	const surtaxFix = allFinite(...amounts.surtax.flatMap((s) => [s.threshold, s.rate]))
		? {
				key: `${code} surtax`,
				apply: () => {
					if (amounts.surtax.length) target.surtax = amounts.surtax;
					else delete target.surtax;
				}
			}
		: undefined;
	compare(
		'Surtax',
		`${code} surtax steps`,
		surtax.length,
		amounts.surtax.length,
		String,
		surtaxFix
	);
	amounts.surtax.forEach((s, i) => {
		const item = `${code} surtax ${i + 1}`;
		compare('Surtax', `${item} threshold`, surtax[i]?.threshold, s.threshold, money, surtaxFix);
		compare('Surtax', `${item} rate`, surtax[i]?.rate, s.rate, pct, surtaxFix);
	});

	// Canada employment amount (provincial K4P)
	compare(
		'Credits',
		`${code} employment amount`,
		prov.employmentAmount ?? 0,
		amounts.cea ?? 0,
		money,
		(v) => {
			if (v) target.employmentAmount = v;
			else delete target.employmentAmount;
		}
	);

	// Low-income tax reduction (factor S): formula kind from the province's own
	// section, basic amount from Table 8.2 (S2)
	const section = 'Tax reductions';
	const reduction = prov.taxReduction;
	const formula = src.formula(
		`${code} tax reduction (factor S)`,
		(ed) => provinceSection(ed, PROVINCE_NAMES[code], FACTOR_S),
		parseReduction
	);
	if (formula === null) return; // present but not parsable: already unverified
	if (Number.isNaN(amounts.s2)) {
		mismatches.push({
			section,
			item: `${code} tax reduction basic amount`,
			code: reduction ? money(reduction.basic) : 'none',
			cra: 'not readable (has the CRA page changed?)'
		});
		return;
	}
	if (formula === undefined && amounts.s2 === null) {
		if (reduction) {
			mismatches.push({
				section,
				item: `${code} tax reduction`,
				code: reduction.kind,
				cra: 'none in T4127',
				fix: { key: `${code} tax reduction`, apply: () => delete target.taxReduction }
			});
		} else {
			pass(section);
		}
		return;
	}
	// A factor S formula with a blank S2 has no basic amount to apply
	const s2 = amounts.s2 ?? NaN;
	if (!formula) {
		mismatches.push({
			section,
			item: `${code} tax reduction formula`,
			code: reduction?.kind ?? 'none',
			cra: `S2 of ${money(s2)} but no factor S formula found (has the CRA page changed?)`
		});
		return;
	}
	if (reduction?.kind !== formula.kind) {
		// calcTaxReduction applies the ontario kind as 2 × basic
		const replacement =
			formula.kind === 'ontario'
				? formula.multiplier === 2 && allFinite(s2)
					? { kind: 'ontario' as const, basic: s2 }
					: undefined
				: allFinite(s2, formula.threshold, formula.rate)
					? { basic: s2, ...formula }
					: undefined;
		mismatches.push({
			section,
			item: `${code} tax reduction formula`,
			code: reduction?.kind ?? 'none',
			cra: formula.kind,
			fix: replacement && {
				key: `${code} tax reduction`,
				apply: () => (target.taxReduction = replacement)
			}
		});
		return;
	}
	pass(section);
	const basic = (v: number) => {
		if (target.taxReduction) target.taxReduction.basic = v;
	};
	compare(section, `${code} tax reduction basic amount`, reduction.basic, s2, money, basic);
	if (formula.kind === 'ontario') {
		// calcTaxReduction applies the ontario kind as 2 × basic; another multiplier needs code changes
		compare(section, `${code} tax reduction multiplier`, 2, formula.multiplier, String);
	}
	if (reduction.kind === 'income-tested' && formula.kind === 'income-tested') {
		const t = target.taxReduction as Mutable<typeof reduction>;
		compare(
			section,
			`${code} tax reduction threshold`,
			reduction.threshold,
			formula.threshold,
			money,
			(v) => {
				t.threshold = v;
			}
		);
		compare(section, `${code} tax reduction rate`, reduction.rate, formula.rate, pct, (v) => {
			t.rate = v;
		});
	}
}

function checkHealthPremium(src: Sources) {
	const section = 'Ontario Health Premium';
	const tiers = src.formula(
		'Ontario Health Premium (V2) formula',
		(ed) => definedIn(ed, 'V2'),
		parseHealthPremium
	);
	if (tiers === undefined) {
		unverified.push('Ontario Health Premium (V2) formula (not found in any edition)');
	}
	if (!tiers) return;
	const code = current.provinces.ON.healthPremium ?? [];
	const fix = allFinite(...tiers.flatMap((t) => [t.start, t.base, t.rate, t.cap]))
		? {
				key: 'ON health premium',
				apply: () => {
					proposed.provinces.ON.healthPremium = tiers.map((t) => ({
						over: t.start,
						base: t.base,
						rate: t.rate,
						max: t.cap
					}));
				}
			}
		: undefined;
	compare(section, 'premium tiers', code.length, tiers.length, String, fix);
	tiers.forEach((t, i) => {
		const item = `premium tier ${i + 1}`;
		compare(section, `${item} starts over`, code[i]?.over, t.start, money, fix);
		compare(section, `${item} base`, code[i]?.base, t.base, money, fix);
		compare(section, `${item} rate`, code[i]?.rate, t.rate, pct, fix);
		compare(section, `${item} maximum`, code[i]?.max, t.cap, money, fix);
	});
}

/** The MID_YEAR_CHANGES entry covering a finding, by its item or its group */
function midYearChange(f: Finding): string | undefined {
	// Only a value read from CRA (which is what carries a fix) can be a known
	// difference; an unreadable one still needs a person
	if (!f.fix) return undefined;
	for (const [key, change] of Object.entries(MID_YEAR_CHANGES)) {
		if (!key.startsWith(`${editionKey} `)) continue;
		const name = key.slice(editionKey.length + 1);
		if (f.item === name || f.item.startsWith(`${name} `) || f.fix?.key === name) return change;
	}
	return undefined;
}

async function report(latest: Edition, jan: Edition) {
	// July tables are prorated, so only a January edition can update rates.json
	const writable = latest.month === 1;
	const write = args.write && writable;
	for (const f of mismatches.filter((m) => midYearChange(m))) {
		mismatches.splice(mismatches.indexOf(f), 1);
		expected.push({ ...f, note: `mid-year change: ${midYearChange(f)}` });
	}
	const applied: Finding[] = [];
	if (write) {
		const keys = new Set<string>();
		for (const f of mismatches) {
			if (!f.fix) continue;
			applied.push(f);
			if (keys.has(f.fix.key)) continue;
			f.fix.apply();
			keys.add(f.fix.key);
		}
		if (applied.length) {
			const file = RATES_FILE.pathname;
			const options = { ...(await resolveConfig(file)), filepath: file };
			writeFileSync(RATES_FILE, await format(JSON.stringify(proposed, null, '\t'), options));
		}
	}
	const open = mismatches.filter((m) => !applied.includes(m));

	// Console
	const sections = [...new Set([...passed.keys(), ...mismatches.map((m) => m.section)])];
	for (const section of sections) {
		const failures = mismatches.filter((m) => m.section === section);
		const okCount = passed.get(section) ?? 0;
		console.log(
			`${failures.length ? '✗' : '✓'} ${section}: ${okCount} match${failures.length ? `, ${failures.length} to update` : ''}`
		);
		for (const f of failures) {
			const status = applied.includes(f)
				? ' (updated)'
				: f.fix && writable
					? ' (--write can update)'
					: '';
			console.log(
				`    ${f.item}: rates.json ${f.code} · CRA ${f.cra}${status}${f.note ? `\n      → ${f.note}` : ''}`
			);
		}
	}
	if (open.some((f) => f.fix) && !writable) {
		console.log(
			`\n  July editions show prorated July–December values, so --write won't use them. Find each\n` +
				`  annual value in the edition's "What's new" section, update rates.json, and add a\n` +
				`  PRORATED_EXCEPTIONS entry in scripts/check-rates.ts.`
		);
	}
	const lists: [string, string[]][] = [
		['Needs a person', manual],
		['Could not verify', unverified]
	];
	for (const [title, list] of lists) {
		if (!list.length) continue;
		console.log(`\n✗ ${title}:`);
		for (const u of list) console.log(`    ${u}`);
	}
	if (expected.length) {
		console.log('\nExpected differences:');
		for (const f of expected)
			console.log(`    ${f.item}: rates.json ${f.code} · CRA ${f.cra} — ${f.note}`);
	}
	if (notes.length) {
		console.log('\nNotes:');
		for (const n of notes) console.log(`    ${n}`);
	}
	const qc = current.provinces.QC;
	console.log(
		`\nQuebec (manual check): CRA doesn't publish Quebec's provincial values.\n` +
			`  Each November, Québec Finance publishes "Parameters of the personal income tax system"\n` +
			`  for the coming year. Update QC and quebecYear in src/lib/rates.json. Currently (${current.quebecYear}):\n` +
			`    basic personal amount ${money(qc.personalAmount)}\n` +
			`    brackets ${describe(qc.brackets)}\n` +
			`  ${current.quebecYear} source: ${QUEBEC_URL(current.quebecYear)}`
	);

	const failed = open.length > 0 || unverified.length > 0 || manual.length > 0;
	if (applied.length) console.log(`\n✓ Updated src/lib/rates.json (${applied.length} values).`);
	console.log(
		failed
			? unverified.length && !open.length && !manual.length
				? '\n✗ Some rates could not be verified.'
				: '\n✗ Rates need updating.'
			: '\n✓ All checked rates match T4127.'
	);

	// Markdown (for the pull request or issue the scheduled workflow opens)
	const md: string[] = ['## T4127 rate check', ''];
	md.push(`Checked against [${latest.title}](${latest.url})`);
	if (latest !== jan) md.push(`and [${jan.title}](${jan.url})`);
	md.push('');
	const row = (f: Finding) =>
		`| ${f.item} | ${f.code} | ${f.cra} |${f.note ? ` ${f.note} |` : ' |'}`;
	if (applied.length) {
		md.push('### Updated in `src/lib/rates.json`', '');
		md.push('| Item | Was | CRA | Note |', '| --- | --- | --- | --- |', ...applied.map(row), '');
	}
	if (open.length) {
		md.push('### Needs a person', '');
		if (open.some((f) => f.fix) && !writable) {
			md.push(
				"July editions show prorated July–December values, so these weren't applied. Find each annual value in the edition's \"What's new\" section, update `src/lib/rates.json`, and add a `PRORATED_EXCEPTIONS` entry in `scripts/check-rates.ts`.",
				''
			);
		}
		md.push(
			'| Item | rates.json | CRA | Note |',
			'| --- | --- | --- | --- |',
			...open.map(row),
			''
		);
	}
	if (manual.length) {
		if (!open.length) md.push('### Needs a person', '');
		md.push(...manual.map((m) => `- ${m}`), '');
	}
	if (unverified.length) {
		md.push('### Could not verify', '', ...unverified.map((u) => `- ${u}`), '');
	}
	if (expected.length) {
		md.push('### Expected differences', '');
		md.push(
			...expected.map((f) => `- ${f.item}: rates.json ${f.code} · CRA ${f.cra} — ${f.note}`),
			''
		);
	}
	if (notes.length) md.push('### Notes', '', ...notes.map((n) => `- ${n}`), '');
	if (!failed && !applied.length) md.push('All checked rates match T4127.', '');

	finish(failed ? 1 : 0, md.join('\n'));
}

await main();
