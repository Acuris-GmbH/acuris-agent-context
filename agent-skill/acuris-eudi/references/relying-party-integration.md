# Relying-party backend integration

The two HTTP calls you actually wire — `POST /v1/eudi/sessions` and
`GET /v1/eudi/sessions/{id}/result` — with worked examples in Node,
Python, and Go.

## Pattern at a glance

```
1. POST /v1/eudi/sessions      → returns session_id + qr_code_data_url + polling_url
2. Render the QR to the user
3. Poll polling_url every 2s   → returns verification_status: "pending" | "valid" | "invalid" | "expired"
4. On "valid", read .address and .credential_validity
```

That's the whole integration. No webhooks, no client libraries, no
JWT verification (the verifier does that for you).

## Node / TypeScript (Express)

```ts
import express from "express";

const app = express();
app.use(express.json());

const EUDI_BASE = "https://eudi.acuris-geo.com";

interface SessionResponse {
  session_id: string;
  presentation_uri: string;
  qr_code_data_url: string;
  expires_at: string;
  polling_url: string;
}

interface ResultResponse {
  session_id: string;
  verification_status: "pending" | "valid" | "invalid" | "expired";
  completed_at: string | null;
  error: string | null;
  credential_validity?: {
    signature_valid: boolean;
    issuer_trusted: boolean;
    issuer: string;
    issuer_country: string;
    anchor: string;
    crl_checked: boolean;
  };
  address?: {
    disclosed_fields: string[];
    canonical_address: string;
    accuracy_type: "Verified" | "Corrected" | "Partial" | "Unverified";
    confidence: number;
    country_code: string;
    structured: { street?: string; city?: string; postcode?: string; country: string };
    skipped_reason: string | null;
  };
}

// 1. Start a verification session
app.post("/kyc/eudi/start", async (req, res) => {
  const { caseId } = req.body;

  const r = await fetch(`${EUDI_BASE}/v1/eudi/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customer_id: caseId,
      requested_fields: [
        "resident_country", "resident_city", "resident_postal_code",
        "resident_street", "resident_house_number",
      ],
      client_metadata: { app: "branch-app", version: "1.2" },
    }),
  });
  if (!r.ok) return res.status(502).json({ error: "eudi_session_failed" });
  const session = (await r.json()) as SessionResponse;

  // Return the QR + polling URL to the UI. Don't expose presentation_uri
  // to your own UI — that's wallet-internal.
  res.json({
    sessionId:    session.session_id,
    qr:           session.qr_code_data_url,
    pollingUrl:   `/kyc/eudi/${session.session_id}/result`,
    expiresAt:    session.expires_at,
  });
});

// 2. Proxy the poll through your backend (don't let the browser hit
//    eudi.acuris-geo.com directly — keeps the polling URL out of CORS
//    and lets you add your own caching/throttling).
app.get("/kyc/eudi/:sessionId/result", async (req, res) => {
  const r = await fetch(`${EUDI_BASE}/v1/eudi/sessions/${req.params.sessionId}/result`);
  if (r.status === 404) return res.status(404).json({ error: "unknown_session" });
  const result = (await r.json()) as ResultResponse;
  res.json(result);
});

app.listen(3000);
```

## Python (Flask)

```python
import requests
from flask import Flask, jsonify, request

app = Flask(__name__)
EUDI_BASE = "https://eudi.acuris-geo.com"

@app.post("/kyc/eudi/start")
def start():
    case_id = request.json["caseId"]
    r = requests.post(
        f"{EUDI_BASE}/v1/eudi/sessions",
        json={
            "customer_id": case_id,
            "requested_fields": [
                "resident_country", "resident_city", "resident_postal_code",
                "resident_street", "resident_house_number",
            ],
            "client_metadata": {"app": "branch-app", "version": "1.2"},
        },
        timeout=10,
    )
    if r.status_code != 201:
        return jsonify({"error": "eudi_session_failed"}), 502
    s = r.json()
    return jsonify({
        "sessionId":  s["session_id"],
        "qr":         s["qr_code_data_url"],
        "pollingUrl": f"/kyc/eudi/{s['session_id']}/result",
        "expiresAt":  s["expires_at"],
    })

