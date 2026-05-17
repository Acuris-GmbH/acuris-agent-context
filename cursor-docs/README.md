# Acuris context for Cursor

Three independent ways to give Cursor knowledge of the Acuris APIs.
Pick one (or all three) depending on how you use Cursor.

## 1. Project rules (drop into your repo)

Copy the rules from `rules/` into your project's `.cursor/rules/`:

```bash
mkdir -p .cursor/rules
cp -r path/to/acuris-agent-context/cursor-docs/rules/*.mdc .cursor/rules/
```

Rules supplied:

- `acuris-overview.mdc` — agent-selected; pulled in whenever the
  model decides Acuris is relevant.
- `acuris-autocomplete.mdc` — auto-attached on React checkout/address
  files.
- `acuris-validation.mdc` — auto-attached on server-side address
  routes.
- `acuris-migration.mdc` — manual via `@acuris-migration`, for
  porting from other AV vendors.
- `acuris-eudi.mdc` — agent-selected; pulled in for EUDI Wallet /
  OID4VP / SD-JWT VC / bank KYC integration work.

## 2. @Docs (cloud-indexed external documentation)

In Cursor:

> Settings → Indexing & Docs → @Docs → Add new doc

Use this URL:

```text
https://acuris-gmbh.github.io/acuris-agent-context/
```

The published site covers both the Address skill (root) and the EUDI
skill (`/eudi/`).

## 3. Cursor as an Agent Skills client

Cursor supports the open Agent Skills format natively. To install one
or both skills:

```bash
npx skills add Acuris-GmbH/acuris-agent-context -a cursor
```
