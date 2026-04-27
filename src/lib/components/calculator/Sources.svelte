<script lang="ts">
	import type { RateConfig } from '$lib/types';
	import { fmt } from '$lib/format';
	import { cardStyle, monoFont } from '$lib/styles';

	interface Props {
		config: RateConfig;
	}

	let { config }: Props = $props();

	let lastUpdated = $derived(
		config.meta.lastUpdated
			? new Date(config.meta.lastUpdated).toLocaleDateString('en-CA', {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				})
			: null
	);
</script>

<div style="{cardStyle} padding: 16px 20px; margin-bottom: 24px;">
	<div class="calc-sources-header" style="margin-bottom: 10px;">
		<h3 style="font-size: 12px; font-weight: 700; margin: 0; color: #9094a8; letter-spacing: 1px;">
			SOURCES ({config.year})
		</h3>
		{#if lastUpdated}
			<span style="font-size: 10px; color: {config.meta.stale ? '#ff6b6b' : '#6b6f85'}; {monoFont}">
				{config.meta.stale ? '⚠ Stale — ' : ''}Last updated: {lastUpdated}
				{config.meta.source === 'fallback' ? ' (fallback)' : ''}
			</span>
		{/if}
	</div>
	{#if config.meta.stale}
		<div
			style="font-size: 11px; color: #ff6b6b; background: rgba(255,107,107,0.08); border: 1px solid rgba(255,107,107,0.15); border-radius: 6px; padding: 6px 10px; margin-bottom: 10px;"
		>
			Rate data is more than 48 hours old. Values shown may be outdated.
		</div>
	{/if}
	<div style="font-size: 12px; color: #9094a8; line-height: 1.9;">
		<div>
			CPP:
			<span style="color: #c0c0d0;">
				{(config.cpp.rate * 100).toFixed(2)}% to ${config.cpp.ympe.toLocaleString()} (max ${fmt(
					config.cpp.maxEmployee
				)})
			</span>
			· CPP2:
			<span style="color: #c0c0d0;">
				{(config.cpp2.rate * 100).toFixed(0)}% ${config.cpp2.floor.toLocaleString()}–${config.cpp2.yampe.toLocaleString()}
				(max ${fmt(config.cpp2.maxEmployee)})
			</span>
		</div>
		<div>
			EI:
			<span style="color: #c0c0d0;">
				{(config.ei.rate * 100).toFixed(2)}% to ${config.ei.mie.toLocaleString()} (max ${fmt(
					config.ei.maxEmployee
				)})
			</span>
		</div>
		<div style="margin-top: 6px; color: #6b6f85;">
			Via CRA (canada.ca). Tax is estimated — actual payroll withholding may vary.
		</div>
	</div>
</div>
