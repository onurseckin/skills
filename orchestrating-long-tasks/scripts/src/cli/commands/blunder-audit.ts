import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { JsonObject, JsonValue } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun } from "../../store/load.ts";
import { transact } from "../../store/transaction.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { assertFlags, boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export type BlunderStatus = "open" | "admitted" | "resolved" | "declined" | "ignored";

export interface RGBColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface ApcaBadgeInfo {
  readonly label: string;
  readonly badge_text: string;
  readonly fg_color: string;
  readonly bg_color: string;
  readonly lc: number;
  readonly required_lc: number;
  readonly passes_apca: boolean;
}

export interface ApcaContrastCompliance {
  readonly compliant_badges: number;
  readonly total_badges: number;
  readonly min_lc_observed: number;
  readonly passes_apca: boolean;
  readonly badge_details: readonly ApcaBadgeInfo[];
}

export interface AuditedBlunder {
  readonly id: string;
  readonly type: string;
  readonly severity: "critical" | "warning" | string;
  readonly timestamp: string;
  readonly pid: number;
  readonly ppid: number;
  readonly agent_id: string | null;
  readonly observation: string;
  readonly remediation: string;
  readonly context: {
    readonly cwd?: string | undefined;
    readonly indicators?: Readonly<Record<string, string>> | undefined;
    readonly [key: string]: unknown;
  };
  readonly status: BlunderStatus;
  readonly source_capsule: string;
  readonly source_file: string;
  readonly candidate_id?: string | null | undefined;
}

export interface BlunderAuditSummary {
  readonly total_blunders: number;
  readonly open_count: number;
  readonly admitted_count: number;
  readonly resolved_count: number;
  readonly declined_count: number;
  readonly critical_count: number;
  readonly warning_count: number;
  readonly by_category: Readonly<Record<string, number>>;
  readonly by_capsule: Readonly<Record<string, number>>;
  readonly apca_contrast_compliance: ApcaContrastCompliance;
}

export interface BlunderAuditCommandResult {
  readonly markdown: string;
  readonly capsules_dir: string;
  readonly run_root: string | null;
  readonly total_blunders: number;
  readonly filtered_blunders: readonly AuditedBlunder[];
  readonly summary: BlunderAuditSummary;
  readonly auto_admitted_count: number;
  readonly auto_admitted_candidates: readonly string[];
  readonly [key: string]: unknown;
}

function sRgbToLinearY(r: number, g: number, b: number): number {
  const rLin = Math.pow(r / 255, 2.4);
  const gLin = Math.pow(g / 255, 2.4);
  const bLin = Math.pow(b / 255, 2.4);
  return 0.2126729 * rLin + 0.7151522 * gLin + 0.072175 * bLin;
}

export function calculateApcaLightnessContrast(textColor: RGBColor, bgColor: RGBColor): number {
  let yTxt = sRgbToLinearY(textColor.r, textColor.g, textColor.b);
  let yBg = sRgbToLinearY(bgColor.r, bgColor.g, bgColor.b);

  const blackThresh = 0.022;
  const expBlack = 1.414;

  if (yTxt < blackThresh) {
    yTxt = yTxt + Math.pow(blackThresh - yTxt, expBlack);
  }
  if (yBg < blackThresh) {
    yBg = yBg + Math.pow(blackThresh - yBg, expBlack);
  }

  const scaleFactor = 1.14;
  let contrast = 0;

  if (yBg > yTxt) {
    const yBgExp = Math.pow(yBg, 0.56);
    const yTxtExp = Math.pow(yTxt, 0.57);
    contrast = (yBgExp - yTxtExp) * scaleFactor;
  } else {
    const yBgExp = Math.pow(yBg, 0.65);
    const yTxtExp = Math.pow(yTxt, 0.62);
    contrast = (yBgExp - yTxtExp) * scaleFactor;
  }

  if (Math.abs(contrast) < 0.1) {
    return 0;
  }
  const rawLc = contrast > 0 ? (contrast - 0.027) * 100 : (contrast + 0.027) * 100;
  return Number(Math.abs(rawLc).toFixed(1));
}

