import type { PayDate, PayFrequency } from './types';
import { PAY_FREQUENCIES } from './constants';

export const MONTH_NAMES = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
] as const;

function toPayDate(d: Date): PayDate {
	const month = d.getUTCMonth();
	const day = d.getUTCDate();
	return { month, day, label: `${MONTH_NAMES[month]} ${day}` };
}

/**
 * Paydays in a year. Weekly and every-two-weeks pay land on Fridays from the
 * first Friday of January; twice a month on the 15th and last day; monthly on
 * the last day; once a year on December 31.
 */
export function payDates(year: number, frequency: PayFrequency): PayDate[] {
	const lastDay = (month: number) => toPayDate(new Date(Date.UTC(year, month + 1, 0)));
	const months = Array.from({ length: 12 }, (_, m) => m);

	switch (frequency) {
		case 'weekly':
		case 'biweekly': {
			const step = frequency === 'weekly' ? 7 : 14;
			const firstFriday = 1 + ((5 - new Date(Date.UTC(year, 0, 1)).getUTCDay() + 7) % 7);
			return Array.from({ length: PAY_FREQUENCIES[frequency].periods }, (_, i) =>
				toPayDate(new Date(Date.UTC(year, 0, firstFriday + i * step)))
			);
		}
		case 'semi-monthly':
			return months.flatMap((m) => [toPayDate(new Date(Date.UTC(year, m, 15))), lastDay(m)]);
		case 'monthly':
			return months.map(lastDay);
		case 'annually':
			return [lastDay(11)];
	}
}

/** One-line description of the payday assumptions behind the monthly chart */
export function scheduleNote(frequency: PayFrequency, first: PayDate): string {
	switch (frequency) {
		case 'weekly':
			return `Paid every Friday from ${first.label}; months with a fifth cheque show taller bars.`;
		case 'biweekly':
			return `Paid every other Friday from ${first.label}; months with a third cheque show taller bars.`;
		case 'semi-monthly':
			return 'Paid on the 15th and last day of each month.';
		case 'monthly':
			return 'Paid on the last day of each month.';
		case 'annually':
			return 'Paid once, on December 31.';
	}
}
