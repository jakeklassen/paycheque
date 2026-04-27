<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<div
	style="min-height: 100vh; background: linear-gradient(170deg, #0d0d1a 0%, #151528 40%, #1a1a2e 100%); font-family: 'DM Sans', sans-serif; color: #e8e8ef; display: flex; align-items: center; justify-content: center; padding: 32px 20px;"
>
	<div style="text-align: center; max-width: 420px;">
		<div
			style="font-family: 'Space Mono', monospace; font-size: 72px; font-weight: 700; background: linear-gradient(135deg, #ff6b6b 0%, #ffa726 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1; margin-bottom: 16px;"
		>
			{page.status}
		</div>
		<p style="color: #9094a8; font-size: 16px; margin: 0 0 24px; line-height: 1.5;">
			{page.status === 404
				? "This page doesn't exist. Maybe you were looking for the calculator?"
				: (page.error?.message ?? 'Something went wrong.')}
		</p>
		<a
			href={resolve('/')}
			style="display: inline-block; padding: 10px 24px; background: rgba(102,187,106,0.15); border: 1px solid rgba(102,187,106,0.3); border-radius: 8px; color: #66bb6a; font-size: 14px; font-weight: 600; text-decoration: none; transition: background 0.15s;"
		>
			Go to Calculator
		</a>
	</div>
</div>
