import { HarnessError } from "../../core/errors/index.ts";
import {
  computePolicyChecksum,
  detectPolicyDrift,
  generateDefaultRepoPolicy,
  inspectRepoPolicy,
  loadRepoPolicy,
  parseRepoPolicy,
  saveRepoPolicy,
  type RepoEcosystem,
  type RepoPolicy,
} from "../../policy/index.ts";
import {
  auditRepoGovernanceCoverage,
  discoverAndCalibrateRepoPolicy,
  awakenTier0Governance,
} from "../../mind/governance/policy-discovery.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null) {
      return undefined;
    }
    if (current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, part)) {
      return undefined;
    }
    current = record[part];
  }
  return current;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split(".");
  const root = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === undefined) {
      continue;
    }
    const sub = current[part];
    if (typeof sub !== "object") {
      current[part] = {};
    } else if (sub === null) {
      current[part] = {};
    } else if (sub === undefined) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];
  if (lastKey !== undefined) {
    current[lastKey] = value;
  }
  return root;
}

function parseCoercedValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
    if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
    return raw;
  }
}

export async function policyInitCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const flagRepo = textFlag(flags, "repo", false);
  const flagRepoRoot = textFlag(flags, "repo-root", false);
  const flagDir = textFlag(flags, "dir", false);
  const repo =
    flagRepo !== undefined ? flagRepo : flagRepoRoot !== undefined ? flagRepoRoot : flagDir;

  const flagRun = textFlag(flags, "run", false);
  const flagRunRoot = textFlag(flags, "run-root", false);
  const capsuleRun = flagRun !== undefined ? flagRun : flagRunRoot;

  const explicitEcosystem = textFlag(flags, "ecosystem", false) as RepoEcosystem | undefined;
  const calibrate = boolFlag(flags, "calibrate") ? true : boolFlag(flags, "auto-discover");
  const awaken = boolFlag(flags, "awaken") ? true : boolFlag(flags, "first-responder");
  const testCommands = boolFlag(flags, "test-commands");

  let policy: RepoPolicy;
  let filePath: string;

  if (awaken) {
    const targetRepo = repo !== undefined ? repo : ".";
    const targetRun = capsuleRun !== undefined ? capsuleRun : "";
    const awakening = awakenTier0Governance({
      repoRoot: targetRepo,
      runRoot: targetRun,
      mindId: "mind",
      testCommands: testCommands ? true : true,
      overrideEcosystem: explicitEcosystem,
    });
    return {
      ok: true,
      awakened: true,
      file_path: awakening.policyPath,
      policy: awakening.policy,
      ecosystem: awakening.policy.ecosystem,
      awakened_agents: awakening.awakenedAgents,
      empirical_report: awakening.empiricalReport,
      governance: awakening.governance,
      markdown: `### Policy Initialized & Tier 0 Awakened\n\n- **File**: \`${awakening.policyPath}\`\n- **Ecosystem**: \`${awakening.policy.ecosystem}\`\n- **Awakened Agents**: ${awakening.awakenedAgents.map((a) => a.role).join(", ")}\n- **Commands Verified**: ${awakening.empiricalReport.verifiedCommands.length}`,
    };
  }

  if (calibrate && !explicitEcosystem) {
    const targetRepo = repo !== undefined ? repo : ".";
    const result = discoverAndCalibrateRepoPolicy(targetRepo);
    policy = result.calibratedPolicy;
    filePath = saveRepoPolicy(policy, repo);
  } else {
    policy = generateDefaultRepoPolicy(repo, explicitEcosystem);
    filePath = saveRepoPolicy(policy, repo);
  }

  return {
    ok: true,
    file_path: filePath,
    policy,
    ecosystem: policy.ecosystem,
    markdown: `### Policy Initialized\n\n- **File**: \`${filePath}\`\n- **Ecosystem**: \`${policy.ecosystem}\``,
  };
}

export async function policyGetCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const repo = textFlag(flags, "repo", false);
  const key = textFlag(flags, "key", false);

  const policy = loadRepoPolicy(repo);
  if (key !== undefined && key.length > 0) {
    const value = getNestedValue(policy, key);
    if (value === undefined) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Configuration key "${key}" not found in repository policy`,
      );
    }
    return {
      ok: true,
      key,
      value,
      policy,
      markdown: `### Policy Key: \`${key}\`\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
    };
  }

  return {
    ok: true,
    policy,
    markdown: `### Repository Policy\n\n\`\`\`json\n${JSON.stringify(policy, null, 2)}\n\`\`\``,
  };
}

