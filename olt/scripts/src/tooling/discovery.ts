import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseToolSchema } from "./schema-parser.ts";
import type { DynamicToolRegistry } from "./registry.ts";
import type {
  DiscoveredTool,
  DiscoveryOptions,
  DiscoveryReport,
  ToolDefinition,
} from "./types.ts";

export { type DiscoveredTool, type DiscoveryOptions, type DiscoveryReport };

export function validateToolSpec(raw: unknown): {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly definition?: ToolDefinition | undefined;
} {
  const result = parseToolSchema(raw);
  return {
    valid: result.valid,
    errors: result.errors,
    definition: result.definition,
  };
}

export function parseToolSpec(content: string, _sourcePath = ""): ToolDefinition | null {
  try {
    const trimmed = content.trim();
    if (!trimmed) return null;
    const parsed = JSON.parse(trimmed);
    const result = parseToolSchema(parsed);
    return result.valid && result.definition ? result.definition : null;
  } catch {
    return null;
  }
}

export function discoverToolsFromDirectory(
  dirPath: string,
  options: DiscoveryOptions = {},
): readonly DiscoveredTool[] {
  const resolvedDir = resolve(dirPath);
  if (!existsSync(resolvedDir)) return [];
  const exts = options.extensions ?? [".json", ".tool.json"];
  const recursive = options.recursive ?? true;
  const discovered: DiscoveredTool[] = [];

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (recursive && !entry.startsWith(".") && entry !== "node_modules") walk(fullPath);
      } else if (stat.isFile()) {
        if (!exts.some((ext: string) => fullPath.endsWith(ext))) continue;
        try {
          const content = readFileSync(fullPath, "utf-8");
          const def = parseToolSpec(content, fullPath);
          if (def) {
            discovered.push({
              name: def.name,
              path: fullPath,
              valid: true,
              errors: [],
              definition: {
                ...def,
                category:
                  options.defaultCategory && def.category === "general"
                    ? options.defaultCategory
                    : def.category,
              },
              sourcePath: fullPath,
              loadedAt: new Date().toISOString(),
            });
          }
        } catch {}
      }
    }
  }
  walk(resolvedDir);
  return discovered;
}

export function discoverToolsFromManifest(
  manifestPath: string,
  defaultCategory = "manifest",
): readonly ToolDefinition[] {
  const resolved = resolve(manifestPath);
  if (!existsSync(resolved)) return [];
  try {
    const raw = readFileSync(resolved, "utf-8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.tools)
        ? ((parsed as Record<string, unknown>).tools as unknown[])
        : [parsed];
    const tools: ToolDefinition[] = [];
    for (const item of list) {
      const val = parseToolSchema(item);
      if (val.valid && val.definition) {
        tools.push({
          ...val.definition,
          category:
            val.definition.category === "general" ? defaultCategory : val.definition.category,
        });
      }
    }
    return tools;
  } catch {
    return [];
  }
}

export function scanAndRegisterTools(
  registry: DynamicToolRegistry,
  searchDirs: readonly string[],
  options: DiscoveryOptions = {},
): DiscoveryReport {
  let discoveredCount = 0;
  let registeredCount = 0;
  const errors: { readonly path: string; readonly error: string }[] = [];
  const tools: DiscoveredTool[] = [];

  for (const dir of searchDirs) {
    try {
      const items = discoverToolsFromDirectory(dir, options);
      for (const item of items) {
        discoveredCount++;
        tools.push(item);
        if (options.autoRegister !== false && item.definition) {
          try {
            registry.register(item.definition);
            registeredCount++;
          } catch (err) {
            errors.push({
              path: item.sourcePath ?? item.path ?? dir,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch (err) {
      errors.push({ path: dir, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return {
    total: discoveredCount,
    valid: registeredCount,
    invalid: errors.length,
    discoveredCount,
    registeredCount,
    errors,
    tools,
  };
}
