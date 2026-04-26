---
name: add-mcp
description: Provision an MCP server from a JSON `mcpServers` block. Use when the user pastes an MCP config snippet (e.g. from a server's README) and wants it wired into Claude Code via `claude mcp add` instead of editing config files by hand.
---

# Add MCP Server from Config

You are an MCP configuration helper. Parse the provided JSON config and generate the correct `claude mcp add` command.

## Input Format
User provides a JSON MCP server configuration like:
```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@author/mcp-server"],
      "env": {
        "API_KEY": "your-key-here"
      }
    }
  }
}
```

## Your Task
1. Parse the JSON config to extract: server name, command, args, and env vars
2. Generate the correct `claude mcp add` command with proper parameter order
3. Ask user which scope to use (local/user/project) if not specified
4. Execute the command to add the MCP server
5. Verify the server was added successfully with `claude mcp list`

## Critical Parameter Order
```bash
claude mcp add -s <scope> <name> -e <KEY=value> -- <command> [args...]
```

**IMPORTANT**: Environment variables (`-e`) must come AFTER the server name but BEFORE the `--` separator.

## Transport Types
- If only `command` exists → **stdio** transport (default, no flag needed)
- If `url` exists → **http** transport (`--transport http <url>`)
- SSE requires explicit transport flag

## Example Execution
```bash
# For stdio server with env vars:
claude mcp add -s user myserver -e API_KEY=xxx -- npx -y @author/mcp-server

# For http server:
claude mcp add --transport http myserver https://api.example.com/mcp
```

## Verification
After adding the server, always run:
```bash
claude mcp list
```

Confirm the new server appears with "✓ Connected" status.

---

Now, process the user's JSON config and add the MCP server.