export async function policySetCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const repo = textFlag(flags, "repo", false);
  const key = textFlag(flags, "key", true);
  const rawValue = textFlag(flags, "value", true);

  if (key === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--key and --value flags are required for policy:set",
    );
  }
  if (rawValue === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--key and --value flags are required for policy:set",
    );
  }

  const parsedValue = parseCoercedValue(rawValue);
  const currentPolicy = loadRepoPolicy(repo);

  const updatedRaw = setNestedValue(
    currentPolicy as unknown as Record<string, unknown>,
    key,
    parsedValue,
  );
  const validatedPolicy = parseRepoPolicy(updatedRaw);
  const savedPath = saveRepoPolicy(validatedPolicy, repo);

  return {
    ok: true,
    key,
    value: parsedValue,
    policy: validatedPolicy,
    file_path: savedPath,
    markdown: `### Policy Key Updated\n\n- **Key**: \`${key}\`\n- **Value**: \`${JSON.stringify(parsedValue)}\`\n- **Saved**: \`${savedPath}\``,
  };
}

export async function policyCheckDriftCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const repo = textFlag(flags, "repo", false);
  const expectedChecksum = textFlag(flags, "checksum", false);
  const strict = boolFlag(flags, "strict");

  const currentChecksum = computePolicyChecksum(repo);
  const inspection = inspectRepoPolicy(repo);

  let drifted = false;
  if (expectedChecksum !== undefined) {
    const driftResult = detectPolicyDrift(expectedChecksum, repo);
    drifted = driftResult.drifted;
  }

  if (inspection.status === "invalid_custom") {
    drifted = true;
  }

  const isInvalid = strict && (drifted ? true : inspection.status === "invalid_custom");
  if (isInvalid) {
    const errorMsg =
      inspection.error !== undefined
        ? inspection.error
        : `checksum ${currentChecksum} != expected ${expectedChecksum}`;
    throw new HarnessError(
      "INTEGRITY",
      `Policy drift or corruption detected for repository: ${errorMsg}`,
    );
  }

  const status = drifted ? "drifted" : "in_sync";
  return {
    ok: true,
    status,
    drifted,
    checksum: currentChecksum,
    policy_status: inspection.status,
    markdown: `### Policy Drift Status\n\n- **Status**: \`${status}\`\n- **Checksum**: \`${currentChecksum}\`\n- **Policy Status**: \`${inspection.status}\``,
  };
}

export async function policyAuditCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const flagRepo = textFlag(flags, "repo", false);
  const flagRepoRoot = textFlag(flags, "repo-root", false);
  const flagDir = textFlag(flags, "dir", false);
  const repo =
    flagRepo !== undefined ? flagRepo : flagRepoRoot !== undefined ? flagRepoRoot : flagDir;

  const flagRun = textFlag(flags, "run", false);
  const flagRunRoot = textFlag(flags, "run-root", false);
  const capsuleRun = flagRun !== undefined ? flagRun : flagRunRoot;

  const targetRepo = repo !== undefined ? repo : ".";
  const report = auditRepoGovernanceCoverage(targetRepo, capsuleRun);

  return {
    ok: true,
    report,
    ready: report.readyForMindAuditor,
    markdown: `### Governance Coverage Audit\n\n- **Repo**: \`${report.repoRoot}\`\n- **Policy Present**: \`${report.policyPresent ? "yes" : "no"}\`\n- **Policy Valid**: \`${report.policyValid ? "yes" : "no"}\`\n- **Ecosystem**: \`${report.ecosystem}\`\n- **Has Test Runner**: \`${report.hasTestRunner ? "yes" : "no"}\`\n- **Has Typecheck**: \`${report.hasTypecheck ? "yes" : "no"}\`\n- **Has Linter**: \`${report.hasLinter ? "yes" : "no"}\`\n- **Allowed Commands**: ${report.allowedCommandCount}\n- **Ready For Mind Auditor**: \`${report.readyForMindAuditor ? "yes" : "no"}\``,
  };
}
