import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot } from "../core/shared/paths.ts";
import type {
  CustomHookHandler,
  HookAction,
  HookConfig,
  HookDefinition,
  LifecycleEvent,
} from "./types.ts";

export const DEFAULT_DARWIN_SOUND_PATH = "/System/Library/Sounds/Bottle.aiff";
export const DEFAULT_DARWIN_AUDIO_COMMAND = `afplay ${DEFAULT_DARWIN_SOUND_PATH}`;
export const DEFAULT_HOOK_SCHEMA = "harness.hooks_config";
export const DEFAULT_HOOK_VERSION = 1;

export const DEFAULT_HOOK_CONFIG: HookConfig = {
  schema: DEFAULT_HOOK_SCHEMA,
  version: DEFAULT_HOOK_VERSION,
  enabled: true,
  hooks: [
    {
      id: "builtin-orchestrator-complete-audio",
      description: "Audio chime on orchestrator completion",
      events: ["orchestrator:complete"],
      action: "audio",
      sound: "Bottle",
      file: DEFAULT_DARWIN_SOUND_PATH,
      platforms: ["darwin"],
      enabled: true,
    },
    {
      id: "builtin-run-complete-audio",
      description: "Audio chime on run completion",
      events: ["run:complete"],
      action: "audio",
      sound: "Bottle",
      file: DEFAULT_DARWIN_SOUND_PATH,
      platforms: ["darwin"],
      enabled: true,
    },
  ],
  defaultAudioDarwin: DEFAULT_DARWIN_SOUND_PATH,
};

function isInsideRepo(repoRoot: string, targetPath: string): boolean {
  const pathFromRoot = relative(repoRoot, targetPath);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
  );
}

function canonicalHookConfigPath(repoRoot: string): string {
  return join(repoRoot, ".olt", "capsules", "hooks.json");
}

function assertTrustedHookConfig(filePath: string, repoRoot: string): void {
  const fileInfo = lstatSync(filePath);
  if (!fileInfo.isFile()) {
    throw new HarnessError("PATH_SAFETY", `hook config is not a regular file: '${filePath}'`);
  }

  const realRepoRoot = realpathSync(repoRoot);
  const realConfigPath = realpathSync(filePath);
  if (!isInsideRepo(realRepoRoot, realConfigPath)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `hook config resolves outside repository root: '${filePath}'`,
    );
  }

  if (process.platform !== "win32") {
    const fileStat = statSync(filePath);
    if (typeof process.getuid === "function" && fileStat.uid !== process.getuid()) {
      throw new HarnessError(
        "INTEGRITY",
        `hook config is not owned by the current user: '${filePath}'`,
      );
    }
    if ((fileStat.mode & 0o022) !== 0) {
      throw new HarnessError("INTEGRITY", `hook config is group or world writable: '${filePath}'`);
    }
  }
}

export function resolveHookConfigFile(
  explicitPathOrDir?: string | undefined,
  cwd: string = process.cwd(),
): string | null {
  if (explicitPathOrDir !== undefined && explicitPathOrDir.trim().length > 0) {
    const resolved = resolve(cwd, explicitPathOrDir.trim());
    if (existsSync(resolved)) {
      const stat = lstatSync(resolved);
      if (stat.isSymbolicLink()) {
        throw new HarnessError(
          "PATH_SAFETY",
          `hook config path must not be a symlink: '${resolved}'`,
        );
      }
      if (stat.isFile()) {
        const repoRoot = findRepoRoot(cwd);
        if (!isInsideRepo(repoRoot, resolved)) {
          throw new HarnessError(
            "PATH_SAFETY",
            `hook config is outside repository root: '${resolved}'`,
          );
        }
        assertTrustedHookConfig(resolved, repoRoot);
        return resolved;
      }
      if (!stat.isDirectory()) {
        throw new HarnessError(
          "PATH_SAFETY",
          `hook config path is not a directory or file: '${resolved}'`,
        );
      }
      const repoRoot = findRepoRoot(resolved);
      const candidate = canonicalHookConfigPath(repoRoot);
      if (!existsSync(candidate)) {
        return null;
      }
      assertTrustedHookConfig(candidate, repoRoot);
      return candidate;
    }

    if (resolved.endsWith(".json")) {
      const repoRoot = findRepoRoot(cwd);
      if (!isInsideRepo(repoRoot, resolved)) {
        throw new HarnessError(
          "PATH_SAFETY",
          `hook config is outside repository root: '${resolved}'`,
        );
      }
      return resolved;
    }
  }

  const repoRoot = findRepoRoot(cwd);
  const candidate = canonicalHookConfigPath(repoRoot);
  if (!existsSync(candidate)) {
    return null;
  }
  assertTrustedHookConfig(candidate, repoRoot);
  return candidate;
}

