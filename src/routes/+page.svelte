<script lang="ts">
	import type { ProvinceCode } from '#lib/types.js';
	import { simulate } from '#lib/simulation.js';
	import { monoFont } from '#lib/styles.js';
	import InputSection from '#lib/components/calculator/InputSection.svelte';
	import StatCards from '#lib/components/calculator/StatCards.svelte';
	import DeductionMilestones from '#lib/components/calculator/DeductionMilestones.svelte';
	import MonthlyChart from '#lib/components/calculator/MonthlyChart.svelte';
	import AnnualBreakdown from '#lib/components/calculator/AnnualBreakdown.svelte';
	import Sources from '#lib/components/calculator/Sources.svelte';
	import { browser } from '$app/env';
	import { untrack } from 'svelte';

	const COOKIE_NAME = 'calc-inputs';
	const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

	let { data } = $props();
	let config = $derived(data.config);

	let salary = $state(untrack(() => data.savedInputs?.salary ?? 217_703));
	let rrspWeekly = $state(untrack(() => data.savedInputs?.rrsp ?? 0));
	let province = $state<ProvinceCode>(untrack(() => data.savedInputs?.province ?? 'ON'));

	$effect(() => {
		if (!browser) return;
		const value = encodeURIComponent(JSON.stringify({ salary, rrsp: rrspWeekly, province }));
		document.cookie = `${COOKIE_NAME}=${value};path=/;max-age=${MAX_AGE};samesite=lax`;
	});

	let sim = $derived(simulate(salary, rrspWeekly, province, config));
</script>

<div
	style="min-height: 100vh; background: linear-gradient(170deg, #0d0d1a 0%, #151528 40%, #1a1a2e 100%); font-family: 'DM Sans', sans-serif; color: #e8e8ef; padding: 32px 20px 60px;"
>
	<div style="max-width: 880px; margin: 0 auto;">
		<div style="margin-bottom: 32px;">
			<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
				<div
					style="width: 8px; height: 8px; border-radius: 50%; background: #66bb6a; box-shadow: 0 0 8px rgba(102,187,106,0.5);"
				></div>
				<span
					style="{monoFont} font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #8b8fa3;"
				>
					Canada {config.year}
				</span>
			</div>
			<h1
				style="font-size: 28px; font-weight: 700; margin: 0; line-height: 1.2; background: linear-gradient(135deg, #e8e8ef 0%, #a0a0b8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;"
			>
				Paycheck Deduction Calculator
			</h1>
			<p style="color: #6b6f85; font-size: 14px; margin-top: 6px; line-height: 1.5;">
				See how CPP, CPP2 &amp; EI front-load your deductions — and when your take-home pay jumps.
			</p>
		</div>

		<InputSection
			{salary}
			onSalaryChange={(v) => (salary = v)}
			rrsp={rrspWeekly}
			onRrspChange={(v) => (rrspWeekly = v)}
			{province}
			onProvinceChange={(c) => (province = c)}
			provinces={config.provinces}
		/>

		<StatCards
			earlyMonthlyNet={sim.earlyMonthlyNet}
			avgMonthlyNet={sim.avgMonthlyNet}
			lateMonthlyNet={sim.lateMonthlyNet}
		/>

		<DeductionMilestones data={sim} {config} />

		<MonthlyChart months={sim.months} avgMonthlyNet={sim.avgMonthlyNet} />

		<AnnualBreakdown {salary} {province} data={sim} {config} />

		<Sources {config} />
	</div>
</div>
