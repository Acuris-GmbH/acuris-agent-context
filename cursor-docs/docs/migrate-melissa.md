---
layout: default
title: "Migrate Melissa"
---

# Migration — Melissa Personator / Address Verify → Acuris

Melissa Data ships two relevant products:

- **Address Verify** — the cleansing-only API (`personator.melissadata.net`
  with `&actions=Verify`).
- **Personator** — combined address + name + email + phone enrichment.
  Address coverage is the same engine; the wrapping API just bundles
  more checks.

Migration to Acuris covers the **address** parts; name/email/phone
enrichment is out of scope.

## Concept mapping

| Melissa                                              | Acuris                                            |
| ---------------------------------------------------- | ------------------------------------------------- |
| `Personator?actions=Verify`                          | `validateAddress`                                 |
| `GlobalAddressVerification` REST                     | `validateAddress`                                 |
| `ExpressEntry` (autocomplete) / `Lookup`             | `suggestAddress` / `validateAddress`              |
| `Geocoder` add-on                                    | `geocodeAddress` (built-in)                       |
| `ReverseGeocoder`                                    | `reverseGeocode`                                  |
| `&id=<license>` query param                          | `X-Acuris-Key` header                             |
| `&format=json`                                       | Always JSON                                       |
| `Results` field codes (`AS01`, `AS09`, ...)          | `accuracy_type` + `confidence` + `match_components` |
| Country: ISO-3 (`USA`, `DEU`, …) uppercase or full name | ISO-3 **lowercase** (`usa`, `deu`)             |
| `MAK` (Melissa Address Key)                          | No equivalent (and not needed)                    |

## Before — Melissa Global Address Verification

```http
GET https://address.melissadata.net/v3/WEB/GlobalAddress/doGlobalAddress
    ?id=<license>
    &a1=1 Acuris Way
    &loc=London
    &postal=EC2A 4XX
    &ctry=GBR
    &format=json
```

Response:

```json
{
  "Version": "5.0.0.7",
  "Records": [{
    "RecordID": "1",
    "Results": "AV24,GS01,AC02",
    "FormattedAddress": "1 Acuris Way;London EC2A 4XX;UNITED KINGDOM",
    "AddressLine1": "1 Acuris Way",
    "Locality": "London",
    "PostalCode": "EC2A 4XX",
    "Country": "United Kingdom",
    "Latitude": "51.5236",
    "Longitude": "-0.0850"
  }]
}
```

## After — Acuris

```ts
import { AcurisClient, validateAddress } from "@acuris-geo/av-sdk";

const client = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

const r = await validateAddress(client, {
  country: "gbr",
  street:  "1 Acuris Way",
  city:    "London",
  postcode: "EC2A 4XX",
});

// Melissa-shaped output for downstream code that already keys on these
const melissaShape = {
  RecordID: "1",
  Results:  meltdownResultCodes(r),
  FormattedAddress: r.standardized?.formatted_address?.replace(/\n/g, ";") ?? "",
  AddressLine1:     [r.standardized?.house_number, r.standardized?.street].filter(Boolean).join(" "),
  Locality:         r.standardized?.city ?? "",
  PostalCode:       r.standardized?.postcode ?? "",
  Country:          r.standardized?.country?.toUpperCase() ?? "",
  Latitude:         r.lat?.toString() ?? "",
  Longitude:        r.lng?.toString() ?? "",
};

function meltdownResultCodes(r: import("@acuris-geo/av-sdk").ValidationResult): string {
  const codes: string[] = [];
  // AV: address verification
  if (r.accuracy_type === "rooftop" || r.accuracy_type === "parcel") codes.push("AV25");
  else if (r.accuracy_type?.startsWith("street"))                    codes.push("AV24");
  else                                                                codes.push("AV12");
  // GS: geocode status
  if (r.lat != null && r.lng != null) {
    if (r.accuracy_type === "rooftop") codes.push("GS01");
    else                                codes.push("GS02");
  } else                                codes.push("GS05");
  // AC: any change made by verification engine
  if (r.input_corrected) codes.push("AC02");
  return codes.join(",");
}
```

## Result-code translation

Common Melissa codes you'll see in legacy branching:

| Melissa code | Meaning                              | Acuris condition                                       |
| ------------ | ------------------------------------ | ------------------------------------------------------ |
| `AV25`       | Verified to subpremise / building    | `accuracy_type` in {`rooftop`, `parcel`}               |
| `AV24`       | Verified to thoroughfare             | `accuracy_type` in {`street_interpolated`, `street_center`} |
| `AV23`       | Verified to locality                 | `accuracy_type` in {`locality`, `locality_centroid`}   |
| `AV12`       | No / weak match                      | `accuracy_type === null` or `confidence < 0.4`         |
| `GS01`       | Address-level geocode                | `lat`/`lng` present and `accuracy_type === "rooftop"`  |
| `GS02`       | Street-level geocode                 | `lat`/`lng` present and `accuracy_type.startsWith("street")` |
| `GS05`       | No geocode                           | `lat == null`                                          |
| `AC01`       | Field standardized                   | `input_corrected === true`                             |
| `AC02`       | Component corrected                  | `input_corrected === true`                             |

If your code branches on the full code list, build the helper above to
emit Melissa-shape codes from the Acuris response and keep the
downstream branches as-is.

## Country normalization

Melissa accepts full names ("United Kingdom"), ISO-2 ("GB"), and ISO-3
uppercase ("GBR"). Acuris requires ISO-3 lowercase only.

```ts
const M2A: Record<string, string> = {
  "GBR": "gbr", "USA": "usa", "DEU": "deu", "CAN": "can", "AUS": "aus",
  "FRA": "fra", "ESP": "esp", "ITA": "ita", "JPN": "jpn",
  "United Kingdom": "gbr", "United States": "usa", "Germany": "deu",
  "GB": "gbr", "US": "usa", "DE": "deu",
};
const country = M2A[melissaCountry] ?? melissaCountry.toLowerCase().slice(0, 3);
```

## What you don't migrate

- **MAK (Melissa Address Key)** — Acuris does not assign a stable
  per-address ID. If downstream code stores MAK as a dedupe key, switch
  to a hash of `(country, standardized.formatted_address)` or to your
  own internal address ID.
- **Personator's name / email / phone enrichment** — Acuris is
  address-only. Keep Melissa or another provider for those columns, or
  drop them.
- **CASS-certified output** — Melissa's CASS-certified pipeline is a
  separate offering. Acuris is rooftop-grade but not CASS-certified;
  if you need a CASS stamp, this migration alone doesn't replace it.

> This migration recipe is written against Melissa Data's public docs.
> Code paths that depend on specific result-code combinations need to
> be reviewed against your actual mappings before shipping.
