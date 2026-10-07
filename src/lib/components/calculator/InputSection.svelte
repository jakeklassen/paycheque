<script lang="ts">
	import type { PayFrequency, ProvinceCode, ProvinceConfig } from '#lib/types.js';
	import { PAY_FREQUENCIES } from '#lib/constants.js';
	import { cardStyle, labelStyle } from '#lib/styles.js';
	import CurrencyInput from './CurrencyInput.svelte';
	import Dropdown from './Dropdown.svelte';

	interface Props {
		salary: number;
		onSalaryChange: (value: number) => void;
		rrsp: number;
		onRrspChange: (value: number) => void;
		frequency: PayFrequency;
		onFrequencyChange: (value: PayFrequency) => void;
		province: ProvinceCode;
		onProvinceChange: (code: ProvinceCode) => void;
		provinces: Record<string, ProvinceConfig>;
	}

	let {
		salary,
		onSalaryChange,
		rrsp,
		onRrspChange,
		frequency,
		onFrequencyChange,
		province,
		onProvinceChange,
		provinces
	}: Props = $props();

	const frequencyOptions = (Object.keys(PAY_FREQUENCIES) as PayFrequency[]).map((value) => ({
		value,
		label: PAY_FREQUENCIES[value].label
	}));

	let provinceOptions = $derived(
		(Object.keys(provinces) as ProvinceCode[])
			.map((value) => ({ value, label: provinces[value]?.name ?? value }))
			.sort((a, b) => a.label.localeCompare(b.label))
	);

	const cardWithPad = `${cardStyle} padding: 16px 20px;`;
</script>

<div class="calc-grid-4" style="margin-bottom: 24px;">
	<div style={cardWithPad}>
		<div style={labelStyle}>Annual Gross Salary</div>
		<CurrencyInput value={salary} onChange={onSalaryChange} />
	</div>
	<div style={cardWithPad}>
		<div style={labelStyle}>Weekly RRSP</div>
		<CurrencyInput value={rrsp} onChange={onRrspChange} />
	</div>
	<div style={cardWithPad}>
		<div style={labelStyle}>Pay Frequency</div>
		<Dropdown
			label="Pay frequency"
			value={frequency}
			onChange={onFrequencyChange}
			options={frequencyOptions}
		/>
	</div>
	<div style={cardWithPad}>
		<div style={labelStyle}>Province</div>
		<Dropdown
			label="Province"
			value={province}
			onChange={onProvinceChange}
			options={provinceOptions}
		/>
	</div>
</div>
