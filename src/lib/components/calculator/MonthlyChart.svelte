<script lang="ts">
	import type { MonthData } from '$lib/types';
	import { fmt } from '$lib/format';
	import { cardStyle } from '$lib/styles';

	interface Props {
		months: readonly MonthData[];
		avgMonthlyNet: number;
	}

	let { months, avgMonthlyNet }: Props = $props();

	const MONO = "'Space Mono', monospace";

	// Chart layout
	const HEIGHT = 280;
	const MARGIN = { top: 10, right: 10, bottom: 28, left: 58 };
	const MAX_BAR = 42;

	let container = $state<HTMLDivElement | null>(null);
	let width = $state(760);
	let hoverIdx = $state<number | null>(null);
	let cursorX = $state(0);
	let cursorY = $state(0);

	$effect(() => {
		if (!container) return;
		const ro = new ResizeObserver((entries) => {
			for (const e of entries) {
				width = e.contentRect.width;
			}
		});
		ro.observe(container);
		width = container.clientWidth;
		return () => ro.disconnect();
	});

	let innerWidth = $derived(Math.max(0, width - MARGIN.left - MARGIN.right));
	let innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

	let yMax = $derived.by(() => {
		const maxNet = months.reduce((m, x) => Math.max(m, x.net), 0);
		const upper = Math.max(maxNet, avgMonthlyNet);
		// round up to nearest 1k
		return Math.ceil(upper / 1000) * 1000 || 1000;
	});

	function yToPx(v: number): number {
		return MARGIN.top + innerHeight - (v / yMax) * innerHeight;
	}

	let bandWidth = $derived(innerWidth / Math.max(1, months.length));
	let barWidth = $derived(Math.min(MAX_BAR, bandWidth * 0.72));

	function barX(i: number): number {
		return MARGIN.left + i * bandWidth + (bandWidth - barWidth) / 2;
	}

	// Y axis ticks: 5 evenly spaced
	let yTicks = $derived.by(() => {
		const step = yMax / 4;
		return [0, 1, 2, 3, 4].map((i) => i * step);
	});

	function onMove(e: MouseEvent) {
		if (!container) return;
		const rect = container.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const relX = x - MARGIN.left;
		if (relX < 0 || relX > innerWidth) {
			hoverIdx = null;
			return;
		}
		const idx = Math.min(months.length - 1, Math.max(0, Math.floor(relX / bandWidth)));
		hoverIdx = idx;
		cursorX = x;
		cursorY = y;
	}

	function onLeave() {
		hoverIdx = null;
	}

	let refLineY = $derived(yToPx(avgMonthlyNet));
	let refLabel = $derived(`Avg $${(avgMonthlyNet / 1000).toFixed(1)}k/mo`);
</script>

