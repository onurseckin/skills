import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { enforceLineLimit, formatTable } from "../cli/formatters/line-limiter.ts";
import { HarnessError } from "../errors/harness-error.ts";
export * from "./pushbacks.ts";

export type BlunderCategory = "code_defect" | "model_reasoning_error" | "boundary_violation";

export type BlunderStatus = "open" | "resolved" | "wontfix";

export interface BlunderResolutionProof {
  readonly commit_sha?: string | null | undefined;
  readonly task_id: string;
  readonly test_assertion: string;
  readonly resolved_at: string;
  readonly remediation_notes?: string | undefined;
  readonly verified_by?: string | undefined;
}

export interface BlunderEntry {
  readonly id: string;
  readonly type: string;
  readonly severity: "critical" | "warning" | "high" | "low" | "info" | string;
  readonly timestamp: string;
  readonly category: BlunderCategory;
  readonly status: BlunderStatus;
  readonly observation: string;
  readonly remediation: string;
  readonly role?: string | undefined;
  readonly message?: string | undefined;
  readonly prescribed_remediation?: string | undefined;
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly agent_id?: string | null | undefined;
  readonly context?:
    | {
        readonly cwd?: string | undefined;
        readonly indicators?: Readonly<Record<string, string>> | undefined;
        readonly [key: string]: unknown;
      }
    | undefined;
  readonly count?: number | undefined;
  readonly first_seen_at?: string | undefined;
  readonly last_seen_at?: string | undefined;
  readonly occurrences?: readonly unknown[] | undefined;
  readonly resolution?: BlunderResolutionProof | null | undefined;
  readonly capsule_root?: string | null | undefined;
}

export interface BlunderAuditReport {
  readonly total_blunders: number;
  readonly open_count: number;
  readonly resolved_count: number;
  readonly wontfix_count: number;
  readonly by_category: Readonly<Record<BlunderCategory, number>>;
  readonly by_severity: Readonly<Record<string, number>>;
  readonly blunders: readonly BlunderEntry[];
  readonly capsules_audited: readonly string[];
  readonly generated_at: string;
}

export interface MindCandidateProposal {
  readonly id: string;
  readonly kind: "proposal" | "defect";
  readonly statement: string;
  readonly rationale: string;
  readonly charter_goal_ids: readonly string[];
  readonly write_scope: readonly string[];
  readonly status: "opened" | "needs_authority" | "admitted" | "declined" | string;
  readonly disposition?: "needs_authority" | "actionable" | "out_of_scope" | undefined;
  readonly falsifier_argv?: readonly string[] | undefined;
  readonly falsifier_exit?: number | undefined;
  readonly blunder_id?: string | undefined;
  readonly evidence_class?: string | undefined;
  readonly created_at?: string | undefined;
}

export interface ParseBlunderLogOptions {
  readonly capsuleRoot?: string | undefined;
}

export interface FormatBlunderAuditBriefOptions {
  readonly maxLines?: number | undefined;
}

export interface BlunderHypothesis {
  readonly id: string;
  readonly blunder_id: string;
  readonly root_cause: string;
  readonly confidence: number;
  readonly category: BlunderCategory;
  readonly evidence: readonly string[];
}

export interface BlunderRemediationAction {
  readonly action_id: string;
  readonly blunder_id: string;
  readonly target_scope: readonly string[];
  readonly action_type:
    | "fix_code"
    | "tighten_boundary"
    | "align_reasoning"
    | "add_test_gate"
    | "update_invariants";
  readonly description: string;
  readonly prescribed_test: string;
  readonly status: "planned" | "executed" | "verified" | "failed";
}

export interface BlunderRemediationSynthesis {
  readonly synthesis_id: string;
  readonly summary: string;
  readonly resolved_blunder_ids: readonly string[];
  readonly unresolved_blunder_ids: readonly string[];
  readonly remediation_plan: readonly string[];
  readonly empirical_proofs: readonly BlunderResolutionProof[];
  readonly readiness_for_convergence: boolean;
  readonly recommendation: "converge" | "advance_round" | "escalate_to_authority";
}

export interface BlunderDeliberationRound {
  readonly round_number: number;
  readonly opened_at: string;
  readonly closed_at?: string | null | undefined;
  readonly blunder_ids: readonly string[];
  readonly hypotheses: readonly BlunderHypothesis[];
  readonly remediation_actions: readonly BlunderRemediationAction[];
  readonly synthesis: BlunderRemediationSynthesis;
  readonly status: "deliberating" | "converged" | "escalated" | "exhausted";
}

