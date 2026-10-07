<script lang="ts">
	import type { ProvinceCode, RateConfig, TaxBracket } from '#lib/types.js';
	import {
		CANADA_EMPLOYMENT_AMOUNT,
		CPP_ENHANCED_RATE,
		PROVINCE_BRACKET_OVERRIDES,
		QUEBEC_ABATEMENT
	} from '#lib/constants.js';
	import { fmt } from '#lib/format.js';
	import { cardStyle, monoFont } from '#lib/styles.js';

	interface Props {
		config: RateConfig;
		province: ProvinceCode;
	}

	let { config, province }: Props = $props();

	const CRA = 'https://www.canada.ca/en/revenue-agency';
	const LINKS = [
		{
			label: 'T4127 Payroll Deductions Formulas (Jan 2026)',
			href: `${CRA}/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html`
		},
		{
			label: 'T4127 (Jul 2026 changes)',
			href: `${CRA}/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul/t4127-jul-payroll-deductions-formulas.html`
		},
		{
			label: 'Income tax rates',
			href: `${CRA}/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years.html`
		},
		{
			label: 'CPP',
			href: `${CRA}/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html`
		},
		{
			label: 'CPP2',
			href: `${CRA}/services/tax/businesses/topics/payroll/calculating-deductions/making-deductions/second-additional-cpp-contribution-rates-maximums.html`
		},
		{
			label: 'EI',
			href: `${CRA}/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html`
		}
	];
	const QUEBEC_LINK = {
		label: 'Québec Finance — 2026 income tax parameters',
		href: 'https://cdn-contenu.quebec.ca/cdn-contenu/adm/min/finances/publications-adm/parametres/AUTEN_IncomeTax2026.pdf'
	};

	let lastUpdated = $derived(
		config.meta.lastUpdated
			? new Date(config.meta.lastUpdated).toLocaleDateString('en-CA', {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				})
			: null
	);

	let prov = $derived(config.provinces[province]);
	let ei = $derived(province === 'QC' ? config.eiQuebec : config.ei);
	let fp = $derived(config.federalPersonal);
	let links = $derived(province === 'QC' ? [...LINKS, QUEBEC_LINK] : LINKS);

	function pct(rate: number): string {
		return `${+(rate * 100).toFixed(2)}%`;
	}

	function dollars(n: number): string {
		return `$${n.toLocaleString('en-CA')}`;
	}

	function bracketText(brackets: readonly TaxBracket[]): string {
		return brackets
			.map((b, i) =>
				i === brackets.length - 1 ? `${pct(b.rate)} over ${dollars(b.min)}` : pct(b.rate)
			)
			.join(' / ');
	}

	function bracketThresholds(brackets: readonly TaxBracket[]): string {
		return brackets
			.slice(1)
			.map((b) => dollars(b.min))
			.join(', ');
	}
</script>

