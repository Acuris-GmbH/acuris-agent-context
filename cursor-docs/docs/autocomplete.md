---
layout: default
title: "Autocomplete"
---

# Address autocomplete in a React checkout form

## ⚠️ Country coverage for autocomplete is narrower than for validation

**Only 5 countries currently have `/suggest` (autocomplete) wired:**

```ts
const AUTOCOMPLETE_COUNTRIES = [
  { code: "usa", label: "United States" },
  { code: "deu", label: "Germany" },
  { code: "nld", label: "Netherlands" },
  { code: "fin", label: "Finland" },
  { code: "swe", label: "Sweden" },
];
```

Validation / geocoding / reverse geocoding work against 200+ ISO-3
codes. Autocomplete is narrower because each country needs NORM
columns + indexes built first — a separate engineering step. Other
countries' `/suggest` calls return `[]` silently, which reads as
"the product is broken" to the user.

**Use this exact list in any autocomplete country picker.** Don't add
`fra`, `esp`, `ita`, etc. — they'll appear in the dropdown but
typing into the input will produce no suggestions. That's the worst
possible UX.

If you're building a form that *also* validates on submit (a checkout
flow with `<AcurisAddressInput>` for typing + `<AcurisAddressValidator>`
for submit), the autocomplete-enabled 5 are still the right set —
they're a strict subset of the validation-enabled set, so validation
works for all of them.

## What autocomplete is — and is not

**Autocomplete is one input** that shows a dropdown of suggestions
as the user types, and fires a callback when they pick one. That's
it. A `<AcurisAddressInput>` plus a country selector is the entire
UI surface.

**Autocomplete is NOT a structured form** with separate boxes for
street / house number / postcode / city / state. Building one of
those alongside the autocomplete defeats the point — the user just
told the autocomplete what they want; making them re-type the same
data into split fields is exactly the friction autocomplete exists
to remove. The structured fields belong in a *different* recipe
(see [`validate-on-submit.md`](./validate-on-submit.md) if you need
form-style validation, or
[`api-reference.md`](./api-reference.md) for fielded
`validateAddress` calls).

When the user asks for "an autocomplete component," ship:

- The country picker (a single `<select>`).
- The `<AcurisAddressInput>`.
- A small status line showing what they picked (`formatted_address`).

Nothing else. No street/postcode/city input boxes. No "Validate &
continue" button. Those are different recipes — load them when the
user asks for them.

## The pattern

A single-line input that calls `/suggest` as the user types,
debounced. When they pick a suggestion you receive a `SuggestionHit`
with the structured fields attached (`street`, `house_number`,
`city`, `postcode`, `lat`, `lng`, `formatted_address`) — for display
use `formatted_address`; for further server-side calls pass the hit
to `validateAddress` (the SDK accepts it). You don't need to render
those sub-fields to the user.

## Option A — drop-in React component

If you can take a React dependency, the component package does this
for you:

```bash
npm install @acuris-geo/av-sdk@^0.1.2 @acuris-geo/centra-checkout@^0.1.2
```

> **Pin `@acuris-geo/centra-checkout` to `^0.1.2`.** Earlier versions
> shipped the dropdown unstyled, which renders as invisible text in
> Tailwind v4 / modern CSS-reset environments. 0.1.2 ships zero-specificity
> default styles so the dropdown works out-of-the-box; see the "Styling"
> section below if you want to override them.

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

## Styling

As of `@acuris-geo/centra-checkout@0.1.2`, the dropdown ships with
sensible default styles (white bg, dark text, border, shadow, hover
state, dark-mode variant). Injected via a single `<style>` block in
`<head>` on first component mount.

All defaults use `:where(...)` selectors so their CSS specificity is
zero — **any consumer styling automatically wins** without needing
`!important`. Three ways to customize:

1. **Pass a `suggestionsClassName`** for the `<ul>`:

   ```tsx
   <AcurisAddressInput
     endpoints={ENDPOINTS}
     country={country}
     value={value}
     onChange={setValue}
     suggestionsClassName="my-dropdown"
   />
   ```

   ```css
   .my-dropdown {
     background: #fafafa;
     border: 2px solid #c97a2b;
   }
   ```

2. **Pass a `renderSuggestion`** to control how each row is rendered:

   ```tsx
   <AcurisAddressInput
     endpoints={ENDPOINTS}
     country={country}
     value={value}
     onChange={setValue}
     renderSuggestion={(hit) => (
       <div className="flex flex-col px-3 py-2 hover:bg-orange-50">
         <span className="text-sm">{hit.formatted_address}</span>
       </div>
     )}
   />
   ```

   Note: when you pass `renderSuggestion`, you own the row's padding,
   typography, and hover state. The default `li` padding/hover only
   applies when `renderSuggestion` is omitted.

3. **Opt out of defaults entirely** by setting an attribute on `<html>`:

   ```html
   <html data-acuris-default-styles="off">
   ```

   The `:where(html:not([data-acuris-default-styles="off"]) ...)` guard
   on every default rule means setting this attribute disables them
   all. Useful when your design system already covers `[data-acuris-suggestions]`.

The component's render output exposes hook points for selector-based
styling without needing any of the above:

| Attribute                                | Selects                              |
| ---------------------------------------- | ------------------------------------ |
| `[data-acuris-input]`                    | The wrapper `<div>`                  |
| `[data-acuris-suggestions]`              | The dropdown `<ul>`                  |
| `[data-acuris-suggestions] li`           | Each suggestion row                  |
| `[data-acuris-suggestions] li[aria-selected="true"]` | Keyboard-highlighted row |
| `[data-acuris-suggestions] li[data-acuris-state="loading"]` | The "Loading…" placeholder |

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

A `SuggestionHit` already has the structured fields. **For a pure
autocomplete, store the hit and display `formatted_address` back to
the user.** Don't render the sub-fields as inputs.

```tsx
function MyAutocomplete() {
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<SuggestionHit | null>(null);

  return (
    <>
      <AcurisAddressInput
        endpoints={ENDPOINTS}
        country={country}
        value={value}
        onChange={setValue}
        onSelect={setPicked}
      />
      {picked && (
        <p>Selected: {picked.formatted_address}</p>
      )}
    </>
  );
}
```

If your form *also* needs full validation on submit (a checkout flow,
say — distinct from "autocomplete"), pass the hit straight to
`validateAddress` on the server:

```ts
await validateAddress(client, picked, { country: picked.country });
```

The SDK accepts a `SuggestionHit`-shaped fielded input directly. No
need to re-render the components as separate input boxes. See
[`validate-on-submit.md`](./validate-on-submit.md) for the full
validation flow if that's what you're building.
