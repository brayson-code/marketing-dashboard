# MCP Connector Hub — Design Doc (Tier B)

**Status:** Design only. No code shipped. Phase 3 Tier A (Google Workspace) is the prerequisite.
**Audience:** Internal engineering.

---

## The opportunity

Tier A hand-wires each integration as agent tools (Google Workspace → `google-tools.ts` module
with explicit function defs and a `handleGoogleTool()` dispatcher). That pattern works well for
known, stable integrations — but N8N users expect agents to act in *arbitrary* tooling. Asking a
power-user client to wait for us to hand-code every connector they need kills adoption.

The Anthropic Messages API already solves this. The `mcp_servers` beta parameter lets you declare
one or more remote MCP servers in the `messages.create` call. The model then initiates calls to
those servers like any other tool — the server handles execution, results come back as tool
results, and the loop continues without us writing a single tool handler. The hub generalises
the platform: tenants register their own MCP servers (N8N, Make, Zapier webhooks, internal APIs)
and every agent gets them for free.

---

## How it works end-to-end

### 1. Storage — per-tenant MCP server registry

Two options; start with option A.

**A. `business_profile` array** (no migration needed — follows the `autonomy.ts` get/set pattern):

```json
{
  "mcp_servers": [
    {
      "id": "uuid-v4",
      "label": "N8N workflows",
      "url": "https://my-n8n.example.com/mcp",
      "auth_token": "<encrypted>",
      "enabled": true,
      "read_only": true,
      "added_at": "2026-06-13T00:00:00Z"
    }
  ]
}
```

**B. Dedicated `tenant_mcp_servers` table** — preferred once we have >1 tenant actively using
this, because it supports RLS + per-server audit rows more cleanly. Migration deferred to Phase 4.

Auth tokens MUST be encrypted at rest. Use the same AES-256-GCM envelope already planned for
OAuth refresh tokens (track that with the Supabase Vault path or a KMS-backed env column — the
exact mechanism is out of scope here, but the constraint is hard: never store plaintext).

### 2. Injecting servers into `subagent.ts`

The only code change to the spawn loop is in the `turn()` closure inside `runSubAgent()` 
(`src/lib/subagent.ts` ~line 444). The `messages.create` call needs two additions:

```typescript
// Inside turn():
const stream = client.messages.stream({
  model: runModel,
  max_tokens: spec.maxTokens,
  system: [...],
  tools,
  messages,
  // MCP hub — only when the tenant has servers enabled for this agent type.
  ...(mcpServers.length > 0 && {
    betas: ['mcp-client-2025-04-04'],   // required beta header
    mcp_servers: mcpServers,
  }),
});
```

`mcpServers` is built before the `turn()` declaration:

```typescript
const mcpServers = await buildMcpServers(type);
// buildMcpServers() reads the tenant's registry, filters to enabled + opted-in for `type`,
// maps to { type: 'url', url, name, authorization_token? }
// Returns [] when the feature flag is off or no servers match.
```

`buildMcpServers()` lives in a new `src/lib/mcp-tools.ts` (parallel to `kg-tools.ts`). It does
not return `Anthropic.ToolUnion[]` — MCP servers are declared on the request, not in `tools[]`.
The model calls them; we never write a handler.

### 3. Tool-result flow

When the model calls an MCP tool, the `stop_reason` is `tool_use` with `type: 'tool_use'` blocks
whose `name` is prefixed by the server's `name` field (e.g. `n8n__send_slack_message`). The
Anthropic SDK automatically routes the call to the declared MCP server URL and injects the result
back — this is the "native" MCP client path, distinct from our `handledToolUses` filter at line
~545. **We do not need to add these tool names to the `handledToolUses` filter.** The SDK loop
handles MCP round-trips transparently; our `handledToolUses` guard for `kg_query / kg_remember /
recall_skill` is orthogonal.

> **Implication:** the loop safety counter (`maxTurns`) still caps total turns. MCP tool calls
> consume turns exactly like local tool calls. No special handling needed.

### 4. Gating — same philosophy as Tier A

Tier A Google tools are gated by (a) connection exists in `connections` table, (b) per-agent
opt-in. MCP servers follow the same two-gate pattern:

| Gate | Implementation |
|---|---|
| Server registered + enabled | `business_profile.mcp_servers[].enabled` |
| Per-agent opt-in | `business_profile.mcp_agent_opts[agentType][serverId] = true` |

