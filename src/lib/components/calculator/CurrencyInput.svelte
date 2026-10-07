<script lang="ts">
	import { monoFont } from '#lib/styles.js';

	interface Props {
		value: number;
		onChange: (value: number) => void;
	}

	let { value, onChange }: Props = $props();

	const formatter = new Intl.NumberFormat('en-CA', {
		maximumFractionDigits: 2,
		useGrouping: true
	});

	function strip(s: string): string {
		return s.replace(/,/g, '');
	}

	let editing = $state(false);
	let draft = $state('');

	let displayValue = $derived(editing ? draft : formatter.format(value));

	function handleFocus() {
		draft = String(value);
		editing = true;
	}

	function commit() {
		editing = false;
		const n = parseFloat(strip(draft));
		if (!isNaN(n) && n >= 0) onChange(n);
	}

	function handleCopy(e: ClipboardEvent) {
		e.preventDefault();
		const raw = editing ? strip(draft) : String(value);
		e.clipboardData?.setData('text/plain', raw);
	}

	const inputStyle = `flex: 1; background: transparent; border: none; outline: none; font-size: 20px; font-weight: 700; color: #e8e8ef; ${monoFont} width: 100%;`;
</script>

<div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
	<span style="color: #6b6f85; font-size: 20px; font-weight: 600;">$</span>
	<input
		value={displayValue}
		oninput={(e) => (draft = (e.currentTarget as HTMLInputElement).value)}
		onfocus={handleFocus}
		onblur={commit}
		onkeydown={(e) => e.key === 'Enter' && commit()}
		oncopy={handleCopy}
		style={inputStyle}
		inputmode="decimal"
	/>
</div>