export interface DeliberationPipelineOptions {
  readonly maxRounds?: number | undefined;
  readonly convergenceThreshold?: number | undefined;
  readonly defaultWriteScope?: readonly string[] | undefined;
  readonly requireCommitSha?: boolean | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Categorizes a blunder entry into one of the canonical categories:
 * - boundary_violation: main thread direct execution, unauthorized mutation, role/tier escalation, role amnesia/confusion
 * - model_reasoning_error: hallucination, logic drift, wrong premise, self-critique failure, plan revision paralysis
 * - code_defect: syntax, type error, test failure, failing gate, runtime defect
 */
export function categorizeBlunder(
  entry:
    | BlunderEntry
    | Record<string, unknown>
    | {
        readonly id?: string | undefined;
        readonly type?: string | undefined;
        readonly observation?: string | undefined;
        readonly remediation?: string | undefined;
        readonly message?: string | undefined;
        readonly prescribed_remediation?: string | undefined;
        readonly category?: string | undefined;
        readonly role?: string | undefined;
      },
): BlunderCategory {
  if (isRecord(entry)) {
    const existingCategory = normalizeText(entry.category);
    if (existingCategory === "role_confusion") {
      return "boundary_violation";
    }
    if (existingCategory === "boundary_violation") {
      return "boundary_violation";
    }
    if (existingCategory === "model_reasoning_error") {
      return "model_reasoning_error";
    }
    if (existingCategory === "code_defect") {
      return "code_defect";
    }
  }

  const rawId = isRecord(entry) ? normalizeText(entry.id) : "";
  const rawType = isRecord(entry) ? normalizeText(entry.type) : "";
  const rawRole = isRecord(entry) ? normalizeText(entry.role) : "";
  const rawObservation = isRecord(entry)
    ? normalizeText(entry.observation) || normalizeText(entry.message)
    : "";
  const rawRemediation = isRecord(entry)
    ? normalizeText(entry.remediation) || normalizeText(entry.prescribed_remediation)
    : "";

  const fullSearchSpace = `${rawId} ${rawType} ${rawRole} ${rawObservation} ${rawRemediation}`;

  // Boundary violation patterns
  const isBoundary =
    rawType.includes("role_confusion") ||
    rawType.includes("role_leak") ||
    rawType.includes("role_amnesia") ||
    rawType.includes("identity") ||
    rawType.includes("main_thread") ||
    rawType.includes("boundary") ||
    rawType.includes("unauthorized") ||
    rawType.includes("role_escalation") ||
    rawType.includes("restraint") ||
    rawType.includes("thread_authority") ||
    rawType.includes("tier") ||
    rawType.includes("permission") ||
    rawType.includes("sandbox_escape") ||
    rawType.includes("scope_escape") ||
    rawId.includes("role-leak") ||
    rawId.includes("role-amnesia") ||
    rawId.includes("identity") ||
    rawId.includes("boundary") ||
    rawId.includes("main-thread") ||
    rawId.includes("orch-role") ||
    fullSearchSpace.includes("main thread") ||
    fullSearchSpace.includes("restraint active") ||
    fullSearchSpace.includes("boundary violation") ||
    fullSearchSpace.includes("boundary") ||
    fullSearchSpace.includes("boundaries") ||
    fullSearchSpace.includes("write scope") ||
    fullSearchSpace.includes("unauthorized mutation") ||
    fullSearchSpace.includes("human shell") ||
    fullSearchSpace.includes("subagent boundary") ||
    fullSearchSpace.includes("subagent delegation") ||
    fullSearchSpace.includes("role escalation") ||
    fullSearchSpace.includes("role confusion") ||
    fullSearchSpace.includes("role amnesia") ||
    fullSearchSpace.includes("identity and role") ||
    fullSearchSpace.includes("direct file edit") ||
    fullSearchSpace.includes("direct test run") ||
    fullSearchSpace.includes("whoami") ||
    fullSearchSpace.includes("failed to actively police");

  if (isBoundary) {
    return "boundary_violation";
  }

  // Model reasoning error patterns
  const isReasoningError =
    rawType.includes("reasoning") ||
    rawType.includes("hallucination") ||
    rawType.includes("logic") ||
    rawType.includes("assumption") ||
    rawType.includes("plan_drift") ||
    rawType.includes("intent_drift") ||
    rawType.includes("instruction_drift") ||
    rawType.includes("self_critique") ||
    rawType.includes("context_loss") ||
    rawType.includes("premise") ||
    rawType.includes("inertia") ||
    rawType.includes("paralysis") ||
    rawType.includes("idle_death") ||
    rawType.includes("self_termination") ||
    rawId.includes("paralysis") ||
    rawId.includes("drift") ||
    rawId.includes("hallucination") ||
    rawId.includes("idle-death") ||
    rawId.includes("self-termination") ||
    fullSearchSpace.includes("reasoning error") ||
    fullSearchSpace.includes("hallucination") ||
    fullSearchSpace.includes("illogical") ||
    fullSearchSpace.includes("incorrect premise") ||
    fullSearchSpace.includes("wrong assumption") ||
    fullSearchSpace.includes("invalid assumption") ||
    fullSearchSpace.includes("failed to adhere") ||
    fullSearchSpace.includes("intent drift") ||
    fullSearchSpace.includes("instruction drift") ||
    fullSearchSpace.includes("plan drift") ||
    fullSearchSpace.includes("plan revision paralysis") ||
    fullSearchSpace.includes("passive inertia") ||
    fullSearchSpace.includes("revision paralysis") ||
    fullSearchSpace.includes("context loss") ||
    fullSearchSpace.includes("self-critique") ||
    fullSearchSpace.includes("self critique") ||
    fullSearchSpace.includes("sleep loop") ||
    fullSearchSpace.includes("idle death") ||
    fullSearchSpace.includes("self-termination") ||
    fullSearchSpace.includes("perpetual consciousness");

  if (isReasoningError) {
    return "model_reasoning_error";
  }

  // Default category
  return "code_defect";
}

/**
 * Validates a blunder resolution proof against empirical standards.
 */
export function validateResolutionProof(
  proof: unknown,
  options: { readonly requireCommitSha?: boolean | undefined } = {},
): BlunderResolutionProof {
  if (!isRecord(proof)) {
    throw new HarnessError("INVALID_ARGUMENT", "resolution proof must be an object");
  }

  const taskId = typeof proof.task_id === "string" ? proof.task_id.trim() : "";
  const testAssertion = typeof proof.test_assertion === "string" ? proof.test_assertion.trim() : "";
  const resolvedAt = typeof proof.resolved_at === "string" ? proof.resolved_at.trim() : "";
  const commitSha =
    typeof proof.commit_sha === "string" && proof.commit_sha.trim()
      ? proof.commit_sha.trim()
      : proof.commit_sha === null
        ? null
        : undefined;

  const remediationNotes =
    typeof proof.remediation_notes === "string" && proof.remediation_notes.trim()
      ? proof.remediation_notes.trim()
      : undefined;

  const verifiedBy =
    typeof proof.verified_by === "string" && proof.verified_by.trim()
      ? proof.verified_by.trim()
      : undefined;

  if (!taskId) {
    throw new HarnessError("INVALID_ARGUMENT", "resolution proof requires non-empty task_id");
  }
  if (!testAssertion) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "resolution proof requires non-empty test_assertion",
    );
  }
  if (!resolvedAt) {
    throw new HarnessError("INVALID_ARGUMENT", "resolution proof requires non-empty resolved_at");
  }

  const parsedDate = Date.parse(resolvedAt);
  if (!Number.isFinite(parsedDate)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `resolution proof resolved_at '${resolvedAt}' is not a valid ISO date timestamp`,
    );
  }

  if (options.requireCommitSha && (!commitSha || commitSha.length < 7)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "resolution proof requires valid commit_sha when requireCommitSha is enabled",
    );
  }

  return {
    task_id: taskId,
    test_assertion: testAssertion,
    resolved_at: resolvedAt,
    ...(commitSha !== undefined ? { commit_sha: commitSha } : {}),
    ...(remediationNotes !== undefined ? { remediation_notes: remediationNotes } : {}),
    ...(verifiedBy !== undefined ? { verified_by: verifiedBy } : {}),
  };
}