@app.get("/kyc/eudi/<session_id>/result")
def result(session_id):
    r = requests.get(f"{EUDI_BASE}/v1/eudi/sessions/{session_id}/result", timeout=10)
    if r.status_code == 404:
        return jsonify({"error": "unknown_session"}), 404
    return jsonify(r.json())
```

## Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

const eudiBase = "https://eudi.acuris-geo.com"

type sessionResp struct {
    SessionID       string `json:"session_id"`
    PresentationURI string `json:"presentation_uri"`
    QRCodeDataURL   string `json:"qr_code_data_url"`
    ExpiresAt       string `json:"expires_at"`
    PollingURL      string `json:"polling_url"`
}

func startSession(customerID string) (*sessionResp, error) {
    body, _ := json.Marshal(map[string]interface{}{
        "customer_id": customerID,
        "requested_fields": []string{
            "resident_country", "resident_city", "resident_postal_code",
            "resident_street", "resident_house_number",
        },
    })
    resp, err := http.Post(eudiBase+"/v1/eudi/sessions", "application/json", bytes.NewReader(body))
    if err != nil { return nil, err }
    defer resp.Body.Close()
    if resp.StatusCode != 201 {
        b, _ := io.ReadAll(resp.Body)
        return nil, fmt.Errorf("eudi start: %d %s", resp.StatusCode, b)
    }
    var s sessionResp
    if err := json.NewDecoder(resp.Body).Decode(&s); err != nil { return nil, err }
    return &s, nil
}
```

## Frontend polling loop

After the backend returns `{ sessionId, qr, pollingUrl }`, your UI:

```ts
async function pollUntilDone(pollingUrl: string, signal: AbortSignal) {
  while (!signal.aborted) {
    const r = await fetch(pollingUrl, { signal });
    if (!r.ok) throw new Error(`poll ${r.status}`);
    const result = await r.json();
    if (result.verification_status !== "pending") return result;
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error("aborted");
}

// In your React component:
const ac = new AbortController();
useEffect(() => {
  pollUntilDone(`/kyc/eudi/${sessionId}/result`, ac.signal)
    .then(handleVerificationResult)
    .catch(handlePollError);
  return () => ac.abort();
}, [sessionId]);
```

Set a soft cap at ~5 minutes of polling (the session expires at 10
minutes regardless; users who haven't scanned by 5 minutes have moved
on).

## What to do with the result

Routing on `verification_status` + `accuracy_type` covers nearly all
real-world handling. Detailed buckets in
[`result-handling.md`](./result-handling.md):

```ts
function decide(result: ResultResponse): "accept" | "review" | "reject" | "retry" {
  if (result.verification_status === "expired")       return "retry";
  if (result.verification_status === "invalid")       return "reject";
  if (result.verification_status === "pending")       throw new Error("still pending — shouldn't happen here");

  // valid + ...
  if (!result.address)                                 return "review";  // address skipped — surface skipped_reason
  switch (result.address.accuracy_type) {
    case "Verified":   return "accept";
    case "Corrected":  return "review";   // show user the canonical form, get confirmation
    case "Partial":    return "review";   // ZIP-only — fine for some flows, not for others
    case "Unverified": return "reject";
  }
}
```

## Idempotency

`POST /v1/eudi/sessions` does **not** support idempotency keys in
Phase 2 (tracked for Phase 3). If your backend retries a session-start
on transient failure, you'll get two distinct sessions — pick one and
let the other expire. The wallet will only call back to the one whose
QR the user scans.

## Error handling

| Condition                              | What to do                                           |
| -------------------------------------- | ---------------------------------------------------- |
| `POST /sessions` returns 4xx           | Bug in your request — fix and retry.                 |
| `POST /sessions` returns 5xx / network | Treat as transient; retry with backoff.              |
| `GET /result` returns 404              | Bug in your client (wrong session_id) or session GC'd. |
| `GET /result` returns 5xx              | Transient; keep polling.                             |
| `verification_status: "expired"`       | User abandoned. Offer to start a new session.        |
| `verification_status: "invalid"`       | Wallet sent something the verifier rejected. Surface `error` to the user; possibly retry from a clean state. |

Rate-limit responses (429) from `POST /sessions` mean you've exceeded
the per-IP or per-`customer_id` cap — back off, then retry. The cap
defaults to "generous for a single bank's peak"; if you hit it under
normal load, contact Acuris to raise it.
