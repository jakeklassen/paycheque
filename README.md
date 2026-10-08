# Canadian Paycheck Deduction Calculator

See how CPP, CPP2 and EI front-load your deductions, and when your take-home pay jumps. Pick a
salary, pay frequency and province; the calculator simulates each paycheque with CRA's T4127
payroll formulas and shows the refund or balance owing at filing time.

It's a static SvelteKit site (no server), deployed to GitHub Pages.

## Developing

Node and pnpm versions are in `mise.toml`.

```sh
pnpm install
pnpm dev          # dev server
pnpm test         # unit tests
pnpm lint         # prettier + eslint
pnpm check        # svelte-check
pnpm build        # static site in build/
```

## Rates

All rates live in `src/lib/rates.json`: CPP, CPP2, EI, federal and provincial brackets, personal
amounts, surtaxes, tax reductions and the Ontario Health Premium. They are annual values; where a
mid-year change makes CRA's July edition show a prorated payroll rate, the annual rate is used.

```sh
pnpm check:rates           # compare rates.json with CRA's T4127
pnpm check:rates --write   # also update rates.json from a January edition
```

CRA doesn't publish Quebec's provincial brackets or basic personal amount. Update those (and
`quebecYear`) from Québec Finance's "Parameters of the personal income tax system", published each
November.

The tests use a frozen copy of the 2026 rates (`src/lib/test-fixtures/rates-2026.json`), so their
expected values don't change when `rates.json` does.

## GitHub Actions

- **CI** (`.github/workflows/ci.yml`): lint, type-check, test and build on every push and pull
  request; deploys `main` to GitHub Pages.
- **Rate check** (`.github/workflows/rates.yml`): every Monday, runs `pnpm check:rates --write`.
  New January-edition values become a pull request; anything that needs a person (July prorated
  values, Quebec, a changed CRA page) becomes an issue, which closes itself once everything
  matches.

One-time setup:

1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Actions → General → Workflow permissions: allow **GitHub Actions to create and
   approve pull requests**.

GitHub disables scheduled workflows after 60 days without repository activity; re-enable the rate
check from the Actions tab if that happens.
