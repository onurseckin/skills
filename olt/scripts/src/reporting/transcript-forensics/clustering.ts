import type {
  ClusteredForensicDefect,
  ForensicFindingOccurrence,
  ForensicHeuristicCategory,
  ForensicRawFinding,
} from "./types.ts";

interface ClusterEntry {
  category: ForensicHeuristicCategory;
  rootCauseHeuristic: string;
  signature: string;
  errorSnippet: string;
  offendingCommand?: string;
  occurrences: ForensicFindingOccurrence[];
  convIds: Set<string>;
  firstSeen: string;
  lastSeen: string;
}

export function clusterForensicFindings(
  findings: readonly ForensicRawFinding[],
): ClusteredForensicDefect[] {
  const map = new Map<string, ClusterEntry>();

  for (const f of findings) {
    const existing = map.get(f.signature);
    const occ: ForensicFindingOccurrence = {
      conversationId: f.conversationId,
      timestamp: f.timestamp,
      ...(f.stepIndex !== undefined ? { stepIndex: f.stepIndex } : {}),
      errorSnippet: f.errorSnippet,
      ...(f.offendingCommand ? { offendingCommand: f.offendingCommand } : {}),
      ...(f.transcriptPath ? { transcriptPath: f.transcriptPath } : {}),
    };

    if (!existing) {
      map.set(f.signature, {
        category: f.category,
        rootCauseHeuristic: f.rootCauseHeuristic,
        signature: f.signature,
        errorSnippet: f.errorSnippet,
        ...(f.offendingCommand ? { offendingCommand: f.offendingCommand } : {}),
        occurrences: [occ],
        convIds: new Set([f.conversationId]),
        firstSeen: f.timestamp,
        lastSeen: f.timestamp,
      });
    } else {
      existing.occurrences.push(occ);
      existing.convIds.add(f.conversationId);
      if (f.timestamp < existing.firstSeen) existing.firstSeen = f.timestamp;
      if (f.timestamp > existing.lastSeen) existing.lastSeen = f.timestamp;
      if (!existing.offendingCommand && f.offendingCommand) {
        existing.offendingCommand = f.offendingCommand;
      }
    }
  }

  return [...map.values()].map((entry) => ({
    category: entry.category,
    rootCauseHeuristic: entry.rootCauseHeuristic,
    signature: entry.signature,
    errorSnippet: entry.errorSnippet,
    ...(entry.offendingCommand ? { offendingCommand: entry.offendingCommand } : {}),
    count: entry.occurrences.length,
    occurrences: entry.occurrences,
    firstSeen: entry.firstSeen,
    lastSeen: entry.lastSeen,
    conversationIds: [...entry.convIds],
  }));
}
