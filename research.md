# Research — agent-context distribution formats (2026-05)

Phase-1 deliverable. Captures what we found before building the Acuris
agent-context package. Anchored on three primary sources:

- Anthropic Claude Code plugin docs (`code.claude.com/docs/en/plugins` and
  `/skills`).
- Cursor docs (`cursor.com/docs/context/rules` and `/context/@-symbols/@-docs`),
  plus the `cursor.com/docs/context/skills` page surfaced via
  agentskills.io.
- The Open Agent Skills standard (`agentskills.io`) and its CLI
  (`npx skills add ...`).

Reference implementation: `aws-geospatial/amazon-location-agent-context`
(cloned, inspected file-by-file). AWS shipped 25 Feb 2026; this is the
template we are mirroring.

---

## 1. Claude Code plugin format

A Claude Code plugin is a directory containing a `.claude-plugin/plugin.json`
manifest plus zero or more component subdirectories at the plugin root.

### Manifest schema

`.claude-plugin/plugin.json`:

```json
{
  "name": "acuris-address",
  "description": "Acuris Address Validation & Geocoding APIs for AI assistants",
  "version": "0.1.0",
  "author":   { "name": "Acuris GmbH" },
  "license":  "MIT",
  "keywords": ["acuris", "address-validation", "geocoding"],
  "repository": "https://github.com/Acuris-GmbH/acuris-agent-context"
}
```

Only `name` is strictly required. `version` is recommended — when absent
the git commit SHA is treated as the version, so every commit is "a new
release."

### Directory layout

| Path                  | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `.claude-plugin/`     | Manifest only. Do **not** put components inside this dir.       |
| `skills/<name>/SKILL.md` | Model-invoked skills (the primary unit).                    |
| `commands/`           | Legacy flat-file commands. New plugins should use `skills/`.    |
| `agents/`             | Custom subagent definitions.                                    |
| `hooks/hooks.json`    | Event handlers.                                                 |
| `.mcp.json`           | Bundled MCP server configs (registered when plugin is enabled). |
| `.lsp.json`           | LSP server configs.                                             |
| `monitors/monitors.json` | Background watchers.                                         |
| `bin/`                | Executables added to `PATH` while enabled.                      |
| `settings.json`       | Default settings applied on enable.                             |

### Installation

Three documented mechanisms:

1. **Marketplace** — published in a `marketplace.json` (either the
   `anthropics/claude-plugins-official` repo or a private/team one):
   `/plugin install <plugin>@<marketplace>`
2. **Local dev** — `claude --plugin-dir ./acuris-address`
3. **URL ZIP** — `claude --plugin-url https://.../plugin.zip`

A self-hosted marketplace is just a public git repo containing a
`.claude-plugin/marketplace.json` at the root. Users add it with
`/plugin marketplace add <owner>/<repo>` then `/plugin install <name>@<owner>`.

### Marketplace schema (`.claude-plugin/marketplace.json`)

```json
{
  "name":  "acuris-plugins",
  "owner": { "name": "Acuris GmbH" },
  "metadata": { "description": "Acuris developer agent plugins", "version": "0.1.0" },
  "plugins": [
    {
      "name":   "acuris-address",
      "source": "./claude-code-plugin",
      "description": "...",
      "category":    "address-validation",
      "tags":        ["acuris", "geocoding"],
      "version":     "0.1.0"
    }
  ]
}
```

The `source` field is relative to the marketplace repo root. Pointing it
at `./claude-code-plugin` lets the same repo serve as both marketplace
and plugin store.

---

## 2. Anthropic Skill format (cross-tool — also the Claude Code primitive)

A skill is a folder with a `SKILL.md` and optional supporting files. The
SKILL.md must have YAML frontmatter at minimum giving `description`, which
the model reads at startup to decide when to load the rest of the file.

```
my-skill/
├── SKILL.md          # required (frontmatter + body)
├── references/       # optional — loaded on demand
├── scripts/          # optional — executed, not read into context
└── assets/           # optional — templates etc.
```

### SKILL.md frontmatter (the fields we will use)

