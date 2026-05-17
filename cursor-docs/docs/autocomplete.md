---
layout: default
title: "Autocomplete"
---

# Address autocomplete in a React checkout form

The pattern: a single-line input that calls `/suggest` as the user
types, debounced. When the user picks a suggestion you populate the
structured fields and (optionally) run `/validate` on submit to lock
in the canonical form.

## Option A — drop-in React component

If you can take a React dependency, the component package does this
for you:

```bash
npm install @acuris-geo/av-sdk@^0.1.2 @acuris-geo/centra-checkout@^0.1.1
```

```tsx
import { AcurisAddressInput } from "@acuris-geo/centra-checkout";
import { useState } from "react";

const ENDPOINTS = {
  validate: "/api/acuris/validate",
  suggest:  "/api/acuris/suggest",
};

export function AddressField({ country = "deu" }: { country?: string }) {
  const [value, setValue] = useState("");
  return (
    <AcurisAddressInput
      endpoints={ENDPOINTS}
      country={country}
      value={value}
      onChange={setValue}
      placeholder="Start typing your address"
    />
  );
}
```

`endpoints` point at *your* backend proxy routes, which call the SDK
server-side. The component handles debouncing, keyboard navigation,
and ARIA. See [nextjs-proxy.md](./nextjs-proxy.md) for the route
implementations.

### `<AcurisAddressInput>` props

The component extends standard `<input>` HTML attributes (omitting
`onChange`, `value`, `onSelect`). Acuris-specific props:

| Prop                    | Type                                       | Default | Notes                                                |
| ----------------------- | ------------------------------------------ | ------- | ---------------------------------------------------- |
| `endpoints`             | `{ validate: string; suggest?: string }`   | —       | Required. URLs on **your** backend, not Acuris.       |
| `country`               | `string` (ISO-3 lowercase)                  | —       | Required. Biases suggestions by country.              |
| `value`                 | `string`                                    | —       | Required. Current input text (controlled).            |
| `onChange`              | `(value: string) => void`                   | —       | Required. Fires on every keystroke and on pick.       |
| `onSelect`              | `(hit: SuggestionHit) => void`              | —       | Fires once when the user picks a suggestion.          |
| `debounceMs`            | `number`                                    | `200`   | Window before firing `/suggest`.                      |
| `minQueryLength`        | `number`                                    | `3`     | **Not** `minLength` — that's an HTML input attribute. |
| `limit`                 | `number`                                    | `5`     | Server caps at 50.                                    |
| `state`                 | `string` (uppercase)                        | —       | Region bias for `usa`/`can`/`aus`.                    |
| `renderSuggestion`      | `(hit, index) => ReactNode`                 | —       | Custom row renderer.                                  |
| `suggestionsClassName`  | `string`                                    | —       | Class on the dropdown container.                      |

Plus any standard `<input>` attribute (`id`, `placeholder`, `disabled`,
`autoComplete`, `className`, etc.).

### `<AcurisAddressValidator>` props

| Prop          | Type                                              | Default | Notes                                          |
| ------------- | ------------------------------------------------- | ------- | ---------------------------------------------- |
| `endpoints`   | `{ validate: string; suggest?: string }`          | —       | Required.                                      |
| `country`     | `string`                                           | —       | Required. ISO-3 lowercase.                     |
| `address`     | `FieldedAddressInput \| string`                   | —       | Required.                                      |
| `trigger`     | `"blur" \| "submit" \| "manual"`                  | `"blur"` | When to run validation.                       |
| `children`    | `(state: ValidatorRenderState) => ReactNode`      | —       | Render prop. Receives `{ status, result, error, validate, formProps }`. |

Use `trigger="submit"` for checkout flows; `trigger="blur"` for
optional address-quality nudges; `trigger="manual"` plus calling
`state.validate()` yourself when you want full control.

## Option B — hand-rolled hook

When you want full control or you're not on React, the loop is:

```tsx
import { useEffect, useState } from "react";

interface SuggestionHit {
  formatted_address?: string;
  street?: string;
  house_number?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country: string;
  lat?: number;
  lng?: number;
}

export function useAcurisSuggest(query: string, country: string) {
  const [hits, setHits] = useState<SuggestionHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setHits([]); return; }

    const ac = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(
          `/api/acuris/suggest?country=${country}&q=${encodeURIComponent(q)}&limit=8`,
          { signal: ac.signal },
        );
        if (!r.ok) throw new Error(`suggest ${r.status}`);
        const data = await r.json();
        setHits(Array.isArray(data) ? data : data.suggestions ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setHits([]);
      } finally {
        setLoading(false);
      }
    }, 150);  // debounce

    return () => { ac.abort(); clearTimeout(timer); };
  }, [query, country]);

  return { hits, loading };
}
```

### Backend (Next.js App Router)

```ts
// app/api/acuris/suggest/route.ts
import { AcurisClient, suggestAddress } from "@acuris-geo/av-sdk";

const client = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = url.searchParams.get("country") ?? undefined;
  const q       = url.searchParams.get("q") ?? "";
  const limit   = Number(url.searchParams.get("limit") ?? "10");

  if (!country) return Response.json({ error: "country required" }, { status: 400 });

  try {
    const hits = await suggestAddress(client, q, { country, limit });
    return Response.json(hits, {
      headers: { "Cache-Control": "private, max-age=10" },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
```

## Gotchas

- **Debounce, don't gate.** Don't wait for the user to "finish typing".
  150-200ms is the right window. The SDK supports `AbortSignal` so
  stale requests get cancelled when the user types more.
- **Minimum prefix length.** Three characters is the practical floor;
  below that the suggestions are mostly noise.
- **Country is required.** `/suggest` does not infer country. If your
  UI lets the user pick a country, change it *first* then debounce the
  query.
- **Cache for a few seconds.** Suggestion sets are idempotent for a
  given `(country, q, limit, state?)` tuple. A 10-second private cache
  cuts repeat traffic dramatically.
- **`limit` server-capped at 50.** Default 10 is right for a dropdown.
- **`state` bias** for USA / CAN / AUS. If your form already has a
  state field, pass it as `state` (uppercase, e.g. `"CA"`) — improves
  precision when the user types a common street name.
- **Map ISO-2 → ISO-3 at the boundary.** If your form's country picker
  uses ISO-2, build a small lookup once: `"us" → "usa"`, `"de" → "deu"`,
  `"gb" → "gbr"`. Don't ship the conversion server-side per request.

## When the user picks a suggestion

A `SuggestionHit` already has the structured fields. Populate your form
state from those rather than re-parsing `formatted_address`:

```tsx
function onPick(hit: SuggestionHit) {
  setForm({
    street:       hit.street ?? "",
    house_number: hit.house_number ?? "",
    city:         hit.city ?? "",
    state:        hit.state ?? "",
    postcode:     hit.postcode ?? "",
    country:      hit.country,
    lat:          hit.lat,
    lng:          hit.lng,
  });
}
```

Then on submit, call `/api/acuris/validate` with the structured form to
confirm and pull in the canonical `formatted_address`. See
[validate-on-submit.md](./validate-on-submit.md).
