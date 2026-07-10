import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { callRemoteTool, PACKAGE_VERSION, type RemoteToolOptions } from "./remote.js";
import { listCrawlDexTools } from "./tools.js";

export interface CrawlDexMcpServerOptions extends RemoteToolOptions {}

export function createCrawlDexMcpServer(options: CrawlDexMcpServerOptions = {}): Server {
  const server = new Server({
    name: "crawldex-mcp",
    version: PACKAGE_VERSION
  }, {
    capabilities: {
      tools: {}
    },
    instructions: "Read-only CrawlDex preflight tools. Call before an agent attempts a public website task; no API key is required and outcome writes are not exposed by this package."
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listCrawlDexTools()
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    return callRemoteTool(request.params.name, args, options);
  });

  return server;
}
