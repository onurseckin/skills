import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  resolveFeedbackQueuePath,
  resolveCanonicalFeedbackQueuePath,
  appendFeedbackItemsDedupedByTitle,
  type FeedbackItem,
} from "../../../feedback-queue.ts";
import { synthesizeRemediationPlan } from "./slice_26.ts";
import type {
  FeedbackInjectionOptions,
  ForensicsIncident,
  ForensicsInjectionResult,
  PlanInjectionProposal,
} from "./slice_20.ts";
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

  // If passed incidents, synthesize proposals first
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

  const candidates: FeedbackItem[] = [];
  for (const prop of proposals) {
    const newItem: FeedbackItem = {
      id: `fb-${Date.now()}-${randomBytes(3).toString("hex")}`,
      timestamp: new Date().toISOString(),
      priority: prop.priority,
      status: "PENDING",
      category: prop.category,
      title: prop.title,
      content: `${prop.content}\n\n**Remediation Directive**: ${prop.remediationDirective}`,
      metadata: {
        root_cause: prop.rootCause,
        target_role: prop.targetRole,
        proposal_id: prop.id,
        ...prop.metadata,
      },
    };
    candidates.push(newItem);
  }
  // This single transaction dedupes and appends. A persistence failure is propagated;
  // callers never receive a success count for records that were not committed.
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