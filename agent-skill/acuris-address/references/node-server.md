# Plain Node server usage

For non-Next.js stacks — Express, Fastify, Koa, Hono, raw `http` — the
pattern is the same: a single long-lived `AcurisClient` instance,
endpoints that mirror the four SDK functions, errors mapped to HTTP
status codes.

## Express

```ts
import express from "express";
import {
  AcurisClient,
  validateAddress,
  suggestAddress,
  geocodeAddress,
  reverseGeocode,
  AcurisError,
  AcurisRateLimitError,
} from "@acuris-geo/av-sdk";

const app = express();
app.use(express.json());

const acuris = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

function sendError(res: express.Response, err: unknown) {
  if (err instanceof AcurisRateLimitError) {
    if (err.retryAfterSeconds) res.setHeader("Retry-After", String(err.retryAfterSeconds));
    return res.status(429).json({ error: "rate_limit" });
  }
  if (err instanceof AcurisError && err.status) return res.status(err.status).json({ error: err.name });
  res.status(502).json({ error: "upstream" });
}

app.post("/acuris/validate", async (req, res) => {
  try {
    const r = await validateAddress(acuris, req.body.input, { country: req.body.country });
    res.json(r);
  } catch (err) { sendError(res, err); }
});

app.get("/acuris/suggest", async (req, res) => {
  const country = String(req.query.country ?? "");
  const q       = String(req.query.q       ?? "");
  const limit   = Number(req.query.limit   ?? 10);
  if (!country) return res.status(400).json({ error: "country required" });
  try {
    const hits = await suggestAddress(acuris, q, { country, limit });
    res.set("Cache-Control", "private, max-age=10").json(hits);
  } catch { res.json([]); }
});

app.post("/acuris/geocode", async (req, res) => {
  try { res.json(await geocodeAddress(acuris, req.body.input, { country: req.body.country })); }
  catch (err) { sendError(res, err); }
});

app.get("/acuris/reverse", async (req, res) => {
  const country  = String(req.query.country ?? "");
  const lat      = Number(req.query.lat);
  const lng      = Number(req.query.lng);
  const radius_m = Number(req.query.radius_m ?? 50);
  const limit    = Number(req.query.limit ?? 1);
  if (!country) return res.status(400).json({ error: "country required" });
  try {
    const r = await reverseGeocode(acuris, { lat, lng }, { country, radius_m, limit });
    res.json(r);
  } catch (err) { sendError(res, err); }
});

app.listen(3000);
```

## Validate-before-persist pattern

Most server-side use is "the client posted me an address; validate it
before I commit to the DB":

```ts
app.post("/orders", async (req, res) => {
  const { address, items } = req.body;

  let validated;
  try {
    validated = await validateAddress(acuris, address, { country: address.country });
  } catch (err) {
    if (err instanceof AcurisRateLimitError) return res.status(503).json({ error: "try_again" });
    return res.status(400).json({ error: "bad_address" });
  }

  if (validated.confidence < 0.6 || validated.accuracy_type === "centroid") {
    return res.status(422).json({
      error: "address_unverifiable",
      suggestion: validated.standardized?.formatted_address,
    });
  }

  const orderId = await db.orders.insert({
    items,
    address: {
      ...validated.standardized,
      lat: validated.lat, lng: validated.lng,
      raw_input: address,
      confidence: validated.confidence,
      accuracy_type: validated.accuracy_type,
    },
  });
  res.status(201).json({ orderId });
});
```

The key call is the 422 branch: if Acuris can't make sense of the
address, refuse the order rather than silently accept a centroid that
your warehouse can't deliver to.

## Fastify

Same shape, Fastify signatures:

```ts
import Fastify from "fastify";
import { AcurisClient, validateAddress, AcurisError } from "@acuris-geo/av-sdk";

const fastify = Fastify();
const acuris  = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

fastify.post<{ Body: { country: string; input: unknown } }>("/acuris/validate", async (req, reply) => {
  try {
    return await validateAddress(acuris, req.body.input as any, { country: req.body.country });
  } catch (err) {
    if (err instanceof AcurisError && err.status) reply.code(err.status);
    else reply.code(502);
    return { error: String(err) };
  }
});

fastify.listen({ port: 3000 });
```

## Edge / Hono / Cloudflare Workers

The SDK uses standard `fetch` and has no Node imports. It runs on
Cloudflare Workers, Deno, Bun, and Hono-on-edge unchanged. Two notes:

- Pass `apiKey` explicitly instead of relying on `process.env`.
  `process.env` doesn't exist in most edge runtimes.
- Keep `timeoutMs` short (≤5s) — many edge runtimes have hard wall
  limits on CPU and total request time.

```ts
// Cloudflare Worker
import { AcurisClient, validateAddress } from "@acuris-geo/av-sdk";

export default {
  async fetch(req: Request, env: { ACURIS_API_KEY: string }): Promise<Response> {
    const acuris = new AcurisClient({ apiKey: env.ACURIS_API_KEY, timeoutMs: 3000 });
    const body = await req.json();
    const r = await validateAddress(acuris, body.input, { country: body.country });
    return Response.json(r);
  },
};
```

(A long-lived module-scope client would also work; in the Worker model
each request gets a fresh isolate so the value is the same.)
