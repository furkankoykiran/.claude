# MCP Server Management Reference

Full reference for adding and managing Model Context Protocol servers with Claude Code.

## Parameter Order (CRITICAL)

When adding MCP servers with environment variables, parameter order matters:

```bash
claude mcp add -s <scope> <name> -e <KEY=value> -- <command> [args...]
```

Environment variables (`-e`) must come **AFTER** the server name but **BEFORE** the `--` separator.

## Scope Levels

| Scope | Flag | Availability | Storage |
|---|---|---|---|
| Local (default) | (none) | Current project only | Local settings |
| User | `-s user` | All projects (global) | `~/.claude.json` |
| Project | `-s project` | Shared via git | `.mcp.json` |

## Transport Types

- **stdio** (default): Local process. Use `--transport stdio` or omit.
- **http**: Remote HTTP server. Use `--transport http <url>`.
- **sse**: Server-Sent Events. Use `--transport sse <url>`.

## Examples

```bash
# Stdio server with env vars (correct order!)
claude mcp add -s user myserver -e API_KEY=xxx -- npx -y my-mcp-server

# HTTP server
claude mcp add --transport http myserver https://api.example.com/mcp

# Multiple env vars
claude mcp add -s user myserver -e KEY1=val1 -e KEY2=val2 -- npx -y my-mcp-server
```

## Shortcut: `/add-mcp` skill

For JSON-configured servers, the `/add-mcp` skill handles the scope/flag ordering automatically.
