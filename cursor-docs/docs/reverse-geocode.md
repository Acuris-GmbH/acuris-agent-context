---
layout: default
title: "Reverse Geocode"
---

# Reverse geocoding — coordinates to nearest address

Use `reverseGeocode` to turn a `(lat, lng)` pair into the nearest known
address. Common cases: showing the user "you're near 123 Main St" in a
map UI, capturing a delivery driver's GPS at drop-off, or attaching
human-readable context to telemetry.

## Basic call

```ts
import { AcurisClient, reverseGeocode } from "@acuris-geo/av-sdk";

const client = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

const r = await reverseGeocode(client, { lat: 37.7749, lng: -122.4194 }, {
  country:  "usa",
  radius_m: 100,
  limit:    3,
});

for (const hit of r.hits) {
  console.log(hit.formatted_address ?? `${hit.hno} ${hit.street}, ${hit.city}`);
  console.log("distance:", hit.distance_m, "m");
}
```

Required options:

- `country` (ISO-3 lowercase) — the API does not infer it from coords.
- `lat` ∈ `[-90, 90]`, `lng` ∈ `[-180, 180]`.

Optional:

- `radius_m`: search radius in metres. Default `50`, max `5000`.
- `limit`: max results. Default `1`.

## Choosing a radius

| Scenario                                | Suggested `radius_m`        |
| --------------------------------------- | --------------------------- |
| Phone GPS in a dense urban area         | `50` (default)              |
| Phone GPS in a suburb                   | `100`-`200`                 |
| Rural GPS or low-accuracy fix          | `500`-`1000`                 |
| "What city is this point in"            | `2000` with `limit: 5`      |
| Vehicle telemetry at highway speed     | `200`-`500`                  |

Bigger radius = more API work + more noise. Start small, widen only if
the first call returns no hits.

## Snap GPS to nearest known address

```ts
async function snapToAddress(client: AcurisClient, fix: { lat: number; lng: number; country: string }) {
  for (const radius of [50, 200, 1000]) {
    const r = await reverseGeocode(client, { lat: fix.lat, lng: fix.lng }, {
      country: fix.country, radius_m: radius, limit: 1,
    });
    if (r.hits[0]) return r.hits[0];
  }
  return null;
}
```

The escalating-radius pattern avoids over-paying for the common case
(rooftop-accurate GPS) while still catching rural / poor-fix outliers.

## Gotchas

- **`country` is required.** Coordinates are not enough — Acuris is
  country-scoped. If you don't know the country, geo-IP first or
  ask the user; don't loop through 200 country DBs.
- **`distance_m` is straight-line in metres.** Not driving distance, not
  walking. If you need road distance from the GPS fix to the matched
  address, pair this with a routing API.
- **Multi-hit responses** come back under `matches` on the wire; the
  SDK normalizes both single and multi shapes into `{ hits: [...] }`.
  Don't special-case at the application level.
- **`hits` may be empty.** No match within the radius → `hits.length === 0`.
  This is normal in remote areas or over water; not an error.
- **`zip`, not `postcode`**, on `ReverseGeocodingHit`. The SDK uses
  the wire field name here because the `/reverse` response shape is
  flatter than `/validate`.
