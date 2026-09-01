import { afterAll, describe, expect, test } from "bun:test";
import {
  inspectRepositoryContent,
  type RepositoryContentPathSource,
} from "../../../../olt/scripts/src/packets/repository-content.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

const vfs = new VirtualMemoryFS();
const session = createVirtualFSSession(vfs);

afterAll(() => {
  session.cleanup();
  vfs.reset();
});

function fixture(): string {
  const root = `/virtual/repository-content-settle-${Math.random().toString(36).slice(2)}`;
  vfs.mkdirSync(root, { recursive: true });
  vfs.writeFileSync(`${root}/a.txt`, "a");
  vfs.writeFileSync(`${root}/b.txt`, "b");
  vfs.writeFileSync(`${root}/phantom.txt`, "phantom");
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
