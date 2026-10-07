<script lang="ts">
	import type { RateConfig, SimulationResult } from '#lib/types.js';
	import { fmt } from '#lib/format.js';
	import { cardStyle, monoFont } from '#lib/styles.js';

	interface Props {
		salary: number;
		province: string;
		data: SimulationResult;
		config: RateConfig;
	}

	interface BreakdownRow {
		label: string;
		value: number;
		color: string;
		bold?: boolean;
	}

	let { salary, province, data, config }: Props = $props();

	let provinceName = $derived(config.provinces[province]?.name ?? province);

	let rows = $derived.by<BreakdownRow[]>(() => {
		const base: BreakdownRow[] = [
			{ label: 'Gross Income', value: salary, color: '#e8e8ef', bold: true },
			{ label: 'Federal Income Tax', value: -data.federalTax, color: '#ff6b6b' },
			{ label: `${provinceName} Income Tax`, value: -data.provincialTax, color: '#ff8a80' }
		];
		if (data.healthPremium > 0) {
			base.push({
				label: `${provinceName} Health Premium`,
				value: -data.healthPremium,
				color: '#ff8a80'
			});
		}
		base.push({ label: 'CPP', value: -data.totalCPP, color: '#ffa726' });
		base.push({ label: 'CPP2', value: -data.totalCPP2, color: '#ffcc80' });
		base.push({ label: 'EI', value: -data.totalEI, color: '#42a5f5' });
		if (data.annualRRSP > 0) {
			base.push({
				label: 'RRSP Contributions',
				value: -data.annualRRSP,
				color: '#ab47bc'
			});
		}
		return base;
	});
</script>

<div style="{cardStyle} padding: 20px 24px; margin-bottom: 24px;">
	<h2 style="font-size: 14px; font-weight: 700; margin: 0 0 16px; letter-spacing: 0.5px;">
		Annual Breakdown
	</h2>
	{#each rows as row (row.label)}
		<div
			style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.04);"
		>
			<span style="font-size: 13px; color: #9094a8;">{row.label}</span>
			<span
				style="font-size: 14px; font-weight: {row.bold ? 700 : 500}; color: {row.color}; {monoFont}"
			>
				{row.value < 0 ? '−' : ''}${fmt(Math.abs(row.value))}
			</span>
		</div>
	{/each}
	<div
		style="display: flex; justify-content: space-between; padding: 12px 0 4px; border-top: 2px solid rgba(102,187,106,0.3);"
	>
		<span style="font-size: 14px; font-weight: 700; color: #66bb6a;">Annual Net Pay</span>
		<span style="font-size: 18px; font-weight: 700; color: #66bb6a; {monoFont}">
			${fmt(data.totalAnnualNet)}
		</span>
	</div>
</div>
