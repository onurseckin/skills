import {
  normalizeViewportName,
  validateCrossChannelConsistency,
} from "./cross-channel-consistency.ts";
import { extractDomViolations, type FindingAdder } from "./dom-violation-extractor.ts";
import type {
  ClippingViolation,
  ContrastViolation,
  CrossChannelProof,
  DualChannelAuditResult,
  DualChannelInput,
  OrphanViolation,
  OverflowViolation,
  ScreenshotMetadata,
  StackingViolation,
  StructuredFinding,
  ViewportMetrics,
  VisualMetricsReport,
} from "./dual-channel-types.ts";

export type {
  ClippingViolation,
  ContrastViolation,
  CrossChannelProof,
  DualChannelAuditResult,
  DualChannelInput,
  OrphanViolation,
  OverflowViolation,
  ScreenshotMetadata,
  StackingViolation,
  StructuredFinding,
  ViewportMetrics,
  VisualMetricsReport,
};

export { validateCrossChannelConsistency };

const UI_EXTENSIONS = new Set([
  ".tsx",
  ".jsx",
  ".vue",
  ".svelte",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".svg",
]);

const UI_DIR_PATTERNS = [
  /(?:^|[\\/])(components|views|pages|styles|ui|frontend|client|renderer|canvas|layout)(?:[\\/]|$)/i,
];

export function isUiScope(paths: readonly string[]): boolean {
  if (!paths || paths.length === 0) return false;
  for (const p of paths) {
    const lower = p.toLowerCase();
    const dotIdx = lower.lastIndexOf(".");
    if (dotIdx !== -1) {
      const ext = lower.slice(dotIdx);
      if (UI_EXTENSIONS.has(ext)) return true;
    }
    for (const pattern of UI_DIR_PATTERNS) {
      if (pattern.test(lower)) return true;
    }
  }
  return false;
}

const DEFAULT_REQUIRED_VIEWPORTS = ["mobile", "tablet", "desktop"] as const;

function domInvariantsInspected(vp: ViewportMetrics, report: VisualMetricsReport): string[] {
  const inspected: string[] = [];
  if (vp.overflowViolations) inspected.push("no_overflow");
  if (vp.clippingViolations) inspected.push("no_clipping");
  if (vp.stackingViolations) inspected.push("stacking_order");
  if (vp.contrastViolations) inspected.push("wcag_contrast");
  if (vp.orphanViolations) inspected.push("no_origin_orphans");
  if (vp.renderCacheReset !== undefined || report.renderCacheReset !== undefined) {
    inspected.push("render_cache_clean");
  }
  return inspected;
}

const SCREENSHOT_INVARIANT = "screenshot_non_empty";

