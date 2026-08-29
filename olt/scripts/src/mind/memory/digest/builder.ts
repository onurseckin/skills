import { basename } from "node:path";
import {
  generateTrailingValueSeries,
  extractTrailingValueSeriesFromEvents,
  extractTrailingValueSeriesFromState,
  type TrailingValueSeries,
  type TrailingValuePoint,
} from "../../lifecycle/interval/index.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadRun } from "../../../engine/store/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  DigestFinding,
  DigestFailingGate,
  DigestEscalation,
  DigestDeclinedCandidate,
  DigestOpenProposal,
  EscalationDigestData,
  OwnerDigestData,
  BuildEscalationDigestOptions,
  BuildOwnerDigestOptions,
} from "./types.ts";
import { parseNowIso } from "./types.ts";
import { extractRunSignals } from "./reader.ts";
export function buildEscalationDigest(
  options: BuildEscalationDigestOptions = {},
): EscalationDigestData {
  const generatedAt = parseNowIso(options.now);
  const runId = options.runId ?? (options.mindRunRoot ? basename(options.mindRunRoot) : "mind");

  const findingsMap = new Map<string, DigestFinding>();
  const gatesMap = new Map<string, DigestFailingGate>();
  const escalationsMap = new Map<string, DigestEscalation>();
  const declinedMap = new Map<string, DigestDeclinedCandidate>();
  const proposalsMap = new Map<string, DigestOpenProposal>();

  const registerFinding = (f: DigestFinding): void => {
    const key = `${f.runId ?? ""}:${f.taskId ?? ""}:${f.findingId}`;
    if (!findingsMap.has(key)) findingsMap.set(key, f);
  };
  const registerGate = (g: DigestFailingGate): void => {
    const key = `${g.runId ?? ""}:${g.gateId}`;
    if (!gatesMap.has(key)) gatesMap.set(key, g);
  };
  const registerEscalation = (e: DigestEscalation): void => {
    const key = `${e.runId ?? ""}:${e.escalationId}`;
    if (!escalationsMap.has(key)) escalationsMap.set(key, e);
  };
  const registerDeclined = (d: DigestDeclinedCandidate): void => {
    if (!declinedMap.has(d.candidateId)) declinedMap.set(d.candidateId, d);
  };
  const registerProposal = (p: DigestOpenProposal): void => {
    if (!proposalsMap.has(p.proposalId)) proposalsMap.set(p.proposalId, p);
  };

  // 1. Explicit items passed in options
  if (options.openFindings) {
    for (const f of options.openFindings) registerFinding(f);
  }
  if (options.failingGates) {
    for (const g of options.failingGates) registerGate(g);
  }
  if (options.escalations) {
    for (const e of options.escalations) registerEscalation(e);
  }
  if (options.declinedCandidates) {
    for (const d of options.declinedCandidates) registerDeclined(d);
  }
  if (options.openProposals) {
    for (const p of options.openProposals) registerProposal(p);
  }

  // 2. Extract from primary state object
  if (options.state) {
    const extracted = extractRunSignals(options.state, runId);
    for (const f of extracted.findings) registerFinding(f);
    for (const g of extracted.gates) registerGate(g);
    for (const e of extracted.escalations) registerEscalation(e);
    for (const d of extracted.declinedCandidates) registerDeclined(d);
    for (const p of extracted.openProposals) registerProposal(p);
  }

  // 3. Extract from liveRuns list
  if (options.liveRuns) {
    for (const lr of options.liveRuns) {
      if (lr.state) {
        const extracted = extractRunSignals(lr.state, lr.runId);
        for (const f of extracted.findings) registerFinding(f);
        for (const g of extracted.gates) registerGate(g);
        for (const e of extracted.escalations) registerEscalation(e);
        for (const d of extracted.declinedCandidates) registerDeclined(d);
        for (const p of extracted.openProposals) registerProposal(p);
      } else if (lr.runRoot && existsSync(lr.runRoot)) {
        try {
          const loaded = loadRun(lr.runRoot, false);
          const extracted = extractRunSignals(loaded.state as Record<string, unknown>, lr.runId);
          for (const f of extracted.findings) registerFinding(f);
          for (const g of extracted.gates) registerGate(g);
          for (const e of extracted.escalations) registerEscalation(e);
          for (const d of extracted.declinedCandidates) registerDeclined(d);
          for (const p of extracted.openProposals) registerProposal(p);
        } catch {
          // ignore unreadable run
        }
      }
    }
  }

  // 4. Extract from capsulesDir if provided
  if (options.capsulesDir && existsSync(options.capsulesDir)) {
    try {
      const entries = readdirSync(options.capsulesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith(".")) continue;
        const targetPath = join(options.capsulesDir, entry.name);
        try {
          const loaded = loadRun(targetPath, false);
          const extracted = extractRunSignals(loaded.state as Record<string, unknown>, entry.name);
          for (const f of extracted.findings) registerFinding(f);
          for (const g of extracted.gates) registerGate(g);
          for (const e of extracted.escalations) registerEscalation(e);
          for (const d of extracted.declinedCandidates) registerDeclined(d);
          for (const p of extracted.openProposals) registerProposal(p);
        } catch {
          // ignore unreadable directory
        }
      }
    } catch {
      // ignore
    }
  }

  // 5. Extract from mindRunRoot if provided and not already done
  if (options.mindRunRoot && existsSync(options.mindRunRoot) && !options.state) {
    try {
      const loaded = loadRun(options.mindRunRoot, false);
      const extracted = extractRunSignals(
        loaded.state as Record<string, unknown>,
        basename(options.mindRunRoot),
      );
      for (const f of extracted.findings) registerFinding(f);
      for (const g of extracted.gates) registerGate(g);
      for (const e of extracted.escalations) registerEscalation(e);
      for (const d of extracted.declinedCandidates) registerDeclined(d);
      for (const p of extracted.openProposals) registerProposal(p);
    } catch {
      // ignore
    }
  }

  // 6. Extract Trailing Value Series
  const windowSize = options.windowSize ?? 20;
  let trailingValueSeries: TrailingValueSeries;
  if (options.trailingValueSeries) {
    if (
      typeof options.trailingValueSeries === "object" &&
      options.trailingValueSeries !== null &&
      "rawValues" in options.trailingValueSeries &&
      "formattedSeries" in options.trailingValueSeries
    ) {
      trailingValueSeries = options.trailingValueSeries as TrailingValueSeries;
    } else if (Array.isArray(options.trailingValueSeries)) {
      const arr = options.trailingValueSeries;
      if (arr.length === 0) {
        trailingValueSeries = generateTrailingValueSeries([], windowSize);
      } else if (typeof arr[0] === "number") {
        const points: TrailingValuePoint[] = (arr as readonly number[]).map((val, idx) => ({
          pulseId: `pulse-${idx + 1}`,
          outcome: val > 0 ? "advance" : "quiescent",
          value: val,
        }));
        trailingValueSeries = generateTrailingValueSeries(points, windowSize);
      } else {
        trailingValueSeries = generateTrailingValueSeries(
          arr as readonly TrailingValuePoint[],
          windowSize,
        );
      }
    } else {
      trailingValueSeries = generateTrailingValueSeries([], windowSize);
    }
  } else if (options.events && Array.isArray(options.events)) {
    trailingValueSeries = extractTrailingValueSeriesFromEvents(options.events, windowSize);
  } else if (options.state) {
    trailingValueSeries = extractTrailingValueSeriesFromState(options.state, windowSize);
  } else if (options.mindRunRoot && existsSync(options.mindRunRoot)) {
    try {
      const loaded = loadRun(options.mindRunRoot, false);
      trailingValueSeries = extractTrailingValueSeriesFromState(
        loaded.state as Record<string, unknown>,
        windowSize,
      );
    } catch {
      trailingValueSeries = generateTrailingValueSeries([], windowSize);
    }
  } else {
    trailingValueSeries = generateTrailingValueSeries([], windowSize);
  }

  // Deterministic sorting
  const sortedFindings = [...findingsMap.values()].sort((a, b) =>
    (a.findingId + (a.taskId ?? "")).localeCompare(b.findingId + (b.taskId ?? "")),
  );
  const sortedGates = [...gatesMap.values()].sort((a, b) =>
    (a.gateId + (a.taskId ?? "")).localeCompare(b.gateId + (b.taskId ?? "")),
  );
  const sortedEscalations = [...escalationsMap.values()].sort((a, b) =>
    (a.escalationId + (a.taskId ?? "")).localeCompare(b.escalationId + (b.taskId ?? "")),
  );
  const sortedDeclined = [...declinedMap.values()].sort((a, b) =>
    a.candidateId.localeCompare(b.candidateId),
  );
  const sortedProposals = [...proposalsMap.values()].sort((a, b) =>
    a.proposalId.localeCompare(b.proposalId),
  );

  const totalSignalsCount =
    sortedFindings.length +
    sortedGates.length +
    sortedEscalations.length +
    sortedDeclined.length +
    sortedProposals.length;

  return {
    generatedAt,
    runId,
    openFindings: sortedFindings,
    failingGates: sortedGates,
    escalations: sortedEscalations,
    declinedCandidates: sortedDeclined,
    openProposals: sortedProposals,
    trailingValueSeries,
    totalSignalsCount,
  };
}

export const buildOwnerDigest = buildEscalationDigest;
