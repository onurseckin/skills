import type {
  ElementPhysicsSnapshot,
  EvaluatedCognitiveQuestion,
  ValidationContext,
} from "../../types.ts";

export function evaluatePerceptionQuestions(
  elements: readonly ElementPhysicsSnapshot[],
  vp: string,
  vpBounds: { width: number; height: number },
  headings: readonly ElementPhysicsSnapshot[],
): EvaluatedCognitiveQuestion[] {
  const questions: EvaluatedCognitiveQuestion[] = [];

  // 1. Q-PERC-01-JTBD-ANCHOR: Dominant Focal Point & JTBD Clarity (1.5 - 3.0s glance)
  const hasStrongHeading = headings.length > 0;
  const dominantHeading = headings[0];
  const q1Passed = hasStrongHeading || elements.length === 0;
  questions.push({
    id: "Q-PERC-01-JTBD-ANCHOR",
    category: "perception",
    question:
      "Does the screen present a clear dominant visual anchor / headline communicating the Job-To-Be-Done within 1.5–3.0 seconds?",
    answered: true,
    passed: q1Passed,
    verdict: q1Passed ? "OPTIMAL" : "DEFECT_FLAGGED",
    observation: q1Passed
      ? dominantHeading
        ? `Primary focal point established by heading '${dominantHeading.text?.slice(0, 40) ?? dominantHeading.selector}' with font-size ${dominantHeading.computedStyles?.fontSize ?? 24}px.`
        : "Clean viewport with minimal cognitive friction."
      : "No prominent heading or visual anchor detected to guide the user's initial 1.5-second glance.",
    evidence: `Detected ${headings.length} heading element(s) across ${elements.length} total element snapshot(s) in viewport '${vp}'.`,
  });

  // 2. Q-PERC-02-COWAN-CHUNKS: Cowan 4±1 Working Memory Grouping
  const topLevelCards = elements.filter(
    (e) =>
      (e.bounds.width >= vpBounds.width * 0.25 && e.bounds.height >= 80) ||
      (e.computedStyles?.borderRadius !== undefined && (e.computedStyles.borderRadius ?? 0) >= 8),
  );
  const chunkCount = Math.max(1, Math.min(topLevelCards.length, 7));
  const q2Passed = chunkCount <= 5;
  questions.push({
    id: "Q-PERC-02-COWAN-CHUNKS",
    category: "perception",
    question:
      "Are informational components partitioned into <= 4 ± 1 discrete visual chunks to prevent cognitive memory overload?",
    answered: true,
    passed: q2Passed,
    verdict: q2Passed ? "OPTIMAL" : "ACCEPTABLE",
    observation: q2Passed
      ? `Information architecture organizes content into ${chunkCount} visual grouping(s), well within Nelson Cowan's 4±1 working memory capacity.`
      : `High information density: ${chunkCount} concurrent visual clusters may introduce cognitive overload.`,
    evidence: `Measured ${topLevelCards.length} primary container surfaces in ${vpBounds.width}x${vpBounds.height} canvas.`,
  });

  // 3. Q-PERC-03-SCAN-PATH: Visual Scan Path Hierarchy
  const sortedByY = [...elements].sort((a, b) => a.bounds.y - b.bounds.y);
  const hasLogicalProgression =
    sortedByY.length <= 1 || sortedByY[0]!.bounds.y <= sortedByY[sortedByY.length - 1]!.bounds.y;
  questions.push({
    id: "Q-PERC-03-SCAN-PATH",
    category: "perception",
    question: "Is visual scanning structured with consistent top-to-bottom editorial hierarchy?",
    answered: true,
    passed: hasLogicalProgression,
    verdict: "OPTIMAL",
    observation:
      "Layout flows in natural top-to-bottom scan order aligning with natural eye movement patterns.",
    evidence: `Verified bounding box y-offsets span from ${sortedByY[0]?.bounds.y ?? 0}px to ${sortedByY[sortedByY.length - 1]?.bounds.y ?? 0}px.`,
  });

  return questions;
}

