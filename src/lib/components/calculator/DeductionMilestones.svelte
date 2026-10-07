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
				total: data.totalEI,
				color: '#42a5f5',
				detail: `${(ei.rate * 100).toFixed(2)}% on earnings up to $${ei.mie.toLocaleString()}`
			},
			{
				label: 'CPP',
				max: cpp.maxEmployee,
				maxed: data.cppMaxed,
				total: data.totalCPP,
				color: '#ffa726',
				detail: `${(cpp.rate * 100).toFixed(2)}% on $${cpp.exemption.toLocaleString()} – $${cpp.ympe.toLocaleString()}`
			},
			{
				label: 'CPP2',
				max: cpp2.maxEmployee,
				maxed: data.cpp2Maxed,
				total: data.totalCPP2,
				color: '#ffcc80',
				detail: `${(cpp2.rate * 100).toFixed(1)}% on $${cpp2.floor.toLocaleString()} – $${cpp2.yampe.toLocaleString()}`
			}
		];
	});

	// Contributions charged at this salary, and those that never reach their maximum
	let charged = $derived(milestones.filter((m) => m.total > 0));
	let unmaxed = $derived(charged.filter((m) => m.maxed === null));

	let lastMaxed = $derived(
		charged
			.map((m) => m.maxed)
			.filter((m): m is PeriodMarker => m !== null)
			.reduce<PeriodMarker | null>((a, b) => (a && a.period >= b.period ? a : b), null)
	);

	function status(m: { maxed: PeriodMarker | null; total: number }): string {
		if (m.maxed)
			return `reached on the ${m.maxed.date.label} cheque (${m.maxed.period} of ${data.periods.length})`;
		if (m.total === 0) return 'not charged at this salary';
		return `not reached — $${fmt(m.total)} this year`;
	}

	function joinNames(names: string[]): string {
		return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
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
						Max <strong>${fmt(item.max)}</strong> —
						<strong style="color: {item.color};">{status(item)}</strong>
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
		{#if unmaxed.length > 0}
			— {joinNames(unmaxed.map((m) => m.label))}
			{unmaxed.length === 1 ? "doesn't" : "don't"} reach
			{unmaxed.length === 1 ? 'its' : 'their'} maximum at this salary, so there's no mid-year jump in
			take-home.
		{:else if lastMaxed && lastMaxed.period < data.periods.length}
			— all maxed by the
			<strong style="color: #66bb6a;">{lastMaxed.date.label}</strong> cheque, then take-home rises
			by
			<strong style="color: #66bb6a;">
				~${fmt(data.lateMonthlyNet - data.earlyMonthlyNet)}/mo
			</strong>
			(already net of a little extra income tax, since the enhanced CPP and CPP2 deductions stop too)
		{:else if lastMaxed}
			— maxed on the final cheque of the year.
		{/if}
	</div>
</div>
