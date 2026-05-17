# Forward geocoding — addresses to lat/lng

Use `geocodeAddress` when you have a structured address and need
coordinates — most commonly for shipping zones, distance calculations,
service-area checks, or rendering a pin on a map.

If all you have is a free-form string, `validateAddress` returns coords
in the same response. Prefer `geocodeAddress` only when you already
have fielded data, since `/geocode` is faster (no parser pass).

## Basic call

```ts
import { AcurisClient, geocodeAddress } from "@acuris-geo/av-sdk";

const client = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

const g = await geocodeAddress(client, {
  country:      "deu",
  street:       "Friedrichstraße",
  house_number: "43",
  city:         "Berlin",
  postcode:     "10117",
});

if (g.lat != null && g.lng != null) {
  console.log(g.lat, g.lng);            // 52.5074, 13.3899
  console.log(g.accuracy_type);          // "rooftop"
}
```

## Distance between two addresses

```ts
function haversineMeters(a: {lat:number,lng:number}, b: {lat:number,lng:number}) {
  const R = 6_371_000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const [warehouse, customer] = await Promise.all([
  geocodeAddress(client, warehouseAddr),
  geocodeAddress(client, customerAddr),
]);

if (warehouse.lat && warehouse.lng && customer.lat && customer.lng) {
  const km = haversineMeters(
    { lat: warehouse.lat, lng: warehouse.lng },
    { lat: customer.lat,  lng: customer.lng },
  ) / 1000;
}
```

For road-distance instead of straight-line, you need a routing
service — Acuris doesn't do routing. Pair with Mapbox / OSRM / Google
Distance Matrix on top of the Acuris coordinates.

## Accuracy tiers — what each means for distance work

| `accuracy_type`         | Trust it for...                                              |
| ----------------------- | ------------------------------------------------------------ |
| `rooftop`               | Rooftop coords. Use for last-mile, delivery quotes, pin display. |
| `parcel`                | Parcel centroid. Same use cases, ±10-20m typical.            |
| `street_interpolated`   | Address interpolated along the street segment. Good for zone fence checks. |
| `street_center`         | Midpoint of the matched street. OK for city-level decisions, not for delivery. |
| `postcode` / `postcode_center` | Postcode centroid. Coarse — fine for shipping-rate buckets, bad for last-mile. |
| `locality_centroid` / `centroid` | City or country centroid. Treat as no-coords for delivery. |

A useful guard:

```ts
const PRECISE = new Set(["rooftop", "parcel", "street_interpolated"]);
const usable  = (g: { accuracy_type: string | null }) =>
  g.accuracy_type !== null && PRECISE.has(g.accuracy_type);
```

## Service-area check

```ts
function withinServiceArea(g: { lat?: number; lng?: number; accuracy_type: string | null },
                            polygon: GeoJSON.Polygon): boolean {
  if (g.lat == null || g.lng == null) return false;
  if (g.accuracy_type === "centroid")  return false;       // too coarse
  return turfBooleanPointInPolygon([g.lng, g.lat], polygon);
}
```

(`@turf/turf` does the point-in-polygon math.)

## Gotchas

- **`/geocode` is GET, not POST.** Keep your URL length reasonable —
  long international street names + house numbers can push toward 2KB.
  The SDK builds the URL correctly; only relevant if you're hand-rolling.
- **Field name `hno`, not `house_number`, on the wire.** The SDK maps
  this for you (`input.house_number` → `?hno=`). If you bypass the SDK,
  use `hno`.
- **String input falls back to `/validate`.** The SDK does this
  automatically and returns a `GeocodingResult` shape. The trade-off is
  one extra parser pass server-side. Pass fielded input when you can.
- **`lat`/`lng` may be absent.** If Acuris can't geocode at all the
  fields are missing rather than `null`. Always check before using.
