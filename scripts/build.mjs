#!/usr/bin/env node
/**
 * Build all distribution projections from src/.
 *
 *   node scripts/build.mjs           — rebuild from source
 *   node scripts/build.mjs --check   — fail if projections are stale
 *
 * Source layout:
 *   src/skill/         — canonical "acuris-address" skill
 *   src/skill-eudi/    — canonical "acuris-eudi" skill
 *   src/manifests/     — JSON manifest templates
 *   src/rules/         — Cursor MDC rule sources
 *
 * Outputs:
 *   claude-code-plugin/      — Claude Code plugin (manifest + both skills)
 *   agent-skill/             — Open Agent Skill package (both skills)
 *   skills/<name>/           — Aliases so `npx skills add` finds each skill
 *   cursor-docs/             — Cursor MDC rules + flat markdown docs site
 *   .claude-plugin/          — Marketplace manifest at repo root
 */

import { readFile, writeFile, mkdir, rm, readdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC  = join(ROOT, "src");

// Each entry: { name, srcDir, descriptionField (cursor-docs index group label) }
const SKILLS = [
  { name: "acuris-address", srcDir: "skill",      groupLabel: "Address Validation & Geocoding" },
  { name: "acuris-eudi",    srcDir: "skill-eudi", groupLabel: "EUDI Wallet Verifier" },
];

const CHECK = process.argv.includes("--check");

let stale = false;
function note(msg) { process.stdout.write(`  ${msg}\n`); }
function warn(msg) { process.stderr.write(`! ${msg}\n`); }

async function main() {
  const skillPkg = JSON.parse(await readFile(join(SRC, "manifests/skill-package.json"), "utf8"));
  const version  = skillPkg.version;

  await validateSource();

  if (CHECK) {
    await checkProjectionsFresh();
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
  for (const skill of SKILLS) {
    const skillMd = await readFile(join(SRC, skill.srcDir, "SKILL.md"), "utf8");
    const fm = parseFrontmatter(skillMd);
    if (!fm.frontmatter) throw new Error(`${skill.srcDir}/SKILL.md missing YAML frontmatter`);
    for (const field of ["name", "description"]) {
      if (!new RegExp(`^${field}:`, "m").test(fm.frontmatter)) {
        throw new Error(`${skill.srcDir}/SKILL.md missing required frontmatter field: ${field}`);
      }
    }
    const lineCount = skillMd.split("\n").length;
    if (lineCount > 600) warn(`${skill.srcDir}/SKILL.md is ${lineCount} lines; recommended < 500.`);

    for (const f of await readdir(join(SRC, skill.srcDir, "references"))) {
      const body = await readFile(join(SRC, skill.srcDir, "references", f), "utf8");
      if (body.length < 200) warn(`${skill.srcDir}/references/${f} looks too small (${body.length} chars)`);
    }
  }
}

async function rebuild(version, skillPkg) {
  for (const d of ["claude-code-plugin", "agent-skill", "skills", "cursor-docs", ".claude-plugin"]) {
    await rm(join(ROOT, d), { recursive: true, force: true });
  }

  // 1. Open Agent Skill package — one directory per skill
  await mkdir(join(ROOT, "agent-skill"), { recursive: true });
  await writeFile(join(ROOT, "agent-skill/package.json"), JSON.stringify(skillPkg, null, 2) + "\n");
  await writeFile(join(ROOT, "agent-skill/README.md"), agentSkillReadme(version));
  for (const skill of SKILLS) {
    const dst = join(ROOT, "agent-skill", skill.name);
    await mkdir(join(dst, "references"), { recursive: true });
    await copyDir(join(SRC, skill.srcDir), dst);
    note(`Generated: agent-skill/${skill.name}/`);
  }

  // 2. skills/ aliases for `npx skills add` auto-detection
  for (const skill of SKILLS) {
    const dst = join(ROOT, "skills", skill.name);
    await mkdir(join(dst, "references"), { recursive: true });
    await copyDir(join(SRC, skill.srcDir), dst);
    note(`Generated: skills/${skill.name}/ (alias for npx skills add)`);
  }

  // 3. Claude Code plugin — single plugin bundling both skills
  const plugDir = join(ROOT, "claude-code-plugin");
  await mkdir(join(plugDir, ".claude-plugin"), { recursive: true });
  for (const skill of SKILLS) {
    const plugSkill = join(plugDir, "skills", skill.name);
    await mkdir(join(plugSkill, "references"), { recursive: true });
    await copyDir(join(SRC, skill.srcDir), plugSkill);
  }
  const pluginManifest = stampVersion(
    await readFile(join(SRC, "manifests/plugin.json"), "utf8"),
    version,
  );
  await writeFile(join(plugDir, ".claude-plugin/plugin.json"), pluginManifest);
  await writeFile(join(plugDir, "README.md"), pluginReadme(version));
  note(`Generated: claude-code-plugin/ (with ${SKILLS.length} skills)`);

  // 4. Repo-level marketplace
  const marketplace = stampVersion(
    await readFile(join(SRC, "manifests/marketplace.json"), "utf8"),
    version,
  );
  await mkdir(join(ROOT, ".claude-plugin"), { recursive: true });
  await writeFile(join(ROOT, ".claude-plugin/marketplace.json"), marketplace);
  note(`Generated: .claude-plugin/marketplace.json`);

  // 5. Cursor docs: rules + flat docs site
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

  // Docs: address skill at /, EUDI under /eudi/
  await emitSkillSiteSection(SKILLS[0], join(out, "docs"),     "index.md");
  await mkdir(join(out, "docs/eudi"), { recursive: true });
  await emitSkillSiteSection(SKILLS[1], join(out, "docs/eudi"), "index.md");

  // _config.yml at site root
  await writeFile(join(out, "docs/_config.yml"), jekyllConfig());

  // Landing index that links to both skills
  await writeFile(join(out, "docs/landing.md"), landingPage());

  await writeFile(join(out, "README.md"), cursorDocsReadme());
}

async function emitSkillSiteSection(skill, outDir, indexName) {
  const skillBody = stripFrontmatter(await readFile(join(SRC, skill.srcDir, "SKILL.md"), "utf8"));
  await writeFile(
    join(outDir, indexName),
    jekyllFrontmatter(`${skill.name} — ${skill.groupLabel}`) + rewriteReferenceLinks(skillBody),
  );

  await mkdir(join(outDir, "references"), { recursive: true }).catch(() => {});
  // Flat: put references next to the index for simpler relative-links
  for (const f of await readdir(join(SRC, skill.srcDir, "references"))) {
    const body = stripFrontmatter(await readFile(join(SRC, skill.srcDir, "references", f), "utf8"));
    const title = humanizeFilename(f);
    await writeFile(
      join(outDir, f),
      jekyllFrontmatter(title) + rewriteReferenceLinks(body),
    );
  }
}

async function checkProjectionsFresh() {
  for (const skill of SKILLS) {
    const skillBody = await readFile(join(SRC, skill.srcDir, "SKILL.md"), "utf8");
    for (const target of [
      `claude-code-plugin/skills/${skill.name}/SKILL.md`,
      `agent-skill/${skill.name}/SKILL.md`,
      `skills/${skill.name}/SKILL.md`,
    ]) {
      const p = join(ROOT, target);
      if (!existsSync(p)) { stale = true; warn(`missing: ${target}`); continue; }
      const have = await readFile(p, "utf8");
      if (have !== skillBody) { stale = true; warn(`stale:   ${target}`); }
    }
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

function jekyllFrontmatter(title) {
  return `---\nlayout: default\ntitle: ${JSON.stringify(title)}\n---\n\n`;
}

function jekyllConfig() {
  return [
    "title: Acuris agent context",
    "description: Agent-context documentation for the Acuris Address Validation, Geocoding, and EUDI Wallet Verifier APIs.",
    "theme: jekyll-theme-cayman",
    "plugins:",
    "  - jekyll-relative-links",
    "relative_links:",
    "  enabled: true",
    "  collections: true",
    "include:",
    "  - index.md",
    "  - eudi",
    "",
  ].join("\n");
}

function humanizeFilename(name) {
  return name
    .replace(/\.md$/, "")
    .split("-")
    .map((s) => {
      const upper = s.toLowerCase();
      if (["api", "eudi", "mtls", "sdk", "oid4vp", "tsl", "lotl", "crl"].includes(upper)) return upper.toUpperCase();
      return s.charAt(0).toUpperCase() + s.slice(1);
    })
    .join(" ");
}

function landingPage() {
  return `---
layout: default
title: "Acuris agent context"
---

# Acuris agent context

Two skills available. Pick the one that matches what you're building.

- **[Address Validation & Geocoding](index.md)** (\`acuris-address\`) — when wiring address autocomplete, validation, forward/reverse geocoding, or migrating from libAddressDoctor / Loqate / Experian QAS / Melissa / Smarty.
- **[EUDI Wallet Verifier](eudi/index.md)** (\`acuris-eudi\`) — when integrating EU Digital Identity Wallet (OID4VP / SD-JWT VC) verification into a bank KYC or branch onboarding flow.
`;
}

function pluginReadme(version) {
  return `# Acuris — Claude Code plugin

Two Acuris skills bundled into one Claude Code plugin. Version ${version}.

## Install

From this repo's marketplace:

\`\`\`text
/plugin marketplace add Acuris-GmbH/acuris-agent-context
/plugin install acuris@acuris-plugins
\`\`\`

Or for local development:

\`\`\`bash
claude --plugin-dir ./claude-code-plugin
\`\`\`

## Skills inside

- **\`acuris-address\`** — Address Validation & Geocoding APIs.
  Activates on address autocomplete, validation, geocoding, reverse
  geocoding, batch cleanup, or migrations from libAddressDoctor,
  Loqate, Experian QAS, Melissa, Smarty.
- **\`acuris-eudi\`** — EUDI Wallet Verifier. Activates on EU Digital
  Identity Wallet, OID4VP, SD-JWT VC, presentation_definition, PID
  address verification, relying-party backend integration.

Each skill loads independently when the user's task matches its
description. Reference recipes load on demand.
`;
}

function agentSkillReadme(version) {
  return `# Acuris — Open Agent Skill package

Acuris agent skills in the open [Agent Skills](https://agentskills.io)
format. Version ${version}.

Two skills shipped:

- \`acuris-address/\` — Address Validation & Geocoding.
- \`acuris-eudi/\` — EUDI Wallet Verifier.

## Install

\`\`\`bash
# Interactive — pick your agent and which skill(s):
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

Each skill directory contains \`SKILL.md\` + \`references/\` in the
canonical Anthropic skill format. The CLI copies it into the right
host-specific path for your agent.
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

Rules supplied:

- \`acuris-overview.mdc\` — agent-selected; pulled in whenever the
  model decides Acuris is relevant.
- \`acuris-autocomplete.mdc\` — auto-attached on React checkout/address
  files.
- \`acuris-validation.mdc\` — auto-attached on server-side address
  routes.
- \`acuris-migration.mdc\` — manual via \`@acuris-migration\`, for
  porting from other AV vendors.
- \`acuris-eudi.mdc\` — agent-selected; pulled in for EUDI Wallet /
  OID4VP / SD-JWT VC / bank KYC integration work.

## 2. @Docs (cloud-indexed external documentation)

In Cursor:

> Settings → Indexing & Docs → @Docs → Add new doc

Use this URL:

\`\`\`text
https://acuris-gmbh.github.io/acuris-agent-context/
\`\`\`

The published site covers both the Address skill (root) and the EUDI
skill (\`/eudi/\`).

## 3. Cursor as an Agent Skills client

Cursor supports the open Agent Skills format natively. To install one
or both skills:

\`\`\`bash
npx skills add Acuris-GmbH/acuris-agent-context -a cursor
\`\`\`
`;
}

main().catch((err) => { warn(String(err.stack ?? err)); process.exit(1); });
