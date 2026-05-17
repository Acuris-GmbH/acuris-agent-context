#!/usr/bin/env node
/**
 * Build all three distribution projections from src/.
 *
 *   node scripts/build.mjs           — rebuild from source
 *   node scripts/build.mjs --check   — fail if projections are stale
 *
 * Outputs:
 *   claude-code-plugin/      — Claude Code plugin (manifest + skill)
 *   agent-skill/             — Open Agent Skill package
 *   skills/acuris-address/   — Alias so `npx skills add` finds the skill
 *   cursor-docs/             — Cursor MDC rules + flat markdown docs
 *   .claude-plugin/          — Marketplace manifest at repo root
 */

import { readFile, writeFile, mkdir, rm, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC  = join(ROOT, "src");

const SKILL_NAME = "acuris-address";
const CHECK = process.argv.includes("--check");

let stale = false;
function note(msg) { process.stdout.write(`  ${msg}\n`); }
function warn(msg) { process.stderr.write(`! ${msg}\n`); }

async function main() {
  const skillPkg = JSON.parse(await readFile(join(SRC, "manifests/skill-package.json"), "utf8"));
  const version  = skillPkg.version;

  await validateSource();

  if (CHECK) {
    await checkProjectionsFresh(version);
    if (stale) {
      warn("Projections are stale relative to src/. Run `node scripts/build.mjs` and commit the result.");
      process.exit(1);
    }
    note("All projections are fresh.");
    return;
  }

  await rebuild(version, skillPkg);
  note("Build complete.");
}

async function validateSource() {
  const skillMd = await readFile(join(SRC, "skill/SKILL.md"), "utf8");
  const fm = parseFrontmatter(skillMd);
  if (!fm.frontmatter) throw new Error("SKILL.md missing YAML frontmatter");
  for (const field of ["name", "description"]) {
    if (!new RegExp(`^${field}:`, "m").test(fm.frontmatter)) {
      throw new Error(`SKILL.md frontmatter missing required field: ${field}`);
    }
  }
  const lineCount = skillMd.split("\n").length;
  if (lineCount > 600) warn(`SKILL.md is ${lineCount} lines; recommended < 500.`);

  for (const f of await readdir(join(SRC, "skill/references"))) {
    const body = await readFile(join(SRC, "skill/references", f), "utf8");
    if (body.length < 200) warn(`reference ${f} looks too small (${body.length} chars)`);
  }
}

async function rebuild(version, skillPkg) {
  for (const d of ["claude-code-plugin", "agent-skill", "skills", "cursor-docs", ".claude-plugin"]) {
    await rm(join(ROOT, d), { recursive: true, force: true });
  }

  // 1. Open Agent Skill
  const skillDst = join(ROOT, "agent-skill", SKILL_NAME);
  await mkdir(join(skillDst, "references"), { recursive: true });
  await copyDir(join(SRC, "skill"), skillDst);
  await writeFile(join(ROOT, "agent-skill/package.json"), JSON.stringify(skillPkg, null, 2) + "\n");
  await writeFile(join(ROOT, "agent-skill/README.md"), agentSkillReadme(version));
  note(`Generated: agent-skill/${SKILL_NAME}/`);

  // 2. skills/ alias for `npx skills add` auto-detection
  const alias = join(ROOT, "skills", SKILL_NAME);
  await mkdir(join(alias, "references"), { recursive: true });
  await copyDir(join(SRC, "skill"), alias);
  note(`Generated: skills/${SKILL_NAME}/ (alias for npx skills add)`);

  // 3. Claude Code plugin
  const plugDir = join(ROOT, "claude-code-plugin");
  const plugSkill = join(plugDir, "skills", SKILL_NAME);
  await mkdir(join(plugDir, ".claude-plugin"), { recursive: true });
  await mkdir(join(plugSkill, "references"),  { recursive: true });
  await copyDir(join(SRC, "skill"), plugSkill);

  const pluginManifest = stampVersion(
    await readFile(join(SRC, "manifests/plugin.json"), "utf8"),
    version,
  );
  await writeFile(join(plugDir, ".claude-plugin/plugin.json"), pluginManifest);
  await writeFile(join(plugDir, "README.md"), pluginReadme(version));
  note(`Generated: claude-code-plugin/`);

  // 4. Repo-level marketplace
  const marketplace = stampVersion(
    await readFile(join(SRC, "manifests/marketplace.json"), "utf8"),
    version,
  );
  await mkdir(join(ROOT, ".claude-plugin"), { recursive: true });
  await writeFile(join(ROOT, ".claude-plugin/marketplace.json"), marketplace);
  note(`Generated: .claude-plugin/marketplace.json`);

  // 5. Cursor docs: rules + flat docs
  await buildCursorDocs();
  note(`Generated: cursor-docs/`);
}

async function buildCursorDocs() {
  const out = join(ROOT, "cursor-docs");
  await mkdir(join(out, "rules"), { recursive: true });
  await mkdir(join(out, "docs"),  { recursive: true });

  // Rules: copy MDC sources verbatim
  for (const f of await readdir(join(SRC, "rules"))) {
    await copyFile(join(SRC, "rules", f), join(out, "rules", f));
  }

  // Docs: flatten SKILL.md + references, strip skill frontmatter, add a
  // Jekyll page frontmatter so GitHub Pages renders them as HTML.
  const skillBody = stripFrontmatter(await readFile(join(SRC, "skill/SKILL.md"), "utf8"));
  await writeFile(
    join(out, "docs/index.md"),
    jekyllFrontmatter("Acuris agent context") + rewriteReferenceLinks(skillBody),
  );

  for (const f of await readdir(join(SRC, "skill/references"))) {
    const body = stripFrontmatter(await readFile(join(SRC, "skill/references", f), "utf8"));
    const title = humanizeFilename(f);
    await writeFile(
      join(out, "docs", f),
      jekyllFrontmatter(title) + rewriteReferenceLinks(body),
    );
  }

  // Minimal Jekyll config so GitHub Pages applies a theme + relative-link rewriting.
  await writeFile(join(out, "docs/_config.yml"), jekyllConfig());

  await writeFile(join(out, "README.md"), cursorDocsReadme());
}

function jekyllFrontmatter(title) {
  return `---\nlayout: default\ntitle: ${JSON.stringify(title)}\n---\n\n`;
}

function jekyllConfig() {
  return [
    "title: Acuris agent context",
    "description: Agent-context documentation for the Acuris Address Validation & Geocoding APIs.",
    "theme: jekyll-theme-cayman",
    "plugins:",
    "  - jekyll-relative-links",
    "relative_links:",
    "  enabled: true",
    "  collections: true",
    "include:",
    "  - index.md",
    "",
  ].join("\n");
}

function humanizeFilename(name) {
  return name
    .replace(/\.md$/, "")
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

async function checkProjectionsFresh(version) {
  const skillBody = await readFile(join(SRC, "skill/SKILL.md"), "utf8");
  for (const target of [
    `claude-code-plugin/skills/${SKILL_NAME}/SKILL.md`,
    `agent-skill/${SKILL_NAME}/SKILL.md`,
    `skills/${SKILL_NAME}/SKILL.md`,
  ]) {
    const p = join(ROOT, target);
    if (!existsSync(p)) { stale = true; warn(`missing: ${target}`); continue; }
    const have = await readFile(p, "utf8");
    if (have !== skillBody) { stale = true; warn(`stale:   ${target}`); }
  }
}

// ----- helpers -----

async function copyDir(srcDir, dstDir) {
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    const s = join(srcDir, entry.name);
    const d = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      await mkdir(d, { recursive: true });
      await copyDir(s, d);
    } else if (entry.isFile()) {
      await copyFile(s, d);
    }
  }
}

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: null, body: md };
  return { frontmatter: m[1], body: m[2] };
}

