import { basename, extname } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type {
  AgentManifest,
  AgentManifestInterface,
  AgentManifestPermissions,
  AgentManifestProtocol,
  AgentToolsConfig,
} from "./types.ts";
import { normalizeRoleName } from "./discovery.ts";
import { parseYaml } from "./yaml-parser.ts";

export function parseAgentManifest(content: string, filePath?: string): AgentManifest {
  const parsed = parseYaml(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Failed to parse agent manifest YAML: output is not an object (file: ${filePath ?? "in-memory"})`,
    );
  }

  const record = parsed as Record<string, unknown>;

  const name =
    typeof record.name === "string"
      ? record.name
      : filePath
        ? basename(filePath, extname(filePath))
        : "agent";
  const role =
    typeof record.role === "string" ? normalizeRoleName(record.role) : normalizeRoleName(name);
  const tier = typeof record.tier === "number" ? record.tier : 3;
  const domain = typeof record.domain === "string" ? record.domain : undefined;

  const provider: readonly string[] = Array.isArray(record.provider)
    ? record.provider.map((p) => String(p).trim()).filter(Boolean)
    : [];

  const tools: AgentToolsConfig | undefined =
    typeof record.tools === "object" && record.tools !== null
      ? (record.tools as AgentToolsConfig)
      : undefined;

  const config =
    typeof record.config === "object" && record.config !== null
      ? (record.config as Record<string, unknown>)
      : undefined;

  const iface =
    typeof record.interface === "object" && record.interface !== null
      ? (record.interface as AgentManifestInterface)
      : undefined;

  const permissions =
    typeof record.permissions === "object" && record.permissions !== null
      ? (record.permissions as AgentManifestPermissions)
      : undefined;

  const invariants = Array.isArray(record.invariants)
    ? record.invariants.map((inv) => String(inv).trim()).filter(Boolean)
    : undefined;

  const instructions = typeof record.instructions === "string" ? record.instructions : undefined;

  const protocol =
    typeof record.protocol === "object" && record.protocol !== null
      ? (record.protocol as AgentManifestProtocol)
      : undefined;

  return {
    name,
    role,
    tier,
    domain,
    provider: provider.length > 0 ? provider : undefined,
    tools,
    config,
    interface: iface,
    permissions,
    invariants,
    instructions,
    protocol,
    filePath,
    raw: content,
  };
}
