import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectRepositoryContent,
  type RepositoryContentPathSource,
} from "../../../orchestrating-long-tasks/scripts/src/packets/repository-content.ts";

// tests/unit/reporting/handoff-triggers.test.ts's "sealing the run rewrites it against the
// completed state" threw "repository content listing changed during scan" under real
// concurrent-agent load with no write anywhere between the two reads (the scan is read-only) —
// the same fork+exec scheduling hazard repository-git-command.ts already retries per-command,
// surfacing here as the whole listing disagreeing with itself. These prove the settle-retry added
// to inspectRepositoryContent absorbs a transient flap without masking a persistent difference.

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "repository-content-settle-"));
  roots.push(root);
  return root;
}

const STABLE = ["a.txt", "b.txt"];
const FLAPPED = ["a.txt", "b.txt", "phantom.txt"];

/** Returns `flapTimes` disagreeing reads after the first call, then settles on the stable listing. */
function flappingSource(flapTimes: number): {
  source: RepositoryContentPathSource;
  calls: () => number;
} {
  let call = 0;
  const source: RepositoryContentPathSource = () => {
    call += 1;
    // Call 1 establishes "before"; only the reads after it are the flaky ones under test.
    return call > 1 && call <= 1 + flapTimes ? FLAPPED : STABLE;
  };
  return { source, calls: () => call };
}

describe("inspectRepositoryContent settles a transiently flapping listing", () => {
  test("recovers when the re-read disagrees fewer times than the retry budget", () => {
    const repo = fixture();
    const { source, calls } = flappingSource(2);

    const result = inspectRepositoryContent(repo, {}, source);

    expect(result.file_count).toBe(STABLE.length);
    expect(calls()).toBe(5); // before + 2 flapped middle reads + the settling read + a clean after read
  });

  test("still throws once the listing disagrees past the retry budget", () => {
    const repo = fixture();
    const { source, calls } = flappingSource(100);

    expect(() => inspectRepositoryContent(repo, {}, source)).toThrow(
      /repository content listing changed during scan/,
    );
    expect(calls()).toBe(5); // before + 3 bounded retries of middle, never more
  });

  test("a listing that never settles because it genuinely changed is still reported", () => {
    const repo = fixture();
    let call = 0;
    // Every read after the first returns a strictly growing listing — a real, persistent change,
    // never a value that could coincidentally settle back to matching "before".
    const source: RepositoryContentPathSource = () => {
      call += 1;
      return call === 1 ? STABLE : [...STABLE, `growing-${call}.txt`];
    };

    expect(() => inspectRepositoryContent(repo, {}, source)).toThrow(
      /repository content listing changed during scan/,
    );
  });
});
