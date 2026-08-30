import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeRoleKey, resolveAgentHostConfiguration } from "../../authority/host-bindings.ts";
import { parseUnifiedAgentManifest } from "../../authority/manifest-schema.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot, resolveSkillHomeRepo } from "../../core/index.ts";
import { detectActiveHost, isHostType, type HostType } from "../../platform/host-autodetect.ts";
import { loadRepoPolicy } from "../../policy/repo-policy.ts";
import type { AgentHostPolicy } from "../../policy/types/index.ts";
import type { Flags } from "../options.ts";
import {
  verifyMilestoneEvidence,
  type MilestoneEvidenceVerification,
} from "../../mind/evidence/index.ts";

export interface AgentBriefOptions {
  readonly role: string;
  readonly host?: HostType | undefined;
  readonly format?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly capsulePath?: string | undefined;
}

function findAgentManifestPath(role: string, repoRoot?: string): string {
  const root = repoRoot ?? findRepoRoot();
  const normalized = normalizeRoleKey(role);
  const kebab = role.replace(/_/g, "-");
  const snake = role.replace(/-/g, "_");
  const names = Array.from(
    new Set([
      role,
      kebab,
      snake,
      normalized,
      normalized.replace(/_/g, "-"),
      role.replace(/^mind_supervisor$/, "mind"),
      role.replace(/^mind-supervisor$/, "mind"),
      role.replace(/^completeness_critic$/, "critic"),
      role.replace(/^completeness_critic$/, "completeness-critic"),
      role.replace(/^completeness-critic$/, "critic"),
      role.replace(/^validator_code_quality$/, "validator"),
      role.replace(/^validator-code-quality$/, "validator"),
      role.replace(/^implementer$/, "worker"),
    ]),
  );

  const searchDirs = [
    join(root, "olt", "agents"),
    join(root, "agents"),
    join(import.meta.dir, "..", "..", "..", "..", "agents"),
    join(import.meta.dir, "..", "..", "..", "agents"),
    join(homedir(), ".agents", "skills", "olt", "agents"),
    join(resolveSkillHomeRepo(root), "olt", "agents"),
  ];

  for (const dir of searchDirs) {
    for (const name of names) {
      for (const ext of [".yaml", ".yml"]) {
        const full = join(dir, `${name}${ext}`);
        if (existsSync(full)) {
          return full;
        }
      }
    }
  }

  throw new HarnessError("INVALID_ARGUMENT", `Agent manifest not found for role '${role}'`);
}

