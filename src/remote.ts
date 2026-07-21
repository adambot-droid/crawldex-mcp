import { createRequire } from "node:module";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { crawldexClientHeaders } from "./instance.js";
import { isCrawlDexToolName } from "./tools.js";

export const DEFAULT_API_ORIGIN = "https://api.crawldex.com";
export const FALLBACK_API_ORIGINS = [
  "https://api.crawldex.com",
  "https://crawldex.com",
  "https://crawldex.vercel.app"
] as const;
export const DEFAULT_TIMEOUT_MS = 5_000;
export const ECHO_ACTIONS = ["followed", "overrode", "partial"] as const;

const require = createRequire(import.meta.url);
const packageInfo = require("../package.json") as { version?: string };

export const PACKAGE_VERSION = packageInfo.version ?? "0.0.0";
const ECHO_RECORD_ID_PATTERN = /^atr_[0-9a-f]{16}$/;

type FetchLike = typeof fetch;

export interface RemoteToolOptions {
  apiOrigin?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

export async function callRemoteTool(
  name: string,
  args: Record<string, unknown> = {},
  options: RemoteToolOptions = {}
): Promise<CallToolResult> {
  if (!isCrawlDexToolName(name)) {
    return errorResult(`CrawlDex MCP tool is not available in this read-only package: ${name}`);
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return errorResult("CrawlDex MCP cannot call the API because fetch is unavailable in this Node runtime.");
  }

  if (name === "get_trust_record") {
    return callTrustRecordTool(args, { ...options, fetchImpl });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const response = await fetchAcrossOrigins(fetchImpl, "/mcp", {
      method: "POST",
      headers: {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        "user-agent": `crawldex-mcp/${PACKAGE_VERSION}`,
        ...crawldexClientHeaders()
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `crawldex-mcp-${Date.now()}`,
        method: "tools/call",
        params: {
          name,
          arguments: args
        }
      })
    }, options.apiOrigin, timeoutMs);

    if (!response.ok) {
      return errorResult(`CrawlDex MCP API returned HTTP ${response.status}.`);
    }

    const payload = parseJsonRpcResponse(await response.text());
    if (payload.error) {
      return errorResult(payload.error.message ?? `CrawlDex MCP API returned JSON-RPC error ${payload.error.code ?? "unknown"}.`);
    }

    const result = normalizeToolResult(payload.result);
    if (!result.isError) {
      await emitDecisionEcho(args, { ...options, fetchImpl });
    }
    return result;
  } catch (error) {
    if (isAbortError(error)) {
      return errorResult(`CrawlDex MCP request timed out after ${timeoutMs}ms.`);
    }

    return errorResult(`CrawlDex MCP request failed: ${oneLine(error instanceof Error ? error.message : String(error))}`);
  }
}

async function callTrustRecordTool(args: Record<string, unknown>, options: RemoteToolOptions & { fetchImpl: FetchLike }): Promise<CallToolResult> {
  const site = stringArg(args.site) ?? stringArg(args.origin);
  if (!site) {
    return errorResult("get_trust_record requires a site string.");
  }

  const task = stringArg(args.task);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const response = await fetchAcrossOrigins(options.fetchImpl, trustRecordPath(site, task), {
      method: "GET",
      headers: {
        "accept": "application/json",
        "user-agent": `crawldex-mcp/${PACKAGE_VERSION}`,
        ...crawldexClientHeaders()
      }
    }, options.apiOrigin, timeoutMs);

    if (!response.ok) {
      return errorResult(`CrawlDex trust-record API returned HTTP ${response.status}.`);
    }

    const record = parseTrustRecordResponse(await response.text());
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(record, null, 2)
        }
      ],
      structuredContent: record
    };
  } catch (error) {
    if (isAbortError(error)) {
      return errorResult(`CrawlDex trust-record request timed out after ${timeoutMs}ms.`);
    }

    return errorResult(`CrawlDex trust-record request failed: ${oneLine(error instanceof Error ? error.message : String(error))}`);
  }
}

function trustRecordPath(site: string, task: string | undefined): string {
  const base = `/api/v1/trust-record/${encodeURIComponent(site)}`;
  return task ? `${base}/${encodeURIComponent(task)}` : base;
}