export function parseHookDefinition(raw: unknown, defaultId: string): HookDefinition | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;

  const events: LifecycleEvent[] = [];

  if (Array.isArray(record.events)) {
    for (const item of record.events) {
      if (typeof item === "string" && item.trim().length > 0) {
        events.push(item.trim());
      }
    }
  } else if (typeof record.events === "string" && record.events.trim().length > 0) {
    events.push(record.events.trim());
  }

  if (Array.isArray(record.event)) {
    for (const item of record.event) {
      if (typeof item === "string" && item.trim().length > 0 && !events.includes(item.trim())) {
        events.push(item.trim());
      }
    }
  } else if (
    typeof record.event === "string" &&
    record.event.trim().length > 0 &&
    !events.includes(record.event.trim())
  ) {
    events.push(record.event.trim());
  }

  if (events.length === 0) {
    return null;
  }

  let action: HookAction = "shell";
  if (
    record.action === "shell" ||
    record.action === "audio" ||
    record.action === "webhook" ||
    record.action === "custom"
  ) {
    action = record.action;
  } else if (typeof record.action === "string") {
    return null;
  }

  let platforms: string[] | undefined;
  if (Array.isArray(record.platforms)) {
    platforms = record.platforms.filter((p): p is string => typeof p === "string" && p.length > 0);
  } else if (typeof record.platform === "string" && record.platform.length > 0) {
    platforms = [record.platform];
  } else if (Array.isArray(record.platform)) {
    platforms = record.platform.filter((p): p is string => typeof p === "string" && p.length > 0);
  }

  let method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined;
  if (
    record.method === "GET" ||
    record.method === "POST" ||
    record.method === "PUT" ||
    record.method === "PATCH" ||
    record.method === "DELETE"
  ) {
    method = record.method;
  }

  let headers: Record<string, string> | undefined;
  if (
    typeof record.headers === "object" &&
    record.headers !== null &&
    !Array.isArray(record.headers)
  ) {
    const rawHeaders = record.headers as Record<string, unknown>;
    headers = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (typeof v === "string") {
        headers[k] = v;
      }
    }
  }

  let env: Record<string, string> | undefined;
  if (typeof record.env === "object" && record.env !== null && !Array.isArray(record.env)) {
    const rawEnv = record.env as Record<string, unknown>;
    env = {};
    for (const [k, v] of Object.entries(rawEnv)) {
      if (typeof v === "string") {
        env[k] = v;
      }
    }
  }

  let commandArgv: string[] | undefined;
  if (Array.isArray(record.commandArgv) && record.commandArgv.length > 0) {
    const items = record.commandArgv.filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (items.length === record.commandArgv.length) {
      commandArgv = items;
    }
  }

  const id =
    typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : defaultId;
  const description = typeof record.description === "string" ? record.description : undefined;
  const sound = typeof record.sound === "string" ? record.sound : undefined;
  const file = typeof record.file === "string" ? record.file : undefined;
  const volume = typeof record.volume === "number" ? record.volume : undefined;
  const command = typeof record.command === "string" ? record.command : undefined;
  const cwd = typeof record.cwd === "string" ? record.cwd : undefined;
  const url = typeof record.url === "string" ? record.url : undefined;
  const handler =
    typeof record.handler === "function" ? (record.handler as CustomHookHandler) : undefined;
  const enabled = typeof record.enabled === "boolean" ? record.enabled : true;
  const timeout_ms = typeof record.timeout_ms === "number" ? record.timeout_ms : undefined;
  const silent = typeof record.silent === "boolean" ? record.silent : undefined;

  return {
    id,
    description,
    events,
    action,
    sound,
    file,
    volume,
    command,
    commandArgv,
    cwd,
    env,
    url,
    method,
    headers,
    handler,
    platforms,
    enabled,
    timeout_ms,
    silent,
  };
}

export function parseHookConfig(raw: unknown): HookConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return DEFAULT_HOOK_CONFIG;
  }

  const record = raw as Record<string, unknown>;
  const rawHooks = Array.isArray(record.hooks) ? record.hooks : [];
  const hooks: HookDefinition[] = [];

  let index = 0;
  for (const item of rawHooks) {
    index++;
    const parsed = parseHookDefinition(item, `hook-${index}`);
    if (parsed !== null) {
      hooks.push(parsed);
    }
  }

  return {
    schema: typeof record.schema === "string" ? record.schema : DEFAULT_HOOK_SCHEMA,
    version: typeof record.version === "number" ? record.version : DEFAULT_HOOK_VERSION,
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    hooks,
    defaultAudioDarwin:
      typeof record.defaultAudioDarwin === "string"
        ? record.defaultAudioDarwin
        : DEFAULT_DARWIN_SOUND_PATH,
    defaultAudioLinux:
      typeof record.defaultAudioLinux === "string" ? record.defaultAudioLinux : undefined,
    metadata:
      typeof record.metadata === "object" &&
      record.metadata !== null &&
      !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : undefined,
  };
}

export function loadHookConfig(
  target?: string | undefined,
  cwd: string = process.cwd(),
): HookConfig {
  const filePath = resolveHookConfigFile(target, cwd);
  if (filePath === null || !existsSync(filePath)) {
    return DEFAULT_HOOK_CONFIG;
  }

  try {
    const rawText = readFileSync(filePath, "utf8");
    if (rawText.trim().length === 0) {
      return DEFAULT_HOOK_CONFIG;
    }
    const parsedJson: unknown = JSON.parse(rawText);
    return parseHookConfig(parsedJson);
  } catch {
    return DEFAULT_HOOK_CONFIG;
  }
}

export function saveHookConfig(config: HookConfig, targetPath: string): void {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const serialized = JSON.stringify(config, null, 2) + "\n";
  writeFileSync(targetPath, serialized, "utf8");
}
