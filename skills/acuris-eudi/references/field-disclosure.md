# Field disclosure and the address whitelist

Acuris is an **address verifier**, not an identity verifier. The
verifier's `requested_fields` whitelist reflects that scope.

## The whitelist

```
given_name, family_name, birth_date,                            ← identity (accepted, not validated)
resident_country, resident_state, resident_city,                ← address (validated)
resident_postal_code, resident_street, resident_house_number    ← address (validated)
```

Three identity fields, six address fields. Anything you request
outside this list is silently dropped (and logged in the audit trail).
This is deliberate — wallets should not be asked for fields the
verifier won't use, since selective disclosure is the whole point of
EUDI Wallet.

## Why identity fields are accepted but not validated

EUDI Wallets typically issue PID credentials with several attributes
bundled together (given name, family name, birth date, residence
address). A bank doing onboarding may need both identity and address
in a single user gesture. Splitting the request into two wallet flows
(one for identity, one for address) burns user trust and adds friction.

So the verifier accepts identity fields if you request them — the
wallet releases them via selective disclosure, they show up in
`address.disclosed_fields` (technically the field name is `disclosed_fields`
on the address object; identity fields appear there too even though
they're not strictly "address"), and your audit log records what was
released. But Acuris does NOT cross-reference identity claims against
any authoritative source. For identity-attribute validation you need
a dedicated identity vendor (QTSP in the EU, CASS-certified provider
in the US, etc.).

## Why no `pid_id` / `document_id` / national ID

The PID's national identification number (`personal_administrative_number`,
or member-state-specific variants like `pid_id`) is intentionally
**not** in the whitelist. Reasons:

1. Acuris has no use for it — we're address-only.
2. National-ID handling is heavily regulated per member state (some
   ban storage altogether). Requesting it then dropping it (because
   we don't validate it) would still expose your audit trail to those
   regulations.
3. If you need a national ID for your KYC regime, request it
   yourself directly from the wallet via a separate `presentation_definition`
   — don't ask Acuris to broker that disclosure.

## Minimum and maximum field sets

| Minimum useful disclosure                              | What you get                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `resident_country` only                                | `accuracy_type: "Partial"`. Confirms country residency. AV not called. |
| `resident_country` + `resident_postal_code`            | `accuracy_type: "Partial"`. Confirms country + postcode. AV not called. |
| `resident_country` + `resident_postal_code` + `resident_street` | AV is called. Returns full result.                         |

| Maximum disclosure that AV uses                        |
| ------------------------------------------------------ |
| All six `resident_*` fields. Anything else is identity (passed through, not validated). |

You can request fewer fields without losing functionality — Acuris
fills missing components from authoritative reference data during
the AV pass. Requesting `resident_country` + `resident_postal_code`
+ `resident_street` + `resident_house_number` (omitting city + state)
returns a full canonical address including the inferred city.

## `intent_to_retain`

The generated `presentation_definition` sets `intent_to_retain: false`
for every field. This is a signal to the user (via the wallet UI) that
the relying party will not store the disclosed values beyond the
verification.

This matches our actual behaviour: Acuris stores the
*cross-validation outcome* (the bucket, the confidence, the canonical
form) but the audit trail does not retain the raw disclosed values
beyond the session's TTL plus result retention window.

If your bank's KYC regime requires you to *retain* the disclosed
values yourself (you ARE the bank, after all), you do that on your
side after the wallet redirects the user back. Acuris's retention
posture is verifier-side only.

## Audit-trail implications

What goes into the audit log per session:

- `disclosed_fields` (the field names, not values)
- `customer_id`
- `verification_status`
- The `accuracy_type` bucket
- Credential validity flags (`signature_valid`, `issuer_trusted`,
  `issuer_country`, `anchor`, `crl_checked`)
- Timestamps

What does NOT go into the audit log:

- The raw disclosed field values (e.g. the user's actual street name).
- The raw VP token.
- The wallet's user-agent or device fingerprint.

This balance is deliberate: enough evidence to demonstrate a
verification happened and what it produced, without retaining the
underlying PII for longer than the session.

## Wallet-side UX implication

When the user scans the QR, their wallet shows them a consent screen
listing the fields the verifier is asking for. Asking for nine fields
(identity + address) when you only validate six (address) looks
suspicious to the user. **Best practice: only request the fields you
actually need.** If your bank flow only needs address-for-KYC, request
the five address sub-fields without the identity ones — it reads as
"this verifier is asking for the minimum to do its job" rather than
"this verifier is hoovering up everything it can."

The selective-disclosure UX is one of the things that built EUDI
Wallet's trust with end users. Requesting more than you need erodes
that trust.
