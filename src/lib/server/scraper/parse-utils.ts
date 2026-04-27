import { get as httpsGet } from 'node:https';

/** Strip $ and commas, parse as float */
export function parseDollar(text: string): number {
	return parseFloat(text.replace(/[$,\s]/g, ''));
}

/** Strip % sign if present, parse as float (does NOT divide by 100) */
export function parseRate(text: string): number {
	return parseFloat(text.replace(/%/g, '').trim());
}

export const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch a URL using node:https (not undici/fetch) because Canada.ca's
 * Akamai CDN blocks undici's TLS fingerprint.
 */
export function fetchWithTimeout(
	url: string,
	headers?: Record<string, string>
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = httpsGet(url, { headers: { 'User-Agent': USER_AGENT, ...headers } }, (res) => {
			let data = '';
			res.on('data', (chunk: string) => (data += chunk));
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
		});
		req.on('error', reject);
		req.setTimeout(FETCH_TIMEOUT_MS, () => {
			req.destroy(new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`));
		});
	});
}
