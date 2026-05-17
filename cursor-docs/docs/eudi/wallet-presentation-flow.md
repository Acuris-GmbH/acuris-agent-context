---
layout: default
title: "Wallet Presentation Flow"
---

# Wallet presentation flow — for context, not implementation

You — the relying party — do not implement the wallet side. This
page documents what happens between "user scans the QR" and "your
poll returns a result," so you can:

- Set the right user expectations in your UI ("scan with your EUDI
  Wallet → consent → return to this page");
- Reason about timing (typical 5-30s including user consent);
- Debug edge cases ("user scanned but no callback ever arrived").

## Step by step

1. **Your backend POSTs `/v1/eudi/sessions`** with `requested_fields`.
   Acuris stores a session row keyed by `session_id`, builds the
   `presentation_uri` (an `openid4vp://` URL with `request_uri`,
   `response_uri`, `nonce` query params), and generates a QR-coded
   version.

2. **Your UI renders the QR** (or the deep link, on mobile).

3. **The user opens their EUDI Wallet app** and scans the QR (or
   taps the deep link). The wallet parses the `openid4vp://` URL,
   sees `request_uri`, and fetches it.

4. **Wallet fetches the request object** from
   `request_uri` (which points at Acuris). The request object contains
   the verifier's metadata, `response_uri`, `nonce`, and
   `presentation_definition_uri`.

5. **Wallet fetches the `presentation_definition`** from
   `presentation_definition_uri`. This describes what the verifier
   wants disclosed (the whitelist subset of `requested_fields`, with
   `limit_disclosure: required` so the wallet enforces minimum
   disclosure).

6. **Wallet asks the user for consent** — typically: "Acuris wants
   to verify your residence address. Disclose: country, postal code,
   city, street, house number? [Allow] [Cancel]". This is the
   user-visible moment.

7. **Wallet builds an SD-JWT VC presentation** disclosing exactly
   the requested attributes. Selective disclosure means only those
   sub-claims are revealed; the rest of the credential's attributes
   stay hidden. The wallet signs the presentation with the user's
   wallet key (proof of holder binding).

8. **Wallet POSTs `vp_token`** + `presentation_submission` + `state`
   (= the `session_id`) to the verifier's `response_uri`
   (`/v1/eudi/callback`) via `direct_post`,
   `application/x-www-form-urlencoded`.

9. **Verifier validates the presentation**:
   - Parses the SD-JWT VC and the disclosures.
   - Verifies the disclosure hashes (every disclosed sub-claim must
     match a `_sd` digest in the credential body — tamper detection).
   - Verifies the SD-JWT signature against the x5c leaf.
   - Walks the x5c chain to a root, checks the root against the
     issuing-country TSL, checks the TSL against LOTL, checks LOTL
     against the OJ anchor.
   - Checks the leaf cert's CRL.

10. **Verifier extracts address fields** from the disclosed claim
    set, calls the AV pipeline (`POST /validate` on api.acuris-geo.com).

11. **Verifier updates the session row** with the result and returns
    `200` + `{ redirect_uri, session_id, status }` to the wallet.
    The wallet redirects the user's browser to `redirect_uri` (a
    static "verification complete" page).

12. **Your backend's poll returns the result** (your next poll
    after step 11 returns `verification_status` = `valid` /
    `invalid`).

## Where time goes

| Step                                                         | Typical latency      |
| ------------------------------------------------------------ | -------------------- |
| Session creation (`POST /sessions`)                          | < 100ms              |
| QR rendering on your side                                    | instant              |
| **User scans + consents** (the only human-time step)          | **5-30 seconds**     |
| Wallet fetches request object + presentation_definition       | 100-500ms (network)  |
| Wallet builds presentation                                    | < 100ms              |
| Wallet POSTs `direct_post`                                    | 100-500ms            |
| Verifier validates trust chain + CRL                          | 200ms-2s (CRL fetch may be slow first time, cached after) |
| Verifier calls AV `/validate`                                 | 50-300ms             |
| Your next poll sees the terminal state                        | up to your poll interval |

A "valid" path with a fresh CRL and quick user consent: ~10s end to
end. With a slow CRL fetch or a hesitant user: 30s+.

## What can fail at each step

| Step                | Failure mode                                                                   | Status surfaced via your poll                                                                 |
| ------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 3-5 (wallet flow)   | Wallet can't reach the verifier from the user's network                        | Session stays `pending` until TTL expires → `expired`                                          |
| 6 (consent)         | User cancels                                                                   | Wallet doesn't POST; session stays `pending` until TTL expires → `expired`                    |
| 8 (POST)            | Network blip on wallet→verifier                                                | Wallet typically retries; session stays `pending`                                              |
| 9 (validation)      | Hash mismatch, signature failure, trust chain incomplete, CRL revoked          | `verification_status: "invalid"` with `error: <tag>`                                           |
| 10 (AV pass)        | AV returns 5xx or non-JSON                                                     | `verification_status: "valid"`, `address.skipped_reason: "AV transport error: …"`              |
| 11 (response)       | Wallet → verifier got the response but the redirect failed wallet-side          | Doesn't affect your poll — the session is already updated                                      |

## Debugging "user scanned but no callback arrived"

The user reports scanning the QR but your poll never moves out of
`pending`. Things to check:

1. **Did the wallet actually open?** Some users scan with their
   regular camera app, not their wallet. The wallet must be installed
   AND the OS must route `openid4vp://` to it.
2. **Did the user consent?** If they tap Cancel in the wallet UI,
   no POST happens. Your session expires.
3. **Could the wallet reach `eudi.acuris-geo.com`?** Some corporate
   or kiosk WiFi networks block outbound HTTPS to non-allowlisted
   domains. The wallet needs network egress to the verifier.
4. **Is the wallet on `vc+sd-jwt` format with ES256?** That's what
   our metadata advertises. Wallets that only support `mso_mdoc` or
   `jwt_vc_json` will reject the request before even showing a consent
   screen — and won't POST anything to the verifier.

If you have access to the user's wallet logs, the most common error
the wallet would surface is something like "verifier metadata format
mismatch" (mismatched VP format) or "request unreachable" (network
egress blocked).

## Wallet implementations in scope

The verifier is tested against the major EUDI Wallet reference
implementations and the issued-PID wallets currently deployed by
member states (DE: Bundesdruckerei wallet; pilot rollouts in other
member states ongoing). A wallet whose PID is signed by an unsupported
member-state TSL will produce `invalid` with `error: "tsl_no_anchor"`
— in practice this is rare because wallets are issued by the same
authority whose root is in the TSL.
