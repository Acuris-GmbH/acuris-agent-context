# Design — Acuris agent-context package

Phase-2 deliverable. Documents the architecture chosen after research,
the source-of-truth strategy, and the projection rules for each
distribution format. Companion to `research.md`.

## 1. Goal

One Acuris API knowledge package, distributed in three formats, with no
content drift between them:

- A **Claude Code plugin** installable via `/plugin install` or
  `--plugin-dir`.
- A **Cursor docs/rules** bundle that consumers drop into their repo
  (`.cursor/rules/*.mdc`) plus a hosted docs URL Cursor can index via
  `@Docs`.
- An **open Agent Skill** package installable via the universal
  `npx skills add` CLI on Cursor, Claude Code, Codex, OpenCode, GitHub
  Copilot, Gemini CLI, Goose, Kiro, and the other ~30 tools listed at
  agentskills.io.

## 2. Source-of-truth strategy

The canonical content lives at:

```
src/
  skill/
    SKILL.md                  — primary skill entry point (frontmatter + body)
    references/
      api-reference.md        — endpoint shapes, auth, errors, types
      autocomplete.md         — typeahead recipe (React + Next.js proxy)
      validate-on-submit.md   — form-validation recipe
      geocode.md              — forward geocoding for shipping/distance
      reverse-geocode.md      — coordinates → address
      batch-validation.md     — bulk cleanup pattern
      nextjs-proxy.md         — server-route boilerplate
      node-server.md          — vanilla Node usage
      centra-storefront.md    — Centra connector recipe
      migrate-informatica.md  — libAddressDoctor → Acuris
      migrate-loqate.md       — Loqate Capture → Acuris
      migrate-experian-qas.md — Experian QAS → Acuris
      migrate-melissa.md      — Melissa Personator → Acuris
      migrate-smarty.md       — Smarty US/International → Acuris
  manifests/
    plugin.json               — Claude Code plugin manifest template
    marketplace.json          — marketplace.json template
    mcp.json                  — (placeholder; no Acuris MCP server yet)
    skill-package.json        — package metadata for the open Agent Skill
  rules/
    *.mdc                     — Cursor MDC rule sources (3–5 files)
```

This is the **only** location where content is edited. Every projection
is rebuilt from here.

Why a canonical SKILL.md and not a YAML/JSON intermediate format:

- The Anthropic Skill format is the format with the broadest reach
  (30+ tools), and `SKILL.md` is already markdown-with-frontmatter — a
  natural authoring format.
- Both the Claude Code plugin projection and the open Agent Skill
  projection use this file *verbatim*. Only Cursor needs a
  transformation, and that transformation is bounded.
- A YAML intermediate would force every reader to learn a new
  vocabulary and every change to round-trip through a templating layer.
  Not worth it for this scope.

## 3. Projection map

| Projection target               | What gets generated                                                            |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `claude-code-plugin/`           | Plugin manifest + copy of `src/skill/` → `skills/acuris-address/`              |
| `claude-code-plugin/.claude-plugin/plugin.json` | `src/manifests/plugin.json`                                    |
| `.claude-plugin/marketplace.json` (repo root) | `src/manifests/marketplace.json` (points `source` at `./claude-code-plugin`) |
| `agent-skill/acuris-address/`   | Direct copy of `src/skill/`. This is the `npx skills add` payload.            |
| `agent-skill/package.json`      | `src/manifests/skill-package.json` (helps if we later publish to npm)         |
| `cursor-docs/rules/*.mdc`       | Generated from `src/rules/*.mdc` + body excerpts from SKILL.md and references |
| `cursor-docs/docs/`             | Flattened markdown site of `src/skill/SKILL.md` + every `references/*.md`,    |
|                                 | with frontmatter stripped, suitable for `mkdocs` or GitHub Pages.             |

## 4. Build pipeline

A single Node script — `scripts/build.mjs` — performs all four
projections. Plain Node, no dependencies. Steps:

1. Validate `src/skill/SKILL.md` parses as YAML frontmatter + markdown,
   `name` and `description` present, body under 500 lines.
2. Resolve `src/manifests/plugin.json` and `marketplace.json` versions
   from `src/manifests/skill-package.json` (single version source).
3. Rebuild outputs from scratch:
   - `rm -rf claude-code-plugin agent-skill cursor-docs .claude-plugin`
   - Recreate each directory.
   - Copy `src/skill/` into both `claude-code-plugin/skills/acuris-address/`
     and `agent-skill/acuris-address/`.
   - Stamp `version` from `src/manifests/skill-package.json` into the
     two plugin-json files + the marketplace JSON.
   - Generate Cursor outputs (see §5).
4. Re-run a verifier:
   - JSON manifests parse and have required fields.
   - SKILL.md frontmatter is valid YAML and includes `description`.
   - Every relative link inside SKILL.md/references resolves.

CI (`.github/workflows/build.yml`) runs `node scripts/build.mjs --check`
on every PR; the check mode fails if projections are stale relative to
`src/`. PRs must commit both source and projection changes together.

## 5. Cursor projection rules

Three sub-products go into `cursor-docs/`:

### 5a. `cursor-docs/rules/*.mdc` — drop-in project rules

The transformation: split the SKILL.md into 4 focused MDC files matched
to the contexts where a Cursor user is editing.

