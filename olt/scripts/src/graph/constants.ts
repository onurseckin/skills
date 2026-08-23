export const NODE_TYPES = new Set([
  "agent",
  "artifact",
  "decision",
  "finding",
  "gate",
  "requirement",
  "task",
  "topic",
]);

export const EDGE_TYPES = new Set([
  "assigned_to",
  "blocks",
  "depends_on",
  "discovered_from",
  "evidenced_by",
  "implements",
  "produces",
  "relates_to",
  "supersedes",
  "validates",
]);

export const TASK_STATUSES = new Set([
  "proposed",
  "ready",
  "retry_ready",
  "leased",
  "running",
  "submitted",
  "validating",
  "changes_requested",
  "validated",
  "gating",
  "done",
  "blocked",
  "escalated",
  "cancelled",
  "stale",
]);

export const PLANNABLE_TASK_STATUSES = new Set(["proposed", "ready"]);

export const RUNTIME_TASK_FIELDS = new Set([
  "attempt",
  "attempts",
  "dependencies",
  "findings",
  "gate_results",
  "history",
  "implementer_id",
  "lease",
  "orphan_evidence",
  "original_implementer",
  "repair_assignee",
  "repair_round",
  "replacement_evidence",
  "replacement_reason",
  "report",
  "review",
  "status",
  "submission",
  "validations",
  "validation_history",
  "validator_id",
]);

export const MAX_EFFORT = 1_000_000;
