import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type {
  AgentManifest,
  ManifestLoaderOptions,
  RoleContract,
  UnifiedAgentModel,
} from "./types.ts";
import { findSkillRoot, normalizeRoleName } from "./discovery.ts";
import { parseRoleContract } from "./frontmatter-parser.ts";
import { parseAgentManifest } from "./agent-manifest-parser.ts";

export const CONTRACT_CACHE = new Map<string, RoleContract>();
export const MANIFEST_CACHE = new Map<string, AgentManifest>();
export const UNIFIED_CACHE = new Map<string, UnifiedAgentModel>();

export function clearManifestCache(): void {
  CONTRACT_CACHE.clear();
  MANIFEST_CACHE.clear();
  UNIFIED_CACHE.clear();
}

function resolveSearchDirs(options?: ManifestLoaderOptions): string[] {
  const skillRoot = options?.skillRoot ?? findSkillRoot();
  return [options?.agentsDir, options?.rolesDir, join(skillRoot, "agents")].filter(
    (d): d is string => typeof d === "string" && existsSync(d),
  );
}

function createSyntheticContract(role: string, manifest?: AgentManifest): RoleContract {
  const may = manifest?.permissions?.may?.length ? manifest.permissions.may : [`Operate as ${role} inside assigned task boundaries`];
  const mustNot = manifest?.permissions?.must_not?.length ? manifest.permissions.must_not : [`Violate ${role} role boundaries or edit files outside assigned scope`];
  const commands = manifest?.permissions?.commands?.length ? manifest.permissions.commands : ["task:claim", "task:heartbeat", "task:submit", "whoami"];
  const spawns = (manifest?.permissions?.spawns ?? []) as string[];
  const tier = manifest?.tier ?? 3;
  return {
    role: manifest?.role || role,
    tier,
    domain: typeof manifest?.domain === "string" ? manifest.domain : undefined,
    may,
    mustNot,
    commands,
    spawns,
    frontmatter: { role: manifest?.role || role, tier, may: manifest?.permissions?.may, must_not: manifest?.permissions?.must_not, commands: manifest?.permissions?.commands, spawns: manifest?.permissions?.spawns },
    body: manifest?.instructions || `# Role: ${role}\n\nSynthetic contract loaded for role \`${role}\`.`,
    filePath: manifest?.filePath,
    raw: manifest?.raw || `---\nrole: ${role}\ntier: ${tier}\n---\n# Role: ${role}`,
  };
}

export function loadRoleContract(roleInput: string, options?: ManifestLoaderOptions): RoleContract {
  const role = normalizeRoleName(roleInput);
  const bypassCache = options?.bypassCache ?? false;
  if (!bypassCache && CONTRACT_CACHE.has(role)) return CONTRACT_CACHE.get(role)!;

  try {
    const manifest = loadAgentManifest(roleInput, options);
    const contract = createSyntheticContract(role, manifest);
    if (!bypassCache) CONTRACT_CACHE.set(role, contract);
    return contract;
  } catch {}

  for (const searchDir of resolveSearchDirs(options)) {
    const candidateFiles = [
      join(searchDir, `${role}.yaml`),
      join(searchDir, `${role}.yml`),
      join(searchDir, `${role}.md`),
      join(searchDir, `${roleInput}.yaml`),
      join(searchDir, `${roleInput}.md`),
    ];
    for (const cand of candidateFiles) {
      if (existsSync(cand)) {
        try {
          const content = readFileSync(cand, "utf-8");
          const contract = parseRoleContract(content, cand);
          if (!bypassCache) CONTRACT_CACHE.set(role, contract);
          return contract;
        } catch {}
      }
    }
    try {
      for (const file of readdirSync(searchDir)) {
        if (file.endsWith(".md") || file.endsWith(".yaml") || file.endsWith(".yml")) {
          const fullPath = join(searchDir, file);
          try {
            const content = readFileSync(fullPath, "utf-8");
            const parsed = parseRoleContract(content, fullPath);
            if (normalizeRoleName(parsed.role) === role) {
              if (!bypassCache) CONTRACT_CACHE.set(role, parsed);
              return parsed;
            }
          } catch {}
        }
      }
    } catch {}
  }

  const fallbackContract = createSyntheticContract(role);
  if (!bypassCache) CONTRACT_CACHE.set(role, fallbackContract);
  return fallbackContract;
}

