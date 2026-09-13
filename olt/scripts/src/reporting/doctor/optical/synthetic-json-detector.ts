import { OPTICAL_DOCTOR_ENGINE_NAME, type OpticalDoctorFinding } from "./types.ts";

export interface SyntheticJsonPatternRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly description: string;
}

export const SYNTHETIC_JSON_PATTERNS: readonly SyntheticJsonPatternRule[] = [
  {
    id: "empty-overflow-or-clipping-stub",
    pattern:
      /\{[\s\S]*?"(?:layoutOverflows|textClippings|touchTargetCollisions|contrastViolations)"\s*:\s*\[\s*\][\s\S]*?\}/u,
    description: "Synthetic JSON object containing empty layout/clipping/touch violation stubs",
  },
  {
    id: "synthetic-status-pass-stub",
    pattern: /\{[\s\S]*?"status"\s*:\s*"(?:pass|approved|passed|compliant)"[\s\S]*?\}/iu,
    description: "Synthetic JSON status pass or approved stub substituted for ocular appraisal",
  },
  {
    id: "synthetic-empty-findings-array",
    pattern: /\{[\s\S]*?"findings"\s*:\s*\[\s*\][\s\S]*?\}/u,
    description: "Synthetic JSON stub declaring empty findings array without human narrative",
  },
  {
    id: "json-code-block-evasion",
    pattern:
      /```(?:json)?\s*\{[\s\S]*?(?:"layoutOverflows"|"textClippings"|"status"|"findings")[\s\S]*?\}\s*```/iu,
    description: "Markdown JSON code fence wrapping synthetic audit telemetry",
  },
];

const SUSPICIOUS_JSON_KEYS = new Set([
  "layoutoverflows",
  "textclippings",
  "touchtargetcollisions",
  "contrastviolations",
  "status",
  "findings",
  "viewports",
  "auditresult",
]);

function tryParseSuspiciousJson(text: string): {
  readonly detected: boolean;
  readonly snippet: string;
} {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return { detected: false, snippet: "" };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed as Record<string, unknown>).map((k) => k.toLowerCase());
      const hasSuspiciousKey = keys.some((k) => SUSPICIOUS_JSON_KEYS.has(k));
      if (hasSuspiciousKey) {
        return {
          detected: true,
          snippet: trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed,
        };
      }
    }
  } catch {
    // Not valid JSON, continue with regex checks
  }

  return { detected: false, snippet: "" };
}

export function detectSyntheticJsonEvasion(reviewProse: string): readonly OpticalDoctorFinding[] {
  if (typeof reviewProse !== "string" || reviewProse.trim().length === 0) {
    return [];
  }

  const findings: OpticalDoctorFinding[] = [];

  // Check 1: Whole-body JSON payload evasion
  const fullJsonCheck = tryParseSuspiciousJson(reviewProse);
  if (fullJsonCheck.detected) {
    findings.push({
      code: "SYNTHETIC_JSON_EVASION",
      severity: "ERROR",
      engine: OPTICAL_DOCTOR_ENGINE_NAME,
      message:
        "Synthetic JSON evasion detected: entire review is a serialized diagnostic JSON object instead of human prose",
      details: {
        matchedSnippet: fullJsonCheck.snippet,
      },
    });
    return findings;
  }

  // Check 2: Embedded JSON patterns
  for (const rule of SYNTHETIC_JSON_PATTERNS) {
    const match = rule.pattern.exec(reviewProse);
    if (match) {
      const rawSnippet = match[0];
      const matchedSnippet =
        rawSnippet.length > 120 ? `${rawSnippet.slice(0, 117)}...` : rawSnippet;
      findings.push({
        code: "SYNTHETIC_JSON_EVASION",
        severity: "ERROR",
        engine: OPTICAL_DOCTOR_ENGINE_NAME,
        message: `Synthetic JSON evasion detected: ${rule.description}`,
        details: {
          ruleId: rule.id,
          matchedSnippet,
        },
      });
      break;
    }
  }

  return findings;
}
