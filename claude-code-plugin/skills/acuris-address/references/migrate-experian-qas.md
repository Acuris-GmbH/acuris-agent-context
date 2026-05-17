# Migration — Experian QAS (Pro / Pro Web / Authenticate) → Acuris

Experian Address Validation — also branded as **QAS** (Quick Address
Search), **QuickAddress Pro**, and **Pro Web** — ships in two
shapes:

- **QAS Pro / Pro Web** — local install with reference data on a
  Windows/Linux server, plus a SOAP/REST endpoint your apps call.
- **Address Validation REST** — Experian's hosted REST API at
  `api.experianaperture.io` / `api.edq.com`.

The hosted REST API is the easier port; the Pro install with local
data has the same conceptual mapping but requires removing the data
deployment and the licence-server.

## Concept mapping

| Experian QAS                                | Acuris                                            |
| ------------------------------------------- | ------------------------------------------------- |
| `Search` (with `engine: singleline` / `intuitive`) | `validateAddress` (string input)            |
| `Format` (resolve picklist item by `format_id`) | Not needed — Acuris flattens this step        |
| `Suggestions` (typeahead)                   | `suggestAddress`                                  |
| `Validate` (single-pass verify)             | `validateAddress`                                 |
| `Geocoding` add-on                          | `geocodeAddress` (built-in, no add-on)            |
| `match_confidence` (`verified_match`, `partial_match`, ...) | `confidence` + `accuracy_type`        |
| `verification_level` (`V`/`P`/`U`/...)      | `accuracy_type` + `match_components`              |
| `Auth-Token` header                         | `X-Acuris-Key` header                             |
| `country_iso` (ISO-3 alpha-3 uppercase)     | ISO-3 alpha-3 **lowercase**                       |

## Before — Experian REST Search

```http
POST https://api.experianaperture.io/address/search/v1
Auth-Token: <token>
Content-Type: application/json
Reference-Id: <uuid>

{
  "country_iso": "GBR",
  "components": { "unspecified": ["1 Acuris Way London EC2A 4XX"] },
  "options": [{ "name": "search_type", "value": "singleline" }]
}
```

Response contains a list of `suggestions` with `global_address_key`;
you pick one and call `/address/format/v1/{key}` to materialize the
canonical address.

## After — Acuris (one round-trip)

```ts
import { AcurisClient, validateAddress } from "@acuris-geo/av-sdk";

const client = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

const r = await validateAddress(
  client,
  "1 Acuris Way London EC2A 4XX",
  { country: "gbr" },
);

// Pre-canonical, no second round-trip
console.log(r.standardized?.formatted_address);
console.log(r.accuracy_type, r.confidence);
```

If you specifically want the typeahead experience (`/address/search`
with intuitive autocomplete), use `suggestAddress` + `validateAddress`:

```ts
import { suggestAddress } from "@acuris-geo/av-sdk";

const hits = await suggestAddress(client, "1 acur", { country: "gbr", limit: 10 });
// user picks hits[0]
const final = await validateAddress(client, hits[0], { country: "gbr" });
```

## Validation status mapping

```ts
type QASStatus = "verified_match" | "interaction_required" | "premises_partial"
               | "street_partial" | "multiple_matches" | "no_matches";

function toQASStatus(a: string | null, c: number): QASStatus {
  if (!a)                                  return "no_matches";
  if (a === "rooftop"  && c >= 0.9)        return "verified_match";
  if (a === "parcel"   && c >= 0.85)       return "verified_match";
  if (a === "street_interpolated")         return "premises_partial";
  if (a === "street_center")               return "street_partial";
  if (c < 0.4)                             return "no_matches";
  return "interaction_required";
}
```

If your downstream code branches on `verification_level` letter codes:

| QAS letter | Acuris equivalent                                              |
| ---------- | -------------------------------------------------------------- |
| `V`erified  | `accuracy_type` ∈ {`rooftop`, `parcel`} AND `confidence ≥ 0.9` |
| `P`artial   | `street_interpolated` or `confidence` in `[0.5, 0.9)`         |
| `U`nverified | `centroid` / `country` / `confidence < 0.5`                  |
| `R`eview   | `input_corrected === true`                                     |

## Country codes

Experian uses **uppercase** ISO-3. Acuris uses **lowercase** ISO-3.

```ts
const acurisCountry = experianCountry.toLowerCase();   // "GBR" → "gbr"
```

(Don't be tempted to keep the original case — Acuris rejects uppercase.)

## "Format" step no longer needed

QAS / Aperture uses a two-step flow: search returns `global_address_key`,
then `/address/format/v1/{key}` materializes the structured address.
Acuris collapses these into one `/validate` round-trip — the response
already contains the canonical fields. When porting, delete the
intermediate format call entirely.

## Pro / Pro Web on-prem deployments

Pro and Pro Web run on local servers (`qaserver`, `qaproweb` daemons)
with reference data on disk and a licence file pinned to the host. The
cloud Acuris API does not require any of that.

If your reason for staying on Pro was data residency, ask Acuris about
the on-prem product — same SDK call signatures, encrypted DBs deployed
to your infrastructure, no outbound HTTP. The data-residency
conversation is separate from this migration recipe.

> Written against Experian Aperture / QAS public docs. Validate the
> mapping against your actual `verification_level` thresholds before
> cutting over.