export function loadAgentManifest(roleInput: string, options?: ManifestLoaderOptions): AgentManifest {
  const role = normalizeRoleName(roleInput);
  const bypassCache = options?.bypassCache ?? false;
  if (!bypassCache && MANIFEST_CACHE.has(role)) return MANIFEST_CACHE.get(role)!;

  const skillRoot = options?.skillRoot ?? findSkillRoot();
  const agentsDir = options?.agentsDir ?? join(skillRoot, "agents");
  const candidateFiles = [
    join(agentsDir, `${role}.yaml`),
    join(agentsDir, `${role}.yml`),
    join(agentsDir, `${roleInput}.yaml`),
    join(agentsDir, `${roleInput}.yml`),
  ];

  let foundPath: string | null = null;
  for (const cand of candidateFiles) {
    if (existsSync(cand)) {
      foundPath = cand;
      break;
    }
  }

  if (!foundPath && existsSync(agentsDir)) {
    try {
      for (const file of readdirSync(agentsDir)) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          const fullPath = join(agentsDir, file);
          const content = readFileSync(fullPath, "utf-8");
          const parsed = parseAgentManifest(content, fullPath);
          if (normalizeRoleName(parsed.role) === role || normalizeRoleName(parsed.name) === role) {
            foundPath = fullPath;
            MANIFEST_CACHE.set(role, parsed);
            return parsed;
          }
        }
      }
    } catch {}
  }

  if (!foundPath || !existsSync(foundPath)) {
    const fallbackManifest: AgentManifest = {
      name: role,
      role,
      tier: 3,
      provider: ["generic"],
      tools: {
        enable_subagent_tools: true,
        enable_write_tools: role === "implementer" || role === "repairer" || role === "worker",
      },
      interface: {
        display_name: `${role.toUpperCase()} Agent`,
        short_description: `Agent executing tasks under role ${role}`,
        role,
        tier: 3,
      },
      protocol: { cli: "bun ~/.agents/skills/olt/scripts/harness.ts", zero_json: true },
      raw: `name: "${role}"\nrole: "${role}"\ntier: 3`,
    };
    if (!bypassCache) MANIFEST_CACHE.set(role, fallbackManifest);
    return fallbackManifest;
  }

  const content = readFileSync(foundPath, "utf-8");
  const manifest = parseAgentManifest(content, foundPath);
  if (!bypassCache) MANIFEST_CACHE.set(role, manifest);
  return manifest;
}

function getArchetypeAndMandate(role: string, tier: number, shortDescription: string): { archetype: string; coreMandate: string } {
  if (tier === 0) {
    return {
      archetype: "Autonomous Consciousness & Observe-Only Lead",
      coreMandate: "Operate indefinitely as an infinite autonomous consciousness loop, supervising pulse health, generational rotation, and global execution topology without touching repository code.",
    };
  }
  if (tier === 1) {
    return {
      archetype: "Plan Supervisor & Multi-Round Release Manager",
      coreMandate: "Drive multi-round autonomous execution loops, dispatch Tier 2 Domain Coordinators, synthesize findings into next-round prompts, and execute final git releases on dedicated background threads.",
    };
  }
  if (tier === 2) {
    return {
      archetype: "Wave Execution & Lease Manager",
      coreMandate: "Own the run capsule, compile task graphs, dispatch parallel wave lanes to Tier 3 workers, prove gates on disposable scratch copies, enforce quantitative validation, and declare run completion.",
    };
  }
  if (role === "validator" || role.startsWith("validator-")) {
    return {
      archetype: "Adversarial Verifier & Quantitative Gate Inspector",
      coreMandate: "Independently verify task submissions with quantitative metrics, adversarial probes, dual-channel visual validation, and counterfactual falsifiability proofs.",
    };
  }
  if (role === "implementer" || role === "repairer" || role === "worker") {
    return {
      archetype: "Scoped Modular Implementer",
      coreMandate: "Implement modular code strictly within the leased write scope, execute pre-submission verification, maintain 100% strict TypeScript types, and answer findings with proof.",
    };
  }
  if (role === "completeness-critic") {
    return {
      archetype: "Run Completeness & Verification Critic",
      coreMandate: "Independently inspect run convergence, unresolved findings, orphan evidence, and multi-viewport proofs before authorizing run completion.",
    };
  }
  return { archetype: "Autonomous Worker", coreMandate: shortDescription };
}

