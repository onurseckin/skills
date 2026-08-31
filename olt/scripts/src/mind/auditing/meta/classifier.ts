import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  resolveFeedbackQueuePath,
  resolveCanonicalFeedbackQueuePath,
  appendFeedbackItemsDedupedByTitle,
  updateOrPruneFeedbackItems,
  type FeedbackItem,
} from "../../feedback/queue/index.ts";
import { synthesizeRemediationPlan } from "./forensics.ts";
import type {
  FeedbackInjectionOptions,
  ForensicsIncident,
  ForensicsInjectionResult,
  PlanInjectionProposal,
} from "./types.ts";
import { isValidatorRole, isFullTestSuiteCommand } from "../roles/index.ts";
import type { AgentGrantRecord, ExtractedToolCall } from "./types.ts";

export function injectRemediationToFeedbackQueue(
  proposalsOrIncidents: readonly (PlanInjectionProposal | ForensicsIncident)[],
  optionsOrRoot?: string | FeedbackInjectionOptions,
): ForensicsInjectionResult {
  if (proposalsOrIncidents.length === 0) {
    return {
      injectedCount: 0,
      injected_count: 0,
      itemIds: [],
      injected_items: [],
      feedbackItems: [],
      feedback_items: [],
    };
  }

  const proposals: readonly PlanInjectionProposal[] =
    proposalsOrIncidents.length > 0 && "remediationDirective" in proposalsOrIncidents[0]!
      ? (proposalsOrIncidents as readonly PlanInjectionProposal[])
      : synthesizeRemediationPlan(proposalsOrIncidents as readonly ForensicsIncident[]);

  let customRoot: string | undefined;
  let customQueuePath: string | undefined;

  if (typeof optionsOrRoot === "string") {
    customRoot = optionsOrRoot;
  } else if (optionsOrRoot !== undefined) {
    customRoot = optionsOrRoot.customRoot ?? optionsOrRoot.run;
    customQueuePath = optionsOrRoot.queue_path;
  }

  const queuePath = customQueuePath
    ? resolve(customQueuePath)
    : resolveFeedbackQueuePath(
        customRoot ? resolveCanonicalFeedbackQueuePath(customRoot) : undefined,
      );

  const nowIso = new Date().toISOString();
  const proposalTitles = new Map(proposals.map((p) => [p.title.trim().toLowerCase(), p]));

  updateOrPruneFeedbackItems((existingItem) => {
    const normTitle = existingItem.title.trim().toLowerCase();
    const matchingProp = proposalTitles.get(normTitle);
    if (matchingProp) {
      const meta = (existingItem.metadata ?? {}) as Record<string, unknown>;
      const occurrences =
        typeof meta["occurrences"] === "number" ? (meta["occurrences"] as number) + 1 : 2;
      return {
        ...existingItem,
        timestamp: nowIso,
        metadata: {
          ...meta,
          occurrences,
          occurrence_count: occurrences,
          last_detected_at: nowIso,
          target_role: matchingProp.targetRole ?? meta["target_role"],
          root_cause: matchingProp.rootCause ?? meta["root_cause"],
        },
      };
    }
    return existingItem;
  }, queuePath);

  const candidates: FeedbackItem[] = [];
  for (const prop of proposals) {
    const newItem: FeedbackItem = {
      id: `fb-${Date.now()}-${randomBytes(3).toString("hex")}`,
      timestamp: nowIso,
      priority: prop.priority,
      status: "PENDING",
      category: prop.category,
      title: prop.title,
      content: `${prop.content}\n\n**Remediation Directive**: ${prop.remediationDirective}`,
      metadata: {
        root_cause: prop.rootCause,
        target_role: prop.targetRole,
        proposal_id: prop.id,
        occurrences: 1,
        occurrence_count: 1,
        last_detected_at: nowIso,
        ...prop.metadata,
      },
    };
    candidates.push(newItem);
  }

  const injectedItems = appendFeedbackItemsDedupedByTitle(candidates, queuePath);
  const itemIds = injectedItems.map((item) => item.id);

  return {
    injectedCount: itemIds.length,
    injected_count: itemIds.length,
    itemIds,
    injected_items: itemIds,
    queue_path: queuePath,
    feedbackItems: injectedItems,
    feedback_items: injectedItems,
  };
}