```yaml
---
name: acuris-address
description: |
  Acuris Address Validation & Geocoding APIs. Use when the user is
  building address autocomplete, validation on form submit, forward or
  reverse geocoding, or migrating from libAddressDoctor / Loqate /
  Experian QAS / Melissa / Smarty to Acuris.
license: MIT
metadata:
  author:  acuris-gmbh
  version: "0.1.0"
---
```

Full frontmatter surface (Claude Code extends the open standard with
optional fields — we will not need most of them):

| Field                      | Use in our skill?       |
| -------------------------- | ----------------------- |
| `name`                     | Yes (matches dir name)  |
| `description`              | Yes (≤1536 chars w/ `when_to_use`) |
| `when_to_use`              | Yes (trigger phrases)   |
| `license`                  | Yes (MIT)               |
| `metadata`                 | Yes (author + version)  |
| `allowed-tools`            | No (read-only docs)     |
| `disable-model-invocation` | No (we *want* auto-load) |
| `user-invocable`           | No                      |
| `argument-hint`            | No                      |
| `arguments` / `$ARGUMENTS` | No                      |
| `context: fork` / `agent`  | No                      |
| `hooks`                    | No                      |
| `paths` (globs)            | Maybe (`**/*.{tsx,jsx,ts,js}`) |
| `model` / `effort`         | No                      |

### Body conventions

- Keep `SKILL.md` under ~500 lines. Push detail into `references/*.md`.
- First paragraph of the body should reinforce *when* the skill applies —
  it's a backup signal for the discovery step.
- Reference files are linked from SKILL.md as relative markdown links;
  the agent reads them only when its task warrants it (progressive
  disclosure).

### Distribution

The open Agent Skills CLI ships as `npx skills add`:

```bash
npx skills add Acuris-GmbH/acuris-agent-context              # interactive picker
npx skills add Acuris-GmbH/acuris-agent-context -a claude-code
npx skills add Acuris-GmbH/acuris-agent-context -a cursor
npx skills add Acuris-GmbH/acuris-agent-context -a github-copilot
# ...etc. for opencode, codex, gemini-cli, kiro-cli, antigravity, ...
```

The CLI clones the repo, locates `skills/<name>/`, and copies it into the
correct host-specific path (`~/.claude/skills/`, `.cursor/...`,
`.github/copilot/skills/`, etc.). The repo root only needs the
`skills/<name>/SKILL.md` layout — no extra manifest.

### Consumers as of May 2026 (from the agentskills.io homepage)

37+ tools listed, including: Claude Code, Claude.ai, Cursor, GitHub
Copilot, VS Code, OpenAI Codex, Gemini CLI, OpenCode, Goose, Junie,
Kiro, Amp, Letta, Factory, Roo Code, Snowflake Cortex Code, Spring AI,
Databricks Genie, OpenHands, Workshop, Firebender, Laravel Boost, others.

**Implication.** The Anthropic Skill format is the broadest-reach
artifact we can ship. Both the Claude Code plugin and "open Agent Skill"
deliverables in our spec consume essentially the same `SKILL.md` —
the difference is only the surrounding manifest/wrapper.

---

## 3. Cursor: rules + docs + skills

Cursor exposes **three** independent extension surfaces, all relevant:

### 3a. Project rules (`.cursor/rules/*.mdc`)

The 2025-deprecated `.cursorrules` file is gone. Current convention:
markdown files with `.mdc` extension in `.cursor/rules/`, optionally
with YAML frontmatter.

```yaml
---
description: When the user is wiring an address autocomplete or
  validation form, use the Acuris SDK patterns from this rule.
alwaysApply: false
globs: ["**/checkout/**/*.{tsx,jsx}", "**/address/**/*.{tsx,jsx}"]
---

When implementing address autocomplete:
- Install `@acuris-geo/av-sdk`
- ...
```

| Field         | Meaning                                                   |
| ------------- | --------------------------------------------------------- |
| `alwaysApply` | `true` ⇒ injected into every chat; ignores globs/desc.    |
| `globs`       | Auto-attach when matching files are open or referenced.   |
| `description` | Agent reads this to decide when to pull the rule in.      |
| neither       | Manual via `@rule-name`.                                  |

