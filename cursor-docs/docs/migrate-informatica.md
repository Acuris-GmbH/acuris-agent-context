---
layout: default
title: "Migrate Informatica"
---

# Migration — Informatica AddressDoctor (libAddressDoctor) → Acuris

Informatica AddressDoctor (the renamed Address Verification engine
acquired with Informatica) ships as a native `libAddressDoctor.so` /
`AddressDoctor.dll` linked into the customer process, plus per-country
reference databases on disk. Common entry points: the C/C++ SDK with
`AD_Search`, `AD_VerifyAddress`, `AD_ParseAddress`, and the
batch/realtime modes of Informatica Data Quality (IDQ).

Going to Acuris means replacing in-process library calls with HTTP
calls to `api.acuris-geo.com` (cloud), or with the on-prem Acuris SDK
shim (drop-in, same call shape — separate engagement).

This recipe assumes you're moving **to the cloud API**. For the
on-prem drop-in path that preserves your existing call sites, contact
Acuris directly.

## Concept mapping

| AddressDoctor concept                       | Acuris equivalent                                    |
| ------------------------------------------- | ---------------------------------------------------- |
| `AD_VerifyAddress` (verification mode)      | `POST /validate` (`validateAddress`)                 |
| `AD_Search` (interactive / batch search)    | `GET /suggest` + `POST /validate`                    |
| `AD_ParseAddress`                           | Embedded in `/validate` — `parsed` field on response |
| `AD_Geocode` (geocoding extension)          | `GET /geocode` (`geocodeAddress`)                    |
| `AD_GetReverseGeocodingResult`              | `GET /reverse` (`reverseGeocode`)                    |
| Per-country reference DBs (`.bcdb`, `.idx`) | Acuris-side, no install                              |
| Validation status `V_*` codes               | `accuracy_type` (string enum) + `confidence` (0..1)  |
| Element status `E_*` codes                  | `match_components.{city,house_number,...}` (booleans)|
| Verification Level (1-5)                    | `accuracy_type` tier (`rooftop` > `parcel` > ...)    |
| `AD_LICENSE_KEY`                            | `X-Acuris-Key` header / `ACURIS_API_KEY` env         |

## Before — typical IDQ batch using the C SDK

```c
// Pseudocode of the typical IDQ AV mapplet call site
AD_HANDLE h = AD_Open("/etc/addressdoctor/config.xml");
AD_Result *r = AD_VerifyAddress(h, country_iso3, raw_address, AD_PROCESS_MODE_BATCH);
const char *standardized = AD_GetCanonicalAddress(r);
double lat = AD_GetLatitude(r), lng = AD_GetLongitude(r);
int v_status = AD_GetStatus(r);   // V_FULL_MATCH / V_PARTIAL_MATCH / ...
AD_Free(r);
```

## After — Node service equivalent

```ts
import {
  AcurisClient,
  validateAddress,
  AcurisError,
} from "@acuris-geo/av-sdk";

const acuris = new AcurisClient({
  apiKey:     process.env.ACURIS_API_KEY,
  timeoutMs:  15_000,
  maxRetries: 5,
});

interface LegacyRow { id: string; country: string; raw_address: string; }
interface IdqLikeOutput {
  id: string;
  standardized: string;
  lat?: number; lng?: number;
  v_status: "FULL" | "PARTIAL" | "AMBIGUOUS" | "NO_MATCH";
  match_components: { city: boolean; house_number: boolean; street: boolean; postcode: boolean; state: boolean };
}

function mapStatus(accuracy: string | null, confidence: number): IdqLikeOutput["v_status"] {
  if (!accuracy)                                       return "NO_MATCH";
  if (confidence >= 0.9 && accuracy === "rooftop")     return "FULL";
  if (confidence >= 0.75)                              return "PARTIAL";
  if (confidence >= 0.4)                               return "AMBIGUOUS";
  return "NO_MATCH";
}

export async function verify(row: LegacyRow): Promise<IdqLikeOutput> {
  const r = await validateAddress(acuris, row.raw_address, { country: row.country });
  return {
    id: row.id,
    standardized: r.standardized?.formatted_address ?? row.raw_address,
    lat: r.lat, lng: r.lng,
    v_status: mapStatus(r.accuracy_type, r.confidence),
    match_components: {
      city:         r.match_components.city         ?? false,
      house_number: r.match_components.house_number ?? false,
      street:       r.match_components.street       ?? false,
      postcode:     r.match_components.zip          ?? false,
      state:        r.match_components.state        ?? false,
    },
  };
}
```