/**
 * Checks empirical proof integrity for resolution.
 */
export function verifyResolutionProofEmpirical(
  proof: BlunderResolutionProof,
  options: { readonly requireCommitSha?: boolean | undefined } = {},
): { readonly isValid: boolean; readonly reason?: string | undefined } {
  try {
    validateResolutionProof(proof, options);
    if (proof.test_assertion.length < 5) {
      return { isValid: false, reason: "test_assertion is too brief to be empirical" };
    }
    return { isValid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isValid: false, reason: msg };
  }
}

/**
 * Parses raw JSONL or JSON content into a typed array of BlunderEntry items.
 */
export function parseBlunderLog(
  content: string,
  options: ParseBlunderLogOptions = {},
): BlunderEntry[] {
  if (typeof content !== "string") {
    return [];
  }
  if (!content.trim()) {
    return [];
  }

  const lines = content.split("\n");
  const entries: BlunderEntry[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (rawLine === undefined) {
      continue;
    }
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isRecord(parsed)) {
        continue;
      }

      const id =
        typeof parsed.id === "string" && parsed.id.trim()
          ? parsed.id.trim()
          : `blunder-${Date.now()}-${i}`;

      const rawObservation =
        typeof parsed.observation === "string" && parsed.observation.trim()
          ? parsed.observation.trim()
          : typeof parsed.message === "string" && parsed.message.trim()
            ? parsed.message.trim()
            : "";

      const rawRemediation =
        typeof parsed.remediation === "string" && parsed.remediation.trim()
          ? parsed.remediation.trim()
          : typeof parsed.prescribed_remediation === "string" &&
              parsed.prescribed_remediation.trim()
            ? parsed.prescribed_remediation.trim()
            : "";

      const rawType =
        typeof parsed.type === "string" && parsed.type.trim()
          ? parsed.type.trim()
          : typeof parsed.id === "string" && parsed.id.trim()
            ? parsed.id.trim()
            : typeof parsed.category === "string" && parsed.category.trim()
              ? parsed.category.trim()
              : "unspecified_blunder";

      const rawSeverity =
        typeof parsed.severity === "string" && parsed.severity.trim()
          ? parsed.severity.trim().toLowerCase()
          : "warning";

      const timestamp =
        typeof parsed.timestamp === "string" && parsed.timestamp.trim()
          ? parsed.timestamp.trim()
          : new Date().toISOString();

      const pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
      const ppid = typeof parsed.ppid === "number" ? parsed.ppid : undefined;
      const agent_id =
        typeof parsed.agent_id === "string"
          ? parsed.agent_id
          : parsed.agent_id === null
            ? null
            : undefined;

      const role =
        typeof parsed.role === "string" && parsed.role.trim() ? parsed.role.trim() : undefined;

      const context = isRecord(parsed.context)
        ? (parsed.context as BlunderEntry["context"])
        : undefined;

      const rawStatus =
        typeof parsed.status === "string" ? parsed.status.trim().toLowerCase() : "open";
      const status: BlunderStatus =
        rawStatus === "resolved"
          ? "resolved"
          : rawStatus === "wontfix" || rawStatus === "wont_fix" || rawStatus === "wont-fix"
            ? "wontfix"
            : "open";

      let resolution: BlunderResolutionProof | null | undefined = undefined;
      if (isRecord(parsed.resolution)) {
        try {
          resolution = validateResolutionProof(parsed.resolution);
        } catch {
          resolution = undefined;
        }
      } else if (parsed.resolution === null) {
        resolution = null;
      }

      const rawCat =
        typeof parsed.category === "string" ? parsed.category.trim().toLowerCase() : "";
      const category: BlunderCategory =
        rawCat === "role_confusion" || rawCat === "boundary_violation"
          ? "boundary_violation"
          : rawCat === "model_reasoning_error"
            ? "model_reasoning_error"
            : rawCat === "code_defect"
              ? "code_defect"
              : categorizeBlunder(parsed);

      const capsuleRoot =
        typeof parsed.capsule_root === "string"
          ? parsed.capsule_root
          : options.capsuleRoot !== undefined
            ? options.capsuleRoot
            : undefined;

      const message =
        typeof parsed.message === "string" && parsed.message.trim()
          ? parsed.message.trim()
          : rawObservation || undefined;

      const prescribedRemediation =
        typeof parsed.prescribed_remediation === "string" && parsed.prescribed_remediation.trim()
          ? parsed.prescribed_remediation.trim()
          : rawRemediation || undefined;

      const count = typeof parsed.count === "number" && parsed.count > 0 ? parsed.count : 1;
      const firstSeen =
        typeof parsed.first_seen_at === "string" && parsed.first_seen_at.trim()
          ? parsed.first_seen_at.trim()
          : timestamp;
      const lastSeen =
        typeof parsed.last_seen_at === "string" && parsed.last_seen_at.trim()
          ? parsed.last_seen_at.trim()
          : timestamp;

      const occurrences = Array.isArray(parsed.occurrences) ? parsed.occurrences : undefined;

      const entry: BlunderEntry = {
        id,
        type: rawType,
        severity: rawSeverity,
        timestamp,
        category,
        status,
        observation: rawObservation,
        remediation: rawRemediation,
        count,
        first_seen_at: firstSeen,
        last_seen_at: lastSeen,
        ...(occurrences !== undefined ? { occurrences } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(prescribedRemediation !== undefined
          ? { prescribed_remediation: prescribedRemediation }
          : {}),
        ...(pid !== undefined ? { pid } : {}),
        ...(ppid !== undefined ? { ppid } : {}),
        ...(agent_id !== undefined ? { agent_id } : {}),
        ...(context !== undefined ? { context } : {}),
        ...(resolution !== undefined ? { resolution } : {}),
        ...(capsuleRoot !== undefined ? { capsule_root: capsuleRoot } : {}),
      };

      entries.push(entry);
    } catch {
      // Ignore corrupted or malformed lines gracefully
    }
  }

  return entries;
}

