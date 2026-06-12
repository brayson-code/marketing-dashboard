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
| `content-cascade` | ✅ built | Repurpose one pillar piece into five platform-native drafts (X thread, LinkedIn, IG, Short beat sheet, newsletter) |
| `carousel-generator` | ✅ built | Turn a topic or pillar piece into a 6–10 slide IG/LinkedIn carousel script (hook → CTA) with per-slide visual notes for thumbnail-generator |
| `inbox-triage` | ✅ built | Triage inbound email batches into act_now / draft_reply / delegate / archive / spam with suggested replies — never sends |
| `client-onboarding-doc` | ✅ built | Draft the new-client onboarding doc (welcome, cadence, 30-day plan, access checklist, contacts, success metrics) |
| `scope-of-work` | ✅ built | Draft scope-of-work documents — itemized deliverables, explicit exclusions, milestones, placeholder pricing |
| `weekly-client-status` | ✅ built | Weekly client status report (wins / in-flight / blocked + asks / next week / metrics) from the week's structured context |
| `deliverable-qa` | ✅ built | Adversarial QA gate: ship/fix/redo verdict + scored rubric + line-level edits on any draft |
| `pipeline-review` | ✅ built | Pipeline snapshot review — stalled deals + unstick actions, stage red flags, weekly focus list, forecast |
| `sponsor-pitch` | ✅ built | Sponsor pitch one-pager from audience stats + brand-fit hypothesis — honest numbers, 3 packages, deck-ready |
| `community-pulse` | ✅ built | Digest community signals into a sentiment-temperature pulse: themes, reply-worthy members, content asks |