<div style="{cardStyle} padding: 20px 20px 12px; margin-bottom: 24px;">
	<h2 style="font-size: 14px; font-weight: 700; margin: 0 0 16px; letter-spacing: 0.5px;">
		Monthly Net Pay
	</h2>
	<div
		bind:this={container}
		role="img"
		aria-label="Monthly net pay bar chart"
		style="position: relative; width: 100%; height: {HEIGHT}px;"
		onmousemove={onMove}
		onmouseleave={onLeave}
	>
		<svg {width} height={HEIGHT} style="display: block;">
			<!-- X axis baseline -->
			<line
				x1={MARGIN.left}
				x2={MARGIN.left + innerWidth}
				y1={MARGIN.top + innerHeight}
				y2={MARGIN.top + innerHeight}
				stroke="rgba(255,255,255,0.06)"
			/>

			<!-- Y axis ticks -->
			{#each yTicks as t (t)}
				<text
					x={MARGIN.left - 8}
					y={yToPx(t)}
					text-anchor="end"
					dominant-baseline="middle"
					fill="#6b6f85"
					font-size="11"
					font-family={MONO}
				>
					${(t / 1000).toFixed(0)}k
				</text>
			{/each}

			<!-- Hover cursor background -->
			{#if hoverIdx !== null}
				<rect
					x={MARGIN.left + hoverIdx * bandWidth}
					y={MARGIN.top}
					width={bandWidth}
					height={innerHeight}
					fill="rgba(255,255,255,0.03)"
				/>
			{/if}

			<!-- Bars -->
			{#each months as m, i (m.month)}
				{@const barY = yToPx(m.net)}
				{@const barH = Math.max(0, MARGIN.top + innerHeight - barY)}
				{@const color = m.net < avgMonthlyNet ? 'rgba(255,107,107,0.7)' : 'rgba(102,187,106,0.7)'}
				<!-- rounded-top bar using path -->
				<path
					d={`M${barX(i)} ${barY + 4} Q${barX(i)} ${barY} ${barX(i) + 4} ${barY} L${barX(i) + barWidth - 4} ${barY} Q${barX(i) + barWidth} ${barY} ${barX(i) + barWidth} ${barY + 4} L${barX(i) + barWidth} ${barY + barH} L${barX(i)} ${barY + barH} Z`}
					fill={color}
				/>
			{/each}

			<!-- X axis labels -->
			{#each months as m, i (m.month)}
				<text
					x={MARGIN.left + i * bandWidth + bandWidth / 2}
					y={MARGIN.top + innerHeight + 16}
					text-anchor="middle"
					fill="#6b6f85"
					font-size="12"
					font-family={MONO}
				>
					{m.month}
				</text>
			{/each}

			<!-- Reference line: avg -->
			<line
				x1={MARGIN.left}
				x2={MARGIN.left + innerWidth}
				y1={refLineY}
				y2={refLineY}
				stroke="#ffa726"
				stroke-width="2"
				stroke-dasharray="6 4"
			/>
			{#snippet refLabelGroup()}
				{@const tx = MARGIN.left + innerWidth - 8}
				{@const ty = refLineY + 18}
				{@const tw = refLabel.length * 6.5}
				{@const pw = 6}
				{@const ph = 3}
				<rect
					x={tx - tw - pw}
					y={ty - 10 - ph}
					width={tw + pw * 2}
					height={14 + ph * 2}
					rx="4"
					fill="rgba(13,13,26,0.85)"
				/>
				<text
					x={tx}
					y={ty}
					text-anchor="end"
					fill="#ffa726"
					font-size="11"
					font-family={MONO}
					font-weight="700">{refLabel}</text
				>
			{/snippet}
			{@render refLabelGroup()}
		</svg>

		{#if hoverIdx !== null}
			{@const d = months[hoverIdx]}
			<div
				style="position: absolute; left: {Math.min(cursorX + 12, width - 200)}px; top: {Math.max(
					cursorY - 10,
					0
				)}px; background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px 16px; font-family: 'DM Sans', sans-serif; font-size: 13px; color: #e0e0e0; line-height: 1.6; pointer-events: none; z-index: 10; min-width: 180px;"
			>
				<div style="font-weight: 700; margin-bottom: 4px; color: #fff;">{d.month}</div>
				<div>Gross: <span style="color: #8b8fa3;">${fmt(d.gross)}</span></div>
				<div>Income Tax: <span style="color: #ff6b6b;">−${fmt(d.tax)}</span></div>
				<div>CPP: <span style="color: #ffa726;">−${fmt(d.cpp)}</span></div>
				{#if d.cpp2 > 0.01}
					<div>CPP2: <span style="color: #ffcc80;">−${fmt(d.cpp2)}</span></div>
				{/if}
				{#if d.ei > 0.01}
					<div>EI: <span style="color: #42a5f5;">−${fmt(d.ei)}</span></div>
				{/if}
				{#if d.rrsp > 0.01}
					<div>RRSP: <span style="color: #ab47bc;">−${fmt(d.rrsp)}</span></div>
				{/if}
				<div
					style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 6px; padding-top: 6px; font-weight: 700; color: #66bb6a;"
				>
					Net: ${fmt(d.net)}
				</div>
			</div>
		{/if}
	</div>
	<div class="calc-legend" style="margin-top: 8px; padding-bottom: 4px;">
		<div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #6b6f85;">
			<div
				style="width: 10px; height: 10px; border-radius: 2px; background: rgba(255,107,107,0.7);"
			></div>
			Below average
		</div>
		<div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #6b6f85;">
			<div
				style="width: 10px; height: 10px; border-radius: 2px; background: rgba(102,187,106,0.7);"
			></div>
			Above average
		</div>
		<div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #6b6f85;">
			<div style="width: 12px; height: 2px; background: #ffa726;"></div>
			Annual average
		</div>
	</div>
</div>