function stripFrontmatter(md) {
  const p = parseFrontmatter(md);
  return p.frontmatter !== null ? p.body : md;
}

function rewriteReferenceLinks(md) {
  // ./references/foo.md  →  foo.md   (flattened cursor docs site)
  return md.replace(/\(\.\/references\/([^)]+)\)/g, "($1)");
}

function stampVersion(json, version) {
  return json.replace(/\{\{VERSION\}\}/g, version);
}

function pluginReadme(version) {
  return `# acuris-address — Claude Code plugin

Acuris Address Validation & Geocoding agent context, packaged as a
Claude Code plugin. Version ${version}.

## Install

From this repo's marketplace:

\`\`\`text
/plugin marketplace add Acuris-GmbH/acuris-agent-context
/plugin install acuris-address@acuris-plugins
\`\`\`

Or for local development:

\`\`\`bash
claude --plugin-dir ./claude-code-plugin
\`\`\`

## What's inside

- \`skills/acuris-address/SKILL.md\` — primary skill entry point.
- \`skills/acuris-address/references/\` — recipe library (autocomplete,
  validation, geocoding, batch cleanup, Next.js proxy, Centra, and five
  vendor migration recipes).

## Triggers

The skill auto-activates when the user mentions address autocomplete,
validation, geocoding, reverse geocoding, the \`@acuris-geo/av-sdk\`
package, the \`AcurisClient\` symbol, or migration from libAddressDoctor,
Loqate, Experian QAS, Melissa, or Smarty.
`;
}

