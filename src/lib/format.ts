const MONTH_NAMES = [
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
];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function weekToDate(week: number): string {
	const dayOfYear = (week - 1) * 7 + 1;
	let cumDays = 0;
	for (let i = 0; i < 12; i++) {
		if (cumDays + MONTH_DAYS[i] >= dayOfYear) {
			return `${MONTH_NAMES[i]} ${dayOfYear - cumDays}`;
		}
		cumDays += MONTH_DAYS[i];
	}
	return `Week ${week}`;
}

export function fmt(n: number): string {
	return n.toLocaleString('en-CA', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}
