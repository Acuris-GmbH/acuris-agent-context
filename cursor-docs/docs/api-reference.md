---
layout: default
title: "API Reference"
---

# API reference

Authoritative request/response shapes for the four Acuris endpoints, the
client configuration surface, and the error hierarchy. Derived from the
`@acuris-geo/av-sdk` TypeScript types — those are the source of truth
if anything here drifts.

## Authentication

Single header. Send your API key in `X-Acuris-Key`:

```http
POST /validate HTTP/1.1
Host: api.acuris-geo.com
X-Acuris-Key: <ACURIS_API_KEY>
Content-Type: application/json
Accept: application/json
```

The SDK sets this automatically. If you are calling the API by hand
(curl, Postman, generated client from a third-party tool), use this
header — not `Authorization: Bearer`.

### Getting a key

Two self-service paths:

| Endpoint                                 | Best for                              | Caps                                                |
| ---------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| `POST /dev-key`                          | AI-skill / SDK evaluation             | 100 validations + 100 geocodes, 7 days; 1/email/day. |
| `POST /register` (web form at `/register`) | Full trial, paid plan onboarding    | 1000 validations + 1000 geocodes, 28 days.          |

`POST /dev-key` is one step and returns the key in the response body:

```bash
curl -X POST https://api.acuris-geo.com/dev-key \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
```

Response:

```json
{
  "api_key":             "<token>",
  "validation_credits":  100,
  "geocode_credits":     100,
  "expires_at":          "2026-... UTC",
  "tier":                "dev",
  "info_url":            "https://acuris-geo.com/acuris-pricing/",
  "next_steps":          "Set ACURIS_API_KEY=<api_key> ..."
}
```

The dev key authenticates every endpoint (`/validate`, `/geocode`,
`/reverse`, `/suggest`). It's not a special "demo-only" tier — the
calls execute against the same live cascade as paid traffic.

> **Note on the literal value `test`.** The string `"test"` is **not**
> a universal evaluation key. It works on `/suggest` for legacy
> marketing-site widgets but is rejected by `/validate`, `/geocode`,
> and `/reverse`. Use `POST /dev-key` for evaluation instead — it
> takes 5 seconds and gives you a real key.

## Base URL

`https://api.acuris-geo.com`. There is no separate sandbox host — the
test key gates evaluation traffic on the live API. If you are running
the Acuris on-prem build, override `baseUrl` on the client.

## Client configuration

```ts
import { AcurisClient } from "@acuris-geo/av-sdk";

const client = new AcurisClient({
  apiKey:     process.env.ACURIS_API_KEY,       // required (or env)
  baseUrl:    "https://api.acuris-geo.com",     // default
  timeoutMs:  5000,                              // per-request, default
  maxRetries: 3,                                 // 5xx/429/net/timeout
  fetch:      globalThis.fetch,                  // override for tests
  userAgent:  "myapp/1.0",                       // appended after acuris-av-sdk/<ver>
});
```

A long-lived `AcurisClient` instance is the recommended pattern — it
keeps `keep-alive` sockets warm and avoids re-reading env vars per call.

## `POST /validate` — validate an address

SDK: `validateAddress(client, input, options?)`.

**Request body:**

```json
{
  "country": "deu",
  "input": {
    "street":       "Friedrichstraße",
    "house_number": "43",
    "city":         "Berlin",
    "locality":     null,
    "state":        null,
    "postcode":     "10117"
  }
}
```

`input` may also be a single-line string:

```json
{ "country": "usa", "input": "100 Main St, San Francisco CA 94105" }
```

**Response (`ValidationResult`):**

```json
{
  "accuracy_type":  "rooftop",
  "confidence":     0.97,
  "match_type":     "exact",
  "match_score":    0.99,
  "match_components": {
    "city": true, "house_number": true, "state": true,
    "street": true, "zip": true
  },
  "input_corrected": false,
  "standardized": {
    "country":      "deu",
    "city":         "Berlin",
    "state":        "Berlin",
    "postcode":     "10117",
    "street":       "Friedrichstraße",
    "house_number": "43",
    "formatted_address": "Friedrichstraße 43\n10117 Berlin\nGermany"
  },
  "parsed": { "...echo of how Acuris parsed the raw input..." },
  "corrections": [],
  "lat": 52.5074, "lng": 13.3899,
  "house_number_not_found": false,
  "status": "V2"
}
```

