<script lang="ts">
	import type { ProvinceCode, ProvinceConfig } from '$lib/types';
	import { cardStyle, labelStyle } from '$lib/styles';
	import CurrencyInput from './CurrencyInput.svelte';
	import ProvinceDropdown from './ProvinceDropdown.svelte';

	interface Props {
		salary: number;
		onSalaryChange: (value: number) => void;
		rrsp: number;
		onRrspChange: (value: number) => void;
		province: ProvinceCode;
		onProvinceChange: (code: ProvinceCode) => void;
		provinces: Record<string, ProvinceConfig>;
	}

	let { salary, onSalaryChange, rrsp, onRrspChange, province, onProvinceChange, provinces }: Props =
		$props();

	const cardWithPad = `${cardStyle} padding: 16px 20px;`;
</script>

<div class="calc-grid-3" style="margin-bottom: 24px;">
	<div style={cardWithPad}>
		<div style={labelStyle}>Annual Gross Salary</div>
		<CurrencyInput value={salary} onChange={onSalaryChange} />
	</div>
	<div style={cardWithPad}>
		<div style={labelStyle}>Weekly RRSP</div>
		<CurrencyInput value={rrsp} onChange={onRrspChange} />
	</div>
	<div style={cardWithPad}>
		<div style={labelStyle}>Province</div>
		<ProvinceDropdown value={province} onChange={onProvinceChange} {provinces} />
	</div>
</div>