export interface TaskOrderEntry {
  readonly id: string;
  readonly writeScope: readonly string[];
  readonly startedAt?: number | undefined;
  readonly completedAt?: number | undefined;
}

export function resolveAgentRole(
  aid: string,
  calls: readonly ExtractedToolCall[],
  ledger: readonly AgentGrantRecord[],
  state?: Record<string, unknown> | null,
): string {
  const fromCall = calls.find((c) => c.agentRole)?.agentRole;
  if (fromCall) return fromCall;
  const fromLedger = ledger.find(
    (a) =>
      (a as { id?: string; agent_id?: string }).id === aid ||
      (a as { id?: string; agent_id?: string }).agent_id === aid,
  );
  if (fromLedger && (fromLedger as { role?: string }).role) {
    return (fromLedger as { role?: string }).role!;
  }
  if (state && Array.isArray(state["agents"])) {
    const fromState = state["agents"].find(
      (a) =>
        typeof a === "object" &&
        a !== null &&
        ((a as Record<string, unknown>)["id"] === aid ||
          (a as Record<string, unknown>)["agent_id"] === aid),
    ) as Record<string, unknown> | undefined;
    if (fromState && typeof fromState["role"] === "string") return fromState["role"];
  }
  return aid;
}

export function isContractuallyReadOnlyRole(role: string): boolean {
  const norm = role.toLowerCase().trim();
  return (
    isValidatorRole(norm) ||
    norm.includes("validator") ||
    norm.includes("researcher") ||
    norm.includes("research") ||
    norm.includes("scanner") ||
    norm.includes("auditor") ||
    norm.includes("critic")
  );
}

export function parseTaskEntry(t: Record<string, unknown>): {
  id: string;
  writeScope: string[];
  dependencies: string[];
  startedAt?: number | undefined;
  completedAt?: number | undefined;
} {
  const id = String(t["id"] ?? "");
  const writeScope = Array.isArray(t["write_scope"]) ? (t["write_scope"] as string[]) : [];
  const rawDeps = Array.isArray(t["dependencies"])
    ? t["dependencies"]
    : Array.isArray(t["prerequisites"])
      ? t["prerequisites"]
      : Array.isArray(t["depends_on"])
        ? t["depends_on"]
        : Array.isArray(t["deps"])
          ? t["deps"]
          : [];
  let startedAt: number | undefined;
  let completedAt: number | undefined;
  if (Array.isArray(t["attempts"]) && t["attempts"].length > 0) {
    const last = t["attempts"][t["attempts"].length - 1] as Record<string, unknown>;
    if (typeof last["started_at"] === "string") startedAt = Date.parse(last["started_at"]);
    if (typeof last["completed_at"] === "string") completedAt = Date.parse(last["completed_at"]);
  }
  return { id, writeScope, dependencies: rawDeps.map(String), startedAt, completedAt };
}

export function isTransitivelyReachable(
  fromTaskId: string,
  targetTaskId: string,
  taskMap: ReadonlyMap<string, { readonly dependencies: readonly string[] }>,
  visited = new Set<string>(),
): boolean {
  if (fromTaskId === targetTaskId) return true;
  if (visited.has(fromTaskId)) return false;
  visited.add(fromTaskId);
  const task = taskMap.get(fromTaskId);
  if (!task) return false;
  for (const depId of task.dependencies) {
    if (depId === targetTaskId || isTransitivelyReachable(depId, targetTaskId, taskMap, visited)) {
      return true;
    }
  }
  return false;
}

export function isPermittedValidatorTool(call: ExtractedToolCall): boolean {
  if (call.isWrite) return false;
  const tool = String(call.toolName || call.name || "").toLowerCase();
  const isExec = tool === "run_command" || tool.includes("exec") || tool.includes("bash");
  if (!isExec) return true;
  const cmdStr = String(call.rawArguments?.["CommandLine"] ?? call.rawArguments?.["command"] ?? "");
  const argv = Array.isArray(call.rawArguments?.["argv"])
    ? (call.rawArguments!["argv"] as string[])
    : cmdStr.split(/\s+/).filter(Boolean);
  return (
    isFullTestSuiteCommand(argv) ||
    cmdStr.includes("test") ||
    cmdStr.includes("spec") ||
    cmdStr.includes("check")
  );
}
