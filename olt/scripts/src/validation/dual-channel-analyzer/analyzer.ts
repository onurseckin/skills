import { normalizeViewportName } from "../channels/cross-channel-consistency.ts";
import { extractDomViolations, type FindingAdder } from "../channels/dom-violation-extractor.ts";
import { isUiScope } from "./file-classifier.ts";
import { validateCompanionManifestCriteria } from "./manifest-auditor.ts";
import {
  measuredWidthOf,
  validateCrossChannelConsistency,
  verifyScreenshotPixelDimensions,
} from "./cross-proof.ts";
import type {
  CrossChannelProof,
  DualChannelAuditResult,
  DualChannelInput,
  ScreenshotMetadata,
  StructuredFinding,
  ViewportMetrics,
  VisualMetricsReport,
} from "./types.ts";

export const DEFAULT_REQUIRED_VIEWPORTS = ["mobile", "tablet", "desktop"] as const;

export const PROTECTED_VIEWPORT_BANDS: ReadonlySet<string> = new Set([
  "mobile",
  "tablet",
  "desktop",
  "ultrawide",
]);

export function domInvariantsInspected(vp: ViewportMetrics, report: VisualMetricsReport): string[] {
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

export const SCREENSHOT_INVARIANT = "screenshot_non_empty";
export const MANIFEST_INVARIANT = "manifest_4_pillars_certified";

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
  const manifests = input.manifests ?? [];
  const hasScreenshots = screenshots.length > 0;
  const hasManifests = manifests.length > 0;

  if (!hasDomReport && !hasScreenshots && !hasManifests) {
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
        "Rejected: Automated UI Task Mandate requires dual-channel visual validation, but all evidence channels are missing.",
    };
  }

  // Validate screenshots: Reject < 1024 bytes
  for (const sc of screenshots) {
    if (!sc.sizeBytes || sc.sizeBytes < 1024 || isNaN(sc.sizeBytes)) {
      addFinding(
        "invalid_screenshot_size",
        "error",
        `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) is too small (${typeof sc.sizeBytes === "number" ? sc.sizeBytes : 0} bytes < 1024 bytes) or stubbed.`,
        "Ensure real browser rendering pipeline outputs valid non-empty PNG rasterizations (minimum 1024 bytes).",
        undefined,
        sc.viewport,
      );
    }
  }

  const sizeValidScreenshots = screenshots.filter(
    (sc) => typeof sc.sizeBytes === "number" && !isNaN(sc.sizeBytes) && sc.sizeBytes >= 1024,
  );
  const { reads: pngReads, verifiedClaims } = verifyScreenshotPixelDimensions(
    sizeValidScreenshots,
    addFinding,
    input.runRoot,
  );

  // Validate manifests: 4 Pillars & Criteria
  let manifestProofsValid = false;
  if (hasManifests) {
    let validCount = 0;
    for (let i = 0; i < manifests.length; i++) {
      const res = validateCompanionManifestCriteria(manifests[i], addFinding, i, {
        requireSemanticDepth: input.requireSemanticDepth,
      });
      if (res.valid) validCount++;
    }
    manifestProofsValid = validCount === manifests.length && manifests.length > 0;
  }

  const requiredVps = input.requiredViewports ?? DEFAULT_REQUIRED_VIEWPORTS;
  const coveredVps = new Set<string>();
  const coveredRawNames = new Set<string>();

  if (input.domReport) {
    for (const vp of input.domReport.viewports) {
      const norm = normalizeViewportName(vp.viewport, vp.width);
      const hasMeasuredWidth =
        typeof vp.width === "number" && Number.isFinite(vp.width) && vp.width > 0;
      if (hasMeasuredWidth) {
        coveredVps.add(norm);
      }
      if (hasMeasuredWidth) {
        coveredRawNames.add(vp.viewport.trim().toLowerCase());
      }
    }
    extractDomViolations(input.domReport, addFinding, input.subpixelTolerance);
  }

  const validScreenshots = screenshots.filter((s) => {
    if (typeof s.sizeBytes !== "number" || isNaN(s.sizeBytes) || s.sizeBytes < 1024) return false;
    const read = pngReads.get(s);
    return read !== undefined && read.status === "measured";
  });

  for (const sc of validScreenshots) {
    const rawLabel = sc.viewport === undefined ? sc.name : sc.viewport;
    coveredVps.add(normalizeViewportName(rawLabel, measuredWidthOf(pngReads, sc)));
    if (verifiedClaims.has(sc)) {
      coveredRawNames.add(rawLabel.trim().toLowerCase());
    }
  }

  for (const reqVp of requiredVps) {
    const normReq = normalizeViewportName(reqVp);
    const rawReq = reqVp.trim().toLowerCase();
    const isStandardBand = PROTECTED_VIEWPORT_BANDS.has(normReq);
    const customNameCovered = !isStandardBand && coveredRawNames.has(rawReq);
    const isMissing = !coveredVps.has(normReq) && !customNameCovered;
    if (isMissing) {
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
        (s) => normalizeViewportName(s.viewport ?? s.name, measuredWidthOf(pngReads, s)) === norm,
      );
      const hasViolations = findings.some(
        (f) => f.viewport === vp.viewport && f.severity === "error",
      );
      const inspected = domInvariantsInspected(vp, input.domReport!);
      const verifiedInvariants =
        sc === undefined ? inspected : [...inspected, SCREENSHOT_INVARIANT];
      if (manifestProofsValid) {
        verifiedInvariants.push(MANIFEST_INVARIANT);
      }

      proofs.push({
        viewport: vp.viewport,
        ...(sc === undefined ? {} : { screenshotPath: sc.path, screenshotSizeBytes: sc.sizeBytes }),
        domMetricsPresent: true,
        verifiedInvariants,
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
      const verifiedInvariants = domInvariantsInspected(vp, input.domReport!);
      if (manifestProofsValid) {
        verifiedInvariants.push(MANIFEST_INVARIANT);
      }
      proofs.push({
        viewport: vp.viewport,
        domMetricsPresent: true,
        verifiedInvariants,
        status: hasViolations ? "violation_detected" : "dom_only_gap_filled",
      });
    }
  } else {
    mode = "screenshot_gap_filled";
    for (const sc of validScreenshots) {
      const vpName = sc.viewport ?? normalizeViewportName(sc.name, measuredWidthOf(pngReads, sc));
      const hasViolations = findings.some((f) => f.viewport === vpName && f.severity === "error");
      const verifiedInvariants = [SCREENSHOT_INVARIANT];
      if (manifestProofsValid) {
        verifiedInvariants.push(MANIFEST_INVARIANT);
      }
      proofs.push({
        viewport: vpName,
        screenshotPath: sc.path,
        domMetricsPresent: false,
        screenshotSizeBytes: sc.sizeBytes,
        verifiedInvariants,
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
