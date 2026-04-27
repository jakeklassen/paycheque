<script lang="ts">
	import type { ProvinceCode, ProvinceConfig } from '$lib/types';
	import { monoFont } from '$lib/styles';

	interface Props {
		value: ProvinceCode;
		onChange: (code: ProvinceCode) => void;
		provinces: Record<string, ProvinceConfig>;
	}

	let { value, onChange, provinces }: Props = $props();

	let open = $state(false);
	let ref = $state<HTMLDivElement | null>(null);

	function handleOutsideClick(e: MouseEvent) {
		if (open && ref && !ref.contains(e.target as Node)) {
			open = false;
		}
	}

	let sortedCodes = $derived(
		Object.keys(provinces).sort((a, b) =>
			(provinces[a]?.name ?? a).localeCompare(provinces[b]?.name ?? b)
		)
	);

	const buttonStyle = $derived(
		`background: rgba(255,255,255,0.06); border: 1px solid; border-color: ${open ? 'rgba(102,187,106,0.4)' : 'rgba(255,255,255,0.1)'}; border-radius: 6px; color: #e8e8ef; font-size: 16px; font-weight: 700; padding: 6px 36px 6px 10px; outline: none; width: 100%; ${monoFont} cursor: pointer; text-align: left; position: relative; transition: border-color 0.15s;`
	);

	function itemStyle(selected: boolean): string {
		return `display: block; width: 100%; text-align: left; padding: 10px 14px; border: none; outline: none; cursor: pointer; background: ${selected ? 'rgba(102,187,106,0.12)' : 'transparent'}; color: ${selected ? '#66bb6a' : '#c0c0d0'}; font-size: 14px; font-weight: ${selected ? 700 : 500}; ${monoFont} transition: background 0.1s;`;
	}
</script>

<svelte:document onmousedown={handleOutsideClick} />

<div bind:this={ref} style="margin-top: 8px; position: relative;">
	<button type="button" onclick={() => (open = !open)} style={buttonStyle}>
		{provinces[value]?.name ?? value}
		<svg
			width="12"
			height="12"
			viewBox="0 0 12 12"
			style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%) rotate({open
				? 180
				: 0}deg); transition: transform 0.2s ease;"
		>
			<path
				d="M2.5 4.5L6 8L9.5 4.5"
				stroke="#6b6f85"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				fill="none"
			/>
		</svg>
	</button>
	{#if open}
		<div
			style="position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 50; background: #1e1e36; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.5); max-height: 320px; overflow-y: auto;"
		>
			{#each sortedCodes as code (code)}
				{@const prov = provinces[code]}
				{@const selected = code === value}
				{#if prov}
					<button
						type="button"
						onclick={() => {
							onChange(code as ProvinceCode);
							open = false;
						}}
						style={itemStyle(selected)}
						onmouseenter={(e) => {
							if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
						}}
						onmouseleave={(e) => {
							if (!selected) e.currentTarget.style.background = 'transparent';
						}}
					>
						{prov.name}
						{#if selected}
							<span style="float: right; font-size: 12px; opacity: 0.7;">✓</span>
						{/if}
					</button>
				{/if}
			{/each}
		</div>
	{/if}
</div>
