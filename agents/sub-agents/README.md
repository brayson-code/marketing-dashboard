# Sub-Agents

Specialist agents that KeyPlayer spawns to do focused work. Each lives in its own directory and follows the same three-file pattern as KeyPlayer.

## Directory structure
```
agents/sub-agents/
  <agent-id>/
    soul.md      # identity, voice, never-violate values
    agent.md     # mission, model, token budget, operating loop, output schema, hard constraints
    skills.md    # tools, read/write access, explicit out-of-scope list
```

## Required frontmatter in agent.md
Every sub-agent's `agent.md` must include:
- `Model` — exact Claude model ID (e.g. `claude-sonnet-4-6`, `claude-haiku-4-5`)
- `Token budget` — input + output caps
- `Output schema` — what KeyPlayer expects back (so it can parse / forward)

## Template variables
Same as KeyPlayer — `{{CLIENT_NAME}}`, `{{OWNER_FIRST_NAME}}`, `{{OWNER_PHONE}}`, `{{CLIENT_DESCRIPTION}}` — pulled from `state/keyplayer/config.json` and interpolated at load time.

## How to add a new sub-agent
1. Create `agents/sub-agents/<your-agent-id>/`
2. Write soul.md, agent.md, skills.md following the `research-analyst` example
3. Register it in `src/lib/subagent.ts` → `SUBAGENT_REGISTRY` (add the entry with rate limit)
4. KeyPlayer's `spawn_subagent` tool auto-picks it up

## Existing sub-agents
| ID | Status | Purpose |
|---|---|---|
| `research-analyst` | ✅ built | Web research + citation-backed synthesis |
| `lead-research` | TBD | Prospect intel + ICP scoring |
| `content-writer` | TBD | Draft posts for IG / FB / X / LinkedIn / YouTube |
| `outreach-sender` | TBD | Draft email sequences (never sends) |
| `calendar-scheduler` | TBD | Propose meet times |
| `thumbnail-generator` | TBD | Visual covers for content |
| `hyperframes-agent` | TBD | Short-form video editing via HeyGen Hyperframes |
| `memory-compactor` | TBD | Roll up chat history into structured notes |
