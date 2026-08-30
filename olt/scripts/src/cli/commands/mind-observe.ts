import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JsonObject, JsonValue } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  findSourceDefinition,
  MIND_DISCOVERY_SOURCES,
  resolveCommandRecord,
  type EvidenceClass,
  type MindObservationRecord,
  type MindSourceId,
} from "../../mind/memory/sources/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/index.ts";
import { findGrant, readAgentLedger } from "../../workflow/agents/ledger.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { initRepoPolicy } from "../../policy/index.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MindObserveResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly actor: string;
  readonly observation_id: string;
  readonly source: MindSourceId;
  readonly source_number: number;
  readonly source_name: string;
  readonly command_id: string;
  readonly count: number;
  readonly evidence_class: EvidenceClass;
  readonly observed_at: string;
  readonly [key: string]: unknown;
}

export function formatMindObserveBrief(params: {
  readonly observationId: string;
  readonly runRoot: string;
  readonly actor: string;
  readonly sourceId: MindSourceId;
  readonly sourceNumber: number;
  readonly sourceName: string;
  readonly commandId: string;
  readonly count: number;
  readonly evidenceClass: EvidenceClass;
  readonly observedAt: string;
}): string {
  const md = [
    `### Mind Source Observed: ${params.sourceId} (${params.observationId})`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Actor**: \`${params.actor}\``,
    `- **Source**: \`${params.sourceId}\` (#${params.sourceNumber} — ${params.sourceName})`,
    `- **Command ID**: \`${params.commandId}\``,
    `- **Count**: ${params.count}`,
    `- **Evidence Class**: \`${params.evidenceClass}\``,
    `- **Observed At**: \`${params.observedAt}\``,
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export function mindObserveCommand(flags: Flags, _context?: CommandContext): MindObserveResult {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const sourceRaw = textFlag(flags, "source", true)!;
  const commandIdRaw =
    textFlag(flags, "command-id", false) ??
    textFlag(flags, "command", false) ??
    textFlag(flags, "cmd", false);
  const now = textFlag(flags, "now", false);

  if (!commandIdRaw || !commandIdRaw.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--command-id is required: specify the recorded command ID evidencing this observation",
    );
  }
  const commandId = commandIdRaw.trim();

  // Parse count supporting both number and string flag representations
  const rawCount = (flags as Record<string, unknown>)["count"];
  let count: number;
  if (typeof rawCount === "number") {
    if (!Number.isSafeInteger(rawCount) || rawCount < 0) {
      throw new HarnessError("INVALID_ARGUMENT", "--count must be a bounded integer >= 0");
    }
    count = rawCount;
  } else {
    const parsed = integerFlag(flags, "count", { required: true, minimum: 0 });
    if (parsed === undefined) {
      throw new HarnessError("INVALID_ARGUMENT", "--count is required");
    }
    count = parsed;
  }

  const sourceDef = findSourceDefinition(sourceRaw);
  if (!sourceDef) {
    const validList = MIND_DISCOVERY_SOURCES.map((s) => s.id).join(", ");
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `unknown discovery source '${sourceRaw}'; must be one of: ${validList}`,
    );
  }

  const nowMs = now ? Date.parse(now) : Date.now();
  if (now && !Number.isFinite(nowMs)) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${now}`);
  }
  const nowIso = new Date(nowMs).toISOString();

  const loaded = loadRun(run, false);
  const state = loaded.state;

  // 1. Enforce acting agent role grant
  const ledger = readAgentLedger(state);
  const grant = findGrant(ledger, actor);
  if (!grant) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds no grant; register it with agent:register first`,
    );
  }
  if (grant.role !== "mind") {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds role '${grant.role}'; role 'mind' is required for mind:observe`,
    );
  }

  const repoRoot = findRepoRoot(loaded.runRoot);
  const policyFile = join(repoRoot, ".olt", "policy.json");
  if (!existsSync(policyFile)) {
    initRepoPolicy(repoRoot);
  }

  const resolution = resolveCommandRecord(commandId, {
    runRoot: loaded.runRoot,
    repoRoot,
  });

  if (!resolution.found) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `command id '${commandId}' was not found in any capsule under .capsules/; observation requires evidence from a real recorded command`,
    );
  }

  // 3. Determine next observation ID
  const existingObservations = (
    Array.isArray(state.observations) ? state.observations : []
  ) as Record<string, unknown>[];
  let maxObsNum = 0;
  for (const obs of existingObservations) {
    if (typeof obs?.id === "string") {
      const match = /^obs-(\d+)$/.exec(obs.id);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > maxObsNum) maxObsNum = num;
      }
    }
  }
  const nextObsNum = Math.max(maxObsNum + 1, existingObservations.length + 1);
  const observationId = `obs-${nextObsNum}`;

  const observationRecord: MindObservationRecord = {
    id: observationId,
    source: sourceDef.id,
    command_id: commandId,
    count,
    observed_at: nowIso,
    evidence_class: sourceDef.evidenceClass,
  };

  // 4. Transact mind-observed in mind capsule
  transact(
    run,
    actor,
    "mind-observed",
    {
      observation_id: observationId,
      id: observationId,
      source: sourceDef.id,
      command_id: commandId,
      count,
      evidence_class: sourceDef.evidenceClass,
      observed_at: nowIso,
    },
    (working) => {
      const observations = Array.isArray(working.observations) ? [...working.observations] : [];
      observations.push(observationRecord as unknown as JsonObject);
      working.observations = observations as unknown as JsonValue[];
    },
  );

  const markdown = formatMindObserveBrief({
    observationId,
    runRoot: run,
    actor,
    sourceId: sourceDef.id,
    sourceNumber: sourceDef.number,
    sourceName: sourceDef.name,
    commandId,
    count,
    evidenceClass: sourceDef.evidenceClass,
    observedAt: nowIso,
  });

  return {
    markdown,
    run_root: run,
    actor,
    observation_id: observationId,
    source: sourceDef.id,
    source_number: sourceDef.number,
    source_name: sourceDef.name,
    command_id: commandId,
    count,
    evidence_class: sourceDef.evidenceClass,
    observed_at: nowIso,
  };
}