function agentSkillReadme(version) {
  return `# acuris-address — Open Agent Skill

Acuris Address Validation & Geocoding agent context in the open
[Agent Skills](https://agentskills.io) format. Version ${version}.

## Install

\`\`\`bash
# Interactive — pick your agent:
npx skills add Acuris-GmbH/acuris-agent-context

# Specific agent:
npx skills add Acuris-GmbH/acuris-agent-context -a claude-code
npx skills add Acuris-GmbH/acuris-agent-context -a cursor
npx skills add Acuris-GmbH/acuris-agent-context -a github-copilot
npx skills add Acuris-GmbH/acuris-agent-context -a opencode
npx skills add Acuris-GmbH/acuris-agent-context -a codex
npx skills add Acuris-GmbH/acuris-agent-context -a gemini-cli
npx skills add Acuris-GmbH/acuris-agent-context -a kiro-cli
\`\`\`

See <https://agentskills.io> for the full list of compatible tools.

## What's inside

\`acuris-address/\` contains \`SKILL.md\` + \`references/\` in the canonical
Anthropic skill format. The CLI copies it into the right host-specific
path for your agent.
`;
}

function cursorDocsReadme() {
  return `# Acuris context for Cursor

Three independent ways to give Cursor knowledge of the Acuris APIs.
Pick one (or all three) depending on how you use Cursor.

## 1. Project rules (drop into your repo)

Copy the rules from \`rules/\` into your project's \`.cursor/rules/\`:

\`\`\`bash
mkdir -p .cursor/rules
cp -r path/to/acuris-agent-context/cursor-docs/rules/*.mdc .cursor/rules/
\`\`\`

The rules activate automatically when you edit:

- \`acuris-overview.mdc\` — agent-selected; pulled in whenever the model
  decides Acuris is relevant.
- \`acuris-autocomplete.mdc\` — auto-attached on files matching
  \`**/checkout/**/*.{tsx,jsx}\`, \`**/address/**/*.{tsx,jsx}\`,
  \`**/*Autocomplete*\`, \`**/api/**/{address,suggest,autocomplete}*\`.
- \`acuris-validation.mdc\` — auto-attached on files matching
  \`**/api/**/{address,validate,checkout,orders,customers}*\`,
  \`**/server/**/*{address,checkout}*\`, \`**/*AddressValidator*\`.
- \`acuris-migration.mdc\` — manual via \`@acuris-migration\` mention,
  when porting code from another AV vendor.

## 2. @Docs (cloud-indexed external documentation)

In Cursor:

> Settings → Indexing & Docs → @Docs → Add new doc

Use this URL:

\`\`\`text
https://acuris-gmbh.github.io/acuris-agent-context/
\`\`\`

(Available once GitHub Pages is enabled on the repo. The published
site is a flat copy of the same skill + references, hosted by the
\`docs/\` directory in this folder.)

## 3. Cursor as an Agent Skills client

Cursor supports the open Agent Skills format natively. To install the
full skill (not just the rules):

\`\`\`bash
npx skills add Acuris-GmbH/acuris-agent-context -a cursor
\`\`\`
`;
}

main().catch((err) => { warn(String(err.stack ?? err)); process.exit(1); });
