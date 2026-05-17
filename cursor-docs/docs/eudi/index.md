---
layout: default
title: "acuris-eudi — EUDI Wallet Verifier"
---


## Overview

The Acuris EUDI Verifier is a hosted OID4VP (OpenID for Verifiable
Presentations) relying-party service at
`https://eudi.acuris-geo.com`. It accepts EU Digital Identity Wallet
presentations of the PID (Personal Identification Data) credential
(SD-JWT VC format), validates the credential against the EU 27
member-state Trusted Lists (LOTL → national TSL → x5c chain → CRL),
and cross-checks the disclosed residence address against Acuris's
address-validation pipeline.

This skill teaches AI assistants how to integrate the verifier as a
**relying party** (RP) — typically a bank, fintech, or branch-onboarding
backend that needs to verify a customer's residence address via their
EUDI Wallet rather than via document upload.

You — the integrator — do not implement the wallet side. Your backend
initiates a verification session, displays a QR code (or deep link) to
the user, and polls for the verification result. The wallet posts the
presentation directly to the Acuris verifier. The Acuris verifier
validates trust + address and returns a structured result to your
backend.

## When to use this skill

Use this skill when the user is:

- Wiring an EUDI Wallet verification step into a bank KYC, branch
  onboarding, account-opening, or address-change flow.
- Building a relying-party backend that calls `POST /v1/eudi/sessions`
  to start a verification and `GET /v1/eudi/sessions/<id>/result` to
  poll for the answer.
- Generating an OID4VP `presentation_definition` for the address-only
  field set Acuris supports.
- Interpreting `verification_status`, `credential_validity`,
  `accuracy_type`, and `skipped_reason` in poll responses.
- Wiring the QR-code / deep-link presentation to the user (typically
  inside a branch tablet, a teller app, or a mobile onboarding flow).
- Asking about EU 27 trust validation, qualified electronic
  signatures, or which member-state TSLs are currently loaded.

**Do NOT** use this skill for:

- Issuing PID credentials. Issuance is a member-state operation (in
  Germany, by Bundesdruckerei) — Acuris is verifier-side only.
- General-purpose KYC checks beyond address (sanctions screening,
  PEP check, source-of-funds verification). Acuris EUDI does not
  cover identity attribute validation beyond passing identity claims
  through; layer a dedicated KYC vendor for those.
