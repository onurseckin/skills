import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HookConfig } from "../types.ts";
import { DEFAULT_HOOK_CONFIG } from "./constants.ts";
import { parseHookConfig } from "./parser.ts";
import { resolveHookConfigFile } from "./resolver.ts";

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