const APCA_PALETTE: Readonly<
  Record<string, { fg: RGBColor; bg: RGBColor; fgHex: string; bgHex: string; glyph: string }>
> = {
  critical: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 183, g: 28, b: 28 },
    fgHex: "#FFFFFF",
    bgHex: "#B71C1C",
    glyph: "●",
  },
  warning: {
    fg: { r: 0, g: 0, b: 0 },
    bg: { r: 255, g: 193, b: 7 },
    fgHex: "#000000",
    bgHex: "#FFC107",
    glyph: "▲",
  },
  open: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 211, g: 47, b: 47 },
    fgHex: "#FFFFFF",
    bgHex: "#D32F2F",
    glyph: "🟢",
  },
  admitted: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 25, g: 118, b: 210 },
    fgHex: "#FFFFFF",
    bgHex: "#1976D2",
    glyph: "✓",
  },
  resolved: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 46, g: 125, b: 50 },
    fgHex: "#FFFFFF",
    bgHex: "#2E7D32",
    glyph: "✓",
  },
  declined: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 97, g: 97, b: 97 },
    fgHex: "#FFFFFF",
    bgHex: "#616161",
    glyph: "✕",
  },
  ignored: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 117, g: 117, b: 117 },
    fgHex: "#FFFFFF",
    bgHex: "#757575",
    glyph: "○",
  },
};

export function getApcaBadgeInfo(statusOrSeverity: string): ApcaBadgeInfo {
  const normalized = statusOrSeverity.trim().toLowerCase();
  const warningPalette = APCA_PALETTE["warning"];
  const matchedPalette = APCA_PALETTE[normalized];
  const palette = matchedPalette !== undefined ? matchedPalette : warningPalette;
  if (palette === undefined) {
    throw new Error("unreachable: missing warning palette");
  }
  const lc = calculateApcaLightnessContrast(palette.fg, palette.bg);
  const requiredLc = 60.0;
  const passes = lc >= requiredLc;
  const badgeText = `[${palette.glyph} ${normalized.toUpperCase()} (Lc=${lc.toFixed(1)} | ${passes ? "PASS" : "FAIL"})]`;

  return {
    label: normalized,
    badge_text: badgeText,
    fg_color: palette.fgHex,
    bg_color: palette.bgHex,
    lc,
    required_lc: requiredLc,
    passes_apca: passes,
  };
}

export function renderApcaContrastBadge(statusOrSeverity: string): string {
  return getApcaBadgeInfo(statusOrSeverity).badge_text;
}

interface BlunderFileDiscovery {
  readonly capsuleName: string;
  readonly filePath: string;
}

export function discoverBlunderFiles(
  capsulesDir: string,
  explicitRunRoot?: string,
): readonly BlunderFileDiscovery[] {
  const results: BlunderFileDiscovery[] = [];
  const visitedPaths = new Set<string>();

  const rootBlunders = join(capsulesDir, "blunders.jsonl");
  if (existsSync(rootBlunders)) {
    visitedPaths.add(resolve(rootBlunders));
    results.push({ capsuleName: "capsules-root", filePath: rootBlunders });
  }

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const blunderPath = join(capsulesDir, entry.name, "blunders.jsonl");
          const absPath = resolve(blunderPath);
          if (existsSync(blunderPath) && !visitedPaths.has(absPath)) {
            visitedPaths.add(absPath);
            results.push({ capsuleName: entry.name, filePath: blunderPath });
          }
        }
      }
    } catch {
      // Best-effort directory scan
    }
  }

  if (explicitRunRoot !== undefined) {
    const explicitBlunders = join(resolve(explicitRunRoot), "blunders.jsonl");
    const absPath = resolve(explicitBlunders);
    if (existsSync(explicitBlunders) && !visitedPaths.has(absPath)) {
      visitedPaths.add(absPath);
      results.push({ capsuleName: basename(resolve(explicitRunRoot)), filePath: explicitBlunders });
    }
  }

  return results;
}

