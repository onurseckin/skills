import {
  CANONICAL_VIEWPORTS,
  DEFAULT_MIN_SCREENSHOT_BYTES,
  DEFAULT_MIN_UNIQUE_WORDS,
  DEFAULT_MIN_WORD_COUNT,
  OPTICAL_DOCTOR_ENGINE_NAME,
  type CanonicalViewportKind,
  type OpticalDoctorCheckOptions,
  type OpticalDoctorFinding,
  type OpticalReviewToolCall,
} from "./types.ts";

export function normalizePath(p: string): string {
  return p.replace(/\\/gu, "/").replace(/\/+/gu, "/").trim().toLowerCase();
}

function extractViewedPath(tc: OpticalReviewToolCall): string | null {
  if (tc.tool !== "view_file") {
    return null;
  }
  const args = tc.args;
  if (!args || typeof args !== "object") {
    return null;
  }
  const candidate = args.AbsolutePath ?? args.path ?? args.filePath ?? args.targetFile ?? args.file;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return normalizePath(candidate);
  }
  return null;
}

function classifyViewportPath(normalizedPath: string): CanonicalViewportKind | null {
  for (const spec of CANONICAL_VIEWPORTS) {
    if (spec.pattern.test(normalizedPath)) {
      return spec.kind;
    }
  }
  return null;
}

export function detectViewportReviewDefects(
  options: OpticalDoctorCheckOptions,
): readonly OpticalDoctorFinding[] {
  const findings: OpticalDoctorFinding[] = [];

  const toolCalls = options.toolCalls ?? [];
  const viewedPaths = new Set<string>();

  for (const tc of toolCalls) {
    const path = extractViewedPath(tc);
    if (path !== null) {
      viewedPaths.add(path);
    }
  }

  // 1. Tool Calls / Image Inspection Check
  if (options.requiredViewportPaths !== undefined && options.requiredViewportPaths.length > 0) {
    for (const reqPath of options.requiredViewportPaths) {
      const normReq = normalizePath(reqPath);
      const isViewed = Array.from(viewedPaths).some(
        (vp) => vp === normReq || vp.endsWith(`/${normReq}`) || normReq.endsWith(`/${vp}`),
      );
      if (!isViewed) {
        findings.push({
          code: "MISSING_VIEWPORT_INSPECTION",
          severity: "ERROR",
          engine: OPTICAL_DOCTOR_ENGINE_NAME,
          message: `Mandatory viewport image was not inspected via view_file: "${reqPath}"`,
          details: {
            requiredPath: reqPath,
            viewedCount: viewedPaths.size,
          },
        });
      }
    }
  } else {
    // Canonical 4-viewport validation
    if (viewedPaths.size === 0) {
      findings.push({
        code: "UNINSPECTED_SURFACE_APPROVAL",
        severity: "ERROR",
        engine: OPTICAL_DOCTOR_ENGINE_NAME,
        message:
          "No screenshot images were viewed via view_file; UI validation requires headful visual inspection",
        details: { viewedCount: 0 },
      });
    } else {
      const inspectedKinds = new Set<CanonicalViewportKind>();
      for (const vp of viewedPaths) {
        const kind = classifyViewportPath(vp);
        if (kind !== null) {
          inspectedKinds.add(kind);
        }
      }

      for (const spec of CANONICAL_VIEWPORTS) {
        if (!inspectedKinds.has(spec.kind)) {
          findings.push({
            code: "MISSING_VIEWPORT_INSPECTION",
            severity: "ERROR",
            engine: OPTICAL_DOCTOR_ENGINE_NAME,
            message: `Canonical viewport ${spec.label} was not inspected via view_file`,
            details: {
              missingViewport: spec.kind,
              width: spec.width,
              height: spec.height,
            },
          });
        }
      }
    }
  }

  // 2. Corrupt / Zero-byte / Empty Screenshot check
  if (options.screenshotFileSizes !== undefined) {
    const minBytes = DEFAULT_MIN_SCREENSHOT_BYTES;
    for (const [filePath, size] of Object.entries(options.screenshotFileSizes)) {
      if (typeof size === "number" && size < minBytes) {
        findings.push({
          code: "SCREENSHOT_PAYLOAD_EMPTY_OR_CORRUPT",
          severity: "ERROR",
          engine: OPTICAL_DOCTOR_ENGINE_NAME,
          message: `Screenshot artifact "${filePath}" is empty or corrupt (${size} bytes; minimum ${minBytes} bytes required)`,
          details: { filePath, sizeInBytes: size, minimumRequiredBytes: minBytes },
        });
      }
    }
  }

  // 3. Substantive Volume Floor Check (prose depth)
  const minWordCount = options.minWordCount ?? DEFAULT_MIN_WORD_COUNT;
  const minUniqueWords = options.minUniqueWords ?? DEFAULT_MIN_UNIQUE_WORDS;
  const rawProse = options.reviewProse ?? "";

  // Strip code fences (```...```) and inline code (`...`) to prevent word padding attacks
  const strippedProse = rawProse.replace(/```[\s\S]*?```/gu, " ").replace(/`[^`]+`/gu, " ");

  const trimmed = strippedProse.trim();
  const words = trimmed.length === 0 ? [] : trimmed.split(/\s+/u);
  const wordCount = words.length;

  if (wordCount < minWordCount) {
    findings.push({
      code: "INSUFFICIENT_CRITIQUE_DEPTH",
      severity: "ERROR",
      engine: OPTICAL_DOCTOR_ENGINE_NAME,
      message: `Insufficient critique depth: review contains ${wordCount} words (minimum ${minWordCount} required; code fences excluded)`,
      details: { wordCount, minWordCount },
    });
  } else {
    // Check for degenerate word loops / repetition
    const uniqueWordSet = new Set(words.map((w) => w.toLowerCase()));
    if (uniqueWordSet.size < minUniqueWords) {
      findings.push({
        code: "DEGENERATE_REPETITION_DETECTED",
        severity: "ERROR",
        engine: OPTICAL_DOCTOR_ENGINE_NAME,
        message: `Degenerate word repetition: only ${uniqueWordSet.size} unique words found across ${wordCount} words (minimum ${minUniqueWords} required)`,
        details: { uniqueWordCount: uniqueWordSet.size, totalWordCount: wordCount },
      });
    }
  }

  // 4. Multi-Viewport Narrative Coverage Check
  if (rawProse.trim().length > 0) {
    const hasMobile = /(?:mobile|390(?:px)?|phone|iphone|smartphone|small\s+screen)\b/iu.test(
      rawProse,
    );
    const hasTablet = /(?:tablet|768(?:px)?|ipad|medium\s+screen)\b/iu.test(rawProse);
    const hasDesktop = /(?:desktop|1440(?:px)?|1920(?:px)?|wide|large\s+screen)\b/iu.test(rawProse);

    if (!hasMobile || !hasTablet || !hasDesktop) {
      const missingDimensions: string[] = [];
      if (!hasMobile) missingDimensions.push("mobile (390px)");
      if (!hasTablet) missingDimensions.push("tablet (768px)");
      if (!hasDesktop) missingDimensions.push("desktop/wide (1440px/1920px)");

      findings.push({
        code: "DEFICIENT_VIEWPORT_COVERAGE",
        severity: "ERROR",
        engine: OPTICAL_DOCTOR_ENGINE_NAME,
        message: `Deficient viewport narrative coverage: review fails to evaluate ${missingDimensions.join(", ")}`,
        details: { missingDimensions },
      });
    }
  }

  return findings;
}
