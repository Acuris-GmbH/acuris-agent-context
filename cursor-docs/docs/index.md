---
layout: default
title: "acuris-address — Address Validation & Geocoding"
---


## Overview

Acuris is a commercial address validation, geocoding, reverse geocoding,
and autocomplete API at `https://api.acuris-geo.com`. This skill teaches
agents how to wire it correctly into TypeScript / JavaScript code using
the published SDK packages and how to migrate from other AV vendors.

Two npm packages cover the full integration surface:

| Package                      | What it is                                                  |
| ---------------------------- | ----------------------------------------------------------- |
| `@acuris-geo/av-sdk`         | Platform-agnostic TypeScript SDK. Zero runtime dependencies. Works on Node 18+, modern browsers (server-only role), edge runtimes with `fetch`. |
| `@acuris-geo/centra-checkout` | React component library: `<AcurisAddressInput>` (typeahead), `<AcurisAddressValidator>` (headless), checkout-shaped hooks. |

Use the SDK directly for backend or non-React frontends. Use the
component package when you want a drop-in React UI; it calls *your* API
proxy routes, which call the SDK on the server.

## When to use this skill

Use this skill when the user is:

- Building an address input UI (autocomplete in a form, checkout step,
  sign-up flow).
- Validating an address on form submit before persisting it.
- Forward-geocoding addresses to lat/lng (shipping zones, distance,
  service-area checks).
- Reverse-geocoding coordinates to the nearest known address.
- Cleaning a bulk address dataset for data-quality work.
- Migrating off another AV vendor (Informatica AddressDoctor / Loqate /
  Experian QAS / Melissa / Smarty) — see the migration references.

**Do NOT** use this skill for:

- Routing, directions, isochrones, places search, or general POI lookup.
  Acuris is address-only; those belong to Google Maps, Mapbox, or
  Amazon Location.
- Rendering maps. The Acuris SDK returns lat/lng but doesn't ship a
  map renderer — pair the coordinates with MapLibre / Leaflet / Google
  Maps as the user prefers.

## API at a glance

Four endpoints. All live on `https://api.acuris-geo.com`. Auth is a
single header — `X-Acuris-Key: <ACURIS_API_KEY>`.

| Operation         | SDK function                              | HTTP                                  |
| ----------------- | ----------------------------------------- | ------------------------------------- |
| Validate          | `validateAddress(client, input, opts)`    | `POST /validate`                      |
| Forward geocode   | `geocodeAddress(client, input, opts)`     | `GET  /geocode` (or string → `/validate`) |
| Reverse geocode   | `reverseGeocode(client, {lat,lng}, opts)` | `GET  /reverse`                       |
| Autocomplete      | `suggestAddress(client, q, opts)`         | `GET  /suggest`                       |

Country must be ISO-3 alpha, lowercase (`"usa"`, `"deu"`, `"gbr"`). If
you have ISO-2, lowercase-it and map (`"us"` → `"usa"`, `"de"` → `"deu"`)
before calling.

Detailed request/response shapes, error hierarchy, and retry semantics
live in [`references/api-reference.md`](api-reference.md).

## Quick start

```bash
# Pin to current published versions — the packages are pre-1.0
# and `^1.x` ranges will not resolve.
npm install @acuris-geo/av-sdk@^0.1.2
# (optional, for React storefronts)
npm install @acuris-geo/centra-checkout@^0.1.1
```

```ts
import { AcurisClient, validateAddress } from "@acuris-geo/av-sdk";

const client = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

const result = await validateAddress(client, {
  country: "deu",
  street: "Friedrichstraße",
  house_number: "43",
  city: "Berlin",
  postcode: "10117",
});

result.accuracy_type;  // "rooftop" | "parcel" | "street_interpolated" | ...
result.confidence;     // 0..1
result.standardized?.formatted_address;
result.lat;  result.lng;
```

If `ACURIS_API_KEY` is set in the environment, you can omit the `apiKey`
option entirely.

## Defaults

When the user hasn't specified otherwise, prefer these:

- **API key in environment.** Read from `process.env.ACURIS_API_KEY`.
  Never inline a key, never expose it to the browser. For local
  evaluation, obtain a free dev key in one call:

  ```bash
  curl -X POST https://api.acuris-geo.com/dev-key \
    -H 'Content-Type: application/json' \
    -d '{"email":"you@example.com"}'
  # → {"api_key":"<token>","validation_credits":100,
  #     "geocode_credits":100,"expires_at":"...","tier":"dev",...}
  export ACURIS_API_KEY=<api_key>
  ```

  The dev key is capped at 100 validations + 100 geocodes over 7 days
  (rate-limited 1 issuance per email per day, 1 per IP per day). It
  works on every endpoint — `/validate`, `/geocode`, `/reverse`,
  `/suggest`. For more headroom, run the full 28-day trial at
  `https://api.acuris-geo.com/register` (1000 validations + 1000
  geocodes). For production, see `https://acuris-geo.com/acuris-pricing/`.
