import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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
  readonly context?: {
    readonly cwd?: string | undefined;
    readonly indicators?: Readonly<Record<string, string>> | undefined;
    readonly [key: string]: unknown;
  } | undefined;
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
    rawType.includes("role_confusion") ? true :
    rawType.includes("role_leak") ? true :
    rawType.includes("role_amnesia") ? true :
    rawType.includes("identity") ? true :
    rawType.includes("main_thread") ? true :
    rawType.includes("boundary") ? true :
    rawType.includes("unauthorized") ? true :
    rawType.includes("role_escalation") ? true :
    rawType.includes("restraint") ? true :
    rawType.includes("thread_authority") ? true :
    rawType.includes("tier") ? true :
    rawType.includes("permission") ? true :
    rawType.includes("sandbox_escape") ? true :
    rawType.includes("scope_escape") ? true :
    rawId.includes("role-leak") ? true :
    rawId.includes("role-amnesia") ? true :
    rawId.includes("identity") ? true :
    rawId.includes("boundary") ? true :
    rawId.includes("main-thread") ? true :
    rawId.includes("orch-role") ? true :
    fullSearchSpace.includes("main thread") ? true :
    fullSearchSpace.includes("restraint active") ? true :
    fullSearchSpace.includes("boundary violation") ? true :
    fullSearchSpace.includes("boundary") ? true :
    fullSearchSpace.includes("boundaries") ? true :
    fullSearchSpace.includes("write scope") ? true :
    fullSearchSpace.includes("unauthorized mutation") ? true :
    fullSearchSpace.includes("human shell") ? true :
    fullSearchSpace.includes("subagent boundary") ? true :
    fullSearchSpace.includes("subagent delegation") ? true :
    fullSearchSpace.includes("role escalation") ? true :
    fullSearchSpace.includes("role confusion") ? true :
    fullSearchSpace.includes("role amnesia") ? true :
    fullSearchSpace.includes("identity and role") ? true :
    fullSearchSpace.includes("direct file edit") ? true :
    fullSearchSpace.includes("direct test run") ? true :
    fullSearchSpace.includes("whoami") ? true :
    fullSearchSpace.includes("failed to actively police") ? true : false;

  if (isBoundary) {
    return "boundary_violation";
  }

  // Model reasoning error patterns
  const isReasoningError =
    rawType.includes("reasoning") ? true :
    rawType.includes("hallucination") ? true :
    rawType.includes("logic") ? true :
    rawType.includes("assumption") ? true :
    rawType.includes("plan_drift") ? true :
    rawType.includes("intent_drift") ? true :
    rawType.includes("instruction_drift") ? true :
    rawType.includes("self_critique") ? true :
    rawType.includes("context_loss") ? true :
    rawType.includes("premise") ? true :
    rawType.includes("inertia") ? true :
    rawType.includes("paralysis") ? true :
    rawType.includes("idle_death") ? true :
    rawType.includes("self_termination") ? true :
    rawId.includes("paralysis") ? true :
    rawId.includes("drift") ? true :
    rawId.includes("hallucination") ? true :
    rawId.includes("idle-death") ? true :
    rawId.includes("self-termination") ? true :
    fullSearchSpace.includes("reasoning error") ? true :
    fullSearchSpace.includes("hallucination") ? true :
    fullSearchSpace.includes("illogical") ? true :
    fullSearchSpace.includes("incorrect premise") ? true :
    fullSearchSpace.includes("wrong assumption") ? true :
    fullSearchSpace.includes("invalid assumption") ? true :
    fullSearchSpace.includes("failed to adhere") ? true :
    fullSearchSpace.includes("intent drift") ? true :
    fullSearchSpace.includes("instruction drift") ? true :
    fullSearchSpace.includes("plan drift") ? true :
    fullSearchSpace.includes("plan revision paralysis") ? true :
    fullSearchSpace.includes("passive inertia") ? true :
    fullSearchSpace.includes("revision paralysis") ? true :
    fullSearchSpace.includes("context loss") ? true :
    fullSearchSpace.includes("self-critique") ? true :
    fullSearchSpace.includes("self critique") ? true :
    fullSearchSpace.includes("sleep loop") ? true :
    fullSearchSpace.includes("idle death") ? true :
    fullSearchSpace.includes("self-termination") ? true :
    fullSearchSpace.includes("perpetual consciousness") ? true : false;

  if (isReasoningError) {
    return "model_reasoning_error";
  }

  // Default category
  return "code_defect";
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
          : typeof parsed.prescribed_remediation === "string" && parsed.prescribed_remediation.trim()
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
        typeof parsed.role === "string" && parsed.role.trim()
          ? parsed.role.trim()
          : undefined;

      const context =
        isRecord(parsed.context)
          ? (parsed.context as BlunderEntry["context"])
          : undefined;

      const rawStatus = typeof parsed.status === "string" ? parsed.status.trim().toLowerCase() : "open";
      const status: BlunderStatus =
        rawStatus === "resolved"
          ? "resolved"
          : rawStatus === "wontfix" || rawStatus === "wont_fix" || rawStatus === "wont-fix"
            ? "wontfix"
            : "open";

      let resolution: BlunderResolutionProof | null | undefined = undefined;
      if (isRecord(parsed.resolution)) {
        const resObj = parsed.resolution;
        const taskId = typeof resObj.task_id === "string" ? resObj.task_id : "";
        const testAssertion =
          typeof resObj.test_assertion === "string" ? resObj.test_assertion : "";
        const resolvedAt =
          typeof resObj.resolved_at === "string" ? resObj.resolved_at : "";
        const commitSha =
          typeof resObj.commit_sha === "string"
            ? resObj.commit_sha
            : resObj.commit_sha === null
              ? null
              : undefined;

        if (taskId && testAssertion && resolvedAt) {
          resolution = {
            task_id: taskId,
            test_assertion: testAssertion,
            resolved_at: resolvedAt,
            commit_sha: commitSha,
          };
        }
      } else if (parsed.resolution === null) {
        resolution = null;
      }

      const rawCat = typeof parsed.category === "string" ? parsed.category.trim().toLowerCase() : "";
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

      const entry: BlunderEntry = {
        id,
        type: rawType,
        severity: rawSeverity,
        timestamp,
        category,
        status,
        observation: rawObservation,
        remediation: rawRemediation,
        ...(role !== undefined ? { role } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(prescribedRemediation !== undefined ? { prescribed_remediation: prescribedRemediation } : {}),
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
  if (!Array.isArray(blunders)) {
    return "";
  }
  if (blunders.length === 0) {
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
): BlunderEntry {
  if (!isRecord(proof)) {
    throw new HarnessError("INVALID_ARGUMENT", "resolution proof must be an object");
  }

  const taskId = typeof proof.task_id === "string" ? proof.task_id.trim() : "";
  const testAssertion =
    typeof proof.test_assertion === "string" ? proof.test_assertion.trim() : "";
  const resolvedAt =
    typeof proof.resolved_at === "string" ? proof.resolved_at.trim() : "";
  const commitSha =
    typeof proof.commit_sha === "string"
      ? proof.commit_sha.trim()
      : proof.commit_sha === null
        ? null
        : undefined;

  if (!taskId) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "resolution proof requires non-empty task_id",
    );
  }
  if (!testAssertion) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "resolution proof requires non-empty test_assertion",
    );
  }
  if (!resolvedAt) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "resolution proof requires non-empty resolved_at",
    );
  }

  const validatedProof: BlunderResolutionProof = {
    task_id: taskId,
    test_assertion: testAssertion,
    resolved_at: resolvedAt,
    commit_sha: commitSha,
  };

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
      if (targetPath.endsWith(".jsonl") ? true : targetPath.endsWith(".json")) {
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

    // Search subdirectories for capsule runs (e.g. .capsules/mind-gen-5/blunders.jsonl)
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
    if (root === undefined) {
      continue;
    }
    if (typeof root !== "string") {
      continue;
    }
    if (!root.trim()) {
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
  if (!Array.isArray(blunders)) {
    return [];
  }
  if (blunders.length === 0) {
    return [];
  }

  const goals =
    Array.isArray(charterGoals) && charterGoals.length > 0
      ? charterGoals
      : ["G1", "G2"];

  const openBlunders = blunders.filter((b) => b.status === "open");
  const proposals: MindCandidateProposal[] = [];

  for (let i = 0; i < openBlunders.length; i += 1) {
    const b = openBlunders[i];
    if (b !== undefined) {
      const sanitizedId = b.id.startsWith("blunder-")
        ? b.id.slice("blunder-".length)
        : b.id;

      const candidateId = `cand-blunder-${sanitizedId}`;
      const kind: "proposal" | "defect" =
        b.category === "code_defect" ? "defect" : "proposal";

      let matchedGoals: string[] = [];
      if (b.category === "boundary_violation") {
        matchedGoals = goals.filter((g) => g === "G2" ? true : g.toLowerCase().includes("invariant"));
        if (matchedGoals.length === 0) {
          matchedGoals = goals.slice(0, 1);
        }
      } else if (b.category === "model_reasoning_error") {
        matchedGoals = goals.filter((g) => g === "G1" ? true : g === "G2");
        if (matchedGoals.length === 0) {
          matchedGoals = goals.slice(0, 1);
        }
      } else {
        matchedGoals = goals.filter((g) => g === "G1" ? true : g.toLowerCase().includes("type"));
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
    typeof options.maxLines === "number" && options.maxLines > 0
      ? options.maxLines
      : 30;

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
