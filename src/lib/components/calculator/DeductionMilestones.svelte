<script lang="ts">
	import type { RateConfig, SimulationResult } from '$lib/types';
	import { fmt, weekToDate } from '$lib/format';
	import { cardStyle, monoFont } from '$lib/styles';

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
				week: data.eiMaxedWeek,
				color: '#42a5f5',
				detail: `${(ei.rate * 100).toFixed(2)}% on earnings up to $${ei.mie.toLocaleString()}`
			},
			{
				label: 'CPP',
				max: cpp.maxEmployee,
				week: data.cppMaxedWeek,
				color: '#ffa726',
				detail: `${(cpp.rate * 100).toFixed(2)}% on $${cpp.exemption.toLocaleString()} – $${cpp.ympe.toLocaleString()}`
			},
			{
				label: 'CPP2',
				max: cpp2.maxEmployee,
				week: data.cpp2MaxedWeek,
				color: '#ffcc80',
				detail: `${(cpp2.rate * 100).toFixed(1)}% on $${cpp2.floor.toLocaleString()} – $${cpp2.yampe.toLocaleString()}`
			}
		];
	});

	let lastMaxWeek = $derived(data.cpp2MaxedWeek ?? data.cppMaxedWeek ?? data.eiMaxedWeek);
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
						Max <strong>${fmt(item.max)}</strong> — paid off by
						<strong style="color: {item.color};">
							{item.week != null ? `~${weekToDate(item.week)} (wk ${item.week})` : 'N/A'}
						</strong>
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
		— All maxed by
		<strong style="color: #66bb6a;">
			~{lastMaxWeek != null ? weekToDate(lastMaxWeek) : 'N/A'}
		</strong>, then monthly net jumps by
		<strong style="color: #66bb6a;">
			~${fmt(data.lateMonthlyNet - data.earlyMonthlyNet)}/mo
		</strong>
	</div>
</div>
