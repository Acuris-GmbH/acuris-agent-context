# Acuris agent context

Comprehensive context for AI coding agents to build with the
[Acuris](https://acuris-geo.com) Address Validation & Geocoding APIs.
Distributed in three formats from one source of truth:

- **[Claude Code plugin](./claude-code-plugin/)** — installable via
  `/plugin install`, or `claude --plugin-dir ./claude-code-plugin`.
- **[Cursor docs/rules](./cursor-docs/)** — drop-in `.cursor/rules/*.mdc`
  plus a public docs site for the `@Docs` indexer.
- **[Open Agent Skill](./agent-skill/)** — installable via
  `npx skills add` on Claude Code, Cursor, GitHub Copilot, Codex,
  OpenCode, Gemini CLI, Kiro, Goose, and ~30 other tools listed at
  [agentskills.io](https://agentskills.io).

All three teach two skills:

- **`acuris-address`** — Address Validation, Geocoding, Reverse
  Geocoding, Autocomplete. How to wire `@acuris-geo/av-sdk` and
  `@acuris-geo/centra-checkout` correctly, and how to migrate from
  libAddressDoctor (Informatica), Loqate, Experian QAS, Melissa, or
  Smarty.
- **`acuris-eudi`** — EUDI Wallet Verifier. How to integrate
  `https://eudi.acuris-geo.com` as a relying party for OID4VP /
  SD-JWT VC PID verification with EU 27 trust validation, typically
  for bank KYC and branch-onboarding flows.

Each skill auto-activates only when the user's task matches its
description, so installing both costs almost no context.

> **Status:** `0.2.0`. The underlying APIs are stable; this context
> package follows them. Expect occasional content additions as new
> recipes, migration vendors, and verifier features land.

## Why this exists

When you ask any AI coding agent to "add address validation," you tend
to get one of two failure modes: hand-rolled `fetch` calls that hit
the wrong header (`Authorization: Bearer …` instead of `X-Acuris-Key`),
or correct code calling a fictitious endpoint. This package gives the
agent the actual SDK shape, the real headers, the right error types,
and a library of pre-vetted recipes so it generates code that
compiles and runs.

This pattern was popularized for cloud APIs by Amazon Location's
[agent-context release in February 2026](https://github.com/aws-geospatial/amazon-location-agent-context).
We follow their three-format approach (same source-of-truth split with
one transformation step per format) and adapt it to Acuris.

## What's in here

```
src/                       Canonical source — edit here, then rebuild.
├── skill/                 SKILL.md + references/ — the actual content.
├── manifests/             Per-format JSON manifest templates.
└── rules/                 Cursor MDC rule sources.

claude-code-plugin/        Generated: Claude Code plugin.
agent-skill/               Generated: open Agent Skill package.
skills/                    Generated alias so `npx skills add` finds the skill.
cursor-docs/               Generated: Cursor rules + flat docs site.
.claude-plugin/            Generated: marketplace.json at repo root.

scripts/build.mjs          One Node script, zero deps, rebuilds all projections.
research.md                Phase-1 research that informed the design.
design.md                  Phase-2 architecture decisions.
```

## Install

### Claude Code

```text
/plugin marketplace add Acuris-GmbH/acuris-agent-context
/plugin install acuris-address@acuris-plugins
```

Or for local development of this package:

```bash
git clone https://github.com/Acuris-GmbH/acuris-agent-context
claude --plugin-dir ./acuris-agent-context/claude-code-plugin
```

Once installed, the `acuris-address` skill auto-activates when your
task mentions address validation, autocomplete, geocoding, or any of
the supported migration sources. You can also invoke it explicitly with
`/acuris-plugins:acuris-address`.

### Cursor

Three options, mix and match:

1. **Drop-in rules** (works in any Cursor project):

   ```bash
   git clone https://github.com/Acuris-GmbH/acuris-agent-context
   mkdir -p .cursor/rules
   cp acuris-agent-context/cursor-docs/rules/*.mdc .cursor/rules/
   ```

   The four rules auto-attach to checkout / address / API-route files
   and pull themselves in when relevant.

2. **`@Docs` indexer** (once GitHub Pages is enabled):

   In Cursor → `Settings → Indexing & Docs → @Docs → Add new doc`,
   add `https://acuris-gmbh.github.io/acuris-agent-context/`.

3. **Open Agent Skill** (native Cursor support):

   ```bash
   npx skills add Acuris-GmbH/acuris-agent-context -a cursor
   ```

### Any other agent that supports the Agent Skills standard

```bash
# Interactive — pick your agent:
npx skills add Acuris-GmbH/acuris-agent-context

# Or specific:
npx skills add Acuris-GmbH/acuris-agent-context -a github-copilot
npx skills add Acuris-GmbH/acuris-agent-context -a opencode
npx skills add Acuris-GmbH/acuris-agent-context -a codex
npx skills add Acuris-GmbH/acuris-agent-context -a gemini-cli
npx skills add Acuris-GmbH/acuris-agent-context -a kiro-cli
```

The full list of compatible tools is at <https://agentskills.io>.

### Direct context

If your agent doesn't speak any of the above protocols, point it at the
canonical SKILL.md and the references:

```
skills/acuris-address/SKILL.md
skills/acuris-address/references/*.md
```

## What the skill teaches

- **API surface**: the four endpoints (`POST /validate`, `GET /geocode`,
  `GET /reverse`, `GET /suggest`), auth via `X-Acuris-Key`, ISO-3
  lowercase country codes, the typed error hierarchy.
- **SDK usage**: `AcurisClient` patterns, server-side-only key handling,
  retry semantics, cancellation via `AbortSignal`.
- **Implementation recipes**: React autocomplete in checkout flows,
  validate-on-submit, forward geocoding for shipping, reverse geocoding
  from coordinates, batch cleanup, Next.js proxy routes, plain Node
  servers, and the Centra-storefront integration.
- **Migrations**: vendor-to-Acuris recipes for Informatica
  AddressDoctor, Loqate, Experian QAS, Melissa, and Smarty.

## Authoring + rebuilding

Edit anything under `src/`. Then:

```bash
node scripts/build.mjs           # rebuild all three projections
node scripts/build.mjs --check   # CI gate: fail if projections are stale
```

The build script is plain Node — no install needed. CI runs `--check`
on every PR; PRs must commit source and projection changes together.

The design rationale is in [`design.md`](./design.md); the underlying
research on each format's current schema is in
[`research.md`](./research.md).

## License

MIT © Acuris GmbH. See [LICENSE](./LICENSE).
