import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  InFlightIngestionEngine,
  UserIntentExtractionEngine,
  toCanonicalDomainCategory,
  type GitRunner,
} from "../../../olt/scripts/src/mind/preplanning/index.ts";

describe("In-Flight Ingestion Part 1 Module Initialization", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let testDir: string;
  let snapshotsDir: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    testDir = `/virtual/test-inflight-part1-${Date.now()}`;
    snapshotsDir = `${testDir}/.olt/snapshots`;
    vfs.mkdirSync(snapshotsDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  it("initializes InFlightIngestionEngine with virtual paths and mock runner", () => {
    const mockRunner: GitRunner = (_cwd, argv) => {
      const cmd = argv[0];
      if (cmd === "symbolic-ref") return { status: 0, stdout: "main\n", stderr: "" };
      if (cmd === "rev-parse")
        return { status: 0, stdout: "0000111122223333444455556666777788889999\n", stderr: "" };
      if (cmd === "status") return { status: 0, stdout: "", stderr: "" };
      if (cmd === "diff") return { status: 0, stdout: "", stderr: "" };
      if (cmd === "stash") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const engine = new InFlightIngestionEngine(testDir, {
      snapshotsDir,
      runner: mockRunner,
    });
    expect(engine.getRepoRoot()).toBe(testDir);
    expect(engine.getSnapshotsDir()).toBe(snapshotsDir);
    expect(vfs.existsSync(snapshotsDir)).toBe(true);
  });

  it("initializes UserIntentExtractionEngine and verifies canonical categories", () => {
    const engine = new UserIntentExtractionEngine();
    expect(engine).toBeDefined();
    expect(toCanonicalDomainCategory("Core Engine")).toBe("engine");
    expect(toCanonicalDomainCategory("UI/UX")).toBe("reporting");
    expect(toCanonicalDomainCategory("Testing")).toBe("validation");
  });
});
