import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCrawlDexMcpServer } from "./server.js";
import { PACKAGE_VERSION } from "./remote.js";
import { CRAWLDEX_TOOLS } from "./tools.js";

const apiOrigin = "https://api.test";
let testHome: string | null = null;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "crawldex-mcp-test-"));
  vi.stubEnv("HOME", testHome);
  vi.stubEnv("XDG_CONFIG_HOME", join(testHome, ".config"));
  vi.stubEnv("APPDATA", join(testHome, "AppData", "Roaming"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (testHome) {
    rmSync(testHome, { recursive: true, force: true });
    testHome = null;
  }
});

describe("crawldex-mcp stdio server", () => {
  it("serves tools/list from the live-origin parity fixture", async () => {
    const fetchMock = vi.fn();
    const harness = await createHarness(fetchMock);

    try {
      const list = await harness.client.listTools();
      expect(list.tools).toEqual(CRAWLDEX_TOOLS);
      expect(list.tools.map((tool) => tool.name)).toContain("get_trust_record");
      expect(list.tools.find((tool) => tool.name === "get_trust_record")?.description)
        .toMatch(/^Call BEFORE an agent attempts any public-website task/);
      for (const toolName of ["preflight", "check_site_task"]) {
        const schema = list.tools.find((tool) => tool.name === toolName)?.inputSchema;
        expect(schema?.properties).toMatchObject({
          removed_in_batch: { type: "boolean" }
        });
        expect(schema?.required ?? []).not.toContain("removed_in_batch");
      }
      expect(list.tools.map((tool) => tool.name)).not.toContain("report_outcome");
      expect(list.tools.map((tool) => tool.name)).not.toContain("submit_observation");
    } finally {
      await harness.close();
    }
  });

  it("proxies every read-only tool call through the public MCP API", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith(`${apiOrigin}/api/v1/trust-record/`)) {
        return jsonResponse({
          atr_version: "0.1",
          site: "netflix.com",
          task: "subscriptions.cancel",
          issued_at: "2026-07-02T12:00:00.000Z",
          record_id: "atr_0123456789abcdef",
          verdict: "user_needed",
          confidence: 0.63
        });
      }

      const body = JSON.parse(String(init?.body)) as { params: { name: string; arguments: Record<string, unknown> } };
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                tool: body.params.name,
                args: body.params.arguments
              })
            }
          ],
          structuredContent: {
            tool: body.params.name,
            args: body.params.arguments
          }
        }
      });
    });
    const harness = await createHarness(fetchMock);

    try {
      for (const tool of CRAWLDEX_TOOLS) {
        const args = sampleArgs(tool.name);
        const result = await harness.client.callTool({
          name: tool.name,
          arguments: args
        }) as CallToolResult;

        expect(result.isError).not.toBe(true);
        if (tool.name === "get_trust_record") {
          expect(result.structuredContent).toMatchObject({
            atr_version: "0.1",
            record_id: "atr_0123456789abcdef"
          });
        } else {
          expect(result.structuredContent).toEqual({
            tool: tool.name,
            args
          });
        }
      }

      expect(fetchMock).toHaveBeenCalledTimes(CRAWLDEX_TOOLS.length);
      const mcpCall = fetchMock.mock.calls.find(([url]) => String(url) === `${apiOrigin}/mcp`) as [string, RequestInit] | undefined;
      const trustRecordCall = fetchMock.mock.calls.find(([url]) => String(url) === `${apiOrigin}/api/v1/trust-record/netflix.com/subscriptions.cancel`) as [string, RequestInit] | undefined;
      expect(mcpCall).toBeDefined();
      expect(trustRecordCall).toBeDefined();
      expect(mcpCall?.[1].headers).toMatchObject({
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        "user-agent": `crawldex-mcp/${PACKAGE_VERSION}`,
        "x-crawldex-instance": expect.stringMatching(/^[0-9a-f-]{36}$/)
      });
      expect(trustRecordCall?.[1].headers).toMatchObject({
        "accept": "application/json",
        "user-agent": `crawldex-mcp/${PACKAGE_VERSION}`,
        "x-crawldex-instance": expect.stringMatching(/^[0-9a-f-]{36}$/)
      });
    } finally {
      await harness.close();
    }
  });

  it("returns an MCP isError result when the API request times out", async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      })
    );
    const harness = await createHarness(fetchMock, { timeoutMs: 10 });

    try {
      const result = await harness.client.callTool({
        name: "resolve_intent",
        arguments: { query: "cancel my subscription" }
      }) as CallToolResult;

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "CrawlDex MCP request timed out after 10ms."
      });
    } finally {
      await harness.close();
    }
  });

  it("falls back to the Plan B origin chain on Vercel challenge responses", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === `${apiOrigin}/mcp`) {
        return new Response("<html>Vercel Security Checkpoint challenge</html>", {
          status: 403,
          headers: {
            "content-type": "text/html",
            "x-vercel-mitigated": "challenge"
          }
        });
      }

      if (String(url) === "https://api.crawldex.com/mcp") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: "ok" }],
            structuredContent: { ok: true }
          }
        });
      }

      throw new Error(`unexpected URL ${String(url)}`);
    });
    const harness = await createHarness(fetchMock);

    try {
      const result = await harness.client.callTool({
        name: "resolve_intent",
        arguments: { query: "cancel my subscription" }
      }) as CallToolResult;

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ ok: true });
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        `${apiOrigin}/mcp`,
        "https://api.crawldex.com/mcp"
      ]);
    } finally {
      await harness.close();
    }
  });

  it("does not fail over after an ordinary HTTP error response", async () => {
    const fetchMock = vi.fn(async () => new Response("server failed", { status: 500 }));
    const harness = await createHarness(fetchMock);

    try {
      const result = await harness.client.callTool({
        name: "resolve_intent",
        arguments: { query: "cancel my subscription" }
      }) as CallToolResult;

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "CrawlDex MCP API returned HTTP 500."
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`${apiOrigin}/mcp`);
    } finally {
      await harness.close();
    }
  });

  it("emits a decision echo when a follow-up tool carries record_id", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === `${apiOrigin}/api/v1/echo`) {
        return jsonResponse({ status: "accepted" });
      }
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "ok" }],
          structuredContent: { ok: true }
        }
      });
    });
    const harness = await createHarness(fetchMock);

    try {
      const result = await harness.client.callTool({
        name: "preflight",
        arguments: {
          site: "netflix.com",
          task: "subscriptions.cancel",
          record_id: "atr_0123456789abcdef",
          echo_action: "partial",
          task_attempted: false,
          removed_in_batch: true
        }
      }) as CallToolResult;

      expect(result.isError).not.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`${apiOrigin}/mcp`);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`${apiOrigin}/api/v1/echo`);
      expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
        "accept": "application/json",
        "content-type": "application/json",
        "user-agent": `crawldex-mcp/${PACKAGE_VERSION}`
      });
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
        record_id: "atr_0123456789abcdef",
        action_taken: "partial",
        task_attempted: false,
        removed_in_batch: true
      });
    } finally {
      await harness.close();
    }
  });

  it("skips a decision echo when removed_in_batch is not boolean", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { ok: true }
      }
    }));
    const harness = await createHarness(fetchMock);

    try {
      const result = await harness.client.callTool({
        name: "preflight",
        arguments: {
          site: "netflix.com",
          task: "subscriptions.cancel",
          record_id: "atr_0123456789abcdef",
          removed_in_batch: "removed because of private details"
        }
      }) as CallToolResult;

      expect(result.isError).not.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });

  it("persists anonymous instance IDs and sends safe channel headers", async () => {
    vi.stubEnv("CRAWLDEX_CHANNEL", "Registry-Official");
    const fetchMock = vi.fn(async () => jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { ok: true }
      }
    }));
    const harness = await createHarness(fetchMock);

    try {
      await harness.client.callTool({
        name: "resolve_intent",
        arguments: { query: "cancel a subscription" }
      });
      await harness.client.callTool({
        name: "list_tasks",
        arguments: { category: "subscriptions" }
      });

      const headers = fetchMock.mock.calls.map(([, init]) => init?.headers as Record<string, string>);
      expect(headers[0]?.["x-crawldex-instance"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(headers[1]?.["x-crawldex-instance"]).toBe(headers[0]?.["x-crawldex-instance"]);
      expect(headers[0]?.["x-crawldex-channel"]).toBe("registry-official");
      expect(existsSync(join(testHome ?? "", ".config", "crawldex", "instance-id"))).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("omits anonymous instance IDs without suppressing decision echo when opted out", async () => {
    vi.stubEnv("CRAWLDEX_NO_INSTANCE_ID", "1");
    const fetchMock = vi.fn(async () => jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { ok: true }
      }
    }));
    const harness = await createHarness(fetchMock);

    try {
      const result = await harness.client.callTool({
        name: "preflight",
        arguments: {
          site: "netflix.com",
          task: "subscriptions.cancel",
          record_id: "atr_0123456789abcdef"
        }
      }) as CallToolResult;

      expect(result.isError).not.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`${apiOrigin}/mcp`);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`${apiOrigin}/api/v1/echo`);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty("x-crawldex-instance");
      expect(fetchMock.mock.calls[1]?.[1]?.headers).not.toHaveProperty("x-crawldex-instance");
      expect(existsSync(join(testHome ?? "", ".config", "crawldex", "instance-id"))).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("degrades silently when the instance config path is unavailable", async () => {
    if (!testHome) {
      throw new Error("test home was not initialized");
    }
    const blockedConfigPath = join(testHome, "not-a-directory");
    writeFileSync(blockedConfigPath, "");
    vi.stubEnv("XDG_CONFIG_HOME", blockedConfigPath);
    const fetchMock = vi.fn(async () => jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { ok: true }
      }
    }));
    const harness = await createHarness(fetchMock);

    try {
      const result = await harness.client.callTool({
        name: "resolve_intent",
        arguments: { query: "cancel my subscription" }
      }) as CallToolResult;

      expect(result.isError).not.toBe(true);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty("x-crawldex-instance");
    } finally {
      await harness.close();
    }
  });

  it("returns an MCP isError result for malformed API responses", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        unexpected: true
      }
    }));
    const harness = await createHarness(fetchMock);

    try {
      const result = await harness.client.callTool({
        name: "resolve_intent",
        arguments: { query: "cancel my subscription" }
      }) as CallToolResult;

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "Malformed CrawlDex MCP response: missing valid tool content."
      });
    } finally {
      await harness.close();
    }
  });
});

async function createHarness(
  fetchMock: typeof fetch,
  options: { timeoutMs?: number } = {}
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCrawlDexMcpServer({
    apiOrigin,
    fetchImpl: fetchMock,
    timeoutMs: options.timeoutMs
  });
  const client = new Client({
    name: "crawldex-mcp-test",
    version: "0.0.0"
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await client.close();
      await server.close();
    }
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function sampleArgs(name: string): Record<string, unknown> {
  switch (name) {
    case "resolve_intent":
      return { query: "cancel my subscription" };
    case "list_tasks":
      return { category: "subscriptions" };
    case "describe_task":
      return { task: "subscriptions.cancel" };
    case "get_scoring_rubric":
      return {};
    case "get_alternatives":
      return {
        query: "cancel a streaming subscription",
        task: "subscriptions.cancel",
        requires: ["self_service"],
        excludeOrigin: "netflix.com"
      };
    case "check_protocol_support":
      return { site: "example.com" };
    default:
      return {
        site: "netflix.com",
        task: "subscriptions.cancel",
        agent_profile: {
          stack: "vitest"
        }
      };
  }
}
