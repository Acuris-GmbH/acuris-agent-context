# Session lifecycle

What happens between `POST /v1/eudi/sessions` and a terminal status
on `GET .../result`, and what to expect at each step.

## States

```
       ┌─────────┐
       │ pending │ ───────── wallet didn't call back yet (default state)
       └────┬────┘
            │
   ┌────────┴────────┬────────────────────┐
   │                 │                    │
   ▼                 ▼                    ▼
 valid           invalid              expired
(wallet         (wallet posted,      (10-minute
 posted,         trust or hash       TTL elapsed
 trust ok,       check failed)       with no callback)
 address
 evaluated)
```

The terminal states are `valid`, `invalid`, `expired`. Once a session
reaches one of these, it stays there.

## Cadence

- **Poll every 2 seconds.** Aggressive polling rate-limits you and
  doesn't return results faster — the bottleneck is the user's
  consent flow.
- **Soft cap at 5 minutes of polling.** Sessions expire at 10
  minutes; users who haven't scanned by 5 are almost always gone.
  Surface a "haven't scanned yet?" prompt and offer to start a new
  session.
- **Don't poll on a background timer indefinitely.** Use a per-tab
  `AbortController`; cancel on unmount, on navigation, on visibility
  change.

## When sessions move out of `pending`

| Trigger                                                    | New status   | Latency                                             |
| ---------------------------------------------------------- | ------------ | --------------------------------------------------- |
| Wallet POSTs valid `vp_token` to `/callback`                | `valid`      | Within ~500ms of the wallet POST.                   |
| Wallet POSTs malformed / tampered `vp_token`                | `invalid`    | Within ~500ms of the wallet POST.                   |
| Wallet POSTs `vp_token` whose trust chain doesn't validate  | `invalid`    | Within ~1-2s (CRL fetch can take a moment).         |
| 10 minutes elapse without any wallet POST                   | `expired`    | Within ~2-5s of the 10-minute mark.                 |

## What `verification_status` does NOT tell you

- It doesn't tell you whether the user's address is real or correct
  for KYC. That's `address.accuracy_type` (`Verified` / `Corrected` /
  `Partial` / `Unverified`). A `verification_status: "valid"` plus
  `accuracy_type: "Unverified"` is a perfectly common combination — the
  wallet credential was trustworthy, but the address it disclosed
  didn't match Acuris reference data.
- It doesn't tell you whether the user actually scanned a *real* PID.
  The trust validation guarantees the credential's signature chains
  to a trusted member-state issuer; it doesn't guarantee the user
  *is* the person named in the credential. Same trust model as a
  physical ID document: the document is genuine, identity binding
  comes from possession + (optionally) biometric / liveness checks
  layered on top.

## What happens after a terminal state

- **`valid`** — the result row is kept for `EUDI_RESULT_TTL` (default
  24 hours). Late polls return the same result. After that the row is
  GC'd and the polling URL returns 404.
- **`invalid`** — same retention behaviour, but the `address` block is
  typically absent (no address to validate if trust failed). `error`
  carries a short tag (e.g. `crl_revoked`, `tsl_no_anchor`,
  `disclosure_hash_mismatch`).
- **`expired`** — short-form row (no `address`, no `credential_validity`).
  Same TTL.

## Error recovery patterns

| Symptom                                              | Recovery                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Poll returns 404 immediately                         | You're polling a session that was never created — check your `session_id`.|
| Poll returns 404 after first having returned `pending` | Server GC race (very rare). Re-create the session.                      |
| `pending` for >2 minutes                             | User hasn't scanned. Show "scan the QR with your EUDI Wallet" reminder.   |
| `expired`                                            | Wipe the QR; offer to restart.                                            |
| `invalid` with `error: "disclosure_hash_mismatch"`   | Credential was tampered with. Likely user used a malformed wallet build; ask them to retry from a fresh wallet session. |
| `invalid` with `error: "tsl_no_anchor"`              | Credential issuer isn't in the loaded TSL set. Check Acuris's TSL coverage list; if it's a recently-added member state, contact us. |
| `invalid` with `error: "crl_revoked"`                | Issuer revoked this credential. User must obtain a new one from their issuing authority.                                 |

## TTL knobs (server-side, not configurable per-request in Phase 2)

| Knob                  | Default     | Notes                                                  |
| --------------------- | ----------- | ------------------------------------------------------ |
| `EUDI_SESSION_TTL`    | 600s (10m)  | How long `pending` survives before flipping to `expired`. |
| `EUDI_RESULT_TTL`     | 86400s (24h)| How long terminal results are queryable.               |
| `EUDI_PRESENTATION_TTL` | 600s      | How long a wallet has to fetch the presentation_definition after the session is created. (Generally not visible to RPs.) |
