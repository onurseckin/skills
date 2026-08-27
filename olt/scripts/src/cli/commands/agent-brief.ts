import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUnifiedAgentManifest } from "../../authority/manifest-schema.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { loadRepoPolicy } from "../../policy/repo-policy.ts";
import type { Flags } from "../options.ts";

export function executeAgentBrief(options: {
  role: string;
  format?: string;
  repoRoot?: string;
}): string {
  const agentPath = join(import.meta.dir, "..", "..", "..", "..", "agents", `${options.role}.yaml`);
  const rawYaml = readFileSync(agentPath, "utf-8");
  const manifest = parseUnifiedAgentManifest(rawYaml, agentPath);

  const repoPolicy = loadRepoPolicy(options.repoRoot);

  const sections: string[] = [];

  sections.push(`================================================================================
SECTION 1: SYSTEM IDENTITY & HOST TOOL PROTOCOL
================================================================================
ROLE: ${manifest.role}
TIER: ${manifest.tier}
DISPLAY NAME: ${manifest.interface.display_name}
DESCRIPTION: ${manifest.interface.short_description}
PROTOCOL: ${manifest.protocol.cli} (Zero JSON: ${manifest.protocol.zero_json})
TOOLS ENABLED: Subagent: ${manifest.tools.enable_subagent_tools} | Write: ${manifest.tools.enable_write_tools}`);

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
${manifest.invariants.map((i) => `  - ${i}`).join("\n")}`);

  sections.push(`================================================================================
SECTION 3: REPOSITORY POLICY & PERMISSION BOUNDARIES
================================================================================
ALLOWED COMMANDS:
${manifest.permissions.commands.length > 0 ? manifest.permissions.commands.map((c) => `  - ${c}`).join("\n") : "  (None)"}

GLOBAL CAPABILITIES AVAILABLE (POLICY):
${repoPolicy.allowed_commands && repoPolicy.allowed_commands.length > 0 ? repoPolicy.allowed_commands.map((c) => `  - ${c}`).join("\n") : "  (None)"}

SCRATCH HYGIENE:
All temporary scripts and files must strictly be written to \`scratch/\` (or \`.olt/scratch/\`). Root directory hygiene is enforced.

TEST EXECUTION RULES:
- Cognitive Validators: 0 test suite executions allowed.
- Implementers: Only file-scoped unit tests. Whole repo \`bun test\` is strictly prohibited.
- Supervisors: 0 code modifications or raw test executions allowed.`);

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
  if (!role) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing --role");
  }
  const opts: { role: string; format?: string; repoRoot?: string } = {
    role,
    repoRoot: findRepoRoot(cwd),
  };
  if (format !== undefined) {
    opts.format = format;
  }
  const output = executeAgentBrief(opts);
  return { markdown: output };
}

export async function agentDefineCommand(_flags: Flags): Promise<Record<string, unknown>> {
  return { markdown: "agent:define not fully implemented yet" };
}