function parseBlundersFromFile(
  fileInfo: BlunderFileDiscovery,
  capsulesDir: string,
): readonly AuditedBlunder[] {
  if (!existsSync(fileInfo.filePath)) {
    return [];
  }

  const blunders: AuditedBlunder[] = [];
  let fileContent = "";
  try {
    fileContent = readFileSync(fileInfo.filePath, "utf-8");
  } catch {
    return [];
  }

  // Check state.json in corresponding capsule directory to discover candidate admissions
  const capsuleDir =
    fileInfo.capsuleName === "capsules-root"
      ? capsulesDir
      : join(capsulesDir, fileInfo.capsuleName);
  const statePath = join(capsuleDir, "state.json");
  const admittedBlunderWitnesses = new Map<
    string,
    { candidateId: string; status: BlunderStatus }
  >();

  if (existsSync(statePath)) {
    try {
      const stateContent = readFileSync(statePath, "utf-8");
      const stateObj = JSON.parse(stateContent) as Record<string, unknown>;
      const candidates = Array.isArray(stateObj.candidates) ? stateObj.candidates : [];
      for (const cand of candidates) {
        if (typeof cand === "object" && cand !== null) {
          const candRec = cand as Record<string, unknown>;
          const candId = typeof candRec.id === "string" ? candRec.id : "unknown";
          const witness = typeof candRec.witness === "string" ? candRec.witness : "";
          const witnessCmd =
            typeof candRec.witness_command_id === "string" ? candRec.witness_command_id : "";
          const candStatus = typeof candRec.status === "string" ? candRec.status : "";

          const isResolved =
            candStatus === "closed"
              ? true
              : candStatus === "resolved"
                ? true
                : candStatus === "satisfied";
          const isDeclined = candStatus === "declined" ? true : candStatus === "rejected";
          let inferredStatus: BlunderStatus = "admitted";
          if (isResolved) {
            inferredStatus = "resolved";
          } else if (isDeclined) {
            inferredStatus = "declined";
          }

          if (witness.length > 0) {
            admittedBlunderWitnesses.set(witness, { candidateId: candId, status: inferredStatus });
          }
          if (witnessCmd.length > 0) {
            admittedBlunderWitnesses.set(witnessCmd, {
              candidateId: candId,
              status: inferredStatus,
            });
          }
        }
      }
    } catch {
      // State inspection is best-effort
    }
  }

  const lines = fileContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof raw.id === "string" && typeof raw.type === "string") {
        const id = raw.id;
        const type = raw.type;
        const severity =
          raw.severity === "critical"
            ? "critical"
            : raw.severity === "warning"
              ? "warning"
              : "warning";
        const timestamp =
          typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString();
        const pid = typeof raw.pid === "number" ? raw.pid : 0;
        const ppid = typeof raw.ppid === "number" ? raw.ppid : 0;
        const agent_id = typeof raw.agent_id === "string" ? raw.agent_id : null;
        const observation =
          typeof raw.observation === "string" ? raw.observation : "Blunder recorded";
        const remediation =
          typeof raw.remediation === "string" ? raw.remediation : "Remediate blunder";
        const context =
          typeof raw.context === "object" && raw.context !== null
            ? (raw.context as Record<string, unknown>)
            : {};

        let status: BlunderStatus = "open";
        let candidateId: string | null = null;

        const knownStatuses: readonly string[] = [
          "open",
          "admitted",
          "resolved",
          "declined",
          "ignored",
        ];
        if (typeof raw.status === "string" && knownStatuses.includes(raw.status)) {
          status = raw.status as BlunderStatus;
        }

        const candidateMatch = admittedBlunderWitnesses.get(id);
        if (candidateMatch !== undefined) {
          status = candidateMatch.status;
          candidateId = candidateMatch.candidateId;
        }

        blunders.push({
          id,
          type,
          severity,
          timestamp,
          pid,
          ppid,
          agent_id,
          observation,
          remediation,
          context,
          status,
          source_capsule: fileInfo.capsuleName,
          source_file: fileInfo.filePath,
          candidate_id: candidateId,
        });
      }
    } catch {
      // Skip non-parseable JSON lines
    }
  }

  return blunders;
}

