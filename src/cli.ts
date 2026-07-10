#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createRequire } from "node:module";

import { createCrawlDexMcpServer } from "./server.js";

const require = createRequire(import.meta.url);
const packageInfo = require("../package.json") as { version?: string };
const packageVersion = packageInfo.version ?? "0.0.0";

const help = `crawldex-mcp ${packageVersion}

Read-only CrawlDex MCP stdio server.

Usage:
  crawldex-mcp

Environment:
  CRAWLDEX_API_ORIGIN  Pin the first CrawlDex API origin. Default chain:
                       https://api.crawldex.com -> https://crawldex.com -> https://crawldex.vercel.app.

The server exposes public read tools only. Call them before an agent attempts a public website task.
`;

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(help);
    return;
  }

  const server = createCrawlDexMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
