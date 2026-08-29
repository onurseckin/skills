import { HarnessError } from "../../../core/errors/index.ts";
import {
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  QUIESCENCE_INTERVAL_MULTIPLIER,
} from "../../../core/scheduling/index.ts";
import {
  findSourceDefinition,
  MIND_DISCOVERY_SOURCES,
  resolveCommandRecord,
  type EvidenceClass,
  type MindSourceId,
} from "../../memory/sources/index.ts";

export const QUIESCENT_DIGEST_STREAK_THRESHOLD = 8;

export {
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  QUIESCENCE_INTERVAL_MULTIPLIER,
};

export interface QuiescentSourceObservation {
  readonly source: MindSourceId;
  readonly commandId: string;
  readonly count: number;
  readonly evidenceClass: EvidenceClass;
  readonly sourceNumber: number;
  readonly sourceName: string;
}

export interface QuiescentSourceInput {
  readonly source: string;
  readonly commandId: string;
  readonly count: number;
}

export interface QuiescentValidationResult {
  readonly ok: boolean;
  readonly observations: readonly QuiescentSourceObservation[];
  readonly missingSources: readonly MindSourceId[];
  readonly nonZeroSources: readonly { readonly source: MindSourceId; readonly count: number }[];
  readonly invalidSources: readonly string[];
  readonly unevidencedSources: readonly {
    readonly source: MindSourceId;
    readonly commandId: string;
  }[];
  readonly error?: string | undefined;
}

export interface QuiescentDigest {
  readonly streak: number;
  readonly generatedAt: string;
  readonly runId: string;
  readonly message: string;
  readonly sourcesChecked: readonly QuiescentSourceObservation[];
  readonly markdown: string;
}

export function parseQuiescentSourceSpec(spec: string): QuiescentSourceInput {
  if (typeof spec !== "string" || !spec.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid source spec '${spec}'; expected format <source>:<command-id>:<count>`,
    );
  }

  const trimmed = spec.trim();
  const parts = trimmed.split(":");
  if (parts.length < 3) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid source spec '${spec}'; expected format <source>:<command-id>:<count>`,
    );
  }

  const source = parts[0]!.trim();
  const rawCount = parts[parts.length - 1]!.trim();
  const commandId = parts.slice(1, -1).join(":").trim();

  if (!source) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `missing source name in spec '${spec}'; expected format <source>:<command-id>:<count>`,
    );
  }

  if (!commandId) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `missing command id in spec '${spec}'; expected format <source>:<command-id>:<count>`,
    );
  }

  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid count '${rawCount}' in source spec '${spec}'; count must be an integer >= 0`,
    );
  }

  return { source, commandId, count };
}

export function tryParseQuiescentSourceSpec(
  spec: string,
):
  | { readonly ok: true; readonly value: QuiescentSourceInput }
  | { readonly ok: false; readonly error: string } {
  try {
    const parsed = parseQuiescentSourceSpec(spec);
    return { ok: true, value: parsed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function validateQuiescentScan(
  inputs: readonly (string | QuiescentSourceInput)[],
  options: {
    readonly runRoot?: string | undefined;
    readonly capsulesDir?: string | undefined;
    readonly repoRoot?: string | undefined;
  } = {},
): QuiescentValidationResult {
  const invalidSources: string[] = [];
  const nonZeroSources: { readonly source: MindSourceId; readonly count: number }[] = [];
  const unevidencedSources: { readonly source: MindSourceId; readonly commandId: string }[] = [];
  const observationMap = new Map<MindSourceId, QuiescentSourceObservation>();

  for (const item of inputs) {
    let parsedInput: QuiescentSourceInput;
    if (typeof item === "string") {
      const parsedRes = tryParseQuiescentSourceSpec(item);
      if (!parsedRes.ok) {
        invalidSources.push(item);
        continue;
      }
      parsedInput = parsedRes.value;
    } else if (
      item &&
      typeof item === "object" &&
      typeof item.source === "string" &&
      typeof item.commandId === "string" &&
      typeof item.count === "number"
    ) {
      if (
        !Number.isSafeInteger(item.count) ||
        item.count < 0 ||
        !item.source.trim() ||
        !item.commandId.trim()
      ) {
        invalidSources.push(JSON.stringify(item));
        continue;
      }
      parsedInput = {
        source: item.source.trim(),
        commandId: item.commandId.trim(),
        count: item.count,
      };
    } else {
      invalidSources.push(String(item));
      continue;
    }

    const sourceDef = findSourceDefinition(parsedInput.source);
    if (!sourceDef) {
      invalidSources.push(parsedInput.source);
      continue;
    }

    if (parsedInput.count !== 0) {
      nonZeroSources.push({ source: sourceDef.id, count: parsedInput.count });
    }

    const resolution = resolveCommandRecord(parsedInput.commandId, options);
    if (!resolution.found) {
      unevidencedSources.push({ source: sourceDef.id, commandId: parsedInput.commandId });
    }

    observationMap.set(sourceDef.id, {
      source: sourceDef.id,
      commandId: parsedInput.commandId,
      count: parsedInput.count,
      evidenceClass: sourceDef.evidenceClass,
      sourceNumber: sourceDef.number,
      sourceName: sourceDef.name,
    });
  }

  const missingSources: MindSourceId[] = [];
  for (const def of MIND_DISCOVERY_SOURCES) {
    if (!observationMap.has(def.id)) {
      missingSources.push(def.id);
    }
  }

  const sortedObservations = MIND_DISCOVERY_SOURCES.map((def) => observationMap.get(def.id)).filter(
    (obs): obs is QuiescentSourceObservation => obs !== undefined,
  );

  let error: string | undefined = undefined;
  if (invalidSources.length > 0) {
    error = `invalid source specifications: ${invalidSources.join(", ")}`;
  } else if (missingSources.length > 0) {
    error = `quiescence requires all 10 discovery sources to be observed; missing ${missingSources.length} source(s): ${missingSources.join(", ")}`;
  } else if (nonZeroSources.length > 0) {
    error = `quiescence refused: non-zero counts detected in sources: ${nonZeroSources.map((s) => `${s.source}=${s.count}`).join(", ")}; quiescence requires count == 0 for all 10 sources`;
  } else if (unevidencedSources.length > 0) {
    error = `quiescence refused: unrecorded command evidence for sources: ${unevidencedSources.map((s) => `${s.source} (command '${s.commandId}')`).join(", ")}; command records must exist under .capsules/`;
  }

  const ok =
    invalidSources.length === 0 &&
    missingSources.length === 0 &&
    nonZeroSources.length === 0 &&
    unevidencedSources.length === 0 &&
    sortedObservations.length === MIND_DISCOVERY_SOURCES.length;

  return {
    ok,
    observations: sortedObservations,
    missingSources,
    nonZeroSources,
    invalidSources,
    unevidencedSources,
    error,
  };
}