Field meanings:

| Field                     | What it tells you                                       |
| ------------------------- | ------------------------------------------------------- |
| `accuracy_type`           | Precision bucket (`rooftop`, `parcel`, `street_interpolated`, `street_center`, `postcode`, `locality_centroid`, `centroid`, `country`, ...). Open enum. |
| `confidence`              | 0..1. Higher = more confident the match represents the user's intent. |
| `match_type`              | `exact` / `interpolated` / `partial` / `no_match` / `rooftop`. |
| `match_components`        | Per-field booleans — which components matched.          |
| `input_corrected`         | True if Acuris altered the input to produce a match.    |
| `standardized`            | Canonical form. Use `formatted_address` for display.    |
| `corrections`             | Human-readable list of what Acuris changed, if anything.|
| `lat` / `lng`             | Forward-geocoded coords when available.                 |
| `house_number_not_found`  | True if house-level coords weren't found and a coarser tier was returned. |

## `GET /geocode` — forward geocode (fielded only)

SDK: `geocodeAddress(client, input, options?)`.

`/geocode` requires structured fields. The SDK auto-detects: if you pass
a string it falls back to `/validate` (which handles freeform) and maps
the response to `GeocodingResult`.

**Request (query params):**

```
GET /geocode?country=deu&street=Friedrichstra%C3%9Fe&hno=43
            &city=Berlin&postalcode=10117
```

Field mapping from SDK input → query param:

| SDK input field    | Query param   |
| ------------------ | ------------- |
| `street`           | `street`      |
| `house_number`     | `hno`         |
| `city`             | `city`        |
| `locality`         | `town`        |
| `state`            | `state`       |
| `postcode`         | `postalcode`  |

**Response (`GeocodingResult`):** same shape as `standardized` plus
`accuracy_type`, `match_type`, `match_score`, `match_components`,
`lat`, `lng`, `formatted_address`, `house_number_not_found`.

## `GET /reverse` — reverse geocode

SDK: `reverseGeocode(client, { lat, lng }, options)`.

**Request:**

```
GET /reverse?country=usa&lat=37.7749&lng=-122.4194&radius_m=100&limit=3
```

- `radius_m`: search radius in metres. Default `50`, max `5000`.
- `limit`: max results. Default `1`.

**Response (`ReverseGeocodingResult`):**

```json
{
  "hits": [
    {
      "accuracy_type": "rooftop",
      "match_type":    "exact",
      "match_score":   0.98,
      "distance_m":    14,
      "lat":           37.7748,
      "lng":           -122.4195,
      "country":       "usa",
      "city":          "San Francisco",
      "state":         "CA",
      "zip":           "94102",
      "street":        "Market St",
      "hno":           "1"
    }
  ],
  "query": { "lat": 37.7749, "lng": -122.4194, "radius_m": 100 }
}
```

`country` on the options is **required** — the API has no input from
which to infer it. `lat` must be in `[-90, 90]`; `lng` in `[-180, 180]`.

## `GET /suggest` — autocomplete prefix → suggestions

SDK: `suggestAddress(client, q, options)`.

**Request:**

```
GET /suggest?country=deu&q=Friedrichstr&limit=5
```

Optional `state` (`USA` / `CAN` / `AUS` / ...) biases results.
`limit` defaults to `10`, server caps at `50`.

**Response:**

```json
{
  "suggestions": [
    {
      "country": "deu",
      "city":    "Berlin",
      "postcode": "10117",
      "street":  "Friedrichstraße",
      "house_number": "43",
      "lat": 52.5074, "lng": 13.3899,
      "formatted_address": "Friedrichstraße 43\n10117 Berlin\nGermany"
    }
  ]
}
```

The SDK returns the bare `SuggestionHit[]` array (it unwraps
`suggestions`). Empty arrays come back as `[]` (not null).

## Errors

The SDK throws a typed hierarchy:

