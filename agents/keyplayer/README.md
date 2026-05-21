# KeyPlayer Orchestrator Agent

Template files for the KeyPlayer agent. These get loaded at runtime, interpolated with per-client variables, and joined into the Claude system prompt.

## Files
- `soul.md` — identity, voice, values, posture
- `agent.md` — mission, operating loop, sub-agent registry, /goals protocol, hard constraints
- `skills.md` — read/write permissions, external tools, token budgets

## Template variables
Filled in from `state/keyplayer/config.json` at load time.

| Variable | Example | Used in |
|---|---|---|
| `{{CLIENT_NAME}}` | `KeyPlayers` | soul, agent |
| `{{CLIENT_DESCRIPTION}}` | `a marketing agency serving B2B SaaS founders` | soul |
| `{{OWNER_FIRST_NAME}}` | `Brayson` | all three |
| `{{OWNER_PHONE}}` | `+16362932993` | soul |

## Adding a new client
1. Copy `state/keyplayer/config.json` to a new directory keyed by client id
2. Fill in the values
3. Point the runtime at the new state dir (env var `KEYPLAYER_STATE_DIR=state/keyplayer-<client>`)

## State files (per-instance, gitignored)
Live in `state/keyplayer/` for the default deployment:
- `goals.md` — active and historical goals
- `memory.md` — compacted memory, written by `memory-compactor`
- `config.json` — variable values for this deployment
