# Cursor MCP Config

Add this server in Cursor's MCP settings. CrawlDex is read-only, requires no key, and should be called before an agent attempts a public website task.

```json
{
  "mcpServers": {
    "crawldex": {
      "command": "npx",
      "args": ["-y", "crawldex-mcp"],
      "env": {
        "CRAWLDEX_API_ORIGIN": "https://crawldex.com",
        "CRAWLDEX_CHANNEL": "pack-cursor"
      }
    }
  }
}
```

Privacy boundary: do not send passwords, cookies, MFA codes, private account data, payment data, screenshots, raw traces, or user-specific identifiers.
