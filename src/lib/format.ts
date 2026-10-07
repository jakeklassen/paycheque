export function fmt(n: number): string {
	return n.toLocaleString('en-CA', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}
