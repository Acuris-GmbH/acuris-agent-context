---
layout: default
title: "Nextjs Proxy"
---

# Next.js API proxy routes for Acuris

The standard pattern: a thin set of API routes in your Next.js app that
the React components / your custom UI call. The SDK lives server-side
where the API key lives. Works for both App Router and Pages Router.

## App Router (Next.js 13+)

Four routes mirror the four endpoints. They share a single
`AcurisClient` instance, declared at module scope.

```ts
// app/api/acuris/_client.ts
import { AcurisClient } from "@acuris-geo/av-sdk";

if (!process.env.ACURIS_API_KEY) {
  throw new Error("ACURIS_API_KEY is not set");
}

export const acuris = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });
```

```ts
// app/api/acuris/validate/route.ts
import { acuris } from "../_client";
import { validateAddress, AcurisError, AcurisRateLimitError } from "@acuris-geo/av-sdk";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { country?: string; input?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  if (!body.country || body.input == null) return Response.json({ error: "missing_fields" }, { status: 400 });

  try {
    const r = await validateAddress(acuris, body.input as any, { country: body.country });
    return Response.json(r);
  } catch (err) {
    return upstreamErrorToResponse(err);
  }
}

function upstreamErrorToResponse(err: unknown) {
  if (err instanceof AcurisRateLimitError) {
    const headers = err.retryAfterSeconds ? { "Retry-After": String(err.retryAfterSeconds) } : undefined;
    return Response.json({ error: "rate_limit" }, { status: 429, headers });
  }
  if (err instanceof AcurisError && typeof err.status === "number") {
    return Response.json({ error: err.name }, { status: err.status });
  }
  return Response.json({ error: "upstream" }, { status: 502 });
}
```

```ts
// app/api/acuris/suggest/route.ts
import { acuris } from "../_client";
import { suggestAddress } from "@acuris-geo/av-sdk";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const country = u.searchParams.get("country");
  const q       = u.searchParams.get("q") ?? "";
  const limit   = Number(u.searchParams.get("limit") ?? "10");
  const state   = u.searchParams.get("state") ?? undefined;

  if (!country) return Response.json({ error: "country required" }, { status: 400 });
  if (q.length < 3) return Response.json([]);   // don't bill for noise

  try {
    const hits = await suggestAddress(acuris, q, { country, limit, state });
    return Response.json(hits, { headers: { "Cache-Control": "private, max-age=10" } });
  } catch {
    return Response.json([], { status: 200 });   // typeahead must degrade silently
  }
}
```

```ts
// app/api/acuris/geocode/route.ts
import { acuris } from "../_client";
import { geocodeAddress } from "@acuris-geo/av-sdk";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { country, input } = await req.json();
  if (!country || input == null) return Response.json({ error: "missing_fields" }, { status: 400 });
  try {
    const r = await geocodeAddress(acuris, input, { country });
    return Response.json(r);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
```

```ts
// app/api/acuris/reverse/route.ts
import { acuris } from "../_client";
import { reverseGeocode } from "@acuris-geo/av-sdk";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const country = u.searchParams.get("country");
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  const radius_m = Number(u.searchParams.get("radius_m") ?? "50");
  const limit    = Number(u.searchParams.get("limit")    ?? "1");

  if (!country || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: "bad_params" }, { status: 400 });
  }
  try {
    const r = await reverseGeocode(acuris, { lat, lng }, { country, radius_m, limit });
    return Response.json(r);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
```

## Pages Router (Next.js 12 and earlier)

Same shape, different signature:

```ts
// pages/api/acuris/validate.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { acuris } from "./_client";
import { validateAddress, AcurisError } from "@acuris-geo/av-sdk";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { country, input } = req.body ?? {};
  if (!country || input == null) return res.status(400).json({ error: "missing_fields" });
  try {
    const r = await validateAddress(acuris, input, { country });
    res.status(200).json(r);
  } catch (err) {
    res.status(err instanceof AcurisError && err.status ? err.status : 502)
       .json({ error: String(err) });
  }
}
```

## Runtime choice

- `runtime = "nodejs"` (default on App Router). Required for Node-only
  features; safest pick.
- `runtime = "edge"` works too — the SDK uses standard `fetch` and has
  no Node-specific imports. But edge environments are stricter about
  long timeouts; keep `timeoutMs` low and `maxRetries` low.

## Environment

```bash
# .env.local
ACURIS_API_KEY=…
```

- **Never** prefix with `NEXT_PUBLIC_` — that ships the key to the
  browser. The Acuris key is server-side only.
- For Vercel, set the same var in the project dashboard for each
  environment.
- For CI, inject from your secrets store. The `test` literal value
  works for E2E tests against the live API.

## Caching

- `/validate` and `/geocode` are stable for a given input → cache by
  input for hours if the same address gets hit repeatedly. Be mindful
  of GDPR if you're caching customer-specific addresses by request key.
- `/suggest` is high-traffic — the example above caches by URL for 10s,
  which kills the duplicate-keystroke storms autocomplete generates.
- `/reverse` results are stable too, but the key is a continuous float
  so caching needs quantization (round to 5dp lat/lng) to actually hit.

## Errors visible to the browser

Don't leak `err.message` to the frontend — server traces shouldn't end
up in console logs of random visitors. Return a stable error code
(`"rate_limit"`, `"bad_input"`, `"upstream"`, `"no_match"`) and have
the UI map those to user-facing messages. The example routes above
already follow this.