export function analyzeDualChannel(input: DualChannelInput): DualChannelAuditResult {
  const allPaths = [...(input.taskFiles ?? []), ...(input.writeScope ?? [])];
  const isUi = isUiScope(allPaths);

  if (!isUi) {
    return {
      isUiTask: false,
      passed: true,
      mode: "non_ui_skipped",
      findings: [],
      proofs: [],
      summary: "Task does not touch UI or frontend scopes. Visual validation bypassed.",
    };
  }

  const findings: StructuredFinding[] = [];
  const proofs: CrossChannelProof[] = [];
  let findingCounter = 1;

  const addFinding: FindingAdder = (
    category,
    severity,
    message,
    remediation,
    affectedSelector,
    viewport,
  ) => {
    findings.push({
      id: `VF-${String(findingCounter++).padStart(3, "0")}`,
      severity,
      category,
      message,
      remediation,
      ...(affectedSelector ? { affectedSelector } : {}),
      ...(viewport ? { viewport } : {}),
    });
  };

  const hasDomReport = Boolean(
    input.domReport && input.domReport.viewports && input.domReport.viewports.length > 0,
  );
  const screenshots = input.screenshots ?? [];
  const hasScreenshots = screenshots.length > 0;

  if (!hasDomReport && !hasScreenshots) {
    addFinding(
      "missing_channel",
      "error",
      "Automated UI Task Mandate Violation: Task modifies UI scope but provided neither DOM metrics (visual-report.json) nor visual screenshots (.png).",
      "Execute visual validation tests via Playwright or headless visual metrics extraction to produce visual-report.json and screenshots.",
    );
    return {
      isUiTask: true,
      passed: false,
      mode: "rejected",
      findings,
      proofs: [],
      summary:
        "Rejected: Automated UI Task Mandate requires dual-channel visual validation, but both channels are missing.",
    };
  }

  for (const sc of screenshots) {
    if (!sc.sizeBytes || sc.sizeBytes <= 0 || isNaN(sc.sizeBytes)) {
      addFinding(
        "zero_byte_screenshot",
        "error",
        `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) is empty (0 bytes) or stubbed.`,
        "Ensure real browser rendering pipeline outputs valid non-empty PNG rasterizations.",
        undefined,
        sc.viewport,
      );
    }
  }

  const requiredVps = input.requiredViewports ?? DEFAULT_REQUIRED_VIEWPORTS;
  const coveredVps = new Set<string>();

  if (input.domReport) {
    for (const vp of input.domReport.viewports) {
      coveredVps.add(normalizeViewportName(vp.viewport, vp.width));
    }
    extractDomViolations(input.domReport, addFinding, input.subpixelTolerance);
  }
  for (const sc of screenshots) {
    if (sc.sizeBytes > 0 && !isNaN(sc.sizeBytes)) {
      coveredVps.add(normalizeViewportName(sc.viewport ?? sc.name, sc.width));
    }
  }

  for (const reqVp of requiredVps) {
    const normReq = normalizeViewportName(reqVp);
    if (!coveredVps.has(normReq)) {
      addFinding(
        "missing_viewport",
        "error",
        `Missing Viewport Matrix Violation: Required viewport '${reqVp}' is missing across both DOM metrics and screenshots.`,
        "Execute visual test coverage across the full multi-viewport matrix: mobile (375x667), tablet (768x1024), desktop (1280x800).",
        undefined,
        reqVp,
      );
    }
  }

  let mode: DualChannelAuditResult["mode"];
  const validScreenshots = screenshots.filter((s) => s.sizeBytes > 0 && !isNaN(s.sizeBytes));

  if (hasDomReport && validScreenshots.length > 0) {
    mode = "dual_channel_corroborated";
    const consistency = validateCrossChannelConsistency(input.domReport!, validScreenshots);
    if (!consistency.consistent) {
      for (const disc of consistency.discrepancies) {
        addFinding(
          "cross_channel_mismatch",
          "warning",
          `Cross-Channel Discrepancy: ${disc}`,
          "Harmonize viewport configurations and capture settings between DOM metrics and Playwright screenshots.",
        );
      }
    }

    for (const vp of input.domReport!.viewports) {
      const norm = normalizeViewportName(vp.viewport, vp.width);
      const sc = validScreenshots.find(
        (s) => normalizeViewportName(s.viewport ?? s.name, s.width) === norm,
      );
      const hasViolations = findings.some(
        (f) => f.viewport === vp.viewport && f.severity === "error",
      );
      const inspected = domInvariantsInspected(vp, input.domReport!);
      proofs.push({
        viewport: vp.viewport,
        ...(sc === undefined ? {} : { screenshotPath: sc.path, screenshotSizeBytes: sc.sizeBytes }),
        domMetricsPresent: true,
        verifiedInvariants: sc === undefined ? inspected : [...inspected, SCREENSHOT_INVARIANT],
        status: hasViolations
          ? "violation_detected"
          : sc === undefined
            ? "dom_only_gap_filled"
            : "corroborated",
      });
    }
  } else if (hasDomReport) {
    mode = "dom_gap_filled";
    for (const vp of input.domReport!.viewports) {
      const hasViolations = findings.some(
        (f) => f.viewport === vp.viewport && f.severity === "error",
      );
      proofs.push({
        viewport: vp.viewport,
        domMetricsPresent: true,
        verifiedInvariants: domInvariantsInspected(vp, input.domReport!),
        status: hasViolations ? "violation_detected" : "dom_only_gap_filled",
      });
    }
  } else {
    mode = "screenshot_gap_filled";
    for (const sc of validScreenshots) {
      const vpName = sc.viewport ?? normalizeViewportName(sc.name, sc.width);
      const hasViolations = findings.some((f) => f.viewport === vpName && f.severity === "error");
      proofs.push({
        viewport: vpName,
        screenshotPath: sc.path,
        domMetricsPresent: false,
        screenshotSizeBytes: sc.sizeBytes,
        verifiedInvariants: [SCREENSHOT_INVARIANT],
        status: hasViolations ? "violation_detected" : "screenshot_only_gap_filled",
      });
    }
  }

  const hasErrors = findings.some((f) => f.severity === "error");
  const passed = !hasErrors;
  if (!passed) {
    mode = "rejected";
  }

  const summary = passed
    ? `Dual-channel visual validation passed in mode '${mode}'. ${proofs.length} viewport proofs generated.`
    : `Dual-channel visual validation failed with ${findings.length} findings (${findings.filter((f) => f.severity === "error").length} errors).`;

  return {
    isUiTask: true,
    passed,
    mode,
    findings,
    proofs,
    summary,
  };
}
