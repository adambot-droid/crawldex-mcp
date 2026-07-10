# VS Code MCP Config

Add this to `.vscode/mcp.json`. CrawlDex is read-only, requires no key, and should be called before an agent attempts a public website task.

```json
{
  "servers": {
    "crawldex": {
      "command": "npx",
      "args": ["-y", "crawldex-mcp"],
      "env": {
        "CRAWLDEX_API_ORIGIN": "https://crawldex.com",
        "CRAWLDEX_CHANNEL": "pack-vscode"
      }
    }
  }
}
```

Privacy boundary: do not send passwords, cookies, MFA codes, private account data, payment data, screenshots, raw traces, or user-specific identifiers.
