import { HarnessError } from "../../core/errors/index.ts";

const MIN_COGNITIVE_PROBES = 5;
const MIN_COGNITIVE_VECTORS = 2;

const COGNITIVE_VECTORS = [
  "EMPTY_PAYLOAD",
  "TIMEOUT_STAGNATION",
  "CONCURRENCY_MUTATION",
  "HOST_BOUNDARY",
  "STATE_TRANSITION",
  "TYPE_INVARIANT",
  "CLI_TELEMETRY",
  "ADVERSARIAL_GATE",
] as const;

type CognitiveVector = (typeof COGNITIVE_VECTORS)[number];

interface CognitiveProbe {
  readonly id?: string;
  readonly probe_id?: string;
  readonly vector: CognitiveVector | string;
  readonly description?: string;
  readonly probe?: string;
  readonly demand?: string;
  readonly observation?: string;
  readonly pushback?: string;
  readonly resolution_method?: string;
  readonly resolution?: string;
  readonly verified_resolution?: string;
  readonly verified?: boolean;
  readonly status?: string;
  readonly resolution_status?: string;
}

interface CognitiveValidationOptions {
  readonly minProbes?: number;
  readonly minVectors?: number;
  readonly allowedVectors?: readonly string[];
}

interface CognitiveValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly totalProbes: number;
  readonly distinctProbes: readonly CognitiveProbe[];
  readonly verifiedProbes: readonly CognitiveProbe[];
  readonly distinctVectors: readonly string[];
}

const normalizeVector = (vector: string): string =>
  vector.trim().toUpperCase().replace(/[- ]/gu, "_");

const isCognitiveVector = (vector: string): boolean =>
  (COGNITIVE_VECTORS as readonly string[]).includes(normalizeVector(vector));

function parseProbeObject(entry: Record<string, unknown>): CognitiveProbe | null {
  const vector = entry["vector"] ?? entry["cognitive_vector"];
  const hasVector = typeof vector === "string" && vector.trim() !== "";
  const isCognitive =
    entry["channel"] === "cognitive" ||
    entry["kind"] === "cognitive_probe" ||
    Boolean(entry["probe_type"]);
  if (!hasVector && !isCognitive) return null;

  const desc =
    entry["description"] ??
    entry["probe"] ??
    entry["demand"] ??
    entry["observation"] ??
    entry["pushback"];
  const res =
    entry["resolution_method"] ??
    entry["verified_resolution"] ??
    entry["resolution"] ??
    entry["method"];

  return {
    ...(typeof entry["id"] === "string" ? { id: entry["id"] } : {}),
    ...(typeof entry["probe_id"] === "string" ? { probe_id: entry["probe_id"] } : {}),
    vector: hasVector ? (vector as string).trim() : "COGNITIVE_PROBE",
    ...(typeof desc === "string" ? { description: desc } : {}),
    ...(typeof res === "string" ? { resolution_method: res } : {}),
    ...(typeof entry["verified"] === "boolean" ? { verified: entry["verified"] } : {}),
    ...(typeof entry["status"] === "string" ? { status: entry["status"] } : {}),
    ...(typeof entry["resolution_status"] === "string"
      ? { resolution_status: entry["resolution_status"] }
      : {}),
  };
}

function extractCognitiveProbes(source: unknown): readonly CognitiveProbe[] {
  if (!source) return [];
  let candidateList: unknown[] = [];
  if (Array.isArray(source)) {
    candidateList = source;
  } else if (typeof source === "object" && source !== null) {
    const rec = source as Record<string, unknown>;
    candidateList = Array.isArray(rec["validations"])
      ? (rec["validations"] as unknown[])
      : Array.isArray(rec["probes"])
        ? (rec["probes"] as unknown[])
        : [];
  }

  const extracted: CognitiveProbe[] = [];
  for (const item of candidateList) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const nested =
      entry["probes"] ??
      entry["cognitive_probes"] ??
      entry["pushback_probes"] ??
      entry["pushbacks"];
    if (Array.isArray(nested)) {
      for (const n of nested) {
        if (typeof n === "object" && n !== null) {
          const np = parseProbeObject(n as Record<string, unknown>);
          if (np) extracted.push(np);
        }
      }
      continue;
    }
    if (Array.isArray(entry["findings"])) {
      for (const f of entry["findings"]) {
        if (typeof f === "object" && f !== null) {
          const fp = parseProbeObject(f as Record<string, unknown>);
          if (fp) extracted.push(fp);
        }
      }
    }
    const direct = parseProbeObject(entry);
    if (direct) extracted.push(direct);
  }
  return extracted;
}

function isProbeVerified(probe: CognitiveProbe): boolean {
  const method = probe.resolution_method ?? probe.verified_resolution ?? probe.resolution;
  if (typeof method !== "string" || method.trim() === "") return false;
  if (probe.verified === false) return false;
  if (probe.resolution_status && !["verified", "resolved"].includes(probe.resolution_status))
    return false;
  if (probe.status && ["open", "rejected", "unresolved", "failed"].includes(probe.status))
    return false;
  return true;
}

