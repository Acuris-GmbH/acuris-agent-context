---
layout: default
title: "Centra Storefront"
---

# Centra storefront integration

For storefronts on [Centra](https://centra.com) (Swedish headless
commerce, used by Paul Smith, Nudie Jeans, Holzweiler, NN07, Eton,
Björn Borg, Craft, others), the
[`acuris-centra-connector`](https://github.com/Acuris-GmbH/acuris-centra-connector)
repo ships a complete pre-wired integration. Use it instead of
hand-rolling — the components are tuned to Centra's data shapes
already.

## Install

```bash
npm install @acuris-geo/av-sdk @acuris-geo/centra-checkout
```

## Backend (Next.js API routes)

The four proxy routes from
[`nextjs-proxy.md`](./nextjs-proxy.md). Drop them in as-is — the
component package expects exactly those URLs by default.

## Frontend (checkout component)

```tsx
import { useState } from "react";
import {
  AcurisAddressInput,
  AcurisAddressValidator,
} from "@acuris-geo/centra-checkout";

const ENDPOINTS = {
  validate: "/api/acuris/validate",
  suggest:  "/api/acuris/suggest",
};

export default function CentraCheckoutAddress({
  country,
  onValidated,
}: {
  country: string;
  onValidated: (canonical: {
    formatted_address: string;
    lat?: number; lng?: number;
  }) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <AcurisAddressValidator
      endpoints={ENDPOINTS}
      country={country}
      address={value}
      trigger="submit"
      onResult={(r) => {
        if (r?.standardized?.formatted_address) {
          onValidated({
            formatted_address: r.standardized.formatted_address,
            lat: r.lat, lng: r.lng,
          });
        }
      }}
    >
      {({ status, result, formProps }) => (
        <form {...formProps}>
          <label htmlFor="addr">Shipping address</label>
          <AcurisAddressInput
            id="addr"
            endpoints={ENDPOINTS}
            country={country}
            value={value}
            onChange={setValue}
            placeholder="Start typing…"
          />
          <button type="submit">Continue to payment</button>
          {status === "ok"   && <p>✓ {result?.standardized?.formatted_address}</p>}
          {status === "low_confidence" && (
            <p>Did you mean <strong>{result?.standardized?.formatted_address}</strong>?</p>
          )}
        </form>
      )}
    </AcurisAddressValidator>
  );
}
```

## Wiring into Centra's checkout flow

1. Place the component in your checkout shipping-address step.
2. On a successful `onValidated`, call Centra's
   `POST /selection/{token}/address` with the canonical fields.
3. Capture `lat` / `lng` into your local order metadata if you want
   them for downstream routing or analytics — Centra doesn't have a
   place to store them natively.

Pass the customer's selected country to the `country` prop; default
ISO-3 lowercase. If Centra gives you ISO-2, map it at the boundary:

```ts
const iso3 = ({ se: "swe", de: "deu", us: "usa", gb: "gbr", no: "nor",
                dk: "dnk", fi: "fin", nl: "nld", fr: "fra", it: "ita",
                es: "esp", be: "bel" } as Record<string, string>)[iso2.toLowerCase()];
```

## Working example

The `acuris-centra-connector` repo ships a runnable Next.js demo at
[`examples/centra-storefront/`](https://github.com/Acuris-GmbH/acuris-centra-connector/tree/main/examples/centra-storefront).
Clone it, set `ACURIS_API_KEY`, run `pnpm dev`, and the full
autocomplete-plus-validate loop runs locally against the live API.

## Why a separate component package

The frontend should never touch the Acuris key directly — Centra's
storefronts run client-side, the API key lives server-side. The
component package's only outbound calls are to your proxy routes. The
SDK lives behind those routes. This split is mandatory for any
client-side framework.

The same split applies to commercetools and SCAYLE — separate
connector packages exist for those (`@acuris-geo/commercetools-checkout`,
`@acuris-geo/scayle-checkout`). The pattern in this file (typeahead +
validator + proxy routes) translates directly.
