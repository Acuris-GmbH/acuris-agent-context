# Changelog

## 0.2.1 — 2026-05-17

- Quick-start examples bumped to `@acuris-geo/centra-checkout@^0.1.2`
  (visible default dropdown styles).
- New "Styling" section in `references/autocomplete.md` documenting:
  the zero-specificity default styles, the three override paths
  (`suggestionsClassName`, `renderSuggestion`, the
  `data-acuris-default-styles="off"` attribute), and the
  selector-stable hook points (`[data-acuris-input]`,
  `[data-acuris-suggestions]`, etc.).
- Surfaced by a real demo where the previous-generation agent produced
  a working backend but an invisible dropdown — Tailwind v4 preflight
  stripped the `<ul>/<li>` defaults. Fixed both in the component
  (0.1.2 ships defaults) and in the skill (the section explains the
  contract).

## 0.2.0 — 2026-05-17

- **New skill `acuris-eudi`** for the Acuris EUDI Wallet Verifier
  (`https://eudi.acuris-geo.com`). SKILL.md + 7 references covering
  relying-party backend integration, the full session lifecycle,
  what each `verification_status` / `accuracy_type` bucket means for
  bank KYC decisions, the LOTL→TSL→x5c→CRL trust model, the address
  whitelist + selective-disclosure rationale, the wallet-side flow
  (read-only context for RPs), and mTLS bank-pilot setup.
- **New Cursor MDC rule `acuris-eudi.mdc`** (agent-selected, no
  glob — pulled in when the model decides EUDI integration is
  relevant).
- Build pipeline now ships **two skills in one Claude Code plugin**;
  marketplace entry renamed `acuris-address` → `acuris` to reflect
  the broader scope.
- **Address skill (`acuris-address`):**
  - Quick-start now pins explicit versions (`@^0.1.2` / `@^0.1.1`) so
    agents stop guessing `^1.0.0` and getting npm `ETARGET`.
  - `<AcurisAddressInput>` and `<AcurisAddressValidator>` prop tables
    added to `autocomplete.md`. `minQueryLength` (not `minLength`)
    is now documented.
  - Replaced the misleading blanket "`test` key works for evaluation"
    advice with the new `POST /dev-key` self-service flow (100
    validations + 100 geocodes for 7 days, returned in the response
    body — no email round-trip). `test` is now correctly described as
    suggest-only.
  - New "Tuning timeouts and the retry budget" section explaining the
    cold-first-call sensitivity, with a recommendation to bump
    `timeoutMs` to 10s for proxy paths that can't absorb a 15s
    retry-loop wall time.
- Cursor docs site now serves the EUDI skill at `/eudi/` alongside the
  address skill at `/`, with a landing page linking to both.

## 0.1.0 — 2026-05-17

Initial release.

- Single-source `src/skill/SKILL.md` + 11 references covering the four
  Acuris endpoints, common implementation patterns (autocomplete,
  validation, geocoding, reverse geocoding, batch, Next.js proxy,
  plain Node, Centra storefront), and migration recipes from
  Informatica AddressDoctor, Loqate, Experian QAS, Melissa, and
  Smarty.
- Three projections: `claude-code-plugin/`, `agent-skill/`,
  `cursor-docs/`, plus a `skills/` alias for `npx skills add`
  auto-detection and a repo-root `.claude-plugin/marketplace.json`.
- One Node build script (`scripts/build.mjs`, zero dependencies) and
  a CI `--check` mode that fails PRs whose projections drift from
  source.
- Four Cursor MDC rules: overview (agent-selected), autocomplete
  (auto-attached on checkout / address React files), validation
  (auto-attached on server-side address routes), and migration
  (manual via `@acuris-migration`).
