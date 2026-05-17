# Migration — Smarty (US Street API, US Autocomplete API, International) → Acuris

Smarty (formerly SmartyStreets) ships three relevant products:

- **US Street API** — verify a US address.
- **US Autocomplete Pro API** — typeahead for US addresses.
- **International Street API** — verify non-US addresses.

All three translate cleanly to Acuris.

## Concept mapping

| Smarty                                                | Acuris                                           |
| ----------------------------------------------------- | ------------------------------------------------ |
| `us-street.api.smarty.com/street-address`             | `validateAddress` with `country: "usa"`          |
| `us-autocomplete-pro.api.smarty.com/lookup`           | `suggestAddress` with `country: "usa"`           |
| `international-street.api.smarty.com/verify`          | `validateAddress` with `country: "<iso3>"`       |
| `us-reverse-geo.api.smarty.com/lookup`                | `reverseGeocode` with `country: "usa"`           |
| `auth-id` + `auth-token` (or website key)             | `X-Acuris-Key` header                            |
| `dpv_match_code` / `dpv_footnotes`                    | `accuracy_type` + `match_components`             |
| `precision` (`Zip5`/`Zip7`/`Zip9`/`Structure`/`Rooftop`) | `accuracy_type` tier                          |
| `analysis.address_precision`                          | `accuracy_type`                                  |
| `metadata.latitude` / `longitude`                     | `lat` / `lng` on the response                    |

## US Street → `validateAddress`

### Before

```http
GET https://us-street.api.smarty.com/street-address
    ?auth-id=…&auth-token=…
    &street=100 Main St
    &city=San Francisco
    &state=CA
    &zipcode=94105
```

### After

```ts
import { AcurisClient, validateAddress } from "@acuris-geo/av-sdk";

const client = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

const r = await validateAddress(client, {
  country:     "usa",
  street:      "Main St",
  house_number: "100",
  city:        "San Francisco",
  state:       "CA",
  postcode:    "94105",
});

console.log(r.standardized?.formatted_address);
console.log(r.lat, r.lng);
```

If you're already on Smarty's single-string mode, pass the whole address
as a string:

```ts
await validateAddress(client, "100 Main St, San Francisco CA 94105", { country: "usa" });
```

## US Autocomplete Pro → `suggestAddress`

### Before

```http
GET https://us-autocomplete-pro.api.smarty.com/lookup
    ?key=<embed-key>
    &search=100 main
    &include_only_states=CA
```

### After

```ts
import { suggestAddress } from "@acuris-geo/av-sdk";

const hits = await suggestAddress(client, "100 main", {
  country: "usa",
  state:   "CA",
  limit:   10,
});
```

The big behavioural difference: Smarty's autocomplete returns
**partials with suffix expansion** (typing "100 ma" → "100 main st",
"100 main blvd", "100 maple st"). Acuris returns ranked completions
the same way. The dropdown UX from `<AcurisAddressInput>` in
[`autocomplete.md`](./autocomplete.md) is a near drop-in replacement
for Smarty's `SmartyAutocompletePro` widget.

## International Street → `validateAddress`

Smarty international takes a country in 2-letter or full name. Acuris
takes ISO-3 lowercase.

### Before

```http
POST https://international-street.api.smarty.com/verify
{
  "address1": "Friedrichstraße 43",
  "locality": "Berlin",
  "postal_code": "10117",
  "country": "Germany"
}
```

### After

```ts
const r = await validateAddress(client, {
  country:      "deu",
  street:       "Friedrichstraße",
  house_number: "43",
  city:         "Berlin",
  postcode:     "10117",
});
```

Smarty Country → Acuris ISO-3:

```ts
const SMARTY_TO_ISO3: Record<string, string> = {
  "Germany": "deu", "DE": "deu",
  "United Kingdom": "gbr", "Great Britain": "gbr", "GB": "gbr",
  "France": "fra", "FR": "fra",
  "United States": "usa", "US": "usa",
  "Canada": "can", "CA": "can",
  "Australia": "aus", "AU": "aus",
  // …extend as needed
};
const country = SMARTY_TO_ISO3[smartyCountry] ?? smartyCountry.toLowerCase().slice(0, 3);
```

## DPV / precision mapping

If your downstream code branches on `dpv_match_code` (`Y`/`N`/`S`/`D`)
or `precision` (`Zip5`/`Zip7`/`Zip9`/`Structure`/`Rooftop`):

| Smarty `precision`     | Acuris `accuracy_type`                              |
| ---------------------- | --------------------------------------------------- |
| `Rooftop`              | `rooftop`                                           |
| `Parcel`               | `parcel`                                            |
| `Structure`            | `parcel` / `street_interpolated`                    |
| `Zip9`                 | `street_interpolated` / `street_center`             |
| `Zip7`                 | `street_center` / `postcode`                        |
| `Zip5`                 | `postcode` / `postcode_center`                      |
| `State`/`Administrative` | `locality_centroid` / `centroid`                  |
| `Unknown`              | `null`                                              |

```ts
function toSmartyPrecision(a: string | null): string {
  switch (a) {
    case "rooftop":              return "Rooftop";
    case "parcel":               return "Parcel";
    case "street_interpolated":  return "Zip9";
    case "street_center":        return "Zip7";
    case "postcode":             return "Zip7";
    case "postcode_center":      return "Zip5";
    case "locality_centroid":
    case "centroid":             return "State";
    default:                     return "Unknown";
  }
}

function toDpvMatchCode(r: import("@acuris-geo/av-sdk").ValidationResult): "Y"|"N"|"S"|"D" {
  if (r.match_components.house_number && r.accuracy_type === "rooftop") return "Y";
  if (r.match_components.house_number)                                  return "S";  // street ok, premise approximate
  if (r.accuracy_type === null)                                         return "N";
  return "D";  // default street, no premise number
}
```

## Reverse geocoding

```ts
import { reverseGeocode } from "@acuris-geo/av-sdk";

const r = await reverseGeocode(client, { lat: 37.7749, lng: -122.4194 }, {
  country: "usa", radius_m: 100, limit: 1,
});
// r.hits[0].formatted_address / street / city / state / zip
```

## SDKs

Smarty ships official SDKs in Node, .NET, Java, Python, PHP, Ruby, Go.
Acuris currently ships one TypeScript SDK (`@acuris-geo/av-sdk`); HTTP
calls work from any language. If you're on Python, the call signature
is straightforward — see `references/api-reference.md` for the wire
shapes.

## What you don't migrate

- **DPV / SuiteLink / LACSLink certifications** — these are USPS
  certifications for postal-discount mailers. Acuris is rooftop-grade
  but not CASS-certified. If you need the certified DPV stamp for
  presort discounts, this migration alone doesn't cover it.
- **Smarty's static enrichment fields** (`metadata.county_name`,
  `metadata.time_zone`, `metadata.utc_offset`, `congressional_district`):
  Acuris doesn't return these. Either drop them or layer a separate
  enrichment pass (US Census, OpenAddresses).

> This migration recipe is written against Smarty's public docs.
> Validate against your specific use of `dpv_match_code` /
> `precision` thresholds before cutting over.
