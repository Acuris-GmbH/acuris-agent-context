---
layout: default
title: "API Reference"
---

# EUDI Verifier — API reference

Authoritative request/response shapes for every endpoint on the Acuris
EUDI Verifier. Source of truth is the live API at
`https://eudi.acuris-geo.com`; this file mirrors the public contract.

## Base URL

`https://eudi.acuris-geo.com`. Internal port is 8081 behind an Nginx
TLS terminator with per-IP and per-`customer_id` rate limits.

There is no separate sandbox host. Pilots use a `customer_id` prefix
that Acuris hands out (typically `pilot-<bank-slug>-…`); session and
audit logs are tagged with the prefix so pilot traffic is
distinguishable in monitoring.

## Authentication

Phase 2 bank-facing endpoints are unauthenticated by default. mTLS
client-certificate auth is available per-pilot — see
[`mtls-bank-pilot.md`](./mtls-bank-pilot.md). All other access controls
(IP allowlist, rate limits, per-bank quota) are enforced at the
edge (Nginx).

---

## 1. `POST /v1/eudi/sessions` — start a verification

The relying-party backend calls this to initiate a session. Returns a
`presentation_uri` (and a QR code) you render for the user.

### Request

```http
POST /v1/eudi/sessions HTTP/1.1
Host: eudi.acuris-geo.com
Content-Type: application/json

{
  "customer_id": "kyc-2026-12345",
  "requested_fields": [
    "resident_country", "resident_city", "resident_postal_code",
    "resident_street", "resident_house_number"
  ],
  "client_metadata": { "app": "branch-app", "version": "1.2" }
}
```

| Field              | Required | Notes                                                                                       |
| ------------------ | -------- | ------------------------------------------------------------------------------------------- |
| `customer_id`      | yes      | Opaque bank-side correlation id. Logged in audit trail. Use whatever links to your case.    |
| `requested_fields` | yes      | Array. Filtered against the whitelist (see below); anything else is silently dropped + logged.|
| `callback_url`     | no       | **Reserved for Phase 3 webhook delivery — currently ignored.** Poll the result endpoint.   |
| `client_metadata`  | no       | Free-form object echoed in audit logs only.                                                |

**Requested-field whitelist** (anything outside this list is dropped):

```
given_name, family_name, birth_date,                            ← identity (accepted, not validated)
resident_country, resident_state, resident_city,                ← address (validated)
resident_postal_code, resident_street, resident_house_number    ← address (validated)
```

### Response `201`

```json
{
  "session_id":       "01HJN7…",
  "presentation_uri": "openid4vp://?request_uri=https%3A%2F%2Feudi.acuris-geo.com%2F…&response_uri=…&nonce=…",
  "qr_code_data_url": "data:image/png;base64,iVBOR…",
  "expires_at":       "2026-05-17T11:42:00Z",
  "polling_url":      "https://eudi.acuris-geo.com/v1/eudi/sessions/01HJN7…/result"
}
```

Notes:

- `presentation_uri` carries the `nonce` for wallet-side replay
  protection. The nonce is **not** echoed as a top-level field — banks
  don't need it, and exposing it widens the replay surface.
- `qr_code_data_url` is a base64 PNG. SVG isn't currently returned;
  contact Acuris if your kiosk signage needs vector output.
- `expires_at` is 10 minutes after creation. Hard-coded today;
  per-session TTL is Phase 3 work.
- `polling_url` is what you GET to retrieve the result.

### Error responses

- `400 Bad Request` — malformed JSON, missing `customer_id` or
  `requested_fields`. Body: `{"error":"bad_request","detail":"…"}`.
- `429 Too Many Requests` — per-IP or per-`customer_id` limit hit at
  the Nginx layer. Body: standard Nginx 429 page.

---

## 2. `GET /v1/eudi/sessions/{session_id}/result` — poll for the result

The relying party polls this endpoint until `verification_status` is
no longer `pending`.

### Response `200`

```json
{
  "session_id": "01HJN7…",
  "verification_status": "valid",
  "completed_at": "2026-05-17T11:38:42Z",
  "error": null,
  "credential_validity": {
    "signature_valid": true,
    "issuer_trusted":  true,
    "issuer":          "Bundesdruckerei PID Issuance Service",
    "issuer_country":  "DE",
    "anchor":          "CN=D-TRUST EV Root CA 1 2020,O=D-TRUST GmbH,C=DE",
    "crl_checked":     true,
    "crl_url":         "https://crl.d-trust.net/example.crl",
    "crl_from_cache":  false
  },
  "address": {
    "disclosed_fields":   ["resident_country", "resident_city", "resident_street", "resident_house_number", "resident_postal_code"],
    "canonical_address":  "Frauenstr. 1, 67549 Worms, GERMANY",
    "accuracy_type":      "Verified",
    "confidence":         1.0,
    "country_code":       "DE",
    "structured": {
      "street":   "Frauenstr.",
      "city":     "Worms",
      "postcode": "67549",
      "country":  "DE"
    },
    "skipped_reason":     null
  }
}
```

### `verification_status` states

| Value      | Meaning                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `pending`  | Wallet hasn't called back yet. Keep polling.                                                      |
| `valid`    | Wallet posted a presentation, trust chain validated, address evaluated. See `accuracy_type`.      |
| `invalid`  | Wallet posted a presentation but trust validation or hash check failed. See `error` for detail.   |
| `expired`  | 10 minutes elapsed without a wallet callback.                                                     |

