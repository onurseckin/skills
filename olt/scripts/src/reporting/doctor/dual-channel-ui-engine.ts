import {
  computeDoctorEnginePassed,
  type DoctorCheckEngineResult,
  type DoctorDiagnosticFinding,
} from "./types.ts";

import type { ElementThemePair } from "../theme/index.ts";

export interface DualChannelUiCheckOptions {
  readonly themeElements?: readonly ElementThemePair[] | undefined;
  readonly checkTerminalChannels?: boolean | undefined;
  readonly asciiChannelSample?: string | undefined;
  readonly ansiChannelSample?: string | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly tasks?: Readonly<Record<string, unknown>> | readonly unknown[] | null | undefined;
  readonly runRoot?: string | undefined;
  readonly reports?: readonly unknown[] | undefined;
  readonly artifacts?: readonly string[] | undefined;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function parseColor(color: string): Rgb | null {
  if (typeof color !== "string") return null;
  const str = color.trim().toLowerCase();
  if (str === "") return null;
  if (str === "white") return { r: 255, g: 255, b: 255 };
  if (str === "black") return { r: 0, g: 0, b: 0 };
  if (str.startsWith("#")) {
    const h = str.slice(1);
    const [r, g, b] =
      h.length === 3
        ? [h[0]! + h[0]!, h[1]! + h[1]!, h[2]! + h[2]!]
        : h.length === 6
          ? [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)]
          : [];
    if (r && g && b) return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
  }
  const m = str.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u);
  return m ? { r: parseInt(m[1]!, 10), g: parseInt(m[2]!, 10), b: parseInt(m[3]!, 10) } : null;
}

function sRgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * sRgbToLinear(rgb.r) + 0.7152 * sRgbToLinear(rgb.g) + 0.0722 * sRgbToLinear(rgb.b);
}

function calculateWcagContrast(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function checkDualChannelUi(
  options: DualChannelUiCheckOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];

  if (options.themeElements && options.themeElements.length > 0) {
    for (const pair of options.themeElements) {
      const fgRgb = parseColor(pair.foregroundColor);
      const bgRgb = parseColor(pair.backgroundColor);

      if (!fgRgb || !bgRgb) {
        findings.push({
          code: "DUAL_CHANNEL_CONTRAST_SYNTAX",
          severity: "ERROR",
          engine: "checkDualChannelUi",
          message: `Invalid color expression in selector "${pair.selector}" (${pair.theme} mode): foreground="${pair.foregroundColor}", background="${pair.backgroundColor}"`,
          details: { selector: pair.selector, theme: pair.theme },
        });
        continue;
      }

      const ratio = calculateWcagContrast(fgRgb, bgRgb);
      const isLarge = pair.isLargeText ?? false;
      const required = isLarge ? 3.0 : 4.5;

      if (ratio < required) {
        findings.push({
          code: "DUAL_CHANNEL_CONTRAST_DEFECT",
          severity: ratio < 3.0 ? "ERROR" : "WARN",
          engine: "checkDualChannelUi",
          message: `Theme contrast defect on "${pair.selector}" in ${pair.theme} mode: required ${required.toFixed(1)}:1, found ${ratio.toFixed(2)}:1`,
          details: {
            selector: pair.selector,
            theme: pair.theme,
            contrastRatio: ratio,
            requiredThreshold: required,
          },
        });
      }
    }
  }

  if (options.checkTerminalChannels ?? true) {
    if (options.asciiChannelSample !== undefined && options.asciiChannelSample.length === 0) {
      findings.push({
        code: "TERMINAL_ASCII_CHANNEL_MISSING",
        severity: "ERROR",
        engine: "checkDualChannelUi",
        message: "Terminal ASCII channel output is empty; plain non-ANSI fallback required",
      });
    }
    if (options.ansiChannelSample !== undefined && options.ansiChannelSample.length === 0) {
      findings.push({
        code: "TERMINAL_ANSI_CHANNEL_MISSING",
        severity: "ERROR",
        engine: "checkDualChannelUi",
        message: "Terminal ANSI channel output is empty; styled output stream required",
      });
    }
  }

  const taskMap = extractTasks(options);
  for (const [taskId, task] of Object.entries(taskMap)) {
    const status = typeof task.status === "string" ? task.status.toLowerCase() : "";
    if (status === "cancelled" || status === "abandoned") {
      continue;
    }

    if (!isUiTask(task)) {
      continue;
    }

    const headlessPassed = checkHeadlessPassed(task);
    const opticalPassed = checkOpticalArtifact(taskId, task, options);

    const details = { taskId, status: task.status ?? "open" };
    if (headlessPassed && !opticalPassed) {
      findings.push({
        code: "UI_MISSING_OPTICAL_VALIDATOR",
        severity: "ERROR",
        engine: "checkDualChannelUi",
        message: `UI task "${taskId}" passed headless tests but lacks an optical visual review report artifact (.md or visual report artifact)`,
        details: { ...details, channel1: "passed", channel2: "missing" },
      });
    } else if (!headlessPassed && !opticalPassed) {
      findings.push({
        code: "UI_MISSING_DUAL_CHANNEL_VALIDATION",
        severity: "ERROR",
        engine: "checkDualChannelUi",
        message: `UI task "${taskId}" lacks dual-channel validation: both Channel 1 (headless tests) and Channel 2 (optical visual review) are missing`,
        details: { ...details, channel1: "missing", channel2: "missing" },
      });
    } else if (!headlessPassed && opticalPassed) {
      findings.push({
        code: "UI_MISSING_HEADLESS_VALIDATOR",
        severity: "ERROR",
        engine: "checkDualChannelUi",
        message: `UI task "${taskId}" has optical visual review but lacks Channel 1 headless test validation`,
        details: { ...details, channel1: "missing", channel2: "passed" },
      });
    }
  }

  return {
    engine: "checkDualChannelUi",
    passed: computeDoctorEnginePassed(findings),
    findings,
  };
}