function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return `${str}${" ".repeat(width - str.length)}`;
}

export function renderAsciiBlunderTable(blunders: readonly AuditedBlunder[]): string {
  if (blunders.length === 0) {
    return [
      "┌────────────────────────────────────────────────────────────────────────┐",
      "│ No recorded blunders discovered matching filter criteria               │",
      "└────────────────────────────────────────────────────────────────────────┘",
    ].join("\n");
  }

  const colIdWidth = 24;
  const colCatWidth = 28;
  const colSevWidth = 10;
  const colStatWidth = 10;
  const colApcaWidth = 26;

  const topBorder = `┌${"─".repeat(colIdWidth + 2)}┬${"─".repeat(colCatWidth + 2)}┬${"─".repeat(colSevWidth + 2)}┬${"─".repeat(colStatWidth + 2)}┬${"─".repeat(colApcaWidth + 2)}┐`;
  const header = `│ ${padRight("Blunder ID", colIdWidth)} │ ${padRight("Category / Type", colCatWidth)} │ ${padRight("Severity", colSevWidth)} │ ${padRight("Status", colStatWidth)} │ ${padRight("APCA Contrast Indicator", colApcaWidth)} │`;
  const separator = `├${"─".repeat(colIdWidth + 2)}┼${"─".repeat(colCatWidth + 2)}┼${"─".repeat(colSevWidth + 2)}┼${"─".repeat(colStatWidth + 2)}┼${"─".repeat(colApcaWidth + 2)}┤`;
  const bottomBorder = `└${"─".repeat(colIdWidth + 2)}┴${"─".repeat(colCatWidth + 2)}┴${"─".repeat(colSevWidth + 2)}┴${"─".repeat(colStatWidth + 2)}┴${"─".repeat(colApcaWidth + 2)}┘`;

  const rows = blunders.map((b) => {
    const idCell = padRight(truncateString(b.id, colIdWidth), colIdWidth);
    const catCell = padRight(truncateString(b.type, colCatWidth), colCatWidth);
    const sevCell = padRight(truncateString(b.severity.toUpperCase(), colSevWidth), colSevWidth);
    const statCell = padRight(truncateString(b.status.toUpperCase(), colStatWidth), colStatWidth);
    const apcaCell = padRight(
      truncateString(renderApcaContrastBadge(b.status), colApcaWidth),
      colApcaWidth,
    );
    return `│ ${idCell} │ ${catCell} │ ${sevCell} │ ${statCell} │ ${apcaCell} │`;
  });

  return [topBorder, header, separator, ...rows, bottomBorder].join("\n");
}