`buildMcpServers(agentType)` enforces both. Default = **off for all agents**. The tenant enables
each server per-agent explicitly in Agent Studio (same UX as the Google tools toggle planned for
Tier A).

### 5. Audit

Every MCP tool call must be logged. Because MCP calls are model-initiated and the SDK handles
them, we audit at the *result* boundary — after each `turn()` call, inspect `response.content`
for `tool_use` blocks whose `name` contains `__` (MCP namespace separator) and write an
`activity_log` row via `logAudit()` (`src/lib/audit.ts`):

```
actor: agentType, action: 'mcp_tool_call',
target: toolName (e.g. 'n8n__trigger_workflow'),
detail: { server_id, input_summary }
```

This is a thin post-turn scan — ~5 lines added to the main loop after `response = await turn()`.

---

## Approval gate for write-capable servers

Read-only MCP servers (list files, read sheets, search docs) are low-risk: enable them freely.
Write/destructive servers (send message, update CRM record, trigger automation) follow the same
approval-gate question as Tier A outbound actions:

> "This action will be executed immediately. Approve?"

Implementation options, in order of build complexity:

1. **`read_only` flag on the server row** — the tenant declares this when registering. We trust
   the flag; no runtime inspection. Simple, ships first.
2. **Tool-name allowlist** — tenant specifies which tool names are auto-approved vs. require a
   draft. Stored in `business_profile`. More granular, Phase 4.
3. **Post-call reversal window** — a 5-minute undo queue for write MCP calls, analogous to the
   draft approval flow. Complex; defer indefinitely.

**Ship option 1 first.** Mark every new server `read_only: false` by default; the Connect UI
must require the tenant to check "read-only mode" before the server is activated, or explicitly
acknowledge "this server can take actions."

For `read_only: false` servers, apply the autonomy gate (`src/lib/autonomy.ts gateOutbound()`)
before calling `turn()` — treat MCP-write calls as `other` draft type unless a more specific
mapping exists. This blocks them in `observe` mode and queues them for approval in `propose`
mode. Implementation: `buildMcpServers()` omits non-read-only servers when `autonomy === 'observe'`
and flags them so the turn result is intercepted and queued rather than auto-executed.

---

## Connect UI — "Add MCP server" entry

The Connections page (same surface as Nango OAuth providers) gets a new card:

- Label: "MCP Server"
- Fields: Display name, Server URL, Auth token (optional, written encrypted), Read-only toggle
- On save: writes to `business_profile.mcp_servers[]`, fires `logAudit` with `action: 'mcp_server_added'`
- Status indicator: a `GET <url>/health` ping (or the MCP `list_tools` handshake) to confirm reachability before enabling

No Nango involvement — MCP is a direct HTTP connection from the Anthropic API to the server URL.

---

## Phasing

### Phase 3.5 (next, read-only first)
- `src/lib/mcp-tools.ts` — `buildMcpServers()`, business_profile read/write helpers
- `subagent.ts` — inject `mcp_servers` + beta header into `turn()`; post-turn audit scan
- Connect UI — add MCP server form (read-only mode only, enforced)
- Per-agent opt-in toggle in Agent Studio

### Phase 4 (write-capable, requires approval gate wiring)
- Write-capable servers with autonomy gate integration
- `tenant_mcp_servers` table + RLS (replace business_profile array)
- Tool-name allowlist per server
- `mcp_server_removed` / `mcp_server_disabled` audit events

---

## Precedents in this codebase

- **Tool module pattern:** `src/lib/kg-tools.ts` (definitions + handler) and `src/lib/skill-recall.ts` (definitions only, handler inline). `mcp-tools.ts` is definitions + `buildMcpServers()` only — no handler.
- **Nango proxy pattern:** `src/lib/youtube.ts` → `src/lib/nango.ts`. MCP does not use Nango; the URL + token go directly into the Anthropic request.
- **Gating pattern:** `src/lib/autonomy.ts gateOutbound()`. Reuse for write servers.
- **Audit:** `src/lib/audit.ts logAudit()`. One call per MCP tool_use block detected post-turn.
- **business_profile R/W:** `src/lib/autonomy.ts getAutonomyConfig() / setAutonomyConfig()` — same jsonb update pattern for `mcp_servers` array.
