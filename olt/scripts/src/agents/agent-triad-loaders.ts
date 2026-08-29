import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import {
  normalizeRoleName,
  parseAgentManifest,
  type AgentManifest,
  type AgentManifestInterface,
} from "../authority/manifest-parser.ts";
import { roleToTier } from "./naming.ts";
import type { AgentIdentity, AgentRoleDefinition, AgentTriadOptions } from "./agent-triad-types.ts";
import { resolveWorkspacePaths } from "./agent-triad-paths.ts";

export function loadAgentIdentity(roleInput: string, options?: AgentTriadOptions): AgentIdentity {
  const normRole = normalizeRoleName(roleInput);
  const { agentsDir } = resolveWorkspacePaths(options);

  const candidateNames = [
    `${normRole}.yaml`,
    `${normRole}.yml`,
    `${roleInput}.yaml`,
    `${roleInput}.yml`,
    normRole === "mechanic-validator" ? "mechanic_validator.yaml" : "",
    normRole === "ui-mechanic-validator" ? "ui-mechanic-validator.yaml" : "",
    normRole === "ui-validator" ? "ui-validator.yaml" : "",
  ].filter(Boolean);

  let targetPath: string | null = null;
  for (const name of candidateNames) {
    const p = join(agentsDir, name);
    if (existsSync(p)) {
      targetPath = p;
      break;
    }
  }

  if (!targetPath && existsSync(agentsDir)) {
    try {
      const files = readdirSync(agentsDir);
      for (const file of files) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          const full = join(agentsDir, file);
          const raw = readFileSync(full, "utf-8");
          const manifest = parseAgentManifest(raw, full);
          if (
            normalizeRoleName(manifest.role) === normRole ||
            normalizeRoleName(manifest.name) === normRole
          ) {
            targetPath = full;
            break;
          }
        }
      }
    } catch {
      // Fallback
    }
  }

  if (!targetPath || !existsSync(targetPath)) {
    if (options?.strict) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Agent identity manifest not found for role '${normRole}' in ${agentsDir}`,
      );
    }

    const fallbackTier = roleToTier(normRole);
    return {
      name: normRole,
      role: normRole,
      tier: fallbackTier,
      displayName: `${normRole.charAt(0).toUpperCase() + normRole.slice(1)} Agent`,
      shortDescription: `Synthesized fallback agent identity for role ${normRole}`,
      provider: ["generic"],
      tools: {
        enable_subagent_tools: true,
        enable_write_tools:
          fallbackTier === 3 &&
          (normRole === "implementer" || normRole === "repairer" || normRole === "worker"),
      },
      filePath: undefined,
      rawYaml: undefined,
    };
  }

  const rawYaml = readFileSync(targetPath, "utf-8");
  const manifest: AgentManifest = parseAgentManifest(rawYaml, targetPath);

  const iface: AgentManifestInterface | undefined = manifest.interface;
  const displayName =
    iface?.display_name ??
    `${manifest.name.charAt(0).toUpperCase() + manifest.name.slice(1)} Agent`;
  const shortDescription =
    iface?.short_description ?? `Agent operating under the ${manifest.role} specification`;

  return {
    name: manifest.name,
    role: manifest.role,
    tier: manifest.tier,
    displayName,
    shortDescription,
    provider: manifest.provider,
    tools: manifest.tools ?? iface?.tools,
    config: manifest.config ?? iface?.config,
    protocol: manifest.protocol,
    milestoneNotifications: iface?.milestone_notifications,
    invariants: iface?.mind_invariants ?? iface?.coordinator_invariants,
    filePath: targetPath,
    rawYaml,
  };
}

export function loadAgentRoleDefinition(
  roleInput: string,
  options?: AgentTriadOptions,
): AgentRoleDefinition {
  const normRole = normalizeRoleName(roleInput);
  const { agentsDir } = resolveWorkspacePaths(options);

  const identity = loadAgentIdentity(normRole, options);

  if (!identity.filePath || !existsSync(identity.filePath)) {
    if (options?.strict) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Agent role definition contract not found for role '${normRole}' in ${agentsDir}`,
      );
    }

    const fallbackTier = roleToTier(normRole);
    return {
      role: normRole,
      tier: fallbackTier,
      domain: undefined,
      may: [`Operate as ${normRole} within authorized boundaries`],
      mustNot: [`Exceed ${normRole} role capabilities or write outside lease scope`],
      commands: ["task:claim", "task:heartbeat", "task:submit", "whoami"],
      spawns: [],
      body: `# Role: ${normRole}\n\nSynthesized fallback contract for role ${normRole}.`,
      filePath: undefined,
      frontmatter: { role: normRole, tier: fallbackTier },
      raw: undefined,
    };
  }

  const raw = identity.rawYaml ?? readFileSync(identity.filePath, "utf-8");
  const manifest: AgentManifest = parseAgentManifest(raw, identity.filePath);

  const may = manifest.permissions?.may ?? [`Operate as ${normRole} within authorized boundaries`];
  const mustNot = manifest.permissions?.must_not ?? [
    `Exceed ${normRole} role capabilities or write outside lease scope`,
  ];
  const commands = manifest.permissions?.commands ?? [
    "task:claim",
    "task:heartbeat",
    "task:submit",
    "whoami",
  ];
  const spawns = (manifest.permissions?.spawns ?? []) as string[];
  const body = manifest.instructions ?? "";

  return {
    role: manifest.role,
    tier: manifest.tier,
    domain: typeof manifest.domain === "string" ? manifest.domain : undefined,
    may,
    mustNot,
    commands,
    spawns,
    body,
    filePath: identity.filePath,
    frontmatter: {
      role: manifest.role,
      tier: manifest.tier,
      may,
      must_not: mustNot,
      commands,
      spawns,
    },
    raw,
  };
}