export function formatBlunderAuditReport(params: {
  readonly capsulesDir: string;
  readonly runRoot: string | null;
  readonly blunders: readonly AuditedBlunder[];
  readonly summary: BlunderAuditSummary;
  readonly autoAdmittedCount: number;
  readonly autoAdmittedCandidates: readonly string[];
  readonly isAll?: boolean | undefined;
}): string {
  const lines: string[] = [
    "### Blunder Audit & Observability Report",
    `- **Capsules Directory**: \`${params.capsulesDir}\``,
    params.runRoot !== null
      ? `- **Active Run Root**: \`${params.runRoot}\``
      : "- **Active Run Root**: *none*",
    `- **Total Blunders Discovered**: ${params.summary.total_blunders}`,
    `- **Status Breakdown**: Open: ${params.summary.open_count} | Admitted: ${params.summary.admitted_count} | Resolved: ${params.summary.resolved_count} | Declined: ${params.summary.declined_count}`,
    `- **Severity**: Critical: ${params.summary.critical_count} | Warning: ${params.summary.warning_count}`,
    `- **APCA Perceived Contrast Compliance**: ${params.summary.apca_contrast_compliance.passes_apca ? "PASS (100% badges compliant)" : "FAIL"} (Min Lc=${params.summary.apca_contrast_compliance.min_lc_observed.toFixed(1)})`,
  ];

  if (params.autoAdmittedCount > 0) {
    lines.push(
      `- **Auto-Admitted Candidates**: ${params.autoAdmittedCount} candidate(s) created (\`${params.autoAdmittedCandidates.join("`, `")}\`)`,
    );
  }

  lines.push("");
  lines.push("#### Discovered Blunder Registry");
  lines.push(renderAsciiBlunderTable(params.blunders));

  lines.push("");
  lines.push("#### APCA Perceptual Contrast Matrix");
  lines.push(
    "| State / Severity | Badge Text | Foreground | Background | Perceived Lc | APCA Status |",
  );
  lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");
  for (const badge of params.summary.apca_contrast_compliance.badge_details) {
    lines.push(
      `| \`${badge.label}\` | \`${badge.badge_text}\` | \`${badge.fg_color}\` | \`${badge.bg_color}\` | ${badge.lc.toFixed(1)} | ${badge.passes_apca ? "✓ PASS" : "✗ FAIL"} |`,
    );
  }

  if (params.blunders.length > 0) {
    lines.push("");
    lines.push("#### Forensic Details");
    for (const b of params.blunders) {
      lines.push(`- **\`${b.id}\`** (\`${b.type}\` | ${b.severity})`);
      lines.push(`  - **Capsule**: \`${b.source_capsule}\``);
      lines.push(`  - **Status**: \`${b.status}\` ${renderApcaContrastBadge(b.status)}`);
      lines.push(`  - **PID / PPID**: ${b.pid} / ${b.ppid}`);
      lines.push(`  - **Observation**: ${b.observation}`);
      lines.push(`  - **Remediation**: ${b.remediation}`);
      if (b.candidate_id !== undefined && b.candidate_id !== null) {
        lines.push(`  - **Admitted Candidate ID**: \`${b.candidate_id}\``);
      }
    }
  }

  const maxLines = params.isAll === true ? 500 : 35;
  return enforceLineLimit(lines.join("\n"), maxLines);
}

