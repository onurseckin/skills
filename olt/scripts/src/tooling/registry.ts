export type ToolParameterType = "string" | "number" | "boolean" | "object" | "array";

export interface ToolParameter {
  readonly name: string;
  readonly type: ToolParameterType;
  readonly description: string;
  readonly required?: boolean;
  readonly defaultValue?: unknown;
  readonly enumValues?: readonly (string | number)[];
}

export interface ToolContext {
  readonly agentId?: string;
  readonly correlationId?: string;
  readonly sessionDir?: string;
  readonly abortSignal?: AbortSignal;
  readonly environment?: Record<string, string>;
}

export interface ToolExecutionResult {
  readonly success: boolean;
  readonly output: unknown;
  readonly error?: string;
  readonly durationMs: number;
  readonly toolName: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context?: ToolContext,
) => Promise<unknown> | unknown;

export interface ToolMetadata {
  readonly version?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean;
  readonly deprecationReason?: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly parameters: readonly ToolParameter[];
  readonly handler?: ToolHandler;
  readonly aliases?: readonly string[];
  readonly metadata?: ToolMetadata;
  readonly enabled?: boolean;
}

export interface ToolFilter {
  readonly category?: string;
  readonly tag?: string;
  readonly enabledOnly?: boolean;
  readonly includeDeprecated?: boolean;
  readonly search?: string;
}

export interface ToolRegistryStats {
  readonly totalTools: number;
  readonly enabledTools: number;
  readonly totalInvocations: number;
  readonly categoryCounts: Record<string, number>;
}

export interface ToolCatalogExport {
  readonly exportedAt: string;
  readonly totalTools: number;
  readonly tools: readonly ToolDefinition[];
}

