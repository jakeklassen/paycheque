import type { PayFrequency, ProvinceCode } from './types';
import { PAY_FREQUENCIES, PROVINCE_NAMES } from './constants';

export interface SavedInputs {
	salary: number;
	rrsp: number;
	province: ProvinceCode;
	frequency: PayFrequency;
}

export const DEFAULT_INPUTS: SavedInputs = {
	salary: 100_000,
	rrsp: 0,
	province: 'ON',
	frequency: 'biweekly'
};

const STORAGE_KEY = 'calc-inputs';

/** Parse stored inputs, falling back to the defaults for anything missing or invalid */
export function parseSavedInputs(raw: string | null): SavedInputs {
	try {
		const parsed = JSON.parse(raw ?? '{}') as Partial<Record<keyof SavedInputs, unknown>>;
		const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
		const key = <T extends string>(v: unknown, options: Record<T, unknown>): v is T =>
			typeof v === 'string' && Object.hasOwn(options, v);
		return {
			salary: number(parsed.salary) ? (parsed.salary as number) : DEFAULT_INPUTS.salary,
			rrsp: number(parsed.rrsp) ? (parsed.rrsp as number) : DEFAULT_INPUTS.rrsp,
			province: key(parsed.province, PROVINCE_NAMES) ? parsed.province : DEFAULT_INPUTS.province,
			frequency: key(parsed.frequency, PAY_FREQUENCIES)
				? parsed.frequency
				: DEFAULT_INPUTS.frequency
		};
	} catch {
		return DEFAULT_INPUTS;
	}
}

/** Inputs saved in this browser; storage can be unavailable (private mode, blocked site data) */
export function loadInputs(): SavedInputs {
	try {
		return parseSavedInputs(localStorage.getItem(STORAGE_KEY));
	} catch {
		return DEFAULT_INPUTS;
	}
}

export function saveInputs(inputs: SavedInputs): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
	} catch {
		// Not saved; the calculator still works
	}
}
