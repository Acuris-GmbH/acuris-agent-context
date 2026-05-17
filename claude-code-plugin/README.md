# Acuris — Claude Code plugin

Two Acuris skills bundled into one Claude Code plugin. Version 0.2.1.

## Install

From this repo's marketplace:

```text
/plugin marketplace add Acuris-GmbH/acuris-agent-context
/plugin install acuris@acuris-plugins
```

Or for local development:

```bash
claude --plugin-dir ./claude-code-plugin
```

## Skills inside

- **`acuris-address`** — Address Validation & Geocoding APIs.
  Activates on address autocomplete, validation, geocoding, reverse
  geocoding, batch cleanup, or migrations from libAddressDoctor,
  Loqate, Experian QAS, Melissa, Smarty.
- **`acuris-eudi`** — EUDI Wallet Verifier. Activates on EU Digital
  Identity Wallet, OID4VP, SD-JWT VC, presentation_definition, PID
  address verification, relying-party backend integration.

Each skill loads independently when the user's task matches its
description. Reference recipes load on demand.