const UI_EXTENSIONS: ReadonlySet<string> = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".jsx",
  ".tsx",
  ".vue",
  ".svelte",
]);

const UI_PATH_MARKERS: readonly string[] = [
  "/ui/",
  "/components/",
  "/views/",
  "/frontend/",
  "/styles/",
  "/theme/",
  "/layouts/",
  "/pages/",
];

const UI_KEYWORDS =
  /\b(ui|ux|frontend|responsive|viewport|visual|layout|styling|theme|button|modal|component)\b/i;

function extractTasks(options: DualChannelUiCheckOptions): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  const raw =
    options.tasks ??
    (options.state?.tasks as Record<string, unknown> | readonly unknown[] | undefined);
  if (!raw) return result;
  if (Array.isArray(raw)) {
    raw.forEach((item, i) => {
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        result[typeof obj.id === "string" ? obj.id : `task-${i}`] = obj;
      }
    });
  } else if (typeof raw === "object") {
    for (const [key, val] of Object.entries(raw)) {
      if (val && typeof val === "object") {
        const obj = val as Record<string, unknown>;
        result[typeof obj.id === "string" ? obj.id : key] = obj;
      }
    }
  }
  return result;
}

function isUiTask(task: Record<string, unknown>): boolean {
  if (task.isUiTask === true || task.is_ui_task === true) return true;
  const domain = typeof task.domain === "string" ? task.domain.toLowerCase() : "";
  if (domain === "ui_design" || domain === "ui-design" || domain === "ui") return true;
  const domains = Array.isArray(task.domains) ? task.domains : [];
  if (
    domains.some(
      (d) => typeof d === "string" && (d === "ui_design" || d === "ui-design" || d === "ui"),
    )
  ) {
    return true;
  }
  const writeScope = Array.isArray(task.write_scope) ? task.write_scope : [];
  for (const s of writeScope) {
    if (typeof s !== "string") continue;
    const lower = s.toLowerCase();
    for (const ext of UI_EXTENSIONS) if (lower.endsWith(ext)) return true;
    for (const marker of UI_PATH_MARKERS) if (lower.includes(marker)) return true;
  }
  const text = `${typeof task.label === "string" ? task.label : ""} ${typeof task.title === "string" ? task.title : ""} ${typeof task.description === "string" ? task.description : ""}`;
  return UI_KEYWORDS.test(text);
}

