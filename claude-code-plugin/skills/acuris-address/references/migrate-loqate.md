# Migration — Loqate Capture / Verify → Acuris

Loqate (GBG) sells two products in this space:

- **Loqate Capture** — JS widget + REST autocomplete (`Find` / `Retrieve`
  API). Used in checkout forms.
- **Loqate Verify** — server-side address verification (`Verify` API).

Both map cleanly onto Acuris endpoints.

## Concept mapping

| Loqate                                  | Acuris                                                |
| --------------------------------------- | ----------------------------------------------------- |
| `Capture/Interactive/Find`              | `GET /suggest` (`suggestAddress`)                     |
| `Capture/Interactive/Retrieve`          | `POST /validate` (`validateAddress`)                  |
| `Verify` API                            | `POST /validate` (`validateAddress`)                  |
| `pca.Address` (browser widget)          | `<AcurisAddressInput>` + `<AcurisAddressValidator>`   |
| `Key` query param                       | `X-Acuris-Key` header                                 |
| `Country` (ISO-2 or ISO-3)              | ISO-3 lowercase, required                             |
| `AQI` (Address Quality Index, 1-5)      | `confidence` (0..1) + `accuracy_type`                 |
| `Container` (cascading session)         | Not needed — Acuris suggestions are flat              |
| `Verification Level` (V1-V5)            | `accuracy_type` (`rooftop` > `parcel` > `street_*` …) |

## Capture — autocomplete + retrieve

### Before (Loqate widget)

```html
<script src="https://services.postcodeanywhere.co.uk/js/address-3.91.min.js"></script>
<script>
  new pca.Address(
    [{ element: "Address1" }, { element: "Address2" }, ...],
    { key: "AB12-CD34-EF56-GH78", search: { countries: "GB,US,DE" } },
  );
</script>
```

### After (Acuris)

Backend routes from [`nextjs-proxy.md`](./nextjs-proxy.md), then in
your React form:

```tsx
import {
  AcurisAddressInput,
  AcurisAddressValidator,
} from "@acuris-geo/centra-checkout";

<AcurisAddressValidator
  endpoints={{ validate: "/api/acuris/validate", suggest: "/api/acuris/suggest" }}
  country="gbr"
  address={value}
  trigger="submit"
>
  {({ formProps, status, result }) => (
    <form {...formProps}>
      <AcurisAddressInput endpoints={ENDPOINTS} country="gbr" value={value} onChange={setValue} />
      <button type="submit">Continue</button>
    </form>
  )}
</AcurisAddressValidator>
```

For a non-React stack, the manual hook + proxy routes in
[`autocomplete.md`](./autocomplete.md) cover the same loop.

## Verify — server-side address verification

### Before (Loqate Verify, HTTP GET)

```http
GET https://api.addressy.com/Cleansing/International/Batch/v1.00/json3.ws
    ?Key=AB12-CD34-EF56-GH78
    &Country=GB
    &Address=1 Acuris Way London EC2A 4XX
```

Response includes `Address1..N`, `PostalCode`, `Province`, `AQI`,
`Verification Level`, `Match Score`.

### After (Acuris)

```ts
import { AcurisClient, validateAddress } from "@acuris-geo/av-sdk";

const client = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

const r = await validateAddress(
  client,
  "1 Acuris Way London EC2A 4XX",
  { country: "gbr" },
);

// Loqate-shaped output, for downstream code expecting AQI / Verification Level
const out = {
  Address1:           r.standardized?.street ?? "",
  Address2:           r.standardized?.house_number ?? "",
  Locality:           r.standardized?.city ?? "",
  Province:           r.standardized?.state ?? "",
  PostalCode:         r.standardized?.postcode ?? "",
  CountryISO3:        r.standardized?.country ?? "gbr",
  AQI:                Math.max(1, Math.round(r.confidence * 5)),
  VerificationLevel:  loqateVerificationLevel(r.accuracy_type),
  MatchScore:         r.match_score,
};

function loqateVerificationLevel(a: string | null): "V1"|"V2"|"V3"|"V4"|"V5" {
  switch (a) {
    case "rooftop": case "parcel":      return "V5";
    case "street_interpolated":         return "V4";
    case "street_center": case "postcode": return "V3";
    case "postcode_center":             return "V2";
    default:                            return "V1";
  }
}
```

## Country code normalization

Loqate accepts ISO-2 and ISO-3. Acuris requires ISO-3 lowercase. Map
once at the boundary:

```ts
const ISO2_TO_3: Record<string, string> = {
  gb: "gbr", us: "usa", de: "deu", fr: "fra", es: "esp", it: "ita",
  se: "swe", nl: "nld", be: "bel", no: "nor", dk: "dnk", fi: "fin",
  ie: "irl", pt: "prt", at: "aut", ch: "che", au: "aus", nz: "nzl",
  ca: "can", jp: "jpn", sg: "sgp", in: "ind",
  // …extend as your country footprint grows
};

const country = code.length === 2
  ? ISO2_TO_3[code.toLowerCase()] ?? code.toLowerCase()
  : code.toLowerCase();
```

## Pricing / billing model

- Loqate bills per Find + Retrieve transaction (autocomplete + select).
- Acuris bills per HTTP call to `api.acuris-geo.com`, with `/suggest`
  and `/validate` priced separately. See <https://acuris-geo.com/acuris-pricing/>.

A Loqate Capture flow that uses 5 Find + 1 Retrieve per finished
address translates to 5 `/suggest` + 1 `/validate` on Acuris. The
typeahead caching in [`nextjs-proxy.md`](./nextjs-proxy.md) cuts that
substantially.

## Gotchas

- **Loqate `Container` IDs are not idempotent across sessions.** When
  porting code that stores the container, drop it — Acuris suggestions
  are flat hits with structured fields already attached, no cascading
  drill-down step.
- **Loqate's UK-only `Postcode` endpoint** (`Postcoder` style) has no
  Acuris equivalent; use `suggestAddress(client, postcode, { country: "gbr" })`.
- **AQI is 1-5 (higher better), `confidence` is 0..1.** Don't compare
  them directly; map with the function above or whichever bucket scheme
  matches your business rules.

> This migration recipe is written against Loqate's public docs.
> Validate against your actual Capture / Verify configuration before
> shipping a cutover.
