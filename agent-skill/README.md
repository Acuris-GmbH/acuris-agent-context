# acuris-address — Open Agent Skill

Acuris Address Validation & Geocoding agent context in the open
[Agent Skills](https://agentskills.io) format. Version 0.1.0.

## Install

```bash
# Interactive — pick your agent:
npx skills add Acuris-GmbH/acuris-agent-context

# Specific agent:
npx skills add Acuris-GmbH/acuris-agent-context -a claude-code
npx skills add Acuris-GmbH/acuris-agent-context -a cursor
npx skills add Acuris-GmbH/acuris-agent-context -a github-copilot
npx skills add Acuris-GmbH/acuris-agent-context -a opencode
npx skills add Acuris-GmbH/acuris-agent-context -a codex
npx skills add Acuris-GmbH/acuris-agent-context -a gemini-cli
npx skills add Acuris-GmbH/acuris-agent-context -a kiro-cli
```

See <https://agentskills.io> for the full list of compatible tools.

## What's inside

`acuris-address/` contains `SKILL.md` + `references/` in the canonical
Anthropic skill format. The CLI copies it into the right host-specific
path for your agent.
