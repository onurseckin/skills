import { recordKeyedDefect } from "../../logging/index.ts";
import type {
  DefectCategory,
  DefectRecordInput,
  DefectSeverity,
} from "../../logging/defects/index.ts";
import { extractConversationId, locateTranscripts, parseTranscriptFile } from "./locator.ts";
import {
  ERROR_PATTERNS,
  REVERSE_ENG_TOKEN,
  extractCommand,
  makeFinding,
  type TranscriptStepRecord,
} from "./patterns.ts";
import { clusterForensicFindings } from "./clustering.ts";
import type {
  ClusteredForensicDefect,
  ForensicHeuristicCategory,
  ForensicRawFinding,
  ForensicScanOptions,
  ForensicScanSummary,
} from "./types.ts";

function extractSnippet(text: string, pattern: RegExp | string): string {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (typeof pattern === "string" ? t.includes(pattern) : pattern.test(t)) return t.slice(0, 240);
  }
  return text.trim().slice(0, 240);
}

export function scanTranscriptSteps(
  steps: readonly TranscriptStepRecord[],
  conversationId: string,
  transcriptPath?: string,
): ForensicRawFinding[] {
  const findings: ForensicRawFinding[] = [];
  let pendingCommand: string | undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const ts =
      step.timestamp !== undefined
        ? step.timestamp
        : step.created_at !== undefined
          ? step.created_at
          : new Date().toISOString();
    const cmd = extractCommand(step.tool_calls);
    if (cmd) {
      pendingCommand = cmd;
      if (cmd.includes(REVERSE_ENG_TOKEN)) {
        findings.push(
          makeFinding(
            "source_reverse_engineering",
            "Source code reverse engineering attempt by agent",
            "source_reverse_engineering",
            cmd.slice(0, 200),
            cmd,
            ts,
            conversationId,
            step.step_index !== undefined ? step.step_index : i,
            transcriptPath,
          ),
        );
      }
    }

    const content = step.content !== undefined ? step.content : "";
    if (content.length === 0) continue;
    if (
      content.includes(REVERSE_ENG_TOKEN) &&
      !findings.some((f) => f.category === "source_reverse_engineering")
    ) {
      findings.push(
        makeFinding(
          "source_reverse_engineering",
          "Source code reverse engineering content in transcript",
          "source_reverse_engineering",
          extractSnippet(content, REVERSE_ENG_TOKEN),
          pendingCommand,
          ts,
          conversationId,
          step.step_index !== undefined ? step.step_index : i,
          transcriptPath,
        ),
      );
    }

    for (const pat of ERROR_PATTERNS) {
      const m = content.match(pat.regex);
      if (m) {
        findings.push(
          makeFinding(
            pat.category,
            pat.heuristic(m),
            pat.signature(m),
            extractSnippet(content, pat.regex),
            pendingCommand,
            ts,
            conversationId,
            step.step_index !== undefined ? step.step_index : i,
            transcriptPath,
          ),
        );
      }
    }
  }
  return findings;
}

const DEFECT_CAT_MAP: Record<
  ForensicHeuristicCategory,
  { cat: DefectCategory; sev: DefectSeverity }
> = {
  cognitive_validator_lockout: { cat: "boundary_violation", sev: "critical" },
  critic_authentication_failure: { cat: "security_risk", sev: "critical" },
  command_ownership_failure: { cat: "code_defect", sev: "high" },
  unknown_cli_option: { cat: "code_defect", sev: "high" },
  source_reverse_engineering: { cat: "boundary_violation", sev: "critical" },
  harness_error: { cat: "code_defect", sev: "high" },
};

export function recordClusteredDefects(
  clusters: readonly ClusteredForensicDefect[],
  options?: { defectsPath?: string; cwd?: string },
): number {
  let recorded = 0;
  const filePath = options?.defectsPath;
  const cwd = options?.cwd !== undefined ? options.cwd : process.cwd();

  for (const c of clusters) {
    const meta =
      DEFECT_CAT_MAP[c.category] !== undefined
        ? DEFECT_CAT_MAP[c.category]
        : { cat: "code_defect" as const, sev: "high" as const };
    const input: DefectRecordInput = {
      category: meta.cat,
      severity: meta.sev,
      observation: `[Forensic Scanner] ${c.rootCauseHeuristic} (${c.count} occurrences across ${c.conversationIds.length} sessions). Snippet: ${c.errorSnippet.slice(0, 160)}`,
      description: `System defect identified by transcript forensics: ${c.signature}. Most frequent error: ${c.errorSnippet.slice(0, 100)}`,
      remediation:
        "Investigate agent prompt drift, command specification mismatch, or CLI contract error.",
      dedup_key: c.signature,
      first_seen: c.firstSeen,
      last_seen: c.lastSeen,
      count: c.count,
      context: {
        forensic_category: c.category,
        forensic_signature: c.signature,
        occurrence_count: c.count,
        conversation_ids: c.conversationIds,
        first_seen: c.firstSeen,
        last_seen: c.lastSeen,
        ...(c.offendingCommand ? { offending_command: c.offendingCommand } : {}),
        location:
          c.occurrences[0]?.transcriptPath !== undefined
            ? c.occurrences[0].transcriptPath
            : "transcript",
      },
    };
    try {
      recordKeyedDefect(input, {
        ...(filePath !== undefined ? { filePath } : {}),
        cwd,
      });
      recorded++;
    } catch {
      // Non-blocking recording
    }
  }
  return recorded;
}

export function scanTranscriptForensics(options?: ForensicScanOptions): ForensicScanSummary {
  const transcripts = locateTranscripts(options);
  const allFindings: ForensicRawFinding[] = [];
  let totalSteps = 0;

  for (const tPath of transcripts) {
    const steps = parseTranscriptFile(tPath);
    totalSteps += steps.length;
    const convId = extractConversationId(tPath);
    const findings = scanTranscriptSteps(steps, convId, tPath);
    allFindings.push(...findings);
  }

  const clusters = clusterForensicFindings(allFindings);
  const categories: Record<ForensicHeuristicCategory, number> = {
    cognitive_validator_lockout: 0,
    critic_authentication_failure: 0,
    command_ownership_failure: 0,
    unknown_cli_option: 0,
    source_reverse_engineering: 0,
    harness_error: 0,
  };

  for (const f of allFindings) {
    const existingCount = categories[f.category];
    categories[f.category] = (existingCount !== undefined ? existingCount : 0) + 1;
  }

  let recordedCount = 0;
  if (options?.recordDefects) {
    const recordOpts: { defectsPath?: string; cwd?: string } = {
      ...(options.defectsPath !== undefined ? { defectsPath: options.defectsPath } : {}),
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    };
    recordedCount = recordClusteredDefects(clusters, recordOpts);
  }

  return {
    totalTranscriptsScanned: transcripts.length,
    totalStepsScanned: totalSteps,
    totalFindings: allFindings.length,
    categories,
    clusters,
    recordedDefectCount: recordedCount,
  };
}

export { clusterForensicFindings, extractConversationId, locateTranscripts, parseTranscriptFile };
