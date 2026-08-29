import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  DynamicToolRegistry,
  ToolDefinition,
  ToolParameter,
  ToolParameterType,
} from "./registry.ts";

export interface DiscoveryOptions {
  readonly extensions?: readonly string[];
  readonly recursive?: boolean;
  readonly defaultCategory?: string;
  readonly ignorePatterns?: readonly string[];
  readonly autoRegister?: boolean;
}

export interface DiscoveredTool {
  readonly definition: ToolDefinition;
  readonly sourcePath: string;
  readonly loadedAt: string;
}

export interface DiscoveryReport {
  readonly discoveredCount: number;
  readonly registeredCount: number;
  readonly errors: readonly { readonly path: string; readonly error: string }[];
  readonly tools: readonly DiscoveredTool[];
}

const VALID_PARAM_TYPES: readonly ToolParameterType[] = [
  "string",
  "number",
  "boolean",
  "object",
  "array",
];

export function validateToolSpec(raw: unknown): {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly definition?: ToolDefinition;
} {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["Tool specification must be an object"] };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    errors.push("Tool definition requires a non-empty 'name' string");
  }
  if (typeof obj.description !== "string") {
    errors.push("Tool definition requires a 'description' string");
  }

  const category =
    typeof obj.category === "string" && obj.category.trim() ? obj.category.trim() : "general";
  const parameters: ToolParameter[] = [];
  if (obj.parameters !== undefined) {
    if (!Array.isArray(obj.parameters)) {
      errors.push("'parameters' must be an array");
    } else {
      for (let i = 0; i < obj.parameters.length; i++) {
        const p = obj.parameters[i];
        if (!p || typeof p !== "object") {
          errors.push(`Parameter at index ${i} is not an object`);
          continue;
        }
        const paramObj = p as Record<string, unknown>;
        if (typeof paramObj.name !== "string" || !paramObj.name.trim()) {
          errors.push(`Parameter at index ${i} requires a non-empty 'name'`);
        }
        const typeStr = typeof paramObj.type === "string" ? paramObj.type : "string";
        if (!VALID_PARAM_TYPES.includes(typeStr as ToolParameterType)) {
          errors.push(`Invalid parameter type '${typeStr}' at index ${i}`);
        }
        parameters.push({
          name: typeof paramObj.name === "string" ? paramObj.name.trim() : `param_${i}`,
          type: (VALID_PARAM_TYPES.includes(typeStr as ToolParameterType)
            ? typeStr
            : "string") as ToolParameterType,
          description: typeof paramObj.description === "string" ? paramObj.description : "",
          required: Boolean(paramObj.required),
          defaultValue: paramObj.defaultValue,
          ...(Array.isArray(paramObj.enumValues)
            ? { enumValues: paramObj.enumValues as readonly (string | number)[] }
            : {}),
        });
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  const meta =
    obj.metadata && typeof obj.metadata === "object"
      ? (obj.metadata as Record<string, unknown>)
      : undefined;
  const definition: ToolDefinition = {
    name: String(obj.name).trim(),
    description: String(obj.description),
    category,
    parameters,
    enabled: obj.enabled === undefined ? true : Boolean(obj.enabled),
    ...(Array.isArray(obj.aliases) ? { aliases: obj.aliases.map(String) } : {}),
    ...(meta
      ? {
          metadata: {
            ...(typeof meta.version === "string" ? { version: String(meta.version) } : {}),
            ...(typeof meta.author === "string" ? { author: String(meta.author) } : {}),
            ...(Array.isArray(meta.tags) ? { tags: meta.tags as string[] } : {}),
            deprecated: Boolean(meta.deprecated),
            ...(typeof meta.deprecationReason === "string"
              ? { deprecationReason: String(meta.deprecationReason) }
              : {}),
          },
        }
      : {}),
  };
  return { valid: true, errors: [], definition };
}

export function parseToolSpec(content: string, _sourcePath = ""): ToolDefinition | null {
  try {
    const trimmed = content.trim();
    if (!trimmed) return null;
    const parsed = JSON.parse(trimmed);
    const result = validateToolSpec(parsed);
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
        if (!exts.some((ext) => fullPath.endsWith(ext))) continue;
        try {
          const content = readFileSync(fullPath, "utf-8");
          const def = parseToolSpec(content, fullPath);
          if (def) {
            discovered.push({
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
      const val = validateToolSpec(item);
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
        if (options.autoRegister !== false) {
          try {
            registry.register(item.definition);
            registeredCount++;
          } catch (err) {
            errors.push({
              path: item.sourcePath,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch (err) {
      errors.push({ path: dir, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { discoveredCount, registeredCount, errors, tools };
}
