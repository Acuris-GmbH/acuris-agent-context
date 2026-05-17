# Changelog

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
