/**
 * @file bundle-verifier.ts
 * Multi-viewport bundle verification across all canonical viewports
 */

import { CANONICAL_VIEWPORTS } from "./constants.ts";
import { auditSingleViewportManifest } from "./single-verifier.ts";
import type {
  MandatoryPillar,
  MultiViewportBundleInput,
  MultiViewportDefect,
  MultiViewportVerificationResult,
  ScreenshotArtifact,
  SingleViewportAudit,
} from "./types.ts";

/**
 * Verifies multi-viewport companion manifest bundle across all 4 canonical viewports and 4 mandatory pillars.
 */
export function verifyMultiViewportManifests(
  input: MultiViewportBundleInput,
): MultiViewportVerificationResult {
  const defects: MultiViewportDefect[] = [];
  const requiredViewports = input.requiredViewports ?? CANONICAL_VIEWPORTS;

  // Build a map of viewport -> manifest & screenshot & dpr
  const manifestMap = new Map<string, unknown>();
  const screenshotMap = new Map<string, ScreenshotArtifact>();
  const dprMap = new Map<string, number>();

  // Process entries array if provided
  if (input.entries) {
    for (const entry of input.entries) {
      manifestMap.set(entry.viewport, entry.manifest);
      if (entry.screenshot) {
        screenshotMap.set(entry.viewport, entry.screenshot);
      }
      const entryDpr = entry.devicePixelRatio ?? entry.dpr;
      if (entryDpr !== undefined) {
        dprMap.set(entry.viewport, entryDpr);
      }
    }
  }

  // Process loose manifests
  if (input.manifests) {
    for (const m of input.manifests) {
      if (m && typeof m === "object") {
        const vp = (m as { readonly viewport?: string }).viewport;
        if (vp) {
          manifestMap.set(vp, m);
        }
      }
    }
  }

  // Process loose screenshots
  if (input.screenshots) {
    for (const s of input.screenshots) {
      if (s?.viewport) {
        screenshotMap.set(s.viewport, s);
        if (s.dpr !== undefined) {
          dprMap.set(s.viewport, s.dpr);
        }
      }
    }
  }

  // Process explicit DPR overrides
  if (input.dprOverrides) {
    for (const [vp, dprVal] of Object.entries(input.dprOverrides)) {
      dprMap.set(vp, dprVal);
    }
  }

  const verifiedViewports: string[] = [];
  const missingViewports: string[] = [];
  const viewportAudits: SingleViewportAudit[] = [];
  const pillarMatrix: Record<string, Record<MandatoryPillar, boolean>> = {};

  for (const vp of requiredViewports) {
    pillarMatrix[vp] = {
      mechanical: false,
      cognitive: false,
      product: false,
      ux: false,
    };

    const manifest = manifestMap.get(vp);
    const screenshot = screenshotMap.get(vp);
    const dpr = dprMap.get(vp);

    if (!manifest) {
      missingViewports.push(vp);
      defects.push({
        id: `manifest-missing-viewport-${vp}`,
        category: "missing_manifest",
        severity: "critical",
        viewport: vp,
        message: `Missing companion manifest for required canonical viewport '${vp}'.`,
      });
      continue;
    }

    const audit = auditSingleViewportManifest(vp, manifest, screenshot, {
      requireSemanticDepth: input.requireSemanticDepth,
      dpr,
    });
    viewportAudits.push(audit);
    defects.push(...audit.defects);

    for (const cp of audit.coveredPillars) {
      const entry = pillarMatrix[vp];
      if (entry) {
        entry[cp] = true;
      }
    }

    if (audit.passed) {
      verifiedViewports.push(vp);
    }
  }

  const passed = defects.length === 0 && missingViewports.length === 0;
  const summary = passed
    ? `All ${requiredViewports.length} viewports certified across all 4 mandatory pillars with valid screenshots (>= 1024B).`
    : `Multi-viewport verification failed: ${defects.length} defect(s) detected across viewports [${Array.from(new Set(defects.map((d) => d.viewport))).join(", ")}].`;

  return {
    passed,
    verifiedViewports,
    missingViewports,
    viewportAudits,
    pillarMatrix,
    defects,
    summary,
  };
}
