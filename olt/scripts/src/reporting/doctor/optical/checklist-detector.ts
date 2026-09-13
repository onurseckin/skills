import { OPTICAL_DOCTOR_ENGINE_NAME, type OpticalDoctorFinding } from "./types.ts";

export interface BannedChecklistPatternRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly description: string;
  readonly code: "BANNED_CHECKLIST_BOILERPLATE" | "SUPERFICIAL_CHECKLIST_PARROTING";
}

export const BANNED_CHECKLIST_PATTERNS: readonly BannedChecklistPatternRule[] = [
  {
    id: "rubric-bullet-colon",
    pattern:
      /^\s*(?:[-*+]|\d+[.)])\s*(?:APCA|Touch\s*targets?|Axis|Landmark|Contrast|Z-index|Visual\s*layout|Spacing(?:\s*rhythm)?|Typography|Font\s*rendering|Theme\s*harmony|Lightness\s*contrast)\s*[:\-–]/imu,
    description: "Formulaic bulleted or numbered dimension rubric entry with colon separator",
    code: "BANNED_CHECKLIST_BOILERPLATE",
  },
  {
    id: "heading-checklist",
    pattern:
      /^#{1,6}\s*(?:\d+[.)]\s*)?(?:Visual\s+Layout|Optical\s+Spacing|Typography|Contrast|APCA|Touch\s+Targets?|Theme\s+Harmony|Z-index|Axis\s+\d+|Landmark\s+\d+)\b/imu,
    description: "Astroturfed section heading mimicking mechanical audit dimensions",
    code: "SUPERFICIAL_CHECKLIST_PARROTING",
  },
  {
    id: "task-list-checklist",
    pattern:
      /^\s*(?:[-*+]\s*)?\[[ xX]\]\s*(?:Visual\s+Layout|Optical\s+Spacing|Typography|Contrast|APCA|Touch\s+Targets?|Theme\s+Harmony|Z-index)/imu,
    description: "Markdown checkbox task list item mimicking automated checklist",
    code: "BANNED_CHECKLIST_BOILERPLATE",
  },
  {
    id: "table-checklist-row",
    pattern:
      /\|\s*(?:APCA|Touch\s+targets?|Visual\s+layout|Spacing|Typography|Contrast|Theme\s+harmony|Z-index)\s*\|\s*(?:Pass|Fail|OK|Verified|Passed|N\/A)\s*\|/iu,
    description: "Markdown table row pairing optical dimension with mechanical verdict",
    code: "BANNED_CHECKLIST_BOILERPLATE",
  },
  {
    id: "formulaic-verdict-enumeration",
    pattern:
      /^\s*(?:[-*+]|\d+[.)])\s*[A-Za-z\s]{3,30}:\s*(?:Pass|Fail|Passed|Failed|OK|Verified|Compliant)\s*$/imu,
    description: "Formulaic short status enumeration without qualitative human observation",
    code: "SUPERFICIAL_CHECKLIST_PARROTING",
  },
  {
    id: "legacy-axis-landmark-tag",
    pattern: /\b(?:Axis\s+[1-4]|Landmark\s+[1-3])\b/iu,
    description: "Legacy bureaucratic Axis or Landmark token recital",
    code: "BANNED_CHECKLIST_BOILERPLATE",
  },
  {
    id: "raw-css-token-parrot-dump",
    pattern: /(?:rgba\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\).{0,30}){3,}/iu,
    description: "Repetitive raw CSS color token dump extracted from prompt context",
    code: "SUPERFICIAL_CHECKLIST_PARROTING",
  },
];

export function detectSuperficialChecklists(reviewProse: string): readonly OpticalDoctorFinding[] {
  if (typeof reviewProse !== "string" || reviewProse.trim().length === 0) {
    return [];
  }

  const findings: OpticalDoctorFinding[] = [];
  const lines = reviewProse.split(/\r?\n/u);

  for (const rule of BANNED_CHECKLIST_PATTERNS) {
    if (rule.pattern.multiline) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line !== undefined && rule.pattern.test(line)) {
          const matchedSnippet = line.trim();
          findings.push({
            code: rule.code,
            severity: "ERROR",
            engine: OPTICAL_DOCTOR_ENGINE_NAME,
            message: `Checklist boilerplate detected: ${rule.description} on line ${i + 1}`,
            details: {
              ruleId: rule.id,
              lineNumber: i + 1,
              matchedSnippet,
            },
          });
          // One finding per rule is sufficient to prevent diagnostic flooding
          break;
        }
      }
    } else {
      const match = rule.pattern.exec(reviewProse);
      if (match) {
        findings.push({
          code: rule.code,
          severity: "ERROR",
          engine: OPTICAL_DOCTOR_ENGINE_NAME,
          message: `Checklist boilerplate detected: ${rule.description}`,
          details: {
            ruleId: rule.id,
            matchedSnippet: match[0],
          },
        });
      }
    }
  }

  return findings;
}
