# mTLS for bank pilots

Phase 2 supports per-pilot mTLS (mutual TLS) on the bank-facing
endpoints (`POST /v1/eudi/sessions`, `GET /v1/eudi/sessions/<id>/result`).
This pins each pilot's backend identity by client certificate, on top
of the default network-level controls.

## When you want it

- **You're a regulated entity** (bank, e-money institution, payment
  service provider) and your compliance regime requires authenticated
  identity on all outbound API calls to KYC vendors.
- **You're running multiple environments** (staging, prod) against a
  single Acuris pilot and want clean per-environment audit
  separation.
- **You're sharing a pilot tenancy with sibling business units** and
  want each unit's traffic distinguishable in audit logs.

## When you don't

For initial integration and proof-of-concept work, the default
(unauthenticated bank-facing endpoints behind Nginx IP allowlist + per
`customer_id` rate limit) is sufficient. mTLS adds operational
overhead — certificate provisioning, rotation, renewal — that's not
worth it until you're past PoC.

## How provisioning works

mTLS is provisioned per pilot, not self-service. The flow:

1. You generate a client key pair on your side (RSA-2048 or ECDSA-P256
   are both fine; we prefer ECDSA for performance).
2. You generate a CSR (Certificate Signing Request) containing your
   bank's distinguished name (`CN=acme-bank-kyc-prod, O=Acme Bank AG,
   C=DE`).
3. You send the CSR to your Acuris pilot contact.
4. Acuris signs the CSR with the Acuris pilot CA, and returns the
   signed certificate plus the pilot CA's certificate chain.
5. Acuris configures the Nginx layer to require client-certificate
   auth from your `customer_id` prefix.
6. Your backend presents the client certificate + key on every
   outbound call to `/v1/eudi/sessions` and `/v1/eudi/sessions/.../result`.

## Client-side mTLS — Node

```ts
import https from "node:https";
import { readFileSync } from "node:fs";

const agent = new https.Agent({
  cert: readFileSync("/etc/acuris/client.crt"),
  key:  readFileSync("/etc/acuris/client.key"),
  ca:   readFileSync("/etc/acuris/acuris-pilot-ca.crt"),  // pin the Acuris CA
});

const r = await fetch("https://eudi.acuris-geo.com/v1/eudi/sessions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ customer_id: "kyc-…", requested_fields: [...] }),
  // @ts-ignore — Node's undici fetch accepts dispatcher: agent
  dispatcher: agent,
});
```

(Node's built-in `fetch` doesn't expose an `agent` option as cleanly
as `axios` or `got` do. For production we'd typically recommend
`undici` directly or one of those libraries.)

## Client-side mTLS — Python (requests)

```python
import requests

CERT = ("/etc/acuris/client.crt", "/etc/acuris/client.key")
CA   = "/etc/acuris/acuris-pilot-ca.crt"

r = requests.post(
    "https://eudi.acuris-geo.com/v1/eudi/sessions",
    json={"customer_id": "kyc-…", "requested_fields": [...]},
    cert=CERT,
    verify=CA,
    timeout=10,
)
```

## Client-side mTLS — Go

```go
import (
    "crypto/tls"
    "crypto/x509"
    "net/http"
    "os"
)

cert, _ := tls.LoadX509KeyPair("/etc/acuris/client.crt", "/etc/acuris/client.key")
caPool := x509.NewCertPool()
caPEM, _ := os.ReadFile("/etc/acuris/acuris-pilot-ca.crt")
caPool.AppendCertsFromPEM(caPEM)

client := &http.Client{
    Transport: &http.Transport{
        TLSClientConfig: &tls.Config{
            Certificates: []tls.Certificate{cert},
            RootCAs:      caPool,
            MinVersion:   tls.VersionTLS12,
        },
    },
}
```

## Rotation

Client certificates issued by Acuris are valid for 365 days from
issuance. We email the pilot's technical contact 30 days before
expiry. Rotation is the same flow as initial issuance (new CSR → new
signed cert).

If a certificate expires without being rotated, all calls return
`495 SSL Certificate Error` from Nginx. The Acuris EUDI verifier
itself is unaffected, but your pilot will be temporarily blocked.

## Revocation

If a client key is suspected compromised, notify your Acuris pilot
contact immediately. Revocation is handled at the Nginx layer (the
certificate is removed from the allowlist); CRL distribution is not
used.

## What mTLS does NOT do

- It doesn't authenticate end-users. The end-user's identity binding
  comes from the wallet credential, not from your mTLS cert.
- It doesn't replace the wallet-side trust validation. The verifier
  still does all the LOTL/TSL/CRL checks on every credential.
- It doesn't substitute for proper request signing or content
  integrity. If you need per-request signed payloads (PSD2-style
  signed payment requests), that's a separate Phase 3 feature.

## Cost / quota implications

Pilots with mTLS get a separate per-pilot rate-limit tier and audit
log namespace. The cost model is the same per-verification price as
unauthenticated pilots — mTLS itself is not billed separately.