- Pure address validation without EUDI Wallet (use the
  `acuris-address` skill instead — the underlying AV pipeline is the
  same, but you don't need OID4VP if the user is just typing).
- Non-EU identity wallets (mDL / ISO 18013-5, U.S. state mobile DLs,
  W3C DIDs without OID4VP). Out of scope.

## Integration shape at a glance

You implement two HTTP calls. The wallet handles everything in between.

```
        ┌──────────────┐
        │ Your backend │
        └──────┬───────┘
               │ 1. POST /v1/eudi/sessions
               │    → returns session_id + presentation_uri + qr_code_data_url
               ▼
        ┌──────────────┐
        │ Your UI      │  shows QR / deep link to user
        └──────┬───────┘
               │ user scans → wallet opens → consents to disclosure
               ▼
        ┌──────────────┐
        │ EUDI Wallet  │  fetches presentation_definition, builds VP
        │ (user device)│  POSTs vp_token → /v1/eudi/callback
        └──────┬───────┘
               │
               ▼  (Acuris verifier validates trust + address)
        ┌──────────────┐
        │ Your backend │  2. GET /v1/eudi/sessions/<id>/result
        │              │     → poll until verification_status != "pending"
        └──────────────┘
```

You poll the result endpoint; the wallet → verifier handshake is
opaque to you. Typical end-to-end time: 5-30 seconds depending on how
long the user takes to consent.

## API endpoints you actually call

| Endpoint                                              | Method | Who calls it           |
| ----------------------------------------------------- | ------ | ---------------------- |
| `POST /v1/eudi/sessions`                              | POST   | **Your backend** — start a session |
| `GET  /v1/eudi/sessions/{session_id}/result`          | GET    | **Your backend** — poll for result |
| `GET  /v1/eudi/healthz`                               | GET    | Your monitoring        |
| `GET  /v1/eudi/.well-known/openid-credential-verifier`| GET    | Wallets — verifier metadata |
| `POST /v1/eudi/callback`                              | POST   | **The wallet** — do not call this yourself |
| `GET  /v1/eudi/presentation-definition/{id}`          | GET    | **The wallet** — do not call this yourself |

The last two are documented for completeness; relying parties do not
implement against them. They're the wallet's view of the verifier.

Detailed shapes for every endpoint are in
[`references/api-reference.md`](api-reference.md).

## Quick start

```bash
# 1. Start a session
SID=$(curl -s -X POST https://eudi.acuris-geo.com/v1/eudi/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "customer_id": "kyc-2026-12345",
    "requested_fields": [
      "resident_country", "resident_city", "resident_postal_code",
      "resident_street", "resident_house_number"
    ]
  }' | jq -r .session_id)

# 2. Render the returned qr_code_data_url or presentation_uri in your UI.
#    User scans → wallet opens → consents.

# 3. Poll
while true; do
  RESULT=$(curl -s https://eudi.acuris-geo.com/v1/eudi/sessions/$SID/result)
  STATUS=$(echo "$RESULT" | jq -r .verification_status)
  [ "$STATUS" != "pending" ] && break
  sleep 2
done
echo "$RESULT" | jq .
```

`verification_status` ends in one of: `valid`, `invalid`, `expired`.
Each carries different metadata; full handling in
[`references/result-handling.md`](result-handling.md).

## Defaults

- **Production base URL:** `https://eudi.acuris-geo.com`. There is no
  separate sandbox host; pilots use a `customer_id` prefix Acuris hands
  out (e.g. `pilot-acme-…`).
- **Address-only disclosure.** The Acuris verifier whitelist accepts
  three identity claims (`given_name`, `family_name`, `birth_date`)
  alongside six `resident_*` address sub-fields, but **only the
  `resident_*` fields are cross-checked against Acuris reference
  data.** Requesting non-whitelisted fields silently drops them (and
  logs the drop in your audit trail). See
  [`references/field-disclosure.md`](field-disclosure.md).
- **Polling, not webhooks.** Phase 2 ships polling-only. The
  `callback_url` field on `POST /v1/eudi/sessions` is reserved for
  Phase 3 webhook delivery and is currently ignored. Build your
  integration to poll the `polling_url` returned in the session
  response.
- **Session TTL: 10 minutes.** A session that hasn't received a
  callback within 10 minutes flips to `expired`. Per-session TTL is
  configurable in Phase 3.
- **Don't echo the `nonce`.** The session response deliberately omits
  the OID4VP nonce as a top-level field; banks have no need for it and
  exposing it widens the replay-attack surface. It's embedded inside
  `presentation_uri` if you need it for debugging.
- **mTLS for bank pilots.** Phase 2 supports per-pilot mTLS on the
  bank-facing endpoints. Default is unauthenticated; mTLS provisioning
  is per-pilot. See
  [`references/mtls-bank-pilot.md`](mtls-bank-pilot.md).

## Common mistakes

1. **Calling `/v1/eudi/callback` from your backend.** That endpoint
   is for the user's wallet only. Your backend uses session-start +
   result-poll; the wallet handles the `direct_post` between them.

2. **Polling too aggressively.** A 2-second poll interval is fine. A
   100ms interval will rate-limit you and won't return results faster
   — the bottleneck is the user's consent flow, which takes seconds.

3. **Treating `verification_status: "pending"` as an error.** It
   means "the wallet hasn't called us back yet." Keep polling until
   `valid`, `invalid`, or `expired`.

4. **Requesting identity claims you don't need.** Selective
   disclosure is the whole point of EUDI Wallet. Requesting only the
   address sub-fields builds user trust *and* matches what the
   verifier actually validates. Asking for `given_name` or
   `family_name` along with the address is permitted but the verifier
   only address-cross-checks, not identity-cross-checks.

5. **Ignoring `skipped_reason`.** When AV cross-reference doesn't
   run (e.g. partial disclosure, AV transport error), the poll
   response includes a `skipped_reason` string. Treat that as a
   first-class outcome to log and surface to the bank operator — it
   isn't an error per se.

6. **Confusing `accuracy_type` semantics with the AV-only ones.**
   In EUDI responses, `accuracy_type` is one of `Verified`, `Corrected`,
   `Partial`, `Unverified` — a four-bucket projection of the
   underlying Acuris cascade tuned for KYC compliance reasoning. See
   [`references/result-handling.md`](result-handling.md).

7. **Not handling `country_code` outside EUDI Wallet scope.** EUDI
   Wallet is currently EU 27 + EEA non-EU. A disclosed `resident_country`
   outside this scope returns `accuracy_type: "Unverified"` with a
   `skipped_reason` of `country code not supported by EUDI Wallet
   scope (alpha-2: XX)`. Surface this to the user — it isn't a bug
   in your code or theirs.

## Implementation patterns

Detailed recipes live in the references. Load whichever matches the task:

- [Backend relying-party integration (Node, Python, Go)](relying-party-integration.md)
- [Full session lifecycle: states, polling cadence, expiry, error
  recovery](session-lifecycle.md)
- [What the wallet does (read-only for context, not for
  implementation)](wallet-presentation-flow.md)
- [Field disclosure and the address whitelist](field-disclosure.md)
- [Result handling: accuracy_type, credential_validity, skipped_reason](result-handling.md)
- [Trust model: LOTL, member-state TSLs, OJ anchors, CRL checks](trust-model.md)
- [mTLS bank pilots](mtls-bank-pilot.md)

## Trust model in one paragraph

The verifier walks every presented SD-JWT VC's x5c chain up to a root,
then verifies that root against the issuing member state's national
TSL (Trusted List), then verifies the TSL's signature against the EU
LOTL (List of Trusted Lists), then verifies the LOTL's signature
against the pinned OJ (Official Journal) trust anchors. Six OJ
anchors are pinned for rotation resilience. The leaf issuer
certificate's CRL is checked too. If any link breaks, the response
status is `invalid` and `credential_validity.signature_valid` or
`.issuer_trusted` will be `false`. Full mechanics in
[`references/trust-model.md`](trust-model.md).

## Additional resources

- Live verifier metadata: <https://eudi.acuris-geo.com/v1/eudi/.well-known/openid-credential-verifier>
- Health check: <https://eudi.acuris-geo.com/v1/eudi/healthz>
- OID4VP spec: <https://openid.net/specs/openid-4-verifiable-presentations-1_0.html>
- SD-JWT VC spec: <https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/>
- EU LOTL: <https://ec.europa.eu/tools/lotl/eu-lotl.xml>
- Acuris pricing & EUDI pilot enquiries: <https://acuris-geo.com/>
