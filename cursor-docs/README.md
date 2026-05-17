# Acuris context for Cursor

Three independent ways to give Cursor knowledge of the Acuris APIs.
Pick one (or all three) depending on how you use Cursor.

## 1. Project rules (drop into your repo)

Copy the rules from `rules/` into your project's `.cursor/rules/`:

```bash
mkdir -p .cursor/rules
cp -r path/to/acuris-agent-context/cursor-docs/rules/*.mdc .cursor/rules/
```

The rules activate automatically when you edit:

- `acuris-overview.mdc` — agent-selected; pulled in whenever the model
  decides Acuris is relevant.
- `acuris-autocomplete.mdc` — auto-attached on files matching
  `**/checkout/**/*.{tsx,jsx}`, `**/address/**/*.{tsx,jsx}`,
  `**/*Autocomplete*`, `**/api/**/{address,suggest,autocomplete}*`.
- `acuris-validation.mdc` — auto-attached on files matching
  `**/api/**/{address,validate,checkout,orders,customers}*`,
  `**/server/**/*{address,checkout}*`, `**/*AddressValidator*`.
- `acuris-migration.mdc` — manual via `@acuris-migration` mention,
  when porting code from another AV vendor.

## 2. @Docs (cloud-indexed external documentation)

In Cursor:

> Settings → Indexing & Docs → @Docs → Add new doc

Use this URL:

```text
https://acuris-gmbh.github.io/acuris-agent-context/
```

(Available once GitHub Pages is enabled on the repo. The published
site is a flat copy of the same skill + references, hosted by the
`docs/` directory in this folder.)

## 3. Cursor as an Agent Skills client

Cursor supports the open Agent Skills format natively. To install the
full skill (not just the rules):

```bash
npx skills add Acuris-GmbH/acuris-agent-context -a cursor
```
