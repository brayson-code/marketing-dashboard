// MCP HUB — bridge between the tenant's connected MCP servers (mcp-store) and the
// Anthropic Messages API MCP connector. Anthropic discovers + EXECUTES the MCP
// tools SERVER-SIDE (like web_search) and returns mcp_tool_use / mcp_tool_result
// content blocks; we never run them ourselves and the tool-use loop must NOT treat
// those blocks as unknown tools that break the turn.
//
// SAFETY CONTRACT (the whole point of this module):
//   - When the tenant has NO enabled MCP server (the default + common case),
//     buildMcpConfig() returns null. Callers MUST then send the EXACT request they
//     sent before this feature existed — no mcp_servers, no beta header, no
//     mcp_toolset, no behavior change.
//   - buildMcpConfig() NEVER throws. Any failure (DB, decrypt, shape drift) returns
//     null so a bad beta-API config can never break an existing agent run.
//
// Beta shape: current connector beta is `mcp-client-2025-11-20`, which pairs each
// server in `mcp_servers` with an `mcp_toolset` entry in `tools` (every server must
// be referenced by exactly one toolset). The installed SDK (0.97.0) types both, and
// `client.beta.messages.create({ ..., betas: [MCP_BETA] })` carries the header.

import type Anthropic from '@anthropic-ai/sdk';
import { enabledMcpServers } from './mcp-store';

// Current MCP connector beta. The SDK ships this string as an AnthropicBeta value.
export const MCP_BETA = 'mcp-client-2025-11-20';

// Matches the SDK's BetaRequestMCPServerURLDefinition (type:'url' is required).
type McpServerDef = Anthropic.Beta.Messages.BetaRequestMCPServerURLDefinition;

export interface McpConfig {
  // Spread onto the messages.create params alongside the existing model/tools/etc.
  mcp_servers: McpServerDef[];
  // mcp_toolset entries — one per server — APPENDED to the caller's existing tools.
  toolsets: Array<{ type: 'mcp_toolset'; mcp_server_name: string }>;
  // Names actually sent, for best-effort audit.
  serverNames: string[];
}

/**
 * Build the per-tenant MCP connector config, or null when there's nothing to add.
 * NEVER throws — on any error the caller falls back to the unmodified request.
 */
export async function buildMcpConfig(): Promise<McpConfig | null> {
  try {
    const servers = await enabledMcpServers();
    if (!servers.length) return null; // common case: keep the request byte-identical

    // Each MCP server name must be referenced by exactly one mcp_toolset. Server
    // names come from tenant input; de-dupe defensively so a duplicate name can't
    // make the API reject the whole request (which would lose the fallback's value
    // since the throw is caught here and degrades to the normal call).
    const seen = new Set<string>();
    const mcp_servers: McpServerDef[] = [];
    for (const s of servers) {
      if (!s.name || !s.url || seen.has(s.name)) continue;
      seen.add(s.name);
      // type:'url' is required by the SDK's BetaRequestMCPServerURLDefinition.
      const def: McpServerDef = { type: 'url', name: s.name, url: s.url };
      if (s.authorization_token) def.authorization_token = s.authorization_token;
      mcp_servers.push(def);
    }
    if (!mcp_servers.length) return null;

    return {
      mcp_servers,
      toolsets: mcp_servers.map((s) => ({ type: 'mcp_toolset' as const, mcp_server_name: s.name })),
      serverNames: mcp_servers.map((s) => s.name),
    };
  } catch {
    return null; // fail safe — never break an agent run on MCP config
  }
}

// Type guards for the server-side MCP content blocks. The tool-use loop uses these
// to recognize that a turn touched MCP (so it doesn't mistake mcp_tool_use for an
// unhandled user tool and bail) — execution already happened server-side.
export function isMcpBlock(block: Anthropic.Messages.ContentBlock | { type?: string }): boolean {
  const t = (block as { type?: string }).type;
  return t === 'mcp_tool_use' || t === 'mcp_tool_result';
}

export function hasMcpBlock(content: ReadonlyArray<{ type?: string }>): boolean {
  return content.some(isMcpBlock);
}
