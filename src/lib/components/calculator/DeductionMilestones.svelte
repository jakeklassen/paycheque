<script lang="ts">
	import type { PeriodMarker, RateConfig, SimulationResult } from '#lib/types.js';
	import { fmt } from '#lib/format.js';
	import { cardStyle, monoFont } from '#lib/styles.js';

	interface Props {
		data: SimulationResult;
		config: RateConfig;
	}

	let { data, config }: Props = $props();

	let milestones = $derived.by(() => {
		const { cpp, cpp2, ei } = config;
		return [
			{
				label: 'EI',
				max: ei.maxEmployee,
				maxed: data.eiMaxed,
				color: '#42a5f5',
				detail: `${(ei.rate * 100).toFixed(2)}% on earnings up to $${ei.mie.toLocaleString()}`
			},
			{
				label: 'CPP',
				max: cpp.maxEmployee,
				maxed: data.cppMaxed,
				color: '#ffa726',
				detail: `${(cpp.rate * 100).toFixed(2)}% on $${cpp.exemption.toLocaleString()} – $${cpp.ympe.toLocaleString()}`
			},
			{
				label: 'CPP2',
				max: cpp2.maxEmployee,
				maxed: data.cpp2Maxed,
				color: '#ffcc80',
				detail: `${(cpp2.rate * 100).toFixed(1)}% on $${cpp2.floor.toLocaleString()} – $${cpp2.yampe.toLocaleString()}`
			}
		];
	});

	let lastMaxed = $derived(
		[data.eiMaxed, data.cppMaxed, data.cpp2Maxed]
			.filter((m): m is PeriodMarker => m !== null)
			.reduce<PeriodMarker | null>((a, b) => (a && a.period >= b.period ? a : b), null)
	);

	function describe(m: PeriodMarker | null): string {
		return m ? `${m.date.label} cheque (${m.period} of ${data.periods.length})` : 'not reached';
	}
</script>

<div style="{cardStyle} padding: 20px 24px; margin-bottom: 24px;">
	<h2 style="font-size: 14px; font-weight: 700; margin: 0 0 16px; letter-spacing: 0.5px;">
		When Deductions Max Out
	</h2>
	<div style="display: flex; flex-direction: column; gap: 10px;">
		{#each milestones as item (item.label)}
			<div
				class="calc-milestone-row"
				style="padding: 10px 14px; background: rgba(255,255,255,0.03); border-radius: 8px;"
			>
				<span style="font-weight: 700; font-size: 13px; color: {item.color}; {monoFont}">
					{item.label}
				</span>
				<div>
					<div style="font-size: 13px; color: #c0c0d0;">
						Max <strong>${fmt(item.max)}</strong> — reached on the
						<strong style="color: {item.color};">{describe(item.maxed)}</strong>
					</div>
					<div style="font-size: 11px; color: #50546a; margin-top: 2px;">{item.detail}</div>
				</div>
				<div
					class="calc-milestone-check"
					style="width: 28px; height: 28px; border-radius: 50%; background: {item.color}18; display: flex; align-items: center; justify-content: center; font-size: 13px;"
				>
					✓
				</div>
			</div>
		{/each}
	</div>
	<div
		style="margin-top: 16px; padding: 12px 14px; background: rgba(102,187,106,0.08); border-radius: 8px; border: 1px solid rgba(102,187,106,0.15); font-size: 13px; color: #a0d8a4; line-height: 1.5;"
	>
		Total CPP + CPP2 + EI:
		<strong style="color: #66bb6a;">
			${fmt(data.totalCPP + data.totalCPP2 + data.totalEI)}
		</strong>
		{#if lastMaxed}
			— all maxed by the
			<strong style="color: #66bb6a;">{lastMaxed.date.label}</strong> cheque, then take-home rises
			by
			<strong style="color: #66bb6a;">
				~${fmt(data.lateMonthlyNet - data.earlyMonthlyNet)}/mo
			</strong>
			(income tax withheld goes up a little once CPP and EI stop)
		{/if}
	</div>
</div>