Rules ship as files developers drop into *their* repo's `.cursor/rules/`.

### 3b. Cursor `@Docs` (external documentation indexer)

`Settings → Indexing & Docs → @Docs → Add new doc` takes a URL. Cursor
crawls the URL, indexes the markdown/HTML content, and exposes it via
`@Docs` in chat.

Specifics on URL/sitemap format are sparse in the public docs. In
practice the indexer wants a docs site root with internal links; an
`llms.txt` style table-of-contents at the root helps. For our purposes,
publishing the SKILL.md + references/ tree on GitHub Pages (or a
Cloudflare Pages mirror) and pointing users to that URL is sufficient.

### 3c. Cursor agent skills

Cursor now consumes Agent Skills natively (it appears in the showcase on
agentskills.io with `instructionsUrl: https://cursor.com/docs/context/skills`).
That means our single SKILL.md is also installable in Cursor via
`npx skills add ... -a cursor`, and our `cursor-docs/` deliverable does
not need to duplicate the skill content — it can stay focused on the two
surfaces that *aren't* covered by skills: the `.cursor/rules/*.mdc` drop-in
and the public docs URL.

---

## 4. AWS Location reference implementation

Repo: `aws-geospatial/amazon-location-agent-context`. Apache-2.0.

### Top-level layout

```
.claude-plugin/marketplace.json
plugins/amazon-location-service/
  .claude-plugin/plugin.json
  .mcp.json
  skills/amazon-location-service/
    SKILL.md
    references/*.md
skills/amazon-location-service/
  SKILL.md
  references/*.md
kiro-powers/amazon-location-service/
  kiro.json
  POWER.md
  mcp.json
context/
  amazon-location.md
  additional/*.md
src/
  templates/
    base/                  # context-format templates
    claude/                # plugin.json, marketplace.json, mcp.json, SKILL.md
    kiro/                  # kiro.json, POWER.md
  content/
    amazon-location.sh     # shell-variable definitions feeding template eval
    references/*.md
    additional/*.sh
  scripts/
    build.sh build-base.sh build-claude.sh build-kiro.sh verify-build.sh
AGENTS.md CLAUDE.md CHANGELOG.md README.md
```

### How they avoid drift

- Single source of truth in `src/` (templates + content).
- Build scripts in `src/scripts/*.sh` use bash heredoc `eval` to expand
  templates with `${VAR}` substitution from `src/content/*.sh`.
- `npm run build` (or `./src/scripts/build.sh`) rebuilds *all four*
  projections (`context/`, `plugins/`, `kiro-powers/`, `skills/`) from
  scratch every time.
- Projections are committed — consumers fetch the projection they want
  without running the build.

### Content shape (what their SKILL.md actually contains)

- One-paragraph overview
- "When to use this skill" / "Do NOT use" bullets
- API surface table (services × operations)
- "Common mistakes" — concrete bugs to avoid (using `Title` instead of
  `Address.Label`, missing `validateStyle: false`, etc.)
- "Defaults" — opinionated picks (SDK choice, auth, map style, coordinate
  order)
- "API selection guidance" — which endpoint for which job
- "Reference files" — links to `references/*.md` for deeper material

The whole top-level SKILL.md is ~240 lines. Reference files cover
specific recipes (address-input, address-verification, calculate-routes,
google-migration-{web,ios,android}, ...).

### Install paths they document

| Tool                | Command                                                       |
| ------------------- | ------------------------------------------------------------- |
| Claude Code         | `/plugin install amazon-location-service@claude-plugins-official` |
| Cursor              | Settings → Plugins → search "AWS"                             |
| Kiro IDE            | One-click badge to `kiro.dev/launch/powers/...`               |
| Kiro CLI            | `npx skills add aws-geospatial/amazon-location-agent-context -a kiro-cli` |
| GitHub Copilot et al | `npx skills add aws-geospatial/amazon-location-agent-context -a github-copilot` (or interactive) |
| Direct context      | Read `context/amazon-location.md` + `context/additional/`     |

