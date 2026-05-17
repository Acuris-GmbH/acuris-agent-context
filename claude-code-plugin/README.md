# acuris-address — Claude Code plugin

Acuris Address Validation & Geocoding agent context, packaged as a
Claude Code plugin. Version 0.1.0.

## Install

From this repo's marketplace:

```text
/plugin marketplace add Acuris-GmbH/acuris-agent-context
/plugin install acuris-address@acuris-plugins
```

Or for local development:

```bash
claude --plugin-dir ./claude-code-plugin
```

## What's inside

- `skills/acuris-address/SKILL.md` — primary skill entry point.
- `skills/acuris-address/references/` — recipe library (autocomplete,
  validation, geocoding, batch cleanup, Next.js proxy, Centra, and five
  vendor migration recipes).

## Triggers

The skill auto-activates when the user mentions address autocomplete,
validation, geocoding, reverse geocoding, the `@acuris-geo/av-sdk`
package, the `AcurisClient` symbol, or migration from libAddressDoctor,
Loqate, Experian QAS, Melissa, or Smarty.