export function loadUnifiedAgentModel(roleInput: string, options?: ManifestLoaderOptions): UnifiedAgentModel {
  const role = normalizeRoleName(roleInput);
  const bypassCache = options?.bypassCache ?? false;
  if (!bypassCache && UNIFIED_CACHE.has(role)) return UNIFIED_CACHE.get(role)!;

  const contract = loadRoleContract(role, options);
  const manifest = loadAgentManifest(role, options);
  const displayName = manifest.interface?.display_name ?? `${role.charAt(0).toUpperCase() + role.slice(1)} Agent`;
  const shortDescription = manifest.interface?.short_description ?? `Agent operating under the ${role} contract.`;
  const tier = manifest.tier ?? contract.tier;
  const { archetype, coreMandate } = getArchetypeAndMandate(role, tier, shortDescription);

  const enableSubagentTools = manifest.tools?.enable_subagent_tools ?? manifest.interface?.tools?.enable_subagent_tools ?? true;
  const enableWriteTools = manifest.tools?.enable_write_tools ?? manifest.interface?.tools?.enable_write_tools ?? (tier === 3 && (role === "implementer" || role === "repairer" || role === "worker"));

  const unified: UnifiedAgentModel = {
    role,
    name: manifest.name,
    tier,
    domain: contract.domain,
    displayName,
    shortDescription,
    archetype,
    coreMandate,
    may: contract.may,
    mustNot: contract.mustNot,
    commands: contract.commands,
    spawns: contract.spawns,
    instructions: manifest.instructions ?? manifest.protocol?.instructions ?? "",
    roleContractBody: contract.body,
    tools: { enable_subagent_tools: enableSubagentTools, enable_write_tools: enableWriteTools },
    manifest,
    contract,
  };

  if (!bypassCache) UNIFIED_CACHE.set(role, unified);
  return unified;
}

export function listAvailableRoles(options?: ManifestLoaderOptions): readonly string[] {
  const skillRoot = options?.skillRoot ?? findSkillRoot();
  const searchDir = options?.agentsDir ?? options?.rolesDir ?? join(skillRoot, "agents");
  const rolesSet = new Set<string>();

  if (existsSync(searchDir)) {
    try {
      for (const file of readdirSync(searchDir)) {
        if (file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".md")) {
          rolesSet.add(normalizeRoleName(basename(file, extname(file))));
        }
      }
    } catch {}
  }
  return Array.from(rolesSet).sort();
}

export function listAvailableManifests(options?: ManifestLoaderOptions): readonly string[] {
  const skillRoot = options?.skillRoot ?? findSkillRoot();
  const agentsDir = options?.agentsDir ?? join(skillRoot, "agents");
  const agentsSet = new Set<string>();

  if (existsSync(agentsDir)) {
    try {
      for (const file of readdirSync(agentsDir)) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          agentsSet.add(normalizeRoleName(basename(file, extname(file))));
        }
      }
    } catch {}
  }
  return Array.from(agentsSet).sort();
}
