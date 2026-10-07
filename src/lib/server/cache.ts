import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RateConfig } from '#lib/types.js';

const CACHE_DIR = join(process.cwd(), '.cache');
const CACHE_FILE = join(CACHE_DIR, 'rates.json');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STALE_MS = 48 * 60 * 60 * 1000; // 48 hours

interface CacheEntry {
	data: RateConfig;
	timestamp: number;
}

export async function readCache(): Promise<{
	config: RateConfig;
	fresh: boolean;
} | null> {
	try {
		const raw = await readFile(CACHE_FILE, 'utf-8');
		const entry: CacheEntry = JSON.parse(raw);
		const age = Date.now() - entry.timestamp;

		if (age > STALE_MS) return null;

		return {
			config: {
				...entry.data,
				meta: {
					lastUpdated: new Date(entry.timestamp).toISOString(),
					source: 'cache',
					stale: age > TTL_MS
				}
			},
			fresh: age <= TTL_MS
		};
	} catch {
		return null;
	}
}

export async function writeCache(config: RateConfig): Promise<void> {
	try {
		await mkdir(CACHE_DIR, { recursive: true });
		const entry: CacheEntry = { data: config, timestamp: Date.now() };
		await writeFile(CACHE_FILE, JSON.stringify(entry), 'utf-8');
	} catch {
		// Cache write failure is non-fatal
	}
}