<div style="{cardStyle} padding: 16px 20px; margin-bottom: 24px;">
	<div class="calc-sources-header" style="margin-bottom: 10px;">
		<h3 style="font-size: 12px; font-weight: 700; margin: 0; color: #9094a8; letter-spacing: 1px;">
			SOURCES ({config.year})
		</h3>
		{#if lastUpdated}
			<span style="font-size: 10px; color: {config.meta.stale ? '#ff6b6b' : '#6b6f85'}; {monoFont}">
				{config.meta.stale ? '⚠ Stale — ' : ''}Last updated: {lastUpdated}
				{config.meta.source === 'fallback' ? ' (fallback)' : ''}
			</span>
		{/if}
	</div>
	{#if config.meta.stale}
		<div
			style="font-size: 11px; color: #ff6b6b; background: rgba(255,107,107,0.08); border: 1px solid rgba(255,107,107,0.15); border-radius: 6px; padding: 6px 10px; margin-bottom: 10px;"
		>
			Rate data is more than 48 hours old. Values shown may be outdated.
		</div>
	{/if}
	<div style="font-size: 12px; color: #9094a8; line-height: 1.9;">
		<div>
			CPP:
			<span style="color: #c0c0d0;">
				{pct(config.cpp.rate)} on {dollars(config.cpp.exemption)}–{dollars(config.cpp.ympe)} (max ${fmt(
					config.cpp.maxEmployee
				)})
			</span>
			· CPP2:
			<span style="color: #c0c0d0;">
				{pct(config.cpp2.rate)} on {dollars(config.cpp2.floor)}–{dollars(config.cpp2.yampe)} (max ${fmt(
					config.cpp2.maxEmployee
				)})
			</span>
		</div>
		<div>
			EI{province === 'QC' ? ' (Quebec)' : ''}:
			<span style="color: #c0c0d0;">
				{pct(ei.rate)} to {dollars(ei.mie)} (max ${fmt(ei.maxEmployee)})
			</span>
		</div>
		<div>
			Federal tax:
			<span style="color: #c0c0d0;">
				{bracketText(config.federalBrackets)} (thresholds {bracketThresholds(
					config.federalBrackets
				)})
			</span>
		</div>
		<div>
			Federal credits:
			<span style="color: #c0c0d0;">
				basic personal amount {dollars(fp.amountMax)} (reduced to {dollars(fp.amountMin)} from {dollars(
					fp.clawbackStart
				)}–{dollars(fp.clawbackEnd)}) · Canada employment amount {dollars(CANADA_EMPLOYMENT_AMOUNT)} ·
				base CPP and EI contributions, all at {pct(config.federalBrackets[0].rate)}
			</span>
		</div>
		<div>
			Deductions:
			<span style="color: #c0c0d0;">
				enhanced CPP ({pct(CPP_ENHANCED_RATE)} of the {pct(config.cpp.rate)}) and all of CPP2 reduce
				taxable income
			</span>
		</div>
		{#if prov}
			<div>
				{prov.name} tax:
				<span style="color: #c0c0d0;">
					{bracketText(prov.brackets)}{prov.brackets.length > 1
						? ` (thresholds ${bracketThresholds(prov.brackets)})`
						: ''}
				</span>
			</div>
			<div>
				{prov.name} credits:
				<span style="color: #c0c0d0;">
					basic personal amount {dollars(prov.personalAmount)}{prov.personalAmountClawback
						? ` (reduced to ${dollars(prov.personalAmountClawback.amountMin)} from ${dollars(prov.personalAmountClawback.start)}–${dollars(prov.personalAmountClawback.end)})`
						: ''}{province === 'QC' ? '' : ' · base CPP and EI contributions'}, at {pct(
						prov.brackets[0].rate
					)}
				</span>
			</div>
			{#if prov.surtax?.length}
				<div>
					{prov.name} surtax:
					<span style="color: #c0c0d0;">
						{prov.surtax
							.map((s) => `${pct(s.rate)} of provincial tax over ${dollars(s.threshold)}`)
							.join(' + ')}
					</span>
				</div>
			{/if}
			{#if prov.taxReductionBasic}
				<div>
					{prov.name} tax reduction:
					<span style="color: #c0c0d0;">
						{dollars(prov.taxReductionBasic)} basic amount (no dependants)
					</span>
				</div>
			{/if}
			{#if prov.healthPremiumTiers?.length}
				<div>
					{prov.name} Health Premium:
					<span style="color: #c0c0d0;">
						$0–{dollars(prov.healthPremiumTiers[prov.healthPremiumTiers.length - 1].flat)} based on taxable
						income over {dollars(prov.healthPremiumTiers[0].upTo)}
					</span>
				</div>
			{/if}
			{#if province === 'QC'}
				<div>
					Quebec abatement:
					<span style="color: #c0c0d0;">
						federal tax reduced by {pct(QUEBEC_ABATEMENT)}
					</span>
				</div>
			{/if}
		{/if}
		<div style="margin-top: 6px; color: #6b6f85;">
			{#each links as link, i (link.href)}
				<a
					href={link.href}
					target="_blank"
					rel="noopener noreferrer"
					style="color: #8b9cc8; text-decoration: underline; text-underline-offset: 2px;"
					>{link.label}</a
				>{i < links.length - 1 ? ' · ' : ''}
			{/each}
		</div>
		<div style="color: #6b6f85;">
			CPP, EI and most tax brackets are pulled from CRA (canada.ca); personal amounts, surtaxes and
			credits are maintained by hand from T4127.
			{#if PROVINCE_BRACKET_OVERRIDES[province] && province !== 'QC'}
				{prov?.name} brackets include 2026 changes from T4127 (Jul 2026) that CRA's rates page doesn't
				show yet.
			{/if}
			{#if province === 'QC'}
				Quebec tax uses Québec Finance figures; QPP, QPIP and Quebec-specific deductions are not
				modelled.
			{/if}
			Tax is estimated — actual payroll withholding may vary.
		</div>
	</div>
</div>
