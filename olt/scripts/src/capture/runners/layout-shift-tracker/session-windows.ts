import { resolveLayoutShiftTrackerOptions } from "./options.ts";
import type {
  CumulativeLayoutShiftReport,
  LayoutShiftEntry,
  LayoutShiftTrackerOptions,
  LayoutShiftWindow,
  UnstableElementDisplacement,
} from "./types.ts";

/**
 * Categorizes and groups layout shift entries into session windows according to Web Vitals specification:
 * - Session windows have a maximum total duration of 5 seconds (5000ms).
 * - Consecutive shifts are grouped into the same window if the gap between shifts is at most 1 second (1000ms).
 * - A gap > 1s or reaching the 5s window cap ends the session window and begins a new window.
 */
export function groupSessionWindows(
  entries: readonly LayoutShiftEntry[],
  options?: LayoutShiftTrackerOptions,
): readonly LayoutShiftWindow[] {
  if (entries.length === 0) return [];

  const resolved = resolveLayoutShiftTrackerOptions(options);
  const maxDuration = resolved.sessionMaxDurationMs;
  const maxGap = resolved.sessionMaxGapMs;

  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const windows: LayoutShiftWindow[] = [];

  let currentWindowEntries: LayoutShiftEntry[] = [];
  let windowIndex = 0;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;

    if (currentWindowEntries.length === 0) {
      currentWindowEntries.push(entry);
      continue;
    }

    const previousEntry = currentWindowEntries[currentWindowEntries.length - 1]!;
    const gap = entry.timestamp - previousEntry.timestamp;
    const windowStart = currentWindowEntries[0]!.timestamp;
    const totalDuration = entry.timestamp - windowStart;

    if (gap > maxGap || totalDuration > maxDuration) {
      const startTime = currentWindowEntries[0]!.timestamp;
      const endTime = previousEntry.timestamp;
      const windowScore = currentWindowEntries.reduce(
        (sum, e) => (e.isValidShift ? sum + e.score : sum),
        0,
      );

      windows.push({
        windowIndex: windowIndex++,
        startTime,
        endTime,
        duration: Math.max(0, endTime - startTime),
        entries: currentWindowEntries,
        windowScore,
        isMaxWindow: false,
      });

      currentWindowEntries = [entry];
    } else {
      currentWindowEntries.push(entry);
    }
  }

  if (currentWindowEntries.length > 0) {
    const startTime = currentWindowEntries[0]!.timestamp;
    const endTime = currentWindowEntries[currentWindowEntries.length - 1]!.timestamp;
    const windowScore = currentWindowEntries.reduce(
      (sum, e) => (e.isValidShift ? sum + e.score : sum),
      0,
    );

    windows.push({
      windowIndex: windowIndex++,
      startTime,
      endTime,
      duration: Math.max(0, endTime - startTime),
      entries: currentWindowEntries,
      windowScore,
      isMaxWindow: false,
    });
  }

  // Find maximum window score
  let maxScore = -1;
  let maxIndex = -1;
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]!;
    if (w.windowScore > maxScore) {
      maxScore = w.windowScore;
      maxIndex = i;
    }
  }

  return windows.map((w, idx) => ({
    ...w,
    isMaxWindow: idx === maxIndex && w.windowScore > 0,
  }));
}

/**
 * Builds a comprehensive Cumulative Layout Shift report from a list of shift entries.
 */
export function buildCumulativeLayoutShiftReport(
  entries: readonly LayoutShiftEntry[],
  options?: LayoutShiftTrackerOptions,
): CumulativeLayoutShiftReport {
  const sessionWindows = groupSessionWindows(entries, options);
  let maxSessionWindow: LayoutShiftWindow | null = null;
  let totalCumulativeScore = 0;

  for (const w of sessionWindows) {
    totalCumulativeScore += w.windowScore;
    if (!maxSessionWindow || w.windowScore > maxSessionWindow.windowScore) {
      maxSessionWindow = w;
    }
  }

  const clsScore = maxSessionWindow ? maxSessionWindow.windowScore : 0;
  const rating: CumulativeLayoutShiftReport["rating"] =
    clsScore <= 0.1 ? "good" : clsScore <= 0.25 ? "needs-improvement" : "poor";

  const allRootCauses: UnstableElementDisplacement[] = [];
  const seenSelectors = new Set<string>();

  for (const entry of entries) {
    for (const rc of entry.rootCauses) {
      if (!seenSelectors.has(rc.selector)) {
        seenSelectors.add(rc.selector);
        allRootCauses.push(rc);
      }
    }
  }

  let unstableCount = 0;
  for (const entry of entries) {
    unstableCount += entry.sources.filter((s) => !s.isExcluded).length;
  }

  const summary =
    clsScore <= 0.1
      ? `CLS Score ${clsScore.toFixed(4)} (Good). Visual stability is well maintained.`
      : clsScore <= 0.25
        ? `CLS Score ${clsScore.toFixed(4)} (Needs Improvement). Moderate unexpected layout shifts observed across ${unstableCount} element instances.`
        : `CLS Score ${clsScore.toFixed(4)} (Poor). Significant unexpected layout shifts detected; ${allRootCauses.length} root-causing elements identified.`;

  return {
    clsScore,
    totalCumulativeScore,
    sessionWindows,
    maxSessionWindow,
    totalEntries: entries.length,
    unstableElementsCount: unstableCount,
    rootCauseElements: allRootCauses,
    rating,
    summary,
    evaluatedAt: new Date().toISOString(),
  };
}
