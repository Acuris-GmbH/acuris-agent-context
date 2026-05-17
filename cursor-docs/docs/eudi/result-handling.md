---
layout: default
title: "Result Handling"
---

# Result handling

What to do with the `verification_status` + `address.accuracy_type`
combinations returned by `GET /v1/eudi/sessions/{id}/result`.

## The four-bucket model

| Bucket           | Bank action                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| **Verified**     | Auto-accept. Persist `canonical_address` as the customer's address of record.                              |
| **Corrected**    | Show the user the canonical form, request a one-click confirmation, then persist.                          |
| **Partial**      | Domain-specific. ZIP-only KYC is sufficient for some products (savings accounts) and not others (credit).  |
| **Unverified**   | Reject the EUDI path; ask the user to verify by document upload or branch visit.                           |

Code:

```ts
type AccuracyType = "Verified" | "Corrected" | "Partial" | "Unverified";

function nextStep(status: string, address: { accuracy_type: AccuracyType; canonical_address: string; structured: Record<string, string | undefined> } | undefined) {
  if (status === "expired")     return { kind: "retry",  reason: "session_expired" };
  if (status === "invalid")     return { kind: "reject", reason: "credential_invalid" };
  if (!address)                  return { kind: "review", reason: "address_skipped" };

  switch (address.accuracy_type) {
    case "Verified":
      return { kind: "accept", address: address.canonical_address };
    case "Corrected":
      return { kind: "confirm", suggested: address.canonical_address, original: address.structured };
    case "Partial":
      return { kind: "partial", structured: address.structured };
    case "Unverified":
      return { kind: "reject", reason: "address_unverified" };
  }
}
```

## What each `accuracy_type` actually means

| Value         | Underlying AV match                                                                                      | KYC interpretation                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Verified`    | AV returned `rooftop` or `exact`, confidence ≥ 0.9, **no corrections, no input normalisation**.           | The address as disclosed exists in postal-authority reference data at premise level. Highest possible signal.                 |
| `Corrected`   | AV returned a usable match BUT applied corrections, OR rewrote input, OR `rooftop`/`exact` < 0.9 confidence. | The address resolves, but not byte-for-byte as disclosed. The bank should display the canonical form to the user and confirm. |
| `Partial`     | Only ZIP + country (or other minimal set) disclosed. **AV was not called** — there's nothing to validate beyond locality. | The credential proves residency in a country + postcode, but no street-level claim. Legitimate KYC signal in some contexts.   |
| `Unverified`  | AV said `no_match`, OR the country code is outside EUDI Wallet scope, OR an AV transport error occurred.   | The address claim could not be corroborated against reference data. Don't accept; reject or fall back to document upload.    |

## Common mistakes when interpreting results

1. **Treating `Corrected` as the same as `Verified`.** It isn't.
   `Corrected` means Acuris had to massage the input — a transposed
   digit, an outdated street name, an ambiguous abbreviation. For
   most KYC workflows you should bounce this back to the user for a
   one-click "yes that's me" confirmation before persisting. The
   `confidence` field carries the underlying AV confidence — banks
   with stricter compliance can set a higher threshold (e.g. 0.95)
   above which they auto-accept `Corrected`.

2. **Treating `Partial` as a failure.** It isn't. ZIP-only disclosure
   is a legitimate selective-disclosure choice — the user told the
   wallet "share only my postcode and country." That's a valid KYC
   signal for products that don't need a street address (e.g.
   age-restricted product gating, regional eligibility). Decide per
   product, not per response.

3. **Ignoring `verification_status` and reading `address` directly.**
   The `address` block can be present on `invalid` sessions too (with
   `skipped_reason` set). Always branch on `verification_status` first.

4. **Reading `credential_validity.signature_valid` and assuming
   identity binding.** A `true` here means the credential is
   cryptographically genuine. It does NOT mean the person scanning
   the QR is the person named in the credential — same as a physical
   ID card. If you need identity binding, layer biometric / liveness
   on top (typical bank pattern: EUDI for address + selfie for
   biometric).

5. **Discarding `disclosed_fields`.** That array tells you exactly
   which sub-fields the wallet released. If the user disclosed only
   `resident_country` + `resident_postal_code`, you cannot later
   claim to a regulator that you verified the street — even if your
   own form had a street field. The audit-trail truth is what the
   wallet released.

6. **Trusting `credential_validity.crl_from_cache` for compliance
   reporting.** The CRL cache is short-lived (minutes); both cached
   and fresh checks are equally authoritative for the moment of
   validation. But if you're reporting CRL-fetch times to a
   regulator, use the `completed_at` timestamp, not the cache flag.

## Logging recommendations

For each completed session, log:

- `session_id`, `customer_id`, `completed_at`
- `verification_status`
- `credential_validity.{signature_valid, issuer_trusted, issuer_country, anchor, crl_checked}`
- `address.{accuracy_type, confidence, country_code, skipped_reason}`
- The first ~80 chars of `address.canonical_address`

Do NOT log:

- The full structured address (PII; minimize what you keep beyond what
  you need for compliance evidence).
- The raw `vp_token`. Your backend never sees it; the wallet posts
  directly to the verifier.
- The `presentation_uri` nonce.

## Reconciling EUDI `accuracy_type` with raw AV `accuracy_type`

The two are different scales:

- The raw `acuris-address` SDK returns AV `accuracy_type` values like
  `rooftop`, `parcel`, `street_interpolated`, `locality_centroid`,
  `centroid`. Open enum.
- The EUDI verifier maps those onto a fixed 4-bucket scale (`Verified`
  / `Corrected` / `Partial` / `Unverified`) tuned for KYC compliance
  decision-making.

If you also use the `acuris-address` SDK elsewhere in your app, don't
expect the values to match. The EUDI scale is intentionally coarser —
KYC officers and auditors don't want to reason about 8+ precision
tiers; they want a yes / "ask user" / "almost yes" / no.