For the same throughput as a typical AV mapplet (300-800 rec/s on
mid-range AddressDoctor servers), run the batch script in
[`batch-validation.md`](./batch-validation.md) with concurrency 12-16.

## IDQ-side wiring options

You have three rough paths:

1. **Reverse a passthrough mapplet → REST.** Build an IDQ User-Defined
   Transformation (Java) or call the REST API from a Web Services
   transformation. The output shape above is structured so each field
   maps 1:1 to your current AV mapplet's outputs — minimal downstream
   re-wiring.
2. **Sidecar HTTP layer.** Stand up a small Node service in front of
   IDQ; have your existing AV mapplet call it via HTTP. Cleanest split
   for testing the migration in shadow mode before flipping.
3. **Acuris on-prem SDK shim.** Same call signatures as
   `libAddressDoctor`, drops into your existing process. Requires the
   on-prem product engagement — not a self-serve install.

## Configuration mapping

| AddressDoctor `config.xml` key       | Acuris equivalent                                |
| ------------------------------------ | ------------------------------------------------ |
| `MaxResultCount` (search)            | `limit` on `suggestAddress`                      |
| `ProcessMode = INTERACTIVE`          | `suggestAddress` for typeahead                   |
| `ProcessMode = BATCH`                | Direct `validateAddress` in a parallel loop      |
| `CountryDefault`                     | `country` argument on each call (no global)      |
| `CasingStyle`                        | Acuris returns locale-correct casing; no toggle   |
| `EnableCertifiedAddressing` (CASS)   | Not equivalent — CASS-Pro is USA-only USPS-cert; |
|                                      | Acuris is rooftop-grade but isn't CASS-certified. |
|                                      | If you need a CASS stamp, talk to Acuris.        |

## Status-code translation

Customer Java code that currently reads `r.getStatus().getCode() == V_FULL_MATCH`:

```ts
// Faithful to the IDQ status hierarchy
const isFullMatch    = r.accuracy_type === "rooftop" && r.confidence >= 0.9;
const isPartialMatch = r.confidence >= 0.6 && !isFullMatch;
const isAmbiguous    = r.confidence >= 0.4 && !isPartialMatch && !isFullMatch;
const isNoMatch      = !isFullMatch && !isPartialMatch && !isAmbiguous;
```

Tune the thresholds against a sample of your data — 0.9/0.6/0.4 is a
defensible starting point but downstream business rules (e.g.
"hold for review if address has any correction") may want
`input_corrected === true` as the gate instead.

## What you don't migrate

- **Per-country `.bcdb` files**: not needed. Acuris ships the data
  cloud-side. Decommission the storage and the upgrade pipeline.
- **CASS / SERP / AMAS / SNA certified-address workflows**: these are
  US/AU/NZ postal-authority certifications. Acuris isn't certified
  against them. If you need CASS for postal-discount rates, the
  AddressDoctor → Acuris move alone is not enough — talk to Acuris
  about the on-prem product or keep CASS as a separate post-processing
  step.

> This migration recipe is written against AddressDoctor / Informatica
> AV public docs and the typical IDQ wiring we've seen at customer
> sites. It hasn't been validated against any specific customer
> codebase. Treat as a scaffold; review against your call sites
> before shipping.