---

## 5. Acuris SDK surface (source of truth for the API docs)

From `@acuris-geo/av-sdk` (currently 0.1.2 on npm,
`packages/acuris-av-sdk/` in the centra-connector repo):

| Endpoint              | SDK function                                | HTTP                  |
| --------------------- | ------------------------------------------- | --------------------- |
| Validate              | `validateAddress(client, input, opts)`      | `POST /validate`      |
| Geocode (forward)     | `geocodeAddress(client, input, opts)`       | `POST /geocode`       |
| Reverse geocode       | `reverseGeocode(client, {lat,lng}, opts)`   | `POST /reverse`       |
| Autocomplete suggest  | `suggestAddress(client, q, opts)`           | `POST /suggest`       |

- Auth: `Authorization: Bearer <ACURIS_API_KEY>` header (`apiKey`
  client option, falling back to `process.env.ACURIS_API_KEY`).
- Base URL: `https://api.acuris-geo.com`. No distinct sandbox host —
  the live API accepts a `?password=test` test key with abundant
  credits for evaluation. We will document the env-var pattern, not
  invent a sandbox.
- Country codes: ISO-3 alpha, lowercase (e.g. `"usa"`, `"deu"`, `"gbr"`).
- Error hierarchy: `AcurisError` → `AcurisAuthError`,
  `AcurisValidationError`, `AcurisNotFoundError`,
  `AcurisRateLimitError`, `AcurisServerError`, `AcurisTimeoutError`,
  `AcurisNetworkError`. Transient (5xx, 429, network, timeout) retry
  automatically with exponential backoff up to `maxRetries` (default 3).
- Result types: `ValidationResult`, `GeocodingResult`,
  `ReverseGeocodingResult`, `SuggestionHit[]`. All carry an
  `accuracy_type` (`rooftop`, `parcel`, `street_interpolated`, ...) and
  `confidence` (0..1).
- No OpenAPI spec is published. The TypeScript types in `src/types.ts`
  are the authoritative shape — they have JSDoc comments describing
  every field. We will ship those types as the canonical API reference
  inside the skill.

The companion React package `@acuris-geo/centra-checkout` (also 0.1.2)
exports `<AcurisAddressInput>` (typeahead), `<AcurisAddressValidator>`
(headless render-prop wrapping validate), and hooks. The integration
pattern (frontend → your `/api/acuris/*` proxy → SDK on the server) is
documented in `packages/acuris-centra-checkout/README.md` and the
top-level README of `acuris-centra-connector`.

---

## 6. Decisions implied by the research

1. **Source of truth = a canonical SKILL.md + `references/*.md` set.**
   Both the Claude Code plugin and the Open Agent Skill consume exactly
   this with thin manifest wrappers. Drift surface is minimal.

2. **Cursor needs a transformation, not a duplicate.** Three Cursor
   surfaces exist; we will cover them with:
   - **Skills** — same SKILL.md, no work (installed via `npx skills add -a cursor`).
   - **Rules** — transform SKILL.md sections into 3-4 `.cursor/rules/*.mdc`
     drop-ins for consumer repos.
   - **@Docs** — publish the source tree as a static site (GitHub Pages)
     and document the URL to add to Cursor's @Docs.

3. **Repo layout will mirror AWS Location's** but use Node/TS for the
   build (matches the rest of the org) and ditch the bash heredoc
   templating — our source files are already canonical SKILL.md, so the
   "build" is mostly file copy + wrap + Cursor projection.

4. **Migration recipes get their own reference files.** This is where
   Acuris's commercial pitch lives: clean, runnable code for porting
   from libAddressDoctor (Informatica), Loqate, Experian QAS, Melissa,
   Smarty. Per the brief — we accept the risk of shipping plausible
   ports that haven't been validated against real customer code.

5. **No sandbox URL invented.** Document the `?password=test` test key
   and the `ACURIS_API_KEY` env-var convention.

Design details — directory layout, build script, exact projection
mapping — are written up in `design.md`.
