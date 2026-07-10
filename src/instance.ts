import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CHANNEL_EXACT = new Set(["npx", "hn", "newsletter", "awi", "unknown"]);
const CHANNEL_PREFIXES = ["registry-", "pack-", "adapter-", "readme-", "dataset-", "web-"];

export function crawldexClientHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const headers: Record<string, string> = {};
  const instanceId = readOrCreateInstanceId(env);
  if (instanceId) {
    headers["x-crawldex-instance"] = instanceId;
  }
  const channel = crawldexChannel(env);
  if (channel) {
    headers["x-crawldex-channel"] = channel;
  }
  return headers;
}

export function readOrCreateInstanceId(env: Record<string, string | undefined> = process.env): string | null {
  if (env.CRAWLDEX_NO_INSTANCE_ID === "1") {
    return null;
  }

  const filePath = instanceIdPath(env);
  if (!filePath) {
    return null;
  }

  try {
    const existing = readFileSync(filePath, "utf8").trim();
    if (UUID_PATTERN.test(existing)) {
      return existing.toLowerCase();
    }
  } catch {
    // Missing or unreadable config should not affect CrawlDex API behavior.
  }

  const nextId = randomUUID();
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${nextId}\n`, { mode: 0o600 });
    return nextId;
  } catch {
    return null;
  }
}

export function instanceIdPath(
  env: Record<string, string | undefined> = process.env,
  currentPlatform = platform()
): string | null {
  if (currentPlatform === "win32") {
    const appData = cleanEnv(env.APPDATA);
    return appData ? join(appData, "crawldex", "instance-id") : null;
  }

  const configRoot = cleanEnv(env.XDG_CONFIG_HOME) ?? join(cleanEnv(env.HOME) ?? homedir(), ".config");
  return configRoot ? join(configRoot, "crawldex", "instance-id") : null;
}

export function crawldexChannel(env: Record<string, string | undefined> = process.env): string | null {
  const channel = cleanEnv(env.CRAWLDEX_CHANNEL)?.toLowerCase();
  if (!channel || !CHANNEL_PATTERN.test(channel)) {
    return null;
  }
  if (CHANNEL_EXACT.has(channel) || CHANNEL_PREFIXES.some((prefix) => channel.startsWith(prefix))) {
    return channel;
  }
  return null;
}

function cleanEnv(value: string | undefined): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}