export function executeAgentBrief(options: AgentBriefOptions): string {
  const repoPolicy = loadRepoPolicy(options.repoRoot);
  const agentPath = findAgentManifestPath(options.role, options.repoRoot);
  const rawYaml = readFileSync(agentPath, "utf-8");
  const manifest = parseUnifiedAgentManifest(rawYaml, agentPath);

  let activeHost: HostType | undefined = options.host;
  if (!activeHost) {
    try {
      activeHost = detectActiveHost();
    } catch {
      activeHost = undefined;
    }
  }

  let activeHostPolicy: AgentHostPolicy | undefined;
  if (activeHost) {
    try {
      activeHostPolicy = resolveAgentHostConfiguration(
        options.role,
        activeHost,
        repoPolicy,
        options.repoRoot,
      );
    } catch {
      activeHostPolicy = undefined;
    }
  }

  const canonicalHosts: readonly HostType[] = ["antigravity", "claude_code", "codex", "cursor"];
  const hostBindingsLines: string[] = [];
  for (const h of canonicalHosts) {
    try {
      const cfg = resolveAgentHostConfiguration(options.role, h, repoPolicy, options.repoRoot);
      const thinking = cfg.thinking_effort ? `, Thinking: ${cfg.thinking_effort}` : "";
      const budget = cfg.token_budget ?? cfg.max_tokens;
      const tokenInfo = budget ? `, Tokens: ${budget}` : "";
      hostBindingsLines.push(
        `  - ${h}: ${cfg.model} (Tier: ${cfg.model_tier}${thinking}${tokenInfo})`,
      );
    } catch {}
  }

  const sections: string[] = [];

  const hostInfoLines: string[] = [];
  if (activeHost && activeHostPolicy) {
    hostInfoLines.push(`ACTIVE HOST: ${activeHost}`);
    hostInfoLines.push(
      `MODEL BINDING: ${activeHostPolicy.model} (Tier: ${activeHostPolicy.model_tier})`,
    );
    if (activeHostPolicy.thinking_effort) {
      hostInfoLines.push(`THINKING EFFORT: ${activeHostPolicy.thinking_effort}`);
    }
    if (activeHostPolicy.token_budget || activeHostPolicy.max_tokens) {
      hostInfoLines.push(
        `TOKEN BUDGET: ${activeHostPolicy.token_budget ?? activeHostPolicy.max_tokens}`,
      );
    }
  }
  if (hostBindingsLines.length > 0) {
    hostInfoLines.push("HOST MODEL BINDINGS:\n" + hostBindingsLines.join("\n"));
  }

  const section1 = [
    "ROLE: " + manifest.role,
    "TIER: " + manifest.tier,
    "DISPLAY NAME: " + manifest.interface.display_name,
    "DESCRIPTION: " + manifest.interface.short_description,
    "PROTOCOL: " + manifest.protocol.cli + " (Zero JSON: " + manifest.protocol.zero_json + ")",
    "TOOLS ENABLED: Subagent: " +
      manifest.tools.enable_subagent_tools +
      " | Write: " +
      manifest.tools.enable_write_tools,
    ...hostInfoLines,
  ].join("\n");

  sections.push(`================================================================================
SECTION 1: SYSTEM IDENTITY & HOST TOOL PROTOCOL
================================================================================
${section1}`);

  sections.push(`================================================================================
SECTION 2: CONSTITUTIONAL PERMISSIONS & INVARIANTS
================================================================================
MAY:
${manifest.permissions.may.map((p) => `  - ${p}`).join("\n")}

MUST NOT:
${manifest.permissions.must_not.map((p) => `  - ${p}`).join("\n")}

SPAWNS ALLOWED:
${manifest.permissions.spawns.length > 0 ? manifest.permissions.spawns.map((p) => `  - ${p}`).join("\n") : "  (None)"}

INVARIANTS:
${manifest.invariants.map((i) => `  - ${i}`).join("\n")}
  - Anti-Prose Evidence Invariant: Milestone transitions mandate cryptographic event hash chains and exit_code === 0 receipts.`);

  const normalizedKey = normalizeRoleKey(options.role);
  const rolePolicy = repoPolicy.agents?.[normalizedKey] ?? repoPolicy.agents?.[options.role];
  const rbacAllowed = rolePolicy?.rbac?.allowed_commands ?? [];

  sections.push(`================================================================================
SECTION 3: REPOSITORY POLICY & PERMISSION BOUNDARIES
================================================================================
ALLOWED COMMANDS:
${manifest.permissions.commands && manifest.permissions.commands.length > 0 ? manifest.permissions.commands.map((c) => `  - ${c}`).join("\n") : "  (None)"}

ROLE CAPABILITIES (POLICY):
${rbacAllowed.length > 0 ? rbacAllowed.map((c) => `  - ${c}`).join("\n") : "  (None)"}

GLOBAL CAPABILITIES AVAILABLE (POLICY):
${repoPolicy.allowed_commands && repoPolicy.allowed_commands.length > 0 ? repoPolicy.allowed_commands.map((c) => `  - ${c}`).join("\n") : "  (None)"}

SCRATCH HYGIENE:
All temporary scripts and files must strictly be written to \`scratch/\` (or \`.olt/scratch/\`). Root directory hygiene is enforced.

TEST EXECUTION RULES:
- Cognitive Validators: 0 test suite executions allowed.
- Implementers: Only file-scoped unit tests. Whole repo \`bun test\` is strictly prohibited.
- Supervisors: 0 code modifications or raw test executions allowed.
- Evidence Requirement: Prose assertions cannot substitute for cryptographic command receipts.`);

  if (options.capsulePath) {
    const verification = verifyMilestoneEvidence(options.capsulePath, "ignition");
    sections.push(`================================================================================
SECTION 3.5: CAPSULE MILESTONE EVIDENCE VERIFICATION
================================================================================
STATUS: ${verification.certified ? "CERTIFIED" : "FAILED"}
CAPSULE: ${options.capsulePath}
SUMMARY: ${verification.summary}
HASH CHAIN: ${verification.hashChain.valid ? "VALID" : "INVALID"} (${verification.hashChain.totalEvents} events)
RECEIPTS: ${verification.commandReceipts.length} total, ${verification.failedReceipts.length} failed`);
  }

  const normalizedRoleName = normalizeRoleKey(options.role);
  if (normalizedRoleName === "coordinator" || options.role.toLowerCase().includes("coordinator")) {
    sections.push(`================================================================================
SECTION 3.8: MANDATORY TURN 1 DISPATCH TEMPLATE (ANTI-DIRECT-EXECUTION SENTINEL)
================================================================================
CRITICAL ANTI-DIRECT-EXECUTION INVARIANT (SUPERVISOR_ZERO_CODE_EDITS / ROLE_BOUNDARY_DEVIATION):
Coordinators are Tier 2 pure wave orchestrators and dispatchers. You are STRICTLY PROHIBITED from modifying code, writing files, or executing test suites directly.
Any direct file edit attempt by a coordinator is rejected with ROLE_BOUNDARY_DEVIATION.

MANDATORY TURN 1 EXECUTION SEQUENCE:
1. Initialize & compile the task DAG:
   bun harness.ts plan:compile --run <run_id>
2. Dispatch ready tasks immediately to Tier 3 Implementers and Validators in parallel worktrees using invoke_subagent:
   invoke_subagent({
     "Subagents": [
       {
         "TypeName": "implementer",
         "Role": "Domain Implementer",
         "Prompt": "<exact-anchor briefing with target files, symbols, write scope, and gate commands>"
       },
       {
         "TypeName": "validator",
         "Role": "Quality Validator",
         "Prompt": "<verification instructions for read-only deliverables inspection>"
       }
     ]
   })
3. Supervise wave execution and await subagent completion receipts.`);
  }

  sections.push(`================================================================================
SECTION 4: OPERATIONAL STEP-BY-STEP RUNBOOK
================================================================================
${manifest.instructions}`);

  return sections.join("\n\n");
}