function checkHeadlessPassed(task: Record<string, unknown>): boolean {
  if (
    task.headless_passed === true ||
    task.headlessPassed === true ||
    task.channel1_passed === true ||
    task.channel1Passed === true ||
    task.playwright_passed === true
  ) {
    return true;
  }
  const report = task.report as Record<string, unknown> | undefined;
  if (report && typeof report === "object") {
    if (report.headless_passed === true || report.headlessPassed === true) return true;
    if ((report.mechanicReport as Record<string, unknown> | undefined)?.passed === true)
      return true;
    const dualUi = report.dual_ui_audit as Record<string, unknown> | undefined;
    if ((dualUi?.mechanicReport as Record<string, unknown> | undefined)?.passed === true)
      return true;
    if ((report.dual_channel_audit as Record<string, unknown> | undefined)?.passed === true)
      return true;
  }
  const validations = Array.isArray(task.validations) ? task.validations : [];
  for (const v of validations) {
    if (v && typeof v === "object") {
      const vObj = v as Record<string, unknown>;
      const vId = typeof vObj.validator_id === "string" ? vObj.validator_id : "";
      if (vId.includes("headless") && vObj.verdict === "pass") return true;
    }
  }
  if (Array.isArray(task.screenshots) && task.screenshots.length > 0) return true;
  const gateResults = Array.isArray(task.gate_results) ? task.gate_results : [];
  return gateResults.some(
    (g) =>
      g &&
      typeof g === "object" &&
      ((g as Record<string, unknown>).passed === true ||
        (g as Record<string, unknown>).status === "succeeded" ||
        (g as Record<string, unknown>).exit_code === 0),
  );
}

function isScratchOrExcludedPath(pathStr: string): boolean {
  const norm = pathStr.replace(/\\/g, "/").toLowerCase();
  return (
    norm.includes("/scratch/") ||
    norm.startsWith("scratch/") ||
    norm.includes("/tmp/") ||
    norm.startsWith("tmp/") ||
    norm.includes("/.tmp/") ||
    norm.startsWith(".tmp/") ||
    norm.includes("/node_modules/")
  );
}

function checkOpticalArtifact(
  taskId: string,
  task: Record<string, unknown>,
  options: DualChannelUiCheckOptions,
): boolean {
  if (
    task.optical_passed === true ||
    task.opticalPassed === true ||
    task.channel2_passed === true ||
    task.channel2Passed === true
  ) {
    return true;
  }
  for (const field of [task.optical_report, task.optical_report_path, task.opticalReport]) {
    if (typeof field === "string" && field.trim().length > 0 && !isScratchOrExcludedPath(field))
      return true;
    if (field && typeof field === "object") return true;
  }
  const report = task.report as Record<string, unknown> | undefined;
  if (report && typeof report === "object") {
    if (report.optical_passed === true || report.opticalPassed === true) return true;
    if (
      typeof report.optical_report === "string" &&
      !isScratchOrExcludedPath(report.optical_report)
    )
      return true;
    if (
      typeof report.optical_report_path === "string" &&
      !isScratchOrExcludedPath(report.optical_report_path)
    )
      return true;
    if ((report.cognitiveReport as Record<string, unknown> | undefined)?.passed === true)
      return true;
    const dualUi = report.dual_ui_audit as Record<string, unknown> | undefined;
    if ((dualUi?.cognitiveReport as Record<string, unknown> | undefined)?.passed === true)
      return true;
  }
  const validations = Array.isArray(task.validations) ? task.validations : [];
  for (const v of validations) {
    if (v && typeof v === "object") {
      const vObj = v as Record<string, unknown>;
      const vId = typeof vObj.validator_id === "string" ? vObj.validator_id : "";
      if (
        (vId.includes("optical") ||
          vId === "validator_ui_design" ||
          vId === "ui_optical_validator") &&
        vObj.verdict === "pass"
      ) {
        return true;
      }
    }
  }
  const allArtifacts: string[] = [];
  if (Array.isArray(options.artifacts)) {
    for (const a of options.artifacts) if (typeof a === "string") allArtifacts.push(a);
  }
  if (Array.isArray(task.artifacts)) {
    for (const a of task.artifacts) {
      if (typeof a === "string") allArtifacts.push(a);
      else if (
        a &&
        typeof a === "object" &&
        typeof (a as Record<string, unknown>).path === "string"
      ) {
        allArtifacts.push((a as Record<string, unknown>).path as string);
      }
    }
  }
  const tid = taskId.toLowerCase();
  return allArtifacts.some((art) => {
    if (isScratchOrExcludedPath(art)) return false;
    const lower = art.toLowerCase();
    return (
      lower.endsWith(".md") &&
      (lower.includes(tid) ||
        lower.includes("optical") ||
        lower.includes("visual") ||
        lower.includes("ui-review") ||
        lower.includes("ui_review"))
    );
  });
}