```ts
import {
  AcurisError,            // base
  AcurisAuthError,        // 401, 403
  AcurisValidationError,  // 400, 422
  AcurisNotFoundError,    // 404
  AcurisRateLimitError,   // 429 (carries `retryAfterSeconds`)
  AcurisServerError,      // 5xx
  AcurisTimeoutError,     // client-side timeout
  AcurisNetworkError,     // fetch failed before producing a response
  isTransientStatus,      // helper: status → boolean
} from "@acuris-geo/av-sdk";
```

Every subclass carries `status?`, `body?`, `endpoint?`, and `cause?`.

Recommended handling:

```ts
try {
  const result = await validateAddress(client, input, { country: "deu" });
  // ...
} catch (err) {
  if (err instanceof AcurisAuthError)       throw new Error("Acuris key misconfigured");
  if (err instanceof AcurisValidationError) return { ok: false, kind: "bad_input", err };
  if (err instanceof AcurisRateLimitError)  return { ok: false, kind: "rate_limit", retryAfter: err.retryAfterSeconds };
  if (err instanceof AcurisNotFoundError)   return { ok: false, kind: "no_match" };
  // AcurisServerError / Timeout / NetworkError — already retried by the SDK
  throw err;
}
```

## Retry semantics

The SDK retries the following automatically with exponential backoff
(default `maxRetries: 3`):

- HTTP 5xx
- HTTP 429
- Network errors (fetch threw before a response)
- Client-side timeouts (`timeoutMs` exceeded)

Anything else propagates immediately. Don't add a second retry loop on
top — you'll multiply the budget and confuse the rate-limiter.

### Tuning timeouts and the retry budget

The default `timeoutMs: 5000` is right for most server-side use.
Two situations want different settings:

- **Cold first-call sensitivity.** TLS handshake + DNS on the very
  first call from a freshly-started Node process can occasionally
  exceed 5s on certain network paths. Combined with the default
  `maxRetries: 3`, that turns into a 15+s wall-time before the call
  fails — long enough to time out an HTTP proxy upstream. If you see
  intermittent timeouts on the first call after a deploy, bump
  `timeoutMs` to `10_000`. Subsequent calls reuse the keep-alive
  connection and complete in ~50-100ms.
- **Batch jobs.** Wider timeouts and a deeper retry budget make
  sense when wall-time per row matters less than completion:

  ```ts
  const client = new AcurisClient({
    apiKey:     process.env.ACURIS_API_KEY,
    timeoutMs:  15_000,
    maxRetries: 5,
  });
  ```

Per-call overrides also work:

```ts
await validateAddress(client, addr, {
  country: "deu",
  timeoutMs: 15_000,
  maxRetries: 5,
});
```

## Cancelling

Every SDK call accepts an `AbortSignal`:

```ts
const ac = new AbortController();
const p  = validateAddress(client, input, { country: "deu", signal: ac.signal });
// ...
ac.abort(); // p rejects with AbortError
```

Useful inside React `useEffect` cleanups to drop stale autocomplete
responses when the user types more characters.

## TypeScript types (full surface)

```ts
export type CountryCode = string; // ISO-3 lowercase

export type AddressInput = string | FieldedAddressInput;

export interface FieldedAddressInput {
  street?: string;
  house_number?: string;
  city?: string;
  locality?: string;     // sub-locality / district
  state?: string;
  postcode?: string;
  country?: CountryCode;
}

export type AccuracyType =
  | "rooftop" | "parcel" | "street_interpolated" | "street_center"
  | "postcode" | "postcode_center" | "locality" | "locality_centroid"
  | "centroid" | "country"
  | (string & {});                // open enum

export interface ValidationResult { /* see /validate above */ }
export interface GeocodingResult   { /* see /geocode above */ }
export interface ReverseGeocodingResult { hits: ReverseGeocodingHit[]; query: { lat: number; lng: number; radius_m: number } }
export interface SuggestionHit     { /* see /suggest above */ }
```

Full type definitions live in
[`packages/acuris-av-sdk/src/types.ts`](https://github.com/Acuris-GmbH/acuris-centra-connector/blob/main/packages/acuris-av-sdk/src/types.ts)
in the centra-connector repo.
