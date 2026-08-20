export type EvidenceClass =
  | "harness_observed"
  | "agent_reported"
  | "host_reported"
  | "derived"
  | "unknown";

export const EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "harness_observed",
  "agent_reported",
  "host_reported",
  "derived",
  "unknown",
];

const EVIDENCE_CLASS_NAMES = new Set<string>(EVIDENCE_CLASSES);

/**
 * Declared as an object type, not an interface, so it keeps an implicit index signature and stays
 * assignable to `JsonObject` whenever `T` is JSON-safe; state, event and graph writers persist these
 * values directly.
 */
export type Evidenced<T> = {
  value: T;
  evidence_class: EvidenceClass;
  is_estimated?: boolean;
};

export function isEvidenceClass(value: unknown): value is EvidenceClass {
  return typeof value === "string" && EVIDENCE_CLASS_NAMES.has(value);
}

export function isEvidenced<T>(
  value: unknown,
  isValue: (candidate: unknown) => candidate is T,
): value is Evidenced<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!isEvidenceClass(record.evidence_class)) return false;
  if ("is_estimated" in record && typeof record.is_estimated !== "boolean") return false;
  return isValue(record.value);
}

export function evidenced<T>(value: T, evidenceClass: EvidenceClass): Evidenced<T> {
  return { value, evidence_class: evidenceClass };
}

/** Estimates are always derived and always flagged, so no caller can mint an unflagged guess. */
export function estimated<T>(value: T): Evidenced<T> {
  return { value, evidence_class: "derived", is_estimated: true };
}
