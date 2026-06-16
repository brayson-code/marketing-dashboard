# MCP Servers

**MCP (Model Context Protocol) servers** let you plug additional tools directly into your agents. Connect a remote MCP server and your agents can automatically use the capabilities it provides — extra data sources, specialized APIs, custom business tools, or anything else an MCP server exposes.

![A connected MCP server — toggle it on to let your agents call its tools](images/connectors-mcp-1.png)

---

## What it is

MCP is an open standard for connecting AI agents to external tools and data. When you add an MCP server to KeyCommand:

- It appears as a **card** on the Connections page with a simple on/off toggle.
- When **enabled**, your agents can use that server's tools automatically — they see those capabilities alongside their built-in ones.
- When **disabled** (the default), the server is registered but completely inert — nothing changes in how your agents work.

Think of each MCP server as a plug-in that extends what your agents can do, without any code changes on your side.

---

## How to connect an MCP server

1. Open **Connections** from the left navigation.
2. Scroll to the **MCP Servers** section.
3. Click **Add MCP server**.
4. Enter the server details (typically a URL and any required auth credentials).
5. Click **Save**. The server appears as a card.
6. Flip the **toggle on** to activate it. Your agents can now use its tools.

The **Add MCP server** form asks for the server URL and any auth credentials it needs — paste them in and save, and the new server shows up as its own card.

---

## Enabling and disabling

The toggle on each MCP server card is the only switch you need:

- **On** — agents can use this server's tools on every run where they're relevant.
- **Off** — the server is saved but completely inactive. No agent calls it, and your workspace behaves as if it weren't there.

You can toggle freely at any time — turning a server off doesn't delete it, just pauses it.

---

## Good to know

- **Off by default.** Every new MCP server you add starts toggled off. Nothing changes until you flip it on deliberately.
- **Agents pick up tools automatically.** You don't need to configure which agents use which server — when a server is enabled, all your agents can use its tools if those tools are relevant to the task at hand.
- **One card per server.** If you need to connect multiple separate MCP servers, add each one individually. Each gets its own card and toggle.
- **Security note.** Only connect MCP servers you trust. An enabled server can receive context from your agents' requests, so treat it with the same care you'd give any API key or integration.

---

**Related:** [Connections](./connections.md) · [Agents & Agent Studio](./agents.md)