/**
 * Serializes an array of BlunderEntry records into a JSONL string.
 */
export function serializeBlunderLog(blunders: readonly BlunderEntry[]): string {
  if (!Array.isArray(blunders) || blunders.length === 0) {
    return "";
  }

  let result = "";
  for (let i = 0; i < blunders.length; i += 1) {
    const blunder = blunders[i];
    if (blunder !== undefined) {
      result += `${JSON.stringify(blunder)}\n`;
    }
  }
  return result;
}

/**
 * Updates a blunder entry with verified resolution proof.
 */
export function resolveBlunder(
  blunder: BlunderEntry,
  proof: BlunderResolutionProof,
  options: { readonly requireCommitSha?: boolean | undefined } = {},
): BlunderEntry {
  const validatedProof = validateResolutionProof(proof, options);

  return {
    ...blunder,
    status: "resolved",
    resolution: validatedProof,
  };
}

function findBlunderFiles(targetPath: string): string[] {
  const found: string[] = [];
  if (!existsSync(targetPath)) {
    return found;
  }

  try {
    const stats = lstatSync(targetPath);
    if (!stats.isDirectory()) {
      if (targetPath.endsWith(".jsonl") || targetPath.endsWith(".json")) {
        found.push(targetPath);
      }
      return found;
    }

    const directBlunders = join(targetPath, "blunders.jsonl");
    if (existsSync(directBlunders)) {
      found.push(directBlunders);
    }

    const capsuleBlunders = join(targetPath, ".capsules", "blunders.jsonl");
    if (existsSync(capsuleBlunders) && !found.includes(capsuleBlunders)) {
      found.push(capsuleBlunders);
    }

    const entries = readdirSync(targetPath);
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry !== undefined && !entry.startsWith(".")) {
        const subPath = join(targetPath, entry);
        try {
          const subStats = lstatSync(subPath);
          if (subStats.isDirectory()) {
            const subBlunders = join(subPath, "blunders.jsonl");
            if (existsSync(subBlunders) && !found.includes(subBlunders)) {
              found.push(subBlunders);
            }
          }
        } catch {
          // Non-fatal filesystem access error
        }
      }
    }
  } catch {
    // Non-fatal filesystem access error
  }

  return found;
}