function validateParameterValue(param: ToolParameter, value: unknown): boolean {
  if (value === undefined || value === null) {
    return !param.required;
  }
  if (param.enumValues && param.enumValues.length > 0) {
    if (typeof value !== "string" && typeof value !== "number") return false;
    if (!param.enumValues.includes(value)) return false;
  }
  switch (param.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}

export class DynamicToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly aliasMap = new Map<string, string>();
  private readonly invocationCounts = new Map<string, number>();

  public register(tool: ToolDefinition): void {
    const trimmedName = tool.name.trim();
    if (!trimmedName) throw new Error("Tool name cannot be empty");
    if (this.tools.has(trimmedName) || this.aliasMap.has(trimmedName)) {
      throw new Error(`Tool or alias already registered with name: ${trimmedName}`);
    }
    if (tool.aliases) {
      for (const alias of tool.aliases) {
        const trimmedAlias = alias.trim();
        if (!trimmedAlias) throw new Error("Tool alias cannot be empty");
        if (this.tools.has(trimmedAlias) || this.aliasMap.has(trimmedAlias)) {
          throw new Error(`Alias conflict for '${trimmedAlias}'`);
        }
      }
    }
    const definition: ToolDefinition = {
      ...tool,
      name: trimmedName,
      enabled: tool.enabled ?? true,
      ...(tool.aliases ? { aliases: tool.aliases.map((a) => a.trim()) } : {}),
    };
    this.tools.set(trimmedName, definition);
    if (definition.aliases) {
      for (const alias of definition.aliases) {
        this.aliasMap.set(alias, trimmedName);
      }
    }
  }

  public registerMany(tools: readonly ToolDefinition[]): void {
    for (const tool of tools) this.register(tool);
  }

  public unregister(nameOrAlias: string): boolean {
    const canonicalName = this.aliasMap.get(nameOrAlias) ?? nameOrAlias;
    const tool = this.tools.get(canonicalName);
    if (!tool) return false;
    if (tool.aliases) {
      for (const alias of tool.aliases) this.aliasMap.delete(alias);
    }
    this.invocationCounts.delete(canonicalName);
    return this.tools.delete(canonicalName);
  }

  public get(nameOrAlias: string): ToolDefinition | undefined {
    const canonicalName = this.aliasMap.get(nameOrAlias) ?? nameOrAlias;
    return this.tools.get(canonicalName);
  }

  public has(nameOrAlias: string): boolean {
    const canonicalName = this.aliasMap.get(nameOrAlias) ?? nameOrAlias;
    return this.tools.has(canonicalName);
  }

  public setHandler(nameOrAlias: string, handler: ToolHandler): void {
    const tool = this.get(nameOrAlias);
    if (!tool) throw new Error(`Tool not found: ${nameOrAlias}`);
    this.tools.set(tool.name, { ...tool, handler });
  }

  public list(filter?: ToolFilter): readonly ToolDefinition[] {
    let list = Array.from(this.tools.values());
    if (filter?.enabledOnly) list = list.filter((t) => t.enabled !== false);
    if (filter?.category)
      list = list.filter((t) => t.category.toLowerCase() === filter.category!.toLowerCase());
    if (filter?.tag) list = list.filter((t) => t.metadata?.tags?.includes(filter.tag!));
    if (!filter?.includeDeprecated) list = list.filter((t) => !t.metadata?.deprecated);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          (t.aliases && t.aliases.some((a) => a.toLowerCase().includes(q))),
      );
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  public count(enabledOnly = false): number {
    if (!enabledOnly) return this.tools.size;
    return Array.from(this.tools.values()).filter((t) => t.enabled !== false).length;
  }

  public clear(): void {
    this.tools.clear();
    this.aliasMap.clear();
    this.invocationCounts.clear();
  }

  public async execute(
    nameOrAlias: string,
    args: Record<string, unknown> = {},
    context?: ToolContext,
  ): Promise<ToolExecutionResult> {
    const start = performance.now();
    const tool = this.get(nameOrAlias);
    if (!tool) {
      return {
        success: false,
        output: null,
        error: `Tool '${nameOrAlias}' is not registered`,
        durationMs: performance.now() - start,
        toolName: nameOrAlias,
      };
    }
    if (tool.enabled === false) {
      return {
        success: false,
        output: null,
        error: `Tool '${tool.name}' is disabled`,
        durationMs: performance.now() - start,
        toolName: tool.name,
      };
    }
    if (!tool.handler) {
      return {
        success: false,
        output: null,
        error: `Tool '${tool.name}' has no executable handler registered`,
        durationMs: performance.now() - start,
        toolName: tool.name,
      };
    }

    const resolvedArgs: Record<string, unknown> = { ...args };
    for (const param of tool.parameters) {
      if (resolvedArgs[param.name] === undefined && param.defaultValue !== undefined) {
        resolvedArgs[param.name] = param.defaultValue;
      }
      if (param.required && resolvedArgs[param.name] === undefined) {
        return {
          success: false,
          output: null,
          error: `Missing required parameter '${param.name}' for tool '${tool.name}'`,
          durationMs: performance.now() - start,
          toolName: tool.name,
        };
      }
      if (
        resolvedArgs[param.name] !== undefined &&
        !validateParameterValue(param, resolvedArgs[param.name])
      ) {
        return {
          success: false,
          output: null,
          error: `Invalid type or value for parameter '${param.name}' (expected ${param.type})`,
          durationMs: performance.now() - start,
          toolName: tool.name,
        };
      }
    }

    try {
      const output = await tool.handler(resolvedArgs, context);
      const prevCount = this.invocationCounts.get(tool.name) ?? 0;
      this.invocationCounts.set(tool.name, prevCount + 1);
      return { success: true, output, durationMs: performance.now() - start, toolName: tool.name };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: null,
        error: errorMsg,
        durationMs: performance.now() - start,
        toolName: tool.name,
      };
    }
  }

  public exportCatalog(): ToolCatalogExport {
    const tools = this.list({ includeDeprecated: true }).map((t) => {
      const { handler: _, ...rest } = t;
      return rest;
    });
    return { exportedAt: new Date().toISOString(), totalTools: tools.length, tools };
  }

  public importCatalog(
    catalog: ToolCatalogExport,
    handlers: Record<string, ToolHandler> = {},
  ): number {
    let imported = 0;
    for (const tool of catalog.tools) {
      const resolvedHandler = handlers[tool.name] ?? tool.handler;
      this.register({
        ...tool,
        ...(resolvedHandler ? { handler: resolvedHandler } : {}),
      });
      imported++;
    }
    return imported;
  }

  public getStats(): ToolRegistryStats {
    let totalInvocations = 0;
    for (const count of this.invocationCounts.values()) totalInvocations += count;
    const categoryCounts: Record<string, number> = {};
    for (const tool of this.tools.values()) {
      categoryCounts[tool.category] = (categoryCounts[tool.category] ?? 0) + 1;
    }
    return {
      totalTools: this.tools.size,
      enabledTools: this.count(true),
      totalInvocations,
      categoryCounts,
    };
  }
}

let globalToolRegistryInstance: DynamicToolRegistry | null = null;

export function getGlobalToolRegistry(): DynamicToolRegistry {
  if (!globalToolRegistryInstance) globalToolRegistryInstance = new DynamicToolRegistry();
  return globalToolRegistryInstance;
}

export function resetGlobalToolRegistry(): void {
  if (globalToolRegistryInstance) globalToolRegistryInstance.clear();
  globalToolRegistryInstance = null;
}