async function emitDecisionEcho(
  args: Record<string, unknown>,
  options: RemoteToolOptions & { fetchImpl: FetchLike }
): Promise<void> {
  const recordId = stringArg(args.record_id) ?? stringArg(args.recordId);
  if (!recordId || !ECHO_RECORD_ID_PATTERN.test(recordId)) {
    return;
  }

  const action = echoActionArg(args.action_taken) ?? echoActionArg(args.echo_action) ?? echoActionArg(args.echoAction) ?? "followed";
  const taskAttempted = typeof args.task_attempted === "boolean"
    ? args.task_attempted
    : typeof args.taskAttempted === "boolean"
      ? args.taskAttempted
      : true;
  if ("removed_in_batch" in args && typeof args.removed_in_batch !== "boolean") {
    return;
  }
  const removedInBatch = typeof args.removed_in_batch === "boolean"
    ? args.removed_in_batch
    : undefined;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const payload: Record<string, string | boolean> = {
    record_id: recordId,
    action_taken: action,
    task_attempted: taskAttempted
  };
  if (removedInBatch !== undefined) {
    payload.removed_in_batch = removedInBatch;
  }

  try {
    await fetchAcrossOrigins(options.fetchImpl, "/api/v1/echo", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "user-agent": `crawldex-mcp/${PACKAGE_VERSION}`,
        ...crawldexClientHeaders()
      },
      body: JSON.stringify(payload)
    }, options.apiOrigin, timeoutMs);
  } catch {
    // Echo measures CrawlDex guidance usefulness. It must never alter tool output.
  }
}

async function fetchAcrossOrigins(
  fetchImpl: FetchLike,
  path: string,
  init: RequestInit,
  apiOrigin: string | undefined,
  timeoutMs: number
): Promise<Response> {
  const origins = apiOriginCandidates(apiOrigin);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (let index = 0; index < origins.length; index += 1) {
    const origin = origins[index];
    const remainingMs = deadline - Date.now();
    if (timeoutMs > 0 && remainingMs <= 0) {
      throw timeoutError(timeoutMs);
    }

    try {
      const response = await fetchWithDeadline(fetchImpl, `${origin}${path}`, init, timeoutMs > 0 ? remainingMs : timeoutMs);
      if (await isChallengeResponse(response) && index < origins.length - 1) {
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (isAbortError(error) || index === origins.length - 1) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchWithDeadline(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (timeoutMs <= 0) {
    return fetchImpl(url, init);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(timeoutError(timeoutMs)), timeoutMs);
  timeout.unref?.();

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function apiOriginCandidates(apiOrigin: string | undefined): string[] {
  const configured = normalizeOrigin(apiOrigin ?? process.env.CRAWLDEX_API_ORIGIN);
  const defaults = FALLBACK_API_ORIGINS.map((origin) => normalizeOrigin(origin)).filter((origin): origin is string => Boolean(origin));
  return configured ? [configured, ...defaults.filter((origin) => origin !== configured)] : defaults;
}

async function isChallengeResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false;
  }
  const mitigated = cleanHeader(response.headers.get("x-vercel-mitigated"));
  if (mitigated !== "none") {
    return true;
  }
  try {
    const body = await response.clone().text();
    return /vercel/i.test(body) && /(security checkpoint|challenge|bot protection)/i.test(body);
  } catch {
    return false;
  }
}

function normalizeOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch {
    return null;
  }
}

function cleanHeader(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed || "none";
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`CrawlDex request timed out after ${timeoutMs}ms.`);
  error.name = "AbortError";
  return error;
}

function parseJsonRpcResponse(text: string): JsonRpcResponse {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isObject(parsed)) {
      throw new Error("response was not a JSON object");
    }
    return parsed as JsonRpcResponse;
  } catch (error) {
    throw new Error(`Malformed CrawlDex MCP response: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseTrustRecordResponse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isPlainRecord(parsed) || parsed.atr_version !== "0.1" || typeof parsed.record_id !== "string") {
      throw new Error("response was not an Agent Trust Record object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Malformed CrawlDex trust-record response: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeToolResult(result: unknown): CallToolResult {
  if (!isObject(result)) {
    return errorResult("Malformed CrawlDex MCP response: missing result object.");
  }

  if (!Array.isArray(result.content) || !result.content.every(isSupportedContent)) {
    return errorResult("Malformed CrawlDex MCP response: missing valid tool content.");
  }

  const output: CallToolResult = {
    content: result.content,
    isError: result.isError === true
  };

  if (isPlainRecord(result.structuredContent)) {
    output.structuredContent = result.structuredContent;
  }

  return output;
}

function errorResult(reason: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: oneLine(reason)
      }
    ]
  };
}

function stringArg(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function echoActionArg(value: unknown): (typeof ECHO_ACTIONS)[number] | undefined {
  return typeof value === "string" && (ECHO_ACTIONS as readonly string[]).includes(value)
    ? value as (typeof ECHO_ACTIONS)[number]
    : undefined;
}

function isSupportedContent(value: unknown): value is CallToolResult["content"][number] {
  return isObject(value)
    && value.type === "text"
    && typeof value.text === "string";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
