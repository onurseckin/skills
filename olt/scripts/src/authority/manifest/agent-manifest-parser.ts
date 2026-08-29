import { basename, extname } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type {
  AgentManifest,
  AgentManifestCommunicationContract,
  AgentManifestInterface,
  AgentManifestPermissions,
  AgentManifestProtocol,
  AgentToolsConfig,
} from "./types.ts";
import { normalizeRoleName } from "./discovery.ts";
import { parseYaml } from "./yaml-parser.ts";

export function parseAgentManifest(content: string, filePath?: string): AgentManifest {
  const parsed = parseYaml(content);
  const fileLabel = filePath !== undefined ? filePath : "in-memory";
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Failed to parse agent manifest YAML: output is not an object (file: ${fileLabel})`,
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

  const rawComm =
    typeof record.communication_contract === "object" && record.communication_contract !== null
      ? (record.communication_contract as Record<string, unknown>)
      : undefined;

  const communication_contract: AgentManifestCommunicationContract | undefined = rawComm
    ? {
        protocol: typeof rawComm.protocol === "string" ? rawComm.protocol : "",
        mailbox_path: typeof rawComm.mailbox_path === "string" ? rawComm.mailbox_path : "",
        lock_path: typeof rawComm.lock_path === "string" ? rawComm.lock_path : "",
        allowed_channels: Array.isArray(rawComm.allowed_channels)
          ? rawComm.allowed_channels.map((c) => String(c).trim()).filter(Boolean)
          : [],
        ban_raw_jsonl_reading: Boolean(rawComm.ban_raw_jsonl_reading),
        forbid_native_messaging:
          rawComm.forbid_native_messaging !== undefined
            ? Boolean(rawComm.forbid_native_messaging)
            : undefined,
      }
    : undefined;

  const mandatory_turn1_actions = Array.isArray(record.mandatory_turn1_actions)
    ? record.mandatory_turn1_actions.map((a) => String(a).trim()).filter(Boolean)
    : undefined;

  const dispatch_contract =
    typeof record.dispatch_contract === "string" ? record.dispatch_contract : undefined;

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
    communication_contract,
    mandatory_turn1_actions,
    dispatch_contract,
    filePath,
    raw: content,
  };
}