export async function agentBriefCommand(
  flags: Flags,
  cwd = process.cwd(),
): Promise<Record<string, unknown>> {
  const role = typeof flags["role"] === "string" ? flags["role"] : "";
  const format = typeof flags["format"] === "string" ? flags["format"] : undefined;
  const hostFlag = typeof flags["host"] === "string" ? flags["host"] : undefined;
  const runFlag = typeof flags["run"] === "string" ? flags["run"] : undefined;
  if (!role) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing --role");
  }
  let host: HostType | undefined = undefined;
  if (hostFlag) {
    if (!isHostType(hostFlag)) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid --host value: '${hostFlag}'`);
    }
    host = hostFlag;
  }
  const opts: AgentBriefOptions = {
    role,
    repoRoot: findRepoRoot(cwd),
    ...(format !== undefined ? { format } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(runFlag !== undefined ? { capsulePath: runFlag } : {}),
  };
  const output = executeAgentBrief(opts);
  let milestoneEvidence: MilestoneEvidenceVerification | undefined = undefined;
  if (runFlag) {
    milestoneEvidence = verifyMilestoneEvidence(runFlag, "ignition");
  }
  return {
    markdown: output,
    ...(milestoneEvidence ? { milestone_evidence: milestoneEvidence } : {}),
  };
}

export async function agentDefineCommand(_flags: Flags): Promise<Record<string, unknown>> {
  return { markdown: "agent:define not fully implemented yet" };
}