function probeDeduplicationKey(probe: CognitiveProbe): string {
  if (probe.id?.trim()) return `id:${probe.id.trim()}`;
  if (probe.probe_id?.trim()) return `id:${probe.probe_id.trim()}`;
  const vec = normalizeVector(String(probe.vector));
  const desc = (probe.description ?? probe.probe ?? probe.demand ?? probe.observation ?? "").trim();
  return desc ? `vec_desc:${vec}:${desc}` : `vec_meth:${vec}:${probe.resolution_method ?? ""}`;
}

function validateCognitiveProbes(
  taskOrValidations: unknown,
  options: CognitiveValidationOptions = {},
): CognitiveValidationResult {
  const minProbes = options.minProbes ?? MIN_COGNITIVE_PROBES;
  const minVectors = options.minVectors ?? MIN_COGNITIVE_VECTORS;
  const errors: string[] = [];

  if (
    typeof taskOrValidations === "object" &&
    taskOrValidations !== null &&
    !Array.isArray(taskOrValidations)
  ) {
    const taskRec = taskOrValidations as Record<string, unknown>;
    if (!("validations" in taskRec) || !Array.isArray(taskRec["validations"])) {
      errors.push(
        "Single-pass superficial approval rejected: task.validations is missing or empty.",
      );
      return {
        valid: false,
        errors,
        totalProbes: 0,
        distinctProbes: [],
        verifiedProbes: [],
        distinctVectors: [],
      };
    }
  }

  const allProbes = extractCognitiveProbes(taskOrValidations);
  if (allProbes.length === 0) {
    errors.push(
      `Single-pass superficial approval rejected: task contains 0 cognitive pushback probes (minimum ${minProbes} required across cognitive vectors).`,
    );
    return {
      valid: false,
      errors,
      totalProbes: 0,
      distinctProbes: [],
      verifiedProbes: [],
      distinctVectors: [],
    };
  }

  const distinctMap = new Map<string, CognitiveProbe>();
  for (const p of allProbes) {
    const k = probeDeduplicationKey(p);
    if (!distinctMap.has(k)) distinctMap.set(k, p);
  }
  const distinctProbes = Array.from(distinctMap.values());

  if (distinctProbes.length < minProbes) {
    errors.push(
      `Insufficient distinct cognitive pushback probes: found ${distinctProbes.length} distinct probe(s), but minimum ${minProbes} are required.`,
    );
  }

  const unverifiedProbes: CognitiveProbe[] = [];
  const verifiedProbes: CognitiveProbe[] = [];
  for (const p of distinctProbes) {
    if (isProbeVerified(p)) verifiedProbes.push(p);
    else unverifiedProbes.push(p);
  }

  if (unverifiedProbes.length > 0) {
    const unverifiedIds = unverifiedProbes.map((p) => p.id ?? p.probe_id ?? p.vector).join(", ");
    errors.push(
      `${unverifiedProbes.length} cognitive pushback probe(s) lack verified resolution methods: [${unverifiedIds}].`,
    );
  }

  if (verifiedProbes.length < minProbes) {
    errors.push(
      `Insufficient verified cognitive pushback probes: only ${verifiedProbes.length}/${distinctProbes.length} have verified resolution methods (minimum ${minProbes} required).`,
    );
  }

  const vectors = new Set<string>();
  for (const p of verifiedProbes) {
    const norm = normalizeVector(String(p.vector));
    if (norm !== "" && norm !== "UNKNOWN" && norm !== "COGNITIVE_PROBE") {
      vectors.add(norm);
    }
  }
  const distinctVectors = Array.from(vectors);

  if (distinctVectors.length < minVectors) {
    errors.push(
      `Insufficient cognitive vector diversity: probes span ${distinctVectors.length} distinct vector(s) (${distinctVectors.join(", ")}), but minimum ${minVectors} distinct vectors are required across cognitive vectors.`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    totalProbes: allProbes.length,
    distinctProbes,
    verifiedProbes,
    distinctVectors,
  };
}

function assertCognitiveProbes(
  taskOrValidations: unknown,
  options: CognitiveValidationOptions = {},
): void {
  const result = validateCognitiveProbes(taskOrValidations, options);
  if (!result.valid) {
    throw new HarnessError(
      "INVALID_STATE",
      `Cognitive validation pushback gate failed: ${result.errors.join("; ")}`,
    );
  }
}

function assertTaskReviewCognitiveProbes(
  taskOrValidations: unknown,
  verdict: string = "pass",
  options: CognitiveValidationOptions = {},
): void {
  if (verdict === "pass") assertCognitiveProbes(taskOrValidations, options);
}

const assertValidateFinishProbes = assertCognitiveProbes;

export {
  COGNITIVE_VECTORS,
  MIN_COGNITIVE_PROBES,
  MIN_COGNITIVE_VECTORS,
  assertCognitiveProbes,
  assertTaskReviewCognitiveProbes,
  assertValidateFinishProbes,
  extractCognitiveProbes,
  isCognitiveVector,
  isProbeVerified,
  normalizeVector,
  validateCognitiveProbes,
  type CognitiveProbe,
  type CognitiveValidationOptions,
  type CognitiveValidationResult,
  type CognitiveVector,
};
