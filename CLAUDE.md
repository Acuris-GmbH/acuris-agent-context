# Claude Code — repo guidance

This is the Acuris agent-context repo. It ships AI-agent context for
the Acuris Address Validation & Geocoding APIs in three formats:
Claude Code plugin, Cursor rules/docs, and the open Agent Skill.

## Layout

- `src/` — **source of truth**. All edits go here.
  - `src/skill/SKILL.md` and `src/skill/references/*.md` — the actual
    agent context.
  - `src/manifests/*.json` — per-format manifest templates.
  - `src/rules/*.mdc` — Cursor rule sources.
- `scripts/build.mjs` — one Node script, no dependencies, rebuilds all
  projections. Run with `--check` to verify freshness in CI.
- `claude-code-plugin/`, `agent-skill/`, `skills/`, `cursor-docs/`,
  `.claude-plugin/` — **generated**. Don't hand-edit; the build script
  overwrites them.
- `research.md` — Phase-1 research on the three formats. Read before
  modifying anything format-specific.
- `design.md` — Phase-2 architecture decisions and projection rules.

## When updating content

1. Edit files under `src/skill/` or `src/rules/`.
2. Run `node scripts/build.mjs`.
3. Commit the changes to `src/` *and* the regenerated projections in the
   same commit.
4. CI runs `node scripts/build.mjs --check`; a stale projection fails
   the PR.

## When updating versions

The single version source is `src/manifests/skill-package.json`. Bump
`version` there, run the build, and the plugin manifest + marketplace
manifest get re-stamped automatically.

## When the SDK surface changes

If `@acuris-geo/av-sdk` adds an endpoint, changes a header, or alters
an error shape:

1. Update `src/skill/references/api-reference.md` (always).
2. Update `src/skill/SKILL.md` if the change is prominent (new
   endpoint, new defaults).
3. Decide whether a new reference file is warranted (e.g. a new
   recipe).
4. Bump `src/manifests/skill-package.json` `version`.
5. Build, commit, push.

## When adding a new migration recipe

1. New file `src/skill/references/migrate-<vendor>.md`. Follow the
   shape of the existing migration references — concept-mapping table,
   before/after code, status-code translation, "what you don't
   migrate" section.
2. Add it to the migrations list in `src/skill/SKILL.md`.
3. Add it to the cross-reference table in
   `src/rules/acuris-migration.mdc`.
4. Build, commit.

## Skills available in this repo

The repo lints its own work using built-in skills you may want to
invoke before pushing:

- `/simplify` — review changed code for reuse and quality
- `/review` — review the current branch
- `/security-review` — security review of the pending changes

These are bundled Claude Code skills, not part of the package this
repo ships.