export function blunderAuditCommand(
  flags: Flags,
  _context?: CommandContext,
): BlunderAuditCommandResult {
  assertFlags(flags, [
    "run",
    "capsules-dir",
    "filter-status",
    "filter-category",
    "filter-type",
    "auto-admit",
    "actor",
    "all",
    "now",
    "json",
  ]);

  const run = textFlag(flags, "run", false);
  const capsulesDirFlag = textFlag(flags, "capsules-dir", false);
  const filterStatusRaw = textFlag(flags, "filter-status", false);
  const filterCategoryRaw =
    textFlag(flags, "filter-category", false) !== undefined
      ? textFlag(flags, "filter-category", false)
      : textFlag(flags, "filter-type", false);
  const autoAdmit = boolFlag(flags, "auto-admit");
  const actorFlag = textFlag(flags, "actor", false);
  const isAll = boolFlag(flags, "all");
  const now = textFlag(flags, "now", false);

  const nowMs = now !== undefined ? Date.parse(now) : Date.now();
  if (now !== undefined && !Number.isFinite(nowMs)) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${now}`);
  }
  const nowIso = new Date(nowMs).toISOString();

  // 1. Resolve capsules directory
  let resolvedCapsulesDir: string;
  if (capsulesDirFlag !== undefined) {
    resolvedCapsulesDir = resolve(capsulesDirFlag);
    if (!existsSync(resolvedCapsulesDir)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `capsules directory not found: ${capsulesDirFlag}`,
      );
    }
  } else if (run !== undefined) {
    const resolvedRun = resolve(run);
    const parentDir = dirname(resolvedRun);
    if (basename(parentDir) === ".capsules") {
      resolvedCapsulesDir = parentDir;
    } else if (existsSync(join(resolvedRun, ".capsules"))) {
      resolvedCapsulesDir = join(resolvedRun, ".capsules");
    } else {
      resolvedCapsulesDir = parentDir;
    }
  } else {
    const defaultLocalCapsules = resolve(process.cwd(), ".capsules");
    resolvedCapsulesDir = defaultLocalCapsules;
  }

  // 2. Discover all blunder files
  const discoveredFiles = discoverBlunderFiles(resolvedCapsulesDir, run);

  // 3. Parse all blunders across discovered files with deduplication
  const blunderMap = new Map<string, AuditedBlunder>();
  for (const fileInfo of discoveredFiles) {
    const parsedList = parseBlundersFromFile(fileInfo, resolvedCapsulesDir);
    for (const b of parsedList) {
      if (!blunderMap.has(b.id)) {
        blunderMap.set(b.id, b);
      } else {
        const existing = blunderMap.get(b.id)!;
        if (existing.status === "open" && b.status !== "open") {
          blunderMap.set(b.id, b);
        }
      }
    }
  }

  let allBlunders = Array.from(blunderMap.values());

  // 4. Validate and apply filters
  if (filterStatusRaw !== undefined) {
    const normalizedStatus = filterStatusRaw.trim().toLowerCase();
    const validStatuses = ["open", "admitted", "resolved", "declined", "ignored", "all"];
    if (!validStatuses.includes(normalizedStatus)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `invalid --filter-status: ${filterStatusRaw}; must be one of: ${validStatuses.join(", ")}`,
      );
    }
    if (normalizedStatus !== "all") {
      allBlunders = allBlunders.filter((b) => b.status === normalizedStatus);
    }
  }

  if (filterCategoryRaw !== undefined) {
    const normalizedCategory = filterCategoryRaw.trim().toLowerCase();
    if (normalizedCategory !== "all") {
      allBlunders = allBlunders.filter((b) => {
        const typeMatch = b.type.toLowerCase().includes(normalizedCategory);
        const catMatch =
          typeof (b.context as Record<string, unknown>)?.category === "string"
            ? String((b.context as Record<string, unknown>).category)
                .toLowerCase()
                .includes(normalizedCategory)
            : false;
        return typeMatch ? true : catMatch;
      });
    }
  }

  // 5. Handle --auto-admit
  let autoAdmittedCount = 0;
  const autoAdmittedCandidates: string[] = [];

  if (autoAdmit) {
    if (run === undefined) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "--run is required when using --auto-admit to record candidate proposals",
      );
    }

    const loaded = loadRun(run, false);
    const actor = actorFlag !== undefined ? actorFlag : "mind-auditor";

    const openBlunders = allBlunders.filter((b) => b.status === "open");

    for (const blunder of openBlunders) {
      const candId = `cand-blunder-${blunder.id}`;
      const statement = `Auto-remediate blunder [${blunder.type}]: ${blunder.observation}`;
      const rationale = `Auto-admitted by blunder-audit CLI for ${blunder.id}. Remediation: ${blunder.remediation}`;

      const candidateObj: JsonObject = {
        id: candId,
        kind: "defect",
        statement,
        witness: blunder.id,
        witness_command_id: blunder.id,
        charter_goal_ids: ["G1", "G2"],
        falsifier_argv: null,
        falsifier_exit: null,
        write_scope: ["orchestrating-long-tasks/scripts/src/authority/thread-identifier.ts"],
        rationale,
        status: "admitted",
        created_at: nowIso,
        decided_at: nowIso,
        decided_by: actor,
        decline_reason: null,
        disposition: "actionable",
        gate_failed: null,
        objective_run_id: null,
      };

      try {
        transact(
          run,
          actor,
          "mind-candidate-admitted",
          {
            candidate_id: candId,
            statement,
            blunder_id: blunder.id,
            admitted_at: nowIso,
          },
          (working) => {
            const existingCandidates = Array.isArray(working.candidates)
              ? (working.candidates as JsonValue[])
              : [];
            const alreadyExists = existingCandidates.some(
              (c) =>
                typeof c === "object" &&
                c !== null &&
                ((c as Record<string, unknown>).id === candId
                  ? true
                  : (c as Record<string, unknown>).witness === blunder.id),
            );
            if (!alreadyExists) {
              working.candidates = [...existingCandidates, candidateObj];
            }
          },
        );

        autoAdmittedCount = autoAdmittedCount + 1;
        autoAdmittedCandidates.push(candId);

        // Update in-memory blunder
        const updatedBlunder: AuditedBlunder = {
          ...blunder,
          status: "admitted",
          candidate_id: candId,
        };
        const index = allBlunders.findIndex((b) => b.id === blunder.id);
        if (index !== -1) {
          allBlunders[index] = updatedBlunder;
        }
      } catch {
        // Transaction best-effort per blunder
      }
    }
  }

  // 6. Compute summary metrics and APCA compliance
  let openCount = 0;
  let admittedCount = 0;
  let resolvedCount = 0;
  let declinedCount = 0;
  let criticalCount = 0;
  let warningCount = 0;
  const byCategory: Record<string, number> = {};
  const byCapsule: Record<string, number> = {};

  for (const b of allBlunders) {
    if (b.status === "open") openCount = openCount + 1;
    else if (b.status === "admitted") admittedCount = admittedCount + 1;
    else if (b.status === "resolved") resolvedCount = resolvedCount + 1;
    else if (b.status === "declined" ? true : b.status === "ignored")
      declinedCount = declinedCount + 1;

    if (b.severity === "critical") criticalCount = criticalCount + 1;
    else warningCount = warningCount + 1;

    const cat = b.type;
    byCategory[cat] = (byCategory[cat] !== undefined ? byCategory[cat] : 0) + 1;

    const cap = b.source_capsule;
    byCapsule[cap] = (byCapsule[cap] !== undefined ? byCapsule[cap] : 0) + 1;
  }

  const badgeKeys = ["critical", "warning", "open", "admitted", "resolved", "declined"];
  const badgeDetails: ApcaBadgeInfo[] = badgeKeys.map((k) => getApcaBadgeInfo(k));
  const minLcObserved = badgeDetails.reduce(
    (min, b) => (b.lc < min ? b.lc : min),
    badgeDetails.length > 0 && badgeDetails[0] !== undefined ? badgeDetails[0].lc : 100,
  );
  const compliantBadges = badgeDetails.filter((b) => b.passes_apca).length;

  const apcaCompliance: ApcaContrastCompliance = {
    compliant_badges: compliantBadges,
    total_badges: badgeDetails.length,
    min_lc_observed: minLcObserved,
    passes_apca: compliantBadges === badgeDetails.length,
    badge_details: badgeDetails,
  };

  const summary: BlunderAuditSummary = {
    total_blunders: allBlunders.length,
    open_count: openCount,
    admitted_count: admittedCount,
    resolved_count: resolvedCount,
    declined_count: declinedCount,
    critical_count: criticalCount,
    warning_count: warningCount,
    by_category: byCategory,
    by_capsule: byCapsule,
    apca_contrast_compliance: apcaCompliance,
  };

  const markdown = formatBlunderAuditReport({
    capsulesDir: resolvedCapsulesDir,
    runRoot: run !== undefined ? resolve(run) : null,
    blunders: allBlunders,
    summary,
    autoAdmittedCount,
    autoAdmittedCandidates,
    isAll,
  });

  return {
    markdown,
    capsules_dir: resolvedCapsulesDir,
    run_root: run !== undefined ? resolve(run) : null,
    total_blunders: allBlunders.length,
    filtered_blunders: allBlunders,
    summary,
    auto_admitted_count: autoAdmittedCount,
    auto_admitted_candidates: autoAdmittedCandidates,
  };
}