### `credential_validity` fields

| Field              | Meaning                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `signature_valid`  | SD-JWT VC signature verified against the x5c-chain leaf.               |
| `issuer_trusted`   | The x5c chain walked up to a root present in the issuing-country's TSL. |
| `issuer`           | Common name on the leaf certificate (the credential issuer).            |
| `issuer_country`   | Two-letter country code derived from the TSL the anchor came from.      |
| `anchor`           | The trust anchor (root CA) that terminated the chain validation.        |
| `crl_checked`      | Whether the CRL was successfully fetched (or read from cache).          |
| `crl_url`          | The CRL distribution point checked.                                     |
| `crl_from_cache`   | True if the CRL came from the verifier's in-memory cache.               |

### `address` fields

| Field                | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `disclosed_fields`   | Subset of the whitelist the wallet actually disclosed.                        |
| `canonical_address`  | One-line normalized address from the AV pipeline.                             |
| `accuracy_type`      | `Verified` / `Corrected` / `Partial` / `Unverified`. See `result-handling.md`. |
| `confidence`         | 0..1 from the underlying AV cascade.                                          |
| `country_code`       | ISO-2 country code disclosed by the wallet.                                    |
| `structured`         | Standardized address components.                                              |
| `skipped_reason`     | Non-null iff AV cross-reference was skipped. See below.                       |

### `skipped_reason` values

| Value                                                              | Meaning                                                                                                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"Partial disclosure — insufficient fields for AV validation"`      | Wallet disclosed `resident_country` and/or `resident_postal_code` but no `resident_street`. Nothing meaningful to validate beyond locality.              |
| `"AV transport error: <detail>"`                                    | The Acuris AV pipeline returned a network error or 5xx. Treat as transient; retry the user flow.                                                         |
| `"AV non-JSON response: <detail>"`                                  | AV returned 200 OK with a non-JSON body. Should not happen in production; if it does, file a bug.                                                        |
| `"country code not supported by EUDI Wallet scope (alpha-2: XX)"`   | Disclosed `resident_country` is outside the EUDI Wallet scope (EU 27 + EEA non-EU). The wallet shouldn't issue this in the first place; data anomaly.    |

### Error responses

- `404` — unknown `session_id`.
- `410` — session existed but has been GC'd (rare; sessions are kept
  for a while after expiry to support late polling).

---

## 3. `GET /v1/eudi/healthz`

Trivial liveness probe.

### Response `200`

```json
{ "status": "ok" }
```

Suitable for k8s liveness/readiness probes and external monitoring.
No auth required.

---

## 4. `GET /v1/eudi/.well-known/openid-credential-verifier`

Wallet metadata discovery. Wallets fetch this to confirm what the
verifier supports before opening a presentation flow.

### Response `200`

```json
{
  "client_id":                   "acuris-eudi-verifier",
  "client_name":                 "Acuris",
  "client_id_schemes_supported": ["redirect_uri"],
  "response_modes_supported":    ["direct_post"],
  "vp_formats_supported": {
    "vc+sd-jwt": { "sd-jwt_alg_values": ["ES256"] }
  }
}
```

Relying parties don't normally fetch this — it's wallet-side discovery.

---

## 5. `POST /v1/eudi/callback` — wallet posts the VP

> Documented for completeness. **Relying parties do not implement
> against this endpoint.** The wallet POSTs here after the user
> consents; the verifier validates the presentation and updates the
> session state, which your `GET .../result` poll then picks up.

OpenID4VP `direct_post`, `application/x-www-form-urlencoded`:

```
vp_token=<sd-jwt-vc-presentation>
presentation_submission=<json string>
state=<session_id>
```

### Wallet-visible responses

- `200` — `{ "redirect_uri": "https://acuris-geo.com/verification-complete", "session_id": "…", "status": "valid|invalid" }`
- `400` — `{ "error": "invalid_presentation", "detail": "…" }` (and the session is moved to `invalid`)
- `404` — unknown session_id
- `410` — session expired
- `409` — session already completed

---

## 6. `GET /v1/eudi/presentation-definition/{session_id}`

> Wallet endpoint. **Relying parties do not implement against this
> endpoint.** It returns the DIF Presentation Exchange v2
> `presentation_definition` built from your `requested_fields`. The
> wallet fetches it during the presentation flow.

### Response shape (example)

```json
{
  "id":       "<session_id>",
  "name":    "Acuris Address Verification",
  "purpose": "Bank KYC address verification via EUDI Wallet",
  "input_descriptors": [
    {
      "id": "acuris-pid-address-…",
      "format": { "vc+sd-jwt": {} },
      "constraints": {
        "limit_disclosure": "required",
        "fields": [
          { "path": ["$.resident_country"],     "intent_to_retain": false },
          { "path": ["$.resident_postal_code"], "intent_to_retain": false },
          { "path": ["$.resident_city"],        "intent_to_retain": false },
          { "path": ["$.resident_street"],      "intent_to_retain": false },
          { "path": ["$.resident_house_number"],"intent_to_retain": false }
        ]
      }
    }
  ]
}
```

`intent_to_retain: false` everywhere — we don't store the disclosed
values beyond the session, only the cross-validation outcome.
