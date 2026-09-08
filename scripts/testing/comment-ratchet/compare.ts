import type {
  CommentBaseline,
  CommentBaselineEntry,
  CommentRatchetDelta,
  CommentRatchetDeltaSet,
} from "./contracts.ts";

function compareDeltas(left: CommentRatchetDelta, right: CommentRatchetDelta): number {
  if (left.file < right.file) return -1;
  if (left.file > right.file) return 1;
  return 0;
}

function indexEntries(entries: readonly CommentBaselineEntry[]): Map<string, CommentBaselineEntry> {
  const map = new Map<string, CommentBaselineEntry>();
  for (const entry of entries) {
    map.set(entry.file, entry);
  }
  return map;
}

export function compareCommentBaseline(
  baseline: CommentBaseline,
  current: readonly CommentBaselineEntry[],
): { readonly baselineDelta: CommentRatchetDeltaSet; readonly passed: boolean } {
  const expected = indexEntries(baseline.entries);
  const actual = indexEntries(current);

  const added: CommentRatchetDelta[] = [];
  const worsened: CommentRatchetDelta[] = [];
  const improved: CommentRatchetDelta[] = [];
  const unchanged: CommentRatchetDelta[] = [];
  const resolved: CommentRatchetDelta[] = [];

  for (const [file, entry] of actual) {
    const baseEntry = expected.get(file);
    if (baseEntry === undefined) {
      if (entry.count > 0) {
        added.push({
          file,
          observed: entry.count,
          baseline: 0,
          diff: entry.count,
        });
      }
    } else {
      const diff = entry.count - baseEntry.count;
      if (diff > 0) {
        worsened.push({
          file,
          observed: entry.count,
          baseline: baseEntry.count,
          diff,
        });
      } else if (diff < 0) {
        improved.push({
          file,
          observed: entry.count,
          baseline: baseEntry.count,
          diff,
        });
      } else {
        unchanged.push({
          file,
          observed: entry.count,
          baseline: baseEntry.count,
          diff: 0,
        });
      }
    }
  }

  for (const [file, baseEntry] of expected) {
    const actEntry = actual.get(file);
    if (actEntry === undefined) {
      if (baseEntry.count > 0) {
        resolved.push({
          file,
          observed: 0,
          baseline: baseEntry.count,
          diff: -baseEntry.count,
        });
      }
    } else if (actEntry.count === 0 && baseEntry.count > 0) {
      resolved.push({
        file,
        observed: 0,
        baseline: baseEntry.count,
        diff: -baseEntry.count,
      });
    }
  }

  const sortedAdded = added.sort(compareDeltas);
  const sortedWorsened = worsened.sort(compareDeltas);
  const sortedImproved = improved.sort(compareDeltas);
  const sortedUnchanged = unchanged.sort(compareDeltas);
  const sortedResolved = resolved.sort(compareDeltas);

  return {
    baselineDelta: {
      added: sortedAdded,
      worsened: sortedWorsened,
      improved: sortedImproved,
      unchanged: sortedUnchanged,
      resolved: sortedResolved,
    },
    passed: sortedAdded.length === 0 && sortedWorsened.length === 0,
  };
}