| File                          | `globs`                                                       | Body sourced from                              |
| ----------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| `acuris-overview.mdc`         | `alwaysApply: false`, no globs, `description: "..."` (agent)  | First two sections of SKILL.md (overview + when to use) |
| `acuris-autocomplete.mdc`     | `**/*Autocomplete*.{tsx,jsx}`, `**/checkout/**/*.{tsx,jsx}`   | `references/autocomplete.md` + relevant API bits |
| `acuris-validation.mdc`       | `**/*Address*.{tsx,jsx}`, `**/api/**/{address,validate}*.{ts,js}` | `references/validate-on-submit.md`         |
| `acuris-migration.mdc`        | no globs (manual `@acuris-migration` mention)                  | Index of migration recipes with code excerpts  |

Frontmatter examples are in `research.md §3a`. Consumers copy these
files into their own `.cursor/rules/` directory.

### 5b. `cursor-docs/docs/` — flattened markdown site

Plain markdown files, one per source SKILL.md / reference, with YAML
frontmatter stripped. Intended for hosting on GitHub Pages (or any
static host) and adding to Cursor via `Settings → @Docs → Add new doc`.

`cursor-docs/docs/index.md` is the SKILL.md body. Each
`cursor-docs/docs/<reference-name>.md` is the corresponding reference,
flat. Cross-links are rewritten to relative `.md` paths.

### 5c. `cursor-docs/README.md` — install instructions

Tells the consumer:
1. To drop `rules/*.mdc` into their repo's `.cursor/rules/`.
2. The hosted docs URL to add to Cursor's @Docs.
3. That `npx skills add Acuris-GmbH/acuris-agent-context -a cursor`
   also works if they want the full skill rather than just the rules.

## 6. Marketplace strategy

The repo doubles as a self-hosted Claude Code marketplace. A
`.claude-plugin/marketplace.json` at the repo root, with the plugin
entry pointing at `./claude-code-plugin`, lets users install via:

```bash
/plugin marketplace add Acuris-GmbH/acuris-agent-context
/plugin install acuris-address@acuris-plugins
```

Optional later: submit the same plugin to
`anthropics/claude-plugins-official` so the install command becomes
`/plugin install acuris-address@claude-plugins-official`. Not blocking.

For the open Agent Skill, the `npx skills add` CLI clones the GitHub
repo and finds the `skills/<name>/` directory automatically. We will
**also** keep a top-level `skills/acuris-address/` symlink (or copy)
that points to `agent-skill/acuris-address/`, so the `npx skills add`
default-path lookup works without explicit configuration. (AWS Location
keeps both `skills/amazon-location-service/` *and*
`plugins/amazon-location-service/skills/amazon-location-service/`; we
mirror this.)

## 7. Top-level repo layout (final)

```
acuris-agent-context/
├── README.md                          — install + use for all three formats
├── AGENTS.md                          — cross-tool standard entry point
├── CLAUDE.md                          — guidance specifically for Claude Code
├── CHANGELOG.md
├── LICENSE                            — MIT
├── research.md
├── design.md
├── package.json                       — declares the build script
├── scripts/
│   └── build.mjs
├── src/
│   ├── skill/                         — canonical SKILL.md + references/
│   ├── manifests/                     — JSON templates
│   └── rules/                         — Cursor MDC sources
├── .claude-plugin/
│   └── marketplace.json               — generated; turns the repo into a marketplace
├── claude-code-plugin/                — generated
│   ├── .claude-plugin/plugin.json
│   ├── README.md
│   └── skills/acuris-address/
│       ├── SKILL.md
│       └── references/
├── agent-skill/                       — generated
│   ├── README.md
│   ├── package.json
│   └── acuris-address/
│       ├── SKILL.md
│       └── references/
├── skills/                            — symlink/alias of agent-skill/ for npx-skills auto-detect
│   └── acuris-address/ → ../agent-skill/acuris-address/
├── cursor-docs/                       — generated
│   ├── README.md
│   ├── rules/*.mdc
│   └── docs/*.md
└── .github/workflows/
    └── build.yml                      — runs build --check on PR
```

## 8. Risks accepted

- **Migration recipes aren't validated against real customer code.**
  Per the brief, we ship plausible ports for libAddressDoctor, Loqate,
  Experian QAS, Melissa, Smarty. Each recipe carries a clear "tested
  against vendor docs, not against your codebase — review before
  shipping" note.
- **Cursor `@Docs` URL format is under-specified in their docs.** We
  host a flat markdown site and let Cursor's crawler discover it. If
  indexing turns out to need explicit sitemap/llms.txt support, we add
  it in a follow-up.
- **No Acuris MCP server exists yet.** The `mcp.json` slot in
  `src/manifests/` is reserved but ships empty. When the server lands,
  one file changes and all projections pick it up.
- **One canonical skill, not many.** Skills bundling style varies (AWS
  Location uses one skill with 11 references; some vendors ship many
  small skills). We pick "one skill, many references" because the
  Acuris surface area is small enough that a single agent context covers
  it without losing discoverability, and Claude Code's progressive
  disclosure handles reference loading cleanly.

## 9. Implementation order

1. Author `src/skill/SKILL.md` and every `references/*.md`.
2. Author `src/manifests/*.json` and `src/rules/*.mdc`.
3. Implement `scripts/build.mjs` (~150 lines, zero deps).
4. Run it; commit the projections.
5. Write top-level README + AGENTS.md + CLAUDE.md.
6. Push to `Acuris-GmbH/acuris-agent-context`.
7. Verify: `claude --plugin-dir ./claude-code-plugin` loads cleanly;
   `npx skills add Acuris-GmbH/acuris-agent-context` round-trips; the
   `.cursor/rules/*.mdc` lint as MDC.
