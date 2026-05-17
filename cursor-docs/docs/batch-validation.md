---
layout: default
title: "Batch Validation"
---

# Batch address validation

For data-quality cleanup of an existing database — backfilling
`formatted_address`, attaching `lat`/`lng`, flagging low-confidence
records — run a controlled batch against the API. This is a Node
script pattern, not a request-time one.

## Sizing the job

Per address: one HTTP request, ~150-400ms server-side, ~5KB response.
The default client retries 5xx/429 with backoff. Sensible defaults:

- Concurrency: **8-16 in-flight requests** (not 100s).
- Per-call timeout: **15s** (not the 5s request-time default).
- `maxRetries: 5` (longer batches absorb more transient blips).
- Persistent client, *one* per process.

Going wider than ~16 will start hitting rate limits and your retry
budget burns down. If you need higher throughput, talk to Acuris about
your plan — the API has burst headroom but the per-key steady-state
limit applies.

## Script template

```ts
// scripts/backfill-acuris.ts
import { readFile, writeFile } from "node:fs/promises";
import {
  AcurisClient,
  validateAddress,
  AcurisError,
  AcurisRateLimitError,
} from "@acuris-geo/av-sdk";

interface Row {
  id: string;
  raw_address: string;
  country: string;   // ISO-3 lowercase
}

interface OutRow extends Row {
  formatted_address?: string;
  lat?: number;
  lng?: number;
  accuracy_type?: string | null;
  confidence?: number;
  error?: string;
}

const client = new AcurisClient({
  apiKey:     process.env.ACURIS_API_KEY,
  timeoutMs:  15_000,
  maxRetries: 5,
});

const CONCURRENCY = 12;

async function processOne(row: Row): Promise<OutRow> {
  try {
    const v = await validateAddress(client, row.raw_address, { country: row.country });
    return {
      ...row,
      formatted_address: v.standardized?.formatted_address,
      lat: v.lat, lng: v.lng,
      accuracy_type: v.accuracy_type,
      confidence: v.confidence,
    };
  } catch (err) {
    return { ...row, error: err instanceof AcurisError ? `${err.name}: ${err.message}` : String(err) };
  }
}

async function runBatch(rows: Row[]): Promise<OutRow[]> {
  const out: OutRow[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < rows.length) {
        const i = cursor++;
        const r = await processOne(rows[i]);
        out[i] = r;
        if ((cursor & 0xFF) === 0) process.stderr.write(`  processed ${cursor}/${rows.length}\n`);
      }
    }),
  );
  return out;
}

(async () => {
  const inFile  = process.argv[2] ?? "addresses.json";
  const outFile = process.argv[3] ?? "addresses-validated.json";
  const rows: Row[] = JSON.parse(await readFile(inFile, "utf8"));
  console.error(`Processing ${rows.length} rows with concurrency=${CONCURRENCY}...`);
  const t = Date.now();
  const out = await runBatch(rows);
  await writeFile(outFile, JSON.stringify(out, null, 2));
  console.error(`Done in ${((Date.now() - t)/1000).toFixed(1)}s → ${outFile}`);
})();
```

Run with:

```bash
ACURIS_API_KEY=… node scripts/backfill-acuris.ts addresses.json out.json
```

## Resuming and idempotency

Long batches inevitably get interrupted. Make the script resumable:

- Emit results to an append-only file (`.jsonl`) rather than a single
  JSON blob — interrupted runs leave a usable partial file.
- Track `id`s already processed in a sidecar `processed-ids.txt`; on
  startup, skip those.
- Don't rely on the input file order — write the `id` into every output
  row and reconcile by id when merging into your database.

```ts
import { appendFile } from "node:fs/promises";

const out = "addresses.jsonl";
async function emit(row: OutRow) {
  await appendFile(out, JSON.stringify(row) + "\n");
}
```

## What to do with the results

`confidence` + `accuracy_type` decide your next action per row:

```ts
function bucket(r: OutRow): "good" | "review" | "fix" {
  if (!r.accuracy_type || r.confidence == null)  return "fix";
  if (r.confidence >= 0.9 && r.accuracy_type !== "centroid") return "good";
  if (r.confidence >= 0.6)                        return "review";
  return "fix";
}
```

- `good`: auto-merge `standardized.*` + coords into your row.
- `review`: queue for human triage — keep original side-by-side with
  Acuris's suggestion.
- `fix`: original is unrecoverable; the cheapest fix is to ask the
  customer next time they log in.

## Rate limits and politeness

The SDK absorbs 429 with exponential backoff. If you see `AcurisRateLimitError`
propagate after retries:

- Drop concurrency by half.
- Check `err.retryAfterSeconds` and sleep at least that long before the
  next attempt.
- Don't open a second key to multiply throughput. Talk to Acuris first.
