import type { PageServerLoad } from './$types';
import { getRates } from '#lib/server/get-rates.js';

export const load: PageServerLoad = async ({ cookies }) => {
	const raw = cookies.get('calc-inputs');
	return await getRates(raw);
};
