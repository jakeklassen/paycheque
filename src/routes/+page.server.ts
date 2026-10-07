import type { PageServerLoad } from './$types';
import { getRates } from '#lib/server/get-rates.js';

/** Tax years roll over on Jan 1 in Canada; Eastern time keeps SSR and hydration in agreement */
function currentYearInCanada(): number {
	const year = new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'America/Toronto' });
	return Number(year.format(new Date()));
}

export const load: PageServerLoad = async ({ cookies }) => {
	const raw = cookies.get('calc-inputs');
	return { ...(await getRates(raw)), currentYear: currentYearInCanada() };
};
