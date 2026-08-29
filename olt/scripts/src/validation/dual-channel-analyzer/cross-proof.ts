import { realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { CANONICAL_VIEWPORTS } from "../../capture/config/default-presets.ts";
import { readHeader } from "../../summary/assets/asset-measure.ts";
import {
  normalizeViewportName,
  validateCrossChannelConsistency,
} from "../channels/cross-channel-consistency.ts";
import type { FindingAdder } from "../channels/dom-violation-extractor.ts";
import type { PngDimensionRead, PngVerificationResult, ScreenshotMetadata } from "./types.ts";

export { validateCrossChannelConsistency };

export const PNG_SIGNATURE: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const MAX_DEVICE_SCALE_FACTOR = 4;

export function resolveScreenshotPath(path: string, runRoot: string | undefined): string {
  if (runRoot === undefined || isAbsolute(path)) return path;
  try {
    const root = realpathSync(runRoot);
    const candidate = resolve(join(root, path));
    if (candidate !== root && !candidate.startsWith(root + sep)) return path;
    return candidate;
  } catch {
    return path;
  }
}

export function readPngPixelDimensions(path: string): PngDimensionRead {
  const read = readHeader(path);
  if (read === undefined) return { status: "unreadable" };
  const header = read.header;
  if (header.length < 24) return { status: "invalid_png" };
  if (!header.subarray(0, 8).equals(PNG_SIGNATURE)) return { status: "invalid_png" };
  if (header.subarray(12, 16).toString("latin1") !== "IHDR") return { status: "invalid_png" };
  return { status: "measured", width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

export function measuredWidthOf(
  pngReads: ReadonlyMap<ScreenshotMetadata, PngDimensionRead>,
  sc: ScreenshotMetadata,
): number | undefined {
  const read = pngReads.get(sc);
  return read !== undefined && read.status === "measured" ? read.width : undefined;
}

export function selfReportedDimensionsWithinTolerance(
  measuredWidth: number,
  measuredHeight: number,
  claimedWidth: number | undefined,
  claimedHeight: number | undefined,
): boolean {
  if (
    typeof claimedWidth !== "number" ||
    typeof claimedHeight !== "number" ||
    Number.isNaN(claimedWidth) ||
    Number.isNaN(claimedHeight) ||
    claimedWidth <= 0 ||
    claimedHeight <= 0
  ) {
    return false;
  }
  for (let scale = 1; scale <= MAX_DEVICE_SCALE_FACTOR; scale++) {
    if (measuredWidth === claimedWidth * scale && measuredHeight === claimedHeight * scale) {
      return true;
    }
  }
  return false;
}

export function verifyScreenshotPixelDimensions(
  screenshots: readonly ScreenshotMetadata[],
  addFinding: FindingAdder,
  runRoot?: string,
): PngVerificationResult {
  const reads = new Map<ScreenshotMetadata, PngDimensionRead>();
  const verifiedClaims = new Set<ScreenshotMetadata>();
  for (const sc of screenshots) {
    const pngRead = readPngPixelDimensions(resolveScreenshotPath(sc.path, runRoot));
    reads.set(sc, pngRead);
    if (pngRead.status === "unreadable") {
      addFinding(
        "invalid_screenshot_size",
        "error",
        `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) could not be opened to verify its real pixel dimensions (the file is missing or unreadable). A screenshot whose bytes were never inspected cannot count as captured evidence.`,
        "Ensure the screenshot path points to a PNG file that genuinely exists on disk and was produced by the real browser rendering pipeline, not a fabricated or metadata-only entry.",
        undefined,
        sc.viewport,
      );
      continue;
    }
    if (pngRead.status === "invalid_png") {
      addFinding(
        "invalid_screenshot_size",
        "error",
        `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) is not a valid PNG image (missing PNG signature or IHDR chunk at the expected byte offsets).`,
        "Ensure the captured evidence file is a genuine PNG rasterization produced by the browser rendering pipeline.",
        undefined,
        sc.viewport,
      );
      continue;
    }

    const claimedName = sc.viewport === undefined ? sc.name : sc.viewport;
    const claimedViewport = normalizeViewportName(claimedName, undefined);
    const canonical = CANONICAL_VIEWPORTS[claimedViewport];
    if (canonical === undefined) {
      const consistent = selfReportedDimensionsWithinTolerance(
        pngRead.width,
        pngRead.height,
        sc.width,
        sc.height,
      );
      if (consistent) {
        verifiedClaims.add(sc);
      } else {
        const hasSelfReportedDims = typeof sc.width === "number" && typeof sc.height === "number";
        addFinding(
          "invalid_screenshot_size",
          "error",
          hasSelfReportedDims
            ? `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) claims custom viewport '${claimedViewport}' with self-reported dimensions ${sc.width}x${sc.height}, but its real measured pixel dimensions (${pngRead.width}x${pngRead.height}) are not a consistent match at any 1x-${MAX_DEVICE_SCALE_FACTOR}x device pixel ratio.`
            : `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) claims non-canonical viewport '${claimedViewport}' with real measured pixel dimensions (${pngRead.width}x${pngRead.height}) but supplies no self-reported width/height to cross-check the claim against. A custom viewport whose correctness cannot be established must not count as captured evidence.`,
          "Provide self-reported width/height metadata that matches the real captured pixel dimensions for custom, non-canonical viewports, or capture at one of the canonical viewport presets.",
          undefined,
          sc.viewport,
        );
      }
      continue;
    }

    const scaleFactor = canonical.deviceScaleFactor === undefined ? 1 : canonical.deviceScaleFactor;
    const widthOk =
      pngRead.width >= canonical.width && pngRead.width <= canonical.width * scaleFactor;
    const heightOk =
      pngRead.height >= canonical.height && pngRead.height <= canonical.height * scaleFactor;
    const matches = widthOk && heightOk;
    if (matches) {
      verifiedClaims.add(sc);
    } else {
      addFinding(
        "invalid_screenshot_size",
        "error",
        `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) claims viewport '${claimedViewport}' but its real pixel dimensions (${pngRead.width}x${pngRead.height}) do not match the canonical '${claimedViewport}' viewport (${canonical.width}x${canonical.height}, up to ${scaleFactor}x device pixel ratio).`,
        `Capture genuine '${claimedViewport}' viewport evidence at ${canonical.width}x${canonical.height} (or an integer device-pixel-ratio multiple of it) rather than a placeholder image.`,
        undefined,
        sc.viewport,
      );
    }
  }
  return { reads, verifiedClaims };
}
