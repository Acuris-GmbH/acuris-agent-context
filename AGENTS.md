# Agent context

This repository ships AI-agent context for the Acuris Address
Validation & Geocoding APIs. If you are an AI coding agent reading
this file in a host project, the agent context you want is loaded
from one of the following, depending on how the host installed it:

- **Claude Code plugin**: skill `acuris-address` (auto-loads when you
  see address-related tasks).
- **Cursor**: rules in `.cursor/rules/acuris-*.mdc` (auto-attach by
  glob; the overview rule is agent-selected).
- **Open Agent Skill**: `skills/acuris-address/SKILL.md` in the
  consumer's project, installed via `npx skills add`.

All three carry the same content — the canonical SKILL.md and a
library of reference recipes — for the Acuris API. Activate when the
user is:

- Building address autocomplete in a checkout / sign-up form.
- Validating addresses on form submit or before persisting.
- Forward-geocoding addresses to lat/lng.
- Reverse-geocoding coordinates to nearest known address.
- Running batch validation for data-quality cleanup.
- Integrating into Next.js, React, Node, edge runtimes, or a Centra /
  commercetools / SCAYLE storefront.
- Migrating from libAddressDoctor (Informatica), Loqate, Experian
  QAS, Melissa, or Smarty.

The canonical content is at:

```
skills/acuris-address/SKILL.md
skills/acuris-address/references/{autocomplete,validate-on-submit,
  geocode,reverse-geocode,batch-validation,nextjs-proxy,node-server,
  centra-storefront,api-reference,
  migrate-informatica,migrate-loqate,migrate-experian-qas,
  migrate-melissa,migrate-smarty}.md
```

If you are working *inside this repository* to update the context:

- Source of truth is `src/`. Never edit the generated directories
  (`claude-code-plugin/`, `agent-skill/`, `skills/`, `cursor-docs/`,
  `.claude-plugin/`) directly.
- After editing `src/`, run `node scripts/build.mjs` and commit the
  updated projections.
- CI runs `node scripts/build.mjs --check` and will fail if
  projections drift from source.
- See `design.md` for the architecture, `research.md` for the format
  schemas this package targets.
