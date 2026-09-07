import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SupportedHost } from "./detect.ts";

export interface WireCronOptions {
  readonly host: SupportedHost;
  readonly room: string;
  readonly homeDir?: string;
  readonly repoRoot?: string;
}

export interface WireCronResult {
  readonly mechanism: "schedule" | "settings_hooks" | "notify_hook" | "self_watchdog";
  readonly expression: string | null;
  readonly cadence_seconds: number;
  readonly configPath?: string | null;
}

function wireAntigravityCron(homeDir: string, room: string): WireCronResult {
  const schedulePath = join(homeDir, ".antigravity", "schedules", `communicator-${room}.json`);
  mkdirSync(dirname(schedulePath), { recursive: true });
  const entry = {
    room,
    command: "chat:daemon --tick",
    CronExpression: ["*", "/5 * * * *"].join(""),
    DurationSeconds: 300,
    created_at: new Date().toISOString(),
  };
  writeFileSync(schedulePath, JSON.stringify(entry, null, 2) + "\n", "utf8");
  return {
    mechanism: "schedule",
    expression: ["*", "/5 * * * *"].join(""),
    cadence_seconds: 300,
    configPath: schedulePath,
  };
}

function wireClaudeHooks(targetDir: string): WireCronResult {
  const settingsPath = join(targetDir, ".claude", "settings.json");
  mkdirSync(dirname(settingsPath), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settings = parsed as Record<string, unknown>;
      }
    } catch {
      settings = {};
    }
  }

  const hooksRecord =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
      ? (settings.hooks as Record<string, unknown>)
      : {};

  const appendHook = (existing: unknown, command: string): string[] => {
    if (Array.isArray(existing)) {
      const filtered = existing.filter((item): item is string => typeof item === "string");
      if (!filtered.includes(command)) {
        return [...filtered, command];
      }
      return filtered;
    }
    if (typeof existing === "string") {
      return existing === command ? [existing] : [existing, command];
    }
    return [command];
  };

  const tickCommand = "chat:daemon --tick";
  hooksRecord.SessionStart = appendHook(hooksRecord.SessionStart, tickCommand);
  hooksRecord.PostToolUse = appendHook(hooksRecord.PostToolUse, tickCommand);
  settings.hooks = hooksRecord;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return {
    mechanism: "settings_hooks",
    expression: null,
    cadence_seconds: 900,
    configPath: settingsPath,
  };
}

function wireCodexCron(homeDir: string): WireCronResult {
  const configPath = join(homeDir, ".codex", "config.toml");
  if (!existsSync(configPath)) {
    return {
      mechanism: "self_watchdog",
      expression: null,
      cadence_seconds: 300,
      configPath: null,
    };
  }

  try {
    const existing = readFileSync(configPath, "utf8");
    if (!existing.includes("chat:daemon --tick")) {
      const appended = existing.endsWith("\n")
        ? existing + 'notify_hook = "chat:daemon --tick"\n'
        : existing + '\nnotify_hook = "chat:daemon --tick"\n';
      writeFileSync(configPath, appended, "utf8");
    }
    return {
      mechanism: "notify_hook",
      expression: null,
      cadence_seconds: 900,
      configPath,
    };
  } catch {
    return {
      mechanism: "self_watchdog",
      expression: null,
      cadence_seconds: 300,
      configPath: null,
    };
  }
}

export function wireCron(options: WireCronOptions): WireCronResult {
  const home = options.homeDir ?? homedir();
  const repo = options.repoRoot ?? process.cwd();

  if (options.host === "antigravity") {
    return wireAntigravityCron(home, options.room);
  }
  if (options.host === "claude_code") {
    return wireClaudeHooks(repo);
  }
  if (options.host === "codex") {
    return wireCodexCron(home);
  }
  return {
    mechanism: "self_watchdog",
    expression: null,
    cadence_seconds: 300,
    configPath: null,
  };
}

export function verifyCronWiring(result: WireCronResult, _options?: WireCronOptions): boolean {
  if (result.mechanism === "self_watchdog") {
    return true;
  }
  if (!result.configPath) {
    return false;
  }
  if (!existsSync(result.configPath)) {
    return false;
  }
  try {
    const raw = readFileSync(result.configPath, "utf8");
    return raw.includes("chat:daemon --tick");
  } catch {
    return false;
  }
}
