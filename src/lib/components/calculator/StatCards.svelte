<script lang="ts">
	import { fmt } from '$lib/format';
	import { cardStyle, labelStyle, monoFont } from '$lib/styles';

	interface Props {
		earlyMonthlyNet: number;
		avgMonthlyNet: number;
		lateMonthlyNet: number;
	}

	let { earlyMonthlyNet, avgMonthlyNet, lateMonthlyNet }: Props = $props();

	let stats = $derived([
		{
			key: 'early',
			label: 'Monthly (early year)',
			sub: 'Jan–Mar with all deductions',
			color: '#ff6b6b',
			value: earlyMonthlyNet
		},
		{
			key: 'avg',
			label: 'Monthly (average)',
			sub: 'Annualized average',
			color: '#ffa726',
			value: avgMonthlyNet
		},
		{
			key: 'late',
			label: 'Monthly (after max-out)',
			sub: 'After all caps hit',
			color: '#66bb6a',
			value: lateMonthlyNet
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
			<div style="font-size: 11px; color: #50546a; margin-top: 4px;">{s.sub}</div>
		</div>
	{/each}
</div>
