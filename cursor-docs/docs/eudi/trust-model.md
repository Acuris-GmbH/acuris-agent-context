---
layout: default
title: "Trust Model"
---

# Trust model

What the Acuris EUDI Verifier validates when it says
`credential_validity.issuer_trusted: true`.

This page is for engineers who need to explain to compliance, security,
or legal teams *exactly* what trust check was performed. If you're
just integrating the verifier and want to know what to do with the
result, [`result-handling.md`](./result-handling.md) is enough.

## The trust chain in one paragraph

For every SD-JWT VC the verifier accepts, it walks the x5c chain
embedded in the credential header up to a root. That root must be
present in the issuing member state's national TSL (Trusted List).
The TSL's own signature is verified against the EU LOTL (List of
Trusted Lists). The LOTL's signature is verified against the pinned
OJ (Official Journal) trust anchors. The leaf issuer cert's CRL is
also fetched and checked. If any link breaks, the response is
`verification_status: "invalid"` and either
`credential_validity.signature_valid` or `.issuer_trusted` is `false`.

## The four-layer hierarchy

```
                    ┌──────────────────────────┐
                    │ OJ Official Journal      │
                    │ trust anchors (6 pinned) │       ← bootstrap; updated only via verifier release
                    └────────────┬─────────────┘
                                 │ signs
                                 ▼
                    ┌──────────────────────────┐
                    │ EU LOTL XML              │       ← https://ec.europa.eu/tools/lotl/eu-lotl.xml
                    │ (refreshed periodically) │
                    └────────────┬─────────────┘
                                 │ points to / signs
                                 ▼
                    ┌──────────────────────────┐
                    │ Per-member-state TSL XML │       ← e.g. https://www.nrca-ds.de/st/TSL.xml (Germany)
                    │ (refreshed periodically) │
                    └────────────┬─────────────┘
                                 │ vouches for
                                 ▼
                    ┌──────────────────────────┐
                    │ Qualified-CA root CAs    │       ← e.g. D-TRUST EV Root CA 1 2020
                    └────────────┬─────────────┘
                                 │ issues
                                 ▼
                    ┌──────────────────────────┐
                    │ Intermediate CAs (x5c)   │
                    │ ↓                        │
                    │ Issuer cert (leaf)       │       ← the credential issuer (e.g. Bundesdruckerei)
                    └────────────┬─────────────┘
                                 │ signs
                                 ▼
                    ┌──────────────────────────┐
                    │ SD-JWT VC (the PID)      │
                    └──────────────────────────┘
```

For a presentation to validate, every link must hold:

1. **VC signature ↔ leaf**: SD-JWT VC signature verifies against the
   x5c leaf public key.
2. **x5c chain ↔ root**: standard PKIX path validation, terminating at
   a self-signed root.
3. **Root ↔ TSL**: the root certificate must be present (active, not
   superseded) in the issuing member state's TSL.
4. **TSL signature ↔ LOTL**: the TSL XML must carry a signature
   verifiable against a pointer in the LOTL.
5. **LOTL signature ↔ OJ anchor**: the LOTL must be signed by one of
   the pinned OJ trust anchors.
6. **Revocation**: the leaf issuer's CRL is fetched (or read from
   cache) and the leaf must not be revoked.

If 1-5 fail, you see `issuer_trusted: false`. If 1 fails, you see
`signature_valid: false`. If 6 fails (revoked), you see
`crl_checked: true` but `verification_status: "invalid"` with
`error: "crl_revoked"`.

## OJ trust anchors

Six pinned for rotation resilience. The OJ rotates anchors
periodically; pinning multiple means a single rotation doesn't break
the verifier. When OJ rotates, the verifier ships a release adding
the new anchor; old anchors remain valid until OJ marks them
withdrawn.

To see the current pinned set, the operator can inspect the
verifier's release notes. For relying parties this is opaque — you
don't configure anchors; you trust the Acuris release process.

## Member-state TSL coverage

EU 27 + EEA non-EU is the target scope. As of the most recent Phase
2.5 release, 26 of 27 EU member-state TSLs load successfully at boot;
the 27th (Ireland) is pending a TLS-bypass exception currently being
processed. EEA non-EU (Norway, Liechtenstein, Iceland) and the UK
post-Brexit are NOT in EUDI Wallet scope and will return
`accuracy_type: "Unverified"` with the
`country code not supported by EUDI Wallet scope` `skipped_reason`.

A wallet whose credential is issued by a country not in the loaded
TSL set returns `verification_status: "invalid"` with
`error: "tsl_no_anchor"`. This is rare in practice — EUDI Wallets are
issued by member-state authorities whose roots are in the
corresponding TSL by definition.

## CRL handling

- The verifier fetches the leaf issuer's CRL (URL embedded in the
  certificate's CDP extension) on first use per session.
- Successful fetches are cached in-memory for a configurable TTL
  (default ~1 hour) to amortize cost across high-throughput pilots.
- On a cache miss + fetch failure, the verifier *fails closed* —
  `verification_status: "invalid"` with `error: "crl_unreachable"`.
  We do NOT silently allow a credential through if revocation can't
  be checked.
- `credential_validity.crl_from_cache` tells you whether this
  specific check came from the cache or was freshly fetched. For
  compliance evidence, the `completed_at` timestamp is what matters
  (cached or not, the check happened at that time).

## What you trust by trusting Acuris

By integrating against the verifier you're trusting:

- The pinned OJ anchor set (Acuris-controlled, updated on release).
- The TSL fetch/refresh pipeline (Acuris-controlled).
- The certificate chain validator (custom Python implementation —
  pure-Python, no JCE; reviewed by the Acuris EUDI team).
- The CRL fetcher and cache (Acuris-controlled).
- The in-memory session manager (sessions are not persisted to disk;
  Redis-backed in Phase 2 for HA).

You are NOT trusting Acuris to validate the user's identity in the
sense of "is the person scanning the QR the person named in the
credential." That's a separate concern — pair this with biometric /
liveness checks if your KYC regime requires identity binding beyond
the credential.

## Auditability

Each terminal-state session produces an audit log entry containing:

- The full `credential_validity` block.
- The `customer_id` you supplied.
- The disclosed field set.
- Timestamps for session creation, callback receipt, trust validation
  completion, AV cross-reference completion.

Audit logs are retained per the bank pilot's data-retention agreement
(typical: 7 years for KYC compliance). They are NOT visible via the
public API — request an audit export through your pilot contact.

## Compliance posture

The verifier targets eIDAS 2.0 conformance for the relying-party
verifier role. It does not target issuer-side conformance (Acuris does
not issue credentials). For formal compliance attestation against a
specific regulatory regime (BaFin, FCA, NCA, etc.), the audit log is
the evidence base; the verifier's per-validation output is structured
specifically to support that evidence model.
