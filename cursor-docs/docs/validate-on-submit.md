---
layout: default
title: "Validate On Submit"
---

# Validate on form submit

After the user picks a suggestion (or types the whole address by
hand), call `/validate` to confirm and lock in the canonical form
before persisting. This catches typos, normalizes capitalization, and
gives you `accuracy_type` + `confidence` to decide what to do with
low-quality matches.

## Backend route

```ts
// app/api/acuris/validate/route.ts  (Next.js App Router)
import {
  AcurisClient,
  validateAddress,
  AcurisAuthError,
  AcurisValidationError,
  AcurisRateLimitError,
  AcurisNotFoundError,
} from "@acuris-geo/av-sdk";

const client = new AcurisClient({ apiKey: process.env.ACURIS_API_KEY });

export async function POST(req: Request) {
  const { country, input } = await req.json();

  try {
    const result = await validateAddress(client, input, { country });
    return Response.json(result);
  } catch (err) {
    if (err instanceof AcurisAuthError)       return Response.json({ error: "config" },     { status: 500 });
    if (err instanceof AcurisValidationError) return Response.json({ error: "bad_input" },  { status: 400 });
    if (err instanceof AcurisNotFoundError)   return Response.json({ error: "no_match" },   { status: 404 });
    if (err instanceof AcurisRateLimitError)  return Response.json({ error: "rate_limit" }, { status: 429, headers: err.retryAfterSeconds ? { "Retry-After": String(err.retryAfterSeconds) } : undefined });
    return Response.json({ error: "upstream" }, { status: 502 });
  }
}
```

## Frontend: deciding what to do with the result

`accuracy_type` and `confidence` together drive a three-way decision:

```ts
interface ValidationResult {
  accuracy_type: string | null;
  confidence: number;
  input_corrected: boolean;
  standardized?: { formatted_address?: string };
  corrections?: string[];
}

function classifyAddress(r: ValidationResult): "accept" | "confirm" | "reject" {
  if (!r.accuracy_type || r.confidence < 0.4)         return "reject";
  if (r.input_corrected || r.confidence < 0.8)        return "confirm";
  if (["rooftop", "parcel", "exact"].includes(r.accuracy_type))
                                                       return "accept";
  if (r.accuracy_type.startsWith("street"))           return "confirm";
  return "confirm";
}
```

- **Accept**: silently replace the user's input with `standardized.formatted_address`
  and persist. Best path; happens on most submissions.
- **Confirm**: show the user "did you mean..." with the corrected form,
  give them an "edit" / "yes that's right" choice. Use this when
  `input_corrected` is true or `confidence` is below your threshold —
  shipping the wrong house number is more expensive than one extra click.
- **Reject**: refuse to submit, explain that the address couldn't be
  verified, and let the user edit. Don't auto-substitute centroids.

## Drop-in React component

If you want the decision logic above pre-wired:

```tsx
import { AcurisAddressValidator, AcurisAddressInput } from "@acuris-geo/centra-checkout";

const ENDPOINTS = { validate: "/api/acuris/validate", suggest: "/api/acuris/suggest" };

export default function CheckoutAddress() {
  const [value, setValue] = useState("");
  return (
    <AcurisAddressValidator
      endpoints={ENDPOINTS}
      country="deu"
      address={value}
      trigger="submit"
    >
      {({ status, result, formProps }) => (
        <form {...formProps}>
          <AcurisAddressInput
            endpoints={ENDPOINTS} country="deu"
            value={value} onChange={setValue}
          />
          <button type="submit">Continue</button>
          {status === "ok"      && <p>✓ {result?.standardized?.formatted_address}</p>}
          {status === "low_confidence" && (
            <p>Did you mean: {result?.standardized?.formatted_address}?</p>
          )}
          {status === "no_match" && <p>We couldn't verify this address.</p>}
        </form>
      )}
    </AcurisAddressValidator>
  );
}
```

`trigger="submit"` runs validation on form-submit. `trigger="change"`
runs it as the user types, debounced. `trigger="blur"` runs on field
blur. For checkout flows submit is almost always right.

## What to persist

Recommended schema for your `addresses` table:

| Column                | Source                                   |
| --------------------- | ---------------------------------------- |
| `raw_input`           | What the user typed (audit trail)        |
| `country`             | ISO-3 lowercase                          |
| `street`              | `standardized.street`                    |
| `house_number`        | `standardized.house_number`              |
| `city`                | `standardized.city`                      |
| `state`               | `standardized.state`                     |
| `postcode`            | `standardized.postcode`                  |
| `formatted_address`   | `standardized.formatted_address`         |
| `lat`, `lng`          | `result.lat`, `result.lng`               |
| `accuracy_type`       | `result.accuracy_type`                   |
| `confidence`          | `result.confidence`                      |
| `validated_at`        | `now()`                                  |
| `acuris_status`       | `result.status` (e.g. `"V2"`)            |

Storing both the raw input and the standardized form means later you
can re-validate against an improved cascade and compare without losing
what the user originally entered.

## Edge cases

- **Empty country**: throw a 400 client-side before calling the API.
  The SDK does this for you; if you're proxying, mirror the behavior.
- **`input_corrected: true` and `confidence: 0.95`**: that's the
  most common "you typed a typo and we fixed it" case. Surface the
  correction; don't silently swap.
- **`accuracy_type: "centroid"`**: the response is a country centroid —
  treat as "no match" for billing or shipping use cases.
- **`house_number_not_found: true`**: street-level coords were used.
  Fine for billing addresses; question it for delivery if you're doing
  driver-app last-mile.
