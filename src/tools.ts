import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const CRAWLDEX_TOOLS: Tool[] = [
  {
    name: "get_trust_record",
    description: "Call BEFORE an agent attempts any public-website task to retrieve the Agent Trust Record verdict, confidence, blockers, user-present requirements, evidence links, and dispute link.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string" },
        origin: { type: "string" },
        task: { type: "string" },
        agent_profile: { type: ["object", "string"] }
      },
      additionalProperties: true,
      required: ["site"]
    }
  },
  {
    name: "check_site_task",
    description: "Alias for preflight. Call this BEFORE an agent attempts a public website task to decide proceed, use guardrails, keep the user present, avoid stale evidence, or choose an alternative.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string" },
        origin: { type: "string" },
        task: { type: "string" },
        agent_profile: { type: ["object", "string"] },
        removed_in_batch: { type: "boolean" }
      },
      additionalProperties: true
    }
  },
  {
    name: "get_agent_blockers",
    description: "Call this BEFORE browser execution when a site-task may involve login, checkout, cancellation, refund, form submission, booking, support, or account changes. Returns observed blockers and who must handle them.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string" },
        origin: { type: "string" },
        task: { type: "string" },
        agent_profile: { type: ["object", "string"] }
      },
      additionalProperties: true
    }
  },
  {
    name: "get_success_signals",
    description: "Call this BEFORE and DURING a website task to know which public success signals and guardrails prove the agent is still on the right route.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string" },
        origin: { type: "string" },
        task: { type: "string" },
        agent_profile: { type: ["object", "string"] }
      },
      additionalProperties: true
    }
  },
  {
    name: "get_scoring_rubric",
    description: "Call this when an agent or developer needs to justify CrawlDex verdicts. Returns AES bands, freshness gates, confidence gates, friction penalties, and reporting fields.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true
    }
  },
  {
    name: "preflight",
    description: "Call this BEFORE attempting any public website task. It returns whether to proceed, use guardrails, keep the user present, avoid stale evidence, or use an alternative, plus why calling CrawlDex matters.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string" },
        origin: { type: "string" },
        task: { type: "string" },
        agent_profile: { type: ["object", "string"] },
        removed_in_batch: { type: "boolean" }
      },
      additionalProperties: true
    }
  },
  {
    name: "get_recipe",
    description: "Call this BEFORE executing a known site-task to fetch recipe hints, guardrails, and success signals if CrawlDex has a known-good route.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string" },
        origin: { type: "string" },
        task: { type: "string" },
        agent_profile: { type: ["object", "string"] }
      },
      additionalProperties: true
    }
  },
  {
    name: "get_alternatives",
    description: "Call this when preflight says avoid, user-present, stale, blocked, or low confidence. Returns alternative sites for the same task.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        task: { type: "string" },
        requires: { type: "array", items: { type: "string" } },
        excludeOrigin: { type: "string" }
      },
      additionalProperties: true
    }
  },
  {
    name: "resolve_intent",
    description: "Call this FIRST when the user gives a plain-language web task. It maps the request to CrawlDex task keys before preflight.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      additionalProperties: true,
      required: ["query"]
    }
  },
  {
    name: "list_tasks",
    description: "Call this when an agent needs to discover which website task keys CrawlDex can preflight, optionally by category.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" }
      },
      additionalProperties: true
    }
  },
  {
    name: "describe_task",
    description: "Call this BEFORE choosing a website for a task. It describes task success criteria, evidence, blockers, posture, and known sites.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" }
      },
      additionalProperties: true,
      required: ["task"]
    }
  },
  {
    name: "check_protocol_support",
    description: "Call this before integrating with a site through protocols instead of browser automation. Returns locally known ACP/AP2/MCP/x402 support.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string" },
        origin: { type: "string" }
      },
      additionalProperties: true
    }
  },
  {
    name: "explain_blockers",
    description: "Call this when preflight returns blockers or a human-present recommendation. Explains why the route may fail and what to watch for.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string" },
        origin: { type: "string" },
        task: { type: "string" },
        agent_profile: { type: ["object", "string"] }
      },
      additionalProperties: true
    }
  }
];

export function listCrawlDexTools(): Tool[] {
  return CRAWLDEX_TOOLS.map((tool) => ({
    ...tool,
    inputSchema: { ...tool.inputSchema }
  }));
}

export function isCrawlDexToolName(name: string): boolean {
  return CRAWLDEX_TOOLS.some((tool) => tool.name === name);
}
