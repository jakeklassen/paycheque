<script lang="ts">
	import type { SimulationResult } from '#lib/types.js';
	import { fmt } from '#lib/format.js';
	import { cardStyle, labelStyle, monoFont } from '#lib/styles.js';

	interface Props {
		data: SimulationResult;
	}

	let { data }: Props = $props();

	let perYear = $derived(data.periods.length);

	function chequeNote(net: number): string {
		return perYear === 1
			? `One payment of $${fmt(net)}`
			: `$${fmt(net)} per cheque × ${perYear} a year`;
	}

	let refundNote = $derived(
		data.refund >= 0.5
			? `Plus ~$${fmt(data.refund)} refund when you file`
			: data.refund <= -0.5
				? `Less ~$${fmt(-data.refund)} owing when you file`
				: 'Withholding matches your tax'
	);

	let stats = $derived([
		{
			key: 'early',
			label: 'Monthly (before max-out)',
			sub: chequeNote(data.firstChequeNet),
			color: '#ff6b6b',
			value: data.earlyMonthlyNet
		},
		{
			key: 'avg',
			label: 'Monthly (average)',
			sub: refundNote,
			color: '#ffa726',
			value: data.avgMonthlyNet
		},
		{
			key: 'late',
			label: 'Monthly (after max-out)',
			sub: chequeNote(data.lastChequeNet),
			color: '#66bb6a',
			value: data.lateMonthlyNet
		}
	]);
</script>

<div class="calc-grid-3" style="margin-bottom: 24px;">
	{#each stats as s (s.key)}
		<div style="{cardStyle} padding: 16px; position: relative; overflow: hidden;">
			<div
				style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: {s.color}; opacity: 0.7;"
			></div>
			<div style="{labelStyle} margin-bottom: 8px; letter-spacing: 1.2px;">{s.label}</div>
			<div style="font-size: 20px; font-weight: 700; {monoFont} color: {s.color};">
				${fmt(s.value)}
			</div>
			<div style="font-size: 11px; color: #6b6f85; margin-top: 4px;">{s.sub}</div>
		</div>
	{/each}
</div>