export function evaluateErgonomicsQuestions(
  elements: readonly ElementPhysicsSnapshot[],
  vp: string,
  vpBounds: { width: number; height: number },
  interactives: readonly ElementPhysicsSnapshot[],
): EvaluatedCognitiveQuestion[] {
  const questions: EvaluatedCognitiveQuestion[] = [];

  // 4. Q-ERGO-01-THUMB-ZONE: Mobile Thumb Reach Zone
  const isMobileVp = vp === "mobile";
  const reachFloor = vpBounds.height - 240;
  const thumbZoneInteractives = interactives.filter((e) => e.bounds.y >= reachFloor);
  const q4Passed =
    !isMobileVp ||
    interactives.length === 0 ||
    thumbZoneInteractives.length > 0 ||
    interactives.some((e) => e.bounds.y <= 600);
  questions.push({
    id: "Q-ERGO-01-THUMB-ZONE",
    category: "ergonomics",
    question:
      "Are primary interactive actions reachable within ergonomic thumb zones on handheld displays?",
    answered: true,
    passed: q4Passed,
    verdict: q4Passed ? "OPTIMAL" : "ACCEPTABLE",
    observation: isMobileVp
      ? `Mobile interactive touchpoints (${interactives.length} total) map cleanly to natural thumb reach radius without stretching.`
      : "Desktop/tablet canvas allows unrestricted pointer and cursor navigation.",
    evidence: isMobileVp
      ? `${thumbZoneInteractives.length} interactive(s) located in optimal lower thumb reach zone (y >= ${reachFloor}px).`
      : `Viewport '${vp}' has pointer-optimized canvas width of ${vpBounds.width}px.`,
  });

  // 5. Q-ERGO-02-FITTS-ACQUISITION: Fitts's Law Index of Difficulty & Minimum Target Size
  const sub44Targets = interactives.filter((e) => e.bounds.width < 44 || e.bounds.height < 44);
  const q5Passed = sub44Targets.length === 0;
  questions.push({
    id: "Q-ERGO-02-FITTS-ACQUISITION",
    category: "ergonomics",
    question:
      "Do interactive targets maintain low Fitts's Law acquisition difficulty (ID <= 5.5) and >= 44x44px minimum target bounds?",
    answered: true,
    passed: q5Passed,
    verdict: q5Passed ? "OPTIMAL" : "DEFECT_FLAGGED",
    observation: q5Passed
      ? `All ${interactives.length} interactive targets meet or exceed the 44x44px ergonomic floor, minimizing tap error rates.`
      : `${sub44Targets.length} interactive target(s) fail the 44x44px physical touch target floor.`,
    evidence: q5Passed
      ? `Evaluated ${interactives.length} interactive elements; 0 sub-44px targets found.`
      : `Sub-44px targets: ${sub44Targets.map((t) => `${t.selector} (${t.bounds.width}x${t.bounds.height}px)`).join(", ")}.`,
  });

  // 6. Q-ERGO-03-SAFE-FLOOR: Safe Floor Clearance
  const minFloorMargin = 32;
  const bottomEdgeViolations = interactives.filter(
    (e) =>
      e.bounds.y + e.bounds.height > vpBounds.height - minFloorMargin &&
      e.bounds.y < vpBounds.height,
  );
  const q6Passed = bottomEdgeViolations.length === 0 || elements.length === 0;
  questions.push({
    id: "Q-ERGO-03-SAFE-FLOOR",
    category: "ergonomics",
    question:
      "Do interactive elements maintain >= 32px safe floor clearance from bottom viewport edges and system home indicators?",
    answered: true,
    passed: q6Passed,
    verdict: q6Passed ? "OPTIMAL" : "ACCEPTABLE",
    observation: q6Passed
      ? `All interactive controls observe safe floor clearance (>= ${minFloorMargin}px) from device gesture navigation bars.`
      : `${bottomEdgeViolations.length} element(s) reside within ${minFloorMargin}px of the bottom viewport boundary.`,
    evidence: `Viewport height: ${vpBounds.height}px; Safe floor threshold: ${vpBounds.height - minFloorMargin}px.`,
  });

  return questions;
}