- **Server-side calls.** The SDK is for Node / edge / server runtimes.
  In a browser app, route through your own backend (Next.js API route,
  Express handler, Cloudflare Worker — see
  [`references/nextjs-proxy.md`](nextjs-proxy.md)).
- **Component library for React UIs.** Reach for
  `@acuris-geo/centra-checkout` (`<AcurisAddressInput>` for typeahead,
  `<AcurisAddressValidator>` for form-submit validation) instead of
  hand-rolling a fetch loop.
- **Retries on transient failures.** The SDK retries 5xx, 429, network
  errors, and timeouts automatically (3 attempts, exponential backoff).
  Don't add a retry layer on top.
- **One client per process.** `new AcurisClient(...)` is cheap to create
  but a long-lived instance keeps keep-alive sockets warm and avoids
  re-reading env vars.

## Common mistakes

These are the bugs we see most often in customer code or generated code.
Avoid them.

1. **Sending the API key from the browser.** The SDK works in any
   `fetch`-enabled runtime, but `apiKey` is a server-side credential.
   Browsers must go through a proxy route. The `@acuris-geo/centra-checkout`
   components expect an `endpoints` object pointing at your own URLs,
   not the Acuris API directly.

2. **ISO-2 country codes.** The API rejects `"US"` and `"de"`. Use ISO-3
   lowercase: `"usa"`, `"deu"`, `"gbr"`, `"fra"`, `"fin"`. If you only
   have ISO-2, map it at the boundary.

3. **`Authorization: Bearer …`** instead of the `X-Acuris-Key` header.
   The SDK sets the right header automatically; if you're hand-rolling
   HTTP for any reason, the header name matters.

4. **Treating `accuracy_type` as a closed enum.** New tiers are added
   over time (`street_interpolated`, `street_center`, `locality_centroid`,
   …). Always handle the documented values explicitly and pass through
   unknown values as opaque rather than throwing.

5. **Catching every error the same way.** The SDK throws typed
   subclasses (`AcurisAuthError`, `AcurisRateLimitError`,
   `AcurisValidationError`, `AcurisNotFoundError`, `AcurisServerError`,
   `AcurisTimeoutError`, `AcurisNetworkError`). 4xx is your code's bug;
   5xx and rate limits are runtime; auth errors mean the deploy is
   misconfigured. They deserve different handling.

6. **Forgetting `country` on `/suggest` and `/reverse`.** Unlike
   `/validate`, these endpoints require an explicit country option
   (they have no input from which to infer one).

7. **Hand-parsing the freeform string on the way out.** The SDK returns
   a `standardized` object with `formatted_address`. Display that, don't
   reassemble from individual fields — locale-specific ordering is
   baked in.

8. **Persisting Acuris's raw response without snapshotting the request
   inputs.** If you store `result.standardized`, also store what the user
   typed. Otherwise you can't tell later whether a confidence drop is
   the user's fault or Acuris's.

## Implementation patterns

The implementation recipes are in `references/`. Load whichever ones
match the task:

- [Address autocomplete in a checkout form (React)](autocomplete.md)
- [Validate on form submit](validate-on-submit.md)
- [Forward geocoding for shipping / distance](geocode.md)
- [Reverse geocoding from coordinates](reverse-geocode.md)
- [Batch validation for data-quality cleanup](batch-validation.md)
- [Next.js API proxy routes](nextjs-proxy.md)
- [Plain Node server usage](node-server.md)
- [Centra storefront integration](centra-storefront.md)

## Migrations

Acuris's commercial wedge — these are the recipes for porting code off
incumbent vendors. Each recipe maps the legacy API to the Acuris
equivalent with a runnable example.

- [Informatica AddressDoctor (libAddressDoctor)](migrate-informatica.md)
- [Loqate Capture / Verify](migrate-loqate.md)
- [Experian QAS Pro / Pro Web](migrate-experian-qas.md)
- [Melissa Personator / Address Verify](migrate-melissa.md)
- [Smarty (US Street API, US Autocomplete API, International)](migrate-smarty.md)

> Migrations are written against vendor documentation, not against the
> user's actual integration. Treat them as a starting scaffold — review
> the mapping for your specific configuration before shipping.

## Pricing and limits

The live API is paid per request. The test key `test` lets developers
exercise endpoints during evaluation without burning credits. Pricing
is published at <https://acuris-geo.com/acuris-pricing/>. The SDK
respects the server's rate limits (HTTP 429 with `retry_after`); the
default retry policy backs off and retries up to 3 times before
re-throwing `AcurisRateLimitError`.

## Additional resources

- SDK source: <https://github.com/Acuris-GmbH/acuris-centra-connector/tree/main/packages/acuris-av-sdk>
- React components: <https://github.com/Acuris-GmbH/acuris-centra-connector/tree/main/packages/acuris-centra-checkout>
- Pricing & free tier: <https://acuris-geo.com/acuris-pricing/>
- Live status / changelog: <https://acuris-geo.com/>
