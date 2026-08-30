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
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current === null ||
      typeof current !== "object" ||
      !(part in (current as Record<string, unknown>))
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
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
    const part = parts[i]!;
    if (typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1]!;
  current[lastKey] = value;
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
  const repo =
    textFlag(flags, "repo", false) ??
    textFlag(flags, "repo-root", false) ??
    textFlag(flags, "dir", false);
  const explicitEcosystem = textFlag(flags, "ecosystem", false) as RepoEcosystem | undefined;

  const policy = generateDefaultRepoPolicy(repo, explicitEcosystem);
  const filePath = saveRepoPolicy(policy, repo);

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
  if (key) {
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
  const key = textFlag(flags, "key", true)!;
  const rawValue = textFlag(flags, "value", true)!;

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

  if (strict && (drifted || inspection.status === "invalid_custom")) {
    throw new HarnessError(
      "INTEGRITY",
      `Policy drift or corruption detected for repository: ${inspection.error ?? `checksum ${currentChecksum} != expected ${expectedChecksum}`}`,
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