/**
 * Scans one or more capsule roots for blunders.jsonl logs and builds an aggregated audit report.
 */
export function auditBlunderLog(capsuleRoots: readonly string[]): BlunderAuditReport {
  const auditedCapsules: string[] = [];
  const blunderMap = new Map<string, BlunderEntry>();

  for (let i = 0; i < capsuleRoots.length; i += 1) {
    const root = capsuleRoots[i];
    if (root === undefined || typeof root !== "string" || !root.trim()) {
      continue;
    }

    const absoluteRoot = resolve(root);
    if (!auditedCapsules.includes(absoluteRoot)) {
      auditedCapsules.push(absoluteRoot);
    }

    const blunderFiles = findBlunderFiles(absoluteRoot);
    for (let j = 0; j < blunderFiles.length; j += 1) {
      const filePath = blunderFiles[j];
      if (filePath !== undefined && existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, "utf8");
          const parsed = parseBlunderLog(content, { capsuleRoot: absoluteRoot });
          for (let k = 0; k < parsed.length; k += 1) {
            const entry = parsed[k];
            if (entry !== undefined) {
              const existing = blunderMap.get(entry.id);
              if (!existing) {
                blunderMap.set(entry.id, entry);
              } else if (entry.status === "resolved" && existing.status !== "resolved") {
                blunderMap.set(entry.id, entry);
              } else {
                blunderMap.set(entry.id, entry);
              }
            }
          }
        } catch {
          // File read error is handled non-fatally
        }
      }
    }
  }

  const allBlunders = Array.from(blunderMap.values());

  let openCount = 0;
  let resolvedCount = 0;
  let wontfixCount = 0;

  const categoryCounts: Record<BlunderCategory, number> = {
    code_defect: 0,
    model_reasoning_error: 0,
    boundary_violation: 0,
  };

  const severityCounts: Record<string, number> = {};

  for (let i = 0; i < allBlunders.length; i += 1) {
    const b = allBlunders[i];
    if (b !== undefined) {
      if (b.status === "open") {
        openCount += 1;
      } else if (b.status === "resolved") {
        resolvedCount += 1;
      } else if (b.status === "wontfix") {
        wontfixCount += 1;
      }

      if (b.category === "code_defect") {
        categoryCounts.code_defect += 1;
      } else if (b.category === "model_reasoning_error") {
        categoryCounts.model_reasoning_error += 1;
      } else if (b.category === "boundary_violation") {
        categoryCounts.boundary_violation += 1;
      }

      const sev = b.severity;
      const currentSevCount = severityCounts[sev];
      severityCounts[sev] = typeof currentSevCount === "number" ? currentSevCount + 1 : 1;
    }
  }

  return {
    total_blunders: allBlunders.length,
    open_count: openCount,
    resolved_count: resolvedCount,
    wontfix_count: wontfixCount,
    by_category: categoryCounts,
    by_severity: severityCounts,
    blunders: allBlunders,
    capsules_audited: auditedCapsules,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Formulates actionable candidate proposals from unresolved open blunders for Mind admission.
 */
export function formulateBlunderCandidates(
  blunders: readonly BlunderEntry[],
  charterGoals: readonly string[],
): MindCandidateProposal[] {
  if (!Array.isArray(blunders) || blunders.length === 0) {
    return [];
  }

  const goals =
    Array.isArray(charterGoals) && charterGoals.length > 0 ? charterGoals : ["G1", "G2"];

  const openBlunders = blunders.filter((b) => b.status === "open");
  const proposals: MindCandidateProposal[] = [];

  for (let i = 0; i < openBlunders.length; i += 1) {
    const b = openBlunders[i];
    if (b !== undefined) {
      const sanitizedId = b.id.startsWith("blunder-") ? b.id.slice("blunder-".length) : b.id;

      const candidateId = `cand-blunder-${sanitizedId}`;
      const kind: "proposal" | "defect" = b.category === "code_defect" ? "defect" : "proposal";

      let matchedGoals: string[] = [];
      if (b.category === "boundary_violation") {
        matchedGoals = goals.filter((g) =>
          g === "G2" ? true : g.toLowerCase().includes("invariant"),
        );
        if (matchedGoals.length === 0) {
          matchedGoals = goals.slice(0, 1);
        }
      } else if (b.category === "model_reasoning_error") {
        matchedGoals = goals.filter((g) => (g === "G1" ? true : g === "G2"));
        if (matchedGoals.length === 0) {
          matchedGoals = goals.slice(0, 1);
        }
      } else {
        matchedGoals = goals.filter((g) => (g === "G1" ? true : g.toLowerCase().includes("type")));
        if (matchedGoals.length === 0) {
          matchedGoals = goals.slice(0, 1);
        }
      }

      const writeScope =
        b.context && typeof b.context.cwd === "string" && b.context.cwd.trim()
          ? ["orchestrating-long-tasks/"]
          : ["orchestrating-long-tasks/"];

      const statement = `Remediate ${b.category.replace(/_/g, " ")} blunder: ${b.observation ? b.observation : b.type}`;
      const rationale = `Blunder [${b.id}] (${b.severity}): ${b.remediation ? b.remediation : "Remediate violation and verify resolution proof"}`;

      proposals.push({
        id: candidateId,
        kind,
        statement,
        rationale,
        charter_goal_ids: matchedGoals,
        write_scope: writeScope,
        status: "needs_authority",
        disposition: "actionable",
        blunder_id: b.id,
        evidence_class: "agent_reported",
        created_at: b.timestamp,
      });
    }
  }

  return proposals;
}

/**
 * Formats a concise Markdown summary brief for blunder audits, strictly bounded by line limits.
 */
export function formatBlunderAuditBrief(
  report: BlunderAuditReport,
  options: FormatBlunderAuditBriefOptions = {},
): string {
  const maxLines =
    typeof options.maxLines === "number" && options.maxLines > 0 ? options.maxLines : 30;

  const lines: string[] = [
    "### Blunder Audit & Remediation Brief",
    `- **Total Blunders**: \`${report.total_blunders}\` (Open: \`${report.open_count}\`, Resolved: \`${report.resolved_count}\`, Wontfix: \`${report.wontfix_count}\`)`,
    `- **By Category**: \`code_defect: ${report.by_category.code_defect}\`, \`model_reasoning_error: ${report.by_category.model_reasoning_error}\`, \`boundary_violation: ${report.by_category.boundary_violation}\``,
    `- **Capsules Audited**: \`${report.capsules_audited.length}\``,
    "",
  ];

  if (report.blunders.length > 0) {
    lines.push("#### Recorded Blunders");
    const headers = ["ID", "Status", "Category", "Severity", "Observation"];
    const rows = report.blunders.map((b) => [
      `\`${b.id}\``,
      b.status === "resolved" ? "✅ resolved" : b.status === "open" ? "⚠️ open" : "⏹ wontfix",
      b.category,
      b.severity,
      b.observation.length > 40
        ? `${b.observation.slice(0, 37)}...`
        : b.observation
          ? b.observation
          : b.type,
    ]);

    const tableLines = formatTable(headers, rows);
    for (let i = 0; i < tableLines.length; i += 1) {
      const tLine = tableLines[i];
      if (tLine !== undefined) {
        lines.push(tLine);
      }
    }
  } else {
    lines.push("_No blunder records detected across audited capsules._");
  }

  return enforceLineLimit(lines.join("\n"), maxLines);
}

/**
 * Deep Multi-Round Deliberation & Remediation Routines
 */

/**
 * Formulates root-cause hypotheses for a set of blunders based on category, observations, and context.
 */
export function formulateBlunderHypotheses(
  blunders: readonly BlunderEntry[],
): readonly BlunderHypothesis[] {
  const hypotheses: BlunderHypothesis[] = [];

  for (let i = 0; i < blunders.length; i += 1) {
    const b = blunders[i];
    if (!b) continue;

    let rootCause = "";
    let confidence = 0.8;
    const evidence: string[] = [];

    if (b.observation) {
      evidence.push(`Observation: ${b.observation}`);
    }
    if (b.remediation) {
      evidence.push(`Prescribed remediation: ${b.remediation}`);
    }
    if (b.agent_id) {
      evidence.push(`Agent ID: ${b.agent_id}`);
    }
    if (b.role) {
      evidence.push(`Role: ${b.role}`);
    }

    switch (b.category) {
      case "boundary_violation":
        rootCause = `Agent role confinement failure or unauthorized mutation attempt (${b.type})`;
        confidence = 0.95;
        break;
      case "model_reasoning_error":
        rootCause = `Planning or reasoning divergence from canonical invariants (${b.type})`;
        confidence = 0.85;
        break;
      case "code_defect":
      default:
        rootCause = `Direct runtime assertion failure or semantic defect in implementation (${b.type})`;
        confidence = 0.9;
        break;
    }

    hypotheses.push({
      id: `hypo-${b.id}`,
      blunder_id: b.id,
      root_cause: rootCause,
      confidence,
      category: b.category,
      evidence,
    });
  }

  return hypotheses;
}

/**
 * Synthesizes actionable remediation actions from hypotheses and blunder entries.
 */
export function synthesizeRemediationActions(
  hypotheses: readonly BlunderHypothesis[],
  blunders: readonly BlunderEntry[],
  options: { readonly defaultWriteScope?: readonly string[] | undefined } = {},
): readonly BlunderRemediationAction[] {
  const actions: BlunderRemediationAction[] = [];
  const blunderMap = new Map<string, BlunderEntry>();
  for (const b of blunders) {
    blunderMap.set(b.id, b);
  }

  const defaultScope = options.defaultWriteScope ?? ["orchestrating-long-tasks/scripts/src/"];

  for (let i = 0; i < hypotheses.length; i += 1) {
    const h = hypotheses[i];
    if (!h) continue;

    const b = blunderMap.get(h.blunder_id);
    const targetScope =
      b?.context && typeof b.context.cwd === "string" ? [b.context.cwd] : defaultScope;

    let actionType: BlunderRemediationAction["action_type"];
    let testAssertion = "";

    switch (h.category) {
      case "boundary_violation":
        actionType = "tighten_boundary";
        testAssertion = `verifyRoleRestraint(${b?.agent_id ? `"${b.agent_id}"` : '"agent"'}) === true`;
        break;
      case "model_reasoning_error":
        actionType = "align_reasoning";
        testAssertion = `verifyInvariantAdherence("${h.blunder_id}") === true`;
        break;
      case "code_defect":
      default:
        actionType = "fix_code";
        testAssertion = `bun test ${targetScope[0] ?? ""} - pass with 0 errors`;
        break;
    }

    actions.push({
      action_id: `act-${h.blunder_id}-${i + 1}`,
      blunder_id: h.blunder_id,
      target_scope: targetScope,
      action_type: actionType,
      description: b?.remediation
        ? b.remediation
        : `Remediate ${h.category} root cause: ${h.root_cause}`,
      prescribed_test: testAssertion,
      status: b?.status === "resolved" ? "verified" : "planned",
    });
  }

  return actions;
}

/**
 * Synthesizes a round outcome, evaluating whether resolution proofs cover all blunders.
 */
export function synthesizeDeliberationRound(
  round: {
    readonly round_number: number;
    readonly blunder_ids: readonly string[];
    readonly hypotheses: readonly BlunderHypothesis[];
    readonly remediation_actions: readonly BlunderRemediationAction[];
  },
  proofs: readonly BlunderResolutionProof[],
  options: DeliberationPipelineOptions = {},
): BlunderRemediationSynthesis {
  const maxRounds = options.maxRounds ?? 3;
  const verifiedProofBlunderIds = new Set<string>();

  for (const proof of proofs) {
    const valid = verifyResolutionProofEmpirical(proof, {
      requireCommitSha: options.requireCommitSha,
    });
    if (valid.isValid) {
      verifiedProofBlunderIds.add(proof.task_id);
    }
  }

  const resolvedIds: string[] = [];
  const unresolvedIds: string[] = [];

  for (const bId of round.blunder_ids) {
    if (verifiedProofBlunderIds.has(bId) || verifiedProofBlunderIds.has(`task-${bId}`)) {
      resolvedIds.push(bId);
    } else {
      unresolvedIds.push(bId);
    }
  }

  const allResolved = unresolvedIds.length === 0;
  const plan = round.remediation_actions.map(
    (a) => `[${a.action_type.toUpperCase()}] ${a.description} (Gate: ${a.prescribed_test})`,
  );

  let recommendation: BlunderRemediationSynthesis["recommendation"];
  if (allResolved) {
    recommendation = "converge";
  } else if (round.round_number >= maxRounds) {
    recommendation = "escalate_to_authority";
  } else {
    recommendation = "advance_round";
  }

  return {
    synthesis_id: `synth-r${round.round_number}-${Date.now()}`,
    summary: `Round ${round.round_number} deliberation: ${resolvedIds.length}/${round.blunder_ids.length} blunders resolved with empirical proof.`,
    resolved_blunder_ids: resolvedIds,
    unresolved_blunder_ids: unresolvedIds,
    remediation_plan: plan,
    empirical_proofs: proofs,
    readiness_for_convergence: allResolved,
    recommendation,
  };
}

/**
 * Creates an initial BlunderDeliberationRound.
 */
export function createBlunderDeliberationRound(params: {
  readonly round_number?: number | undefined;
  readonly blunders: readonly BlunderEntry[];
  readonly proofs?: readonly BlunderResolutionProof[] | undefined;
  readonly options?: DeliberationPipelineOptions | undefined;
}): BlunderDeliberationRound {
  const roundNum = params.round_number ?? 1;
  const blunderIds = params.blunders.map((b) => b.id);
  const hypotheses = formulateBlunderHypotheses(params.blunders);
  const actions = synthesizeRemediationActions(
    hypotheses,
    params.blunders,
    params.options?.defaultWriteScope !== undefined
      ? { defaultWriteScope: params.options.defaultWriteScope }
      : {},
  );
  const proofs = params.proofs ?? [];
  const synthesis = synthesizeDeliberationRound(
    {
      round_number: roundNum,
      blunder_ids: blunderIds,
      hypotheses,
      remediation_actions: actions,
    },
    proofs,
    params.options,
  );

  let status: BlunderDeliberationRound["status"] = "deliberating";
  if (synthesis.recommendation === "converge") {
    status = "converged";
  } else if (synthesis.recommendation === "escalate_to_authority") {
    status = "escalated";
  }

  return {
    round_number: roundNum,
    opened_at: new Date().toISOString(),
    closed_at: status !== "deliberating" ? new Date().toISOString() : null,
    blunder_ids: blunderIds,
    hypotheses,
    remediation_actions: actions,
    synthesis,
    status,
  };
}

/**
 * Advances from a current deliberation round to a successor round, carrying forward unresolved blunders.
 */
export function advanceDeliberationRound(
  currentRound: BlunderDeliberationRound,
  nextRoundNumber: number,
  remainingBlunders: readonly BlunderEntry[],
  newProofs: readonly BlunderResolutionProof[],
  options: DeliberationPipelineOptions = {},
): BlunderDeliberationRound {
  const unresolvedOnly = remainingBlunders.filter((b) =>
    currentRound.synthesis.unresolved_blunder_ids.includes(b.id),
  );

  const activeBlunders = unresolvedOnly.length > 0 ? unresolvedOnly : remainingBlunders;
  const allProofs = [...currentRound.synthesis.empirical_proofs, ...newProofs];

  return createBlunderDeliberationRound({
    round_number: nextRoundNumber,
    blunders: activeBlunders,
    proofs: allProofs,
    options,
  });
}

/**
 * Formats a comprehensive Markdown report for a deliberation round.
 */
export function formatDeliberationReport(
  round: BlunderDeliberationRound,
  options: { readonly maxLines?: number | undefined } = {},
): string {
  const maxLines = options.maxLines ?? 60;
  const lines: string[] = [
    `### Mind Blunder Deliberation - Round ${round.round_number}`,
    `- **Status**: \`${round.status.toUpperCase()}\``,
    `- **Opened At**: \`${round.opened_at}\``,
    `- **Blunders Considered**: \`${round.blunder_ids.length}\` (Resolved: \`${round.synthesis.resolved_blunder_ids.length}\`, Unresolved: \`${round.synthesis.unresolved_blunder_ids.length}\`)`,
    `- **Recommendation**: \`${round.synthesis.recommendation}\``,
    "",
    "#### Root Cause Hypotheses",
  ];

  for (const h of round.hypotheses) {
    lines.push(
      `- **[${h.category}]** \`${h.blunder_id}\`: ${h.root_cause} (confidence: ${(h.confidence * 100).toFixed(0)}%)`,
    );
  }

  lines.push("", "#### Remediation Actions");
  for (const a of round.remediation_actions) {
    const mark = a.status === "verified" ? "✅" : "⏳";
    lines.push(
      `- ${mark} **[${a.action_type}]** \`${a.action_id}\`: ${a.description} -> Test: \`${a.prescribed_test}\``,
    );
  }

  if (round.synthesis.empirical_proofs.length > 0) {
    lines.push("", "#### Empirical Resolution Proofs");
    for (const p of round.synthesis.empirical_proofs) {
      lines.push(
        `- Task \`${p.task_id}\`: assertion \`${p.test_assertion}\` resolved at \`${p.resolved_at}\`${p.commit_sha ? ` (commit: \`${p.commit_sha}\`)` : ""}`,
      );
    }
  }

  return enforceLineLimit(lines.join("\n"), maxLines);
}

/**
 * High-Level Multi-Round Lossless Deliberation Pipeline Engine.
 */
export class BlunderDeliberationPipeline {
  private readonly rounds: BlunderDeliberationRound[] = [];
  private readonly options: DeliberationPipelineOptions;

  constructor(options: DeliberationPipelineOptions = {}) {
    this.options = options;
  }

  public startDeliberation(
    blunders: readonly BlunderEntry[],
    initialProofs: readonly BlunderResolutionProof[] = [],
  ): BlunderDeliberationRound {
    const round = createBlunderDeliberationRound({
      round_number: 1,
      blunders,
      proofs: initialProofs,
      options: this.options,
    });
    this.rounds.push(round);
    return round;
  }

  public advance(
    remainingBlunders: readonly BlunderEntry[],
    newProofs: readonly BlunderResolutionProof[] = [],
  ): BlunderDeliberationRound {
    const lastRound = this.rounds[this.rounds.length - 1];
    if (!lastRound) {
      return this.startDeliberation(remainingBlunders, newProofs);
    }

    const nextRound = advanceDeliberationRound(
      lastRound,
      lastRound.round_number + 1,
      remainingBlunders,
      newProofs,
      this.options,
    );
    this.rounds.push(nextRound);
    return nextRound;
  }

  public getCurrentRound(): BlunderDeliberationRound | undefined {
    return this.rounds[this.rounds.length - 1];
  }

  public getAllRounds(): readonly BlunderDeliberationRound[] {
    return this.rounds;
  }

  public isConverged(): boolean {
    const current = this.getCurrentRound();
    return current ? current.status === "converged" : false;
  }
}
