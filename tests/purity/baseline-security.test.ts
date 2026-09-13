import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadBaseline } from "../../scripts/modularity/policy/baseline.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("modularity baseline security, schema, and error validation (VirtualMemoryFS)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  const root = "/virtual/purity-security-test";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  function writeDoc(relativePath: string, data: unknown): void {
    const fullPath = join(root, relativePath);
    vfs.writeFileSync(fullPath, typeof data === "string" ? data : JSON.stringify(data));
  }

  describe("path containment and escape prevention", () => {
    it("rejects path traversal attempting to escape the repository root", async () => {
      await expect(loadBaseline(root, "../../etc/passwd")).rejects.toThrow(
        /baseline path is outside the repository/,
      );
    });

    it("rejects parent directory escape paths", async () => {
      await expect(loadBaseline(root, "../outside.json")).rejects.toThrow(
        /baseline path is outside the repository/,
      );
    });

    it("rejects empty relative path targeting the root itself", async () => {
      await expect(loadBaseline(root, ".")).rejects.toThrow(
        /baseline path is outside the repository/,
      );
    });

    it("fails loudly when baseline file does not exist", async () => {
      await expect(loadBaseline(root, "nonexistent-baseline.json")).rejects.toThrow(
        /missing baseline file/,
      );
    });
  });

  describe("schema version and root document structure", () => {
    it("rejects stale or unsupported schema version strings", async () => {
      writeDoc("baseline.json", {
        schema: "olt-modularity-baseline/v2",
        violations: [],
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(/stale or missing schema/);
    });

    it("rejects document missing schema field", async () => {
      writeDoc("baseline.json", {
        violations: [],
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(/stale or missing schema/);
    });

    it("rejects document having both violations and shards keys", async () => {
      writeDoc("baseline.json", {
        schema: "olt-modularity-baseline/v1",
        violations: [],
        shards: [],
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(/stale or missing schema/);
    });

    it("rejects unknown keys at root document level", async () => {
      writeDoc("baseline.json", {
        schema: "olt-modularity-baseline/v1",
        violations: [],
        extraKey: "illegal",
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(/unknown root key/);
    });
  });

  describe("violation entry contract validation", () => {
    it("rejects unknown modularity rule identifiers", async () => {
      writeDoc("baseline.json", {
        schema: "olt-modularity-baseline/v1",
        violations: [
          {
            rule: "unknown_forbidden_rule",
            path: "src/file.ts",
            observed: 10,
            detail: "Violation",
          },
        ],
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(
        /violation has invalid required fields/,
      );
    });

    it("rejects violation with unknown property keys", async () => {
      writeDoc("baseline.json", {
        schema: "olt-modularity-baseline/v1",
        violations: [
          {
            rule: "line_limit",
            path: "src/file.ts",
            observed: 500,
            detail: "Too big",
            rogueProperty: true,
          },
        ],
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(
        /violation has unknown keys/,
      );
    });

    it("rejects negative numeric observed values", async () => {
      writeDoc("baseline.json", {
        schema: "olt-modularity-baseline/v1",
        violations: [
          {
            rule: "line_limit",
            path: "src/file.ts",
            observed: -5,
            detail: "Negative lines",
          },
        ],
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(
        /violation has negative or invalid observed value/,
      );
    });

    it("rejects invalid non-string non-number observed values", async () => {
      writeDoc("baseline.json", {
        schema: "olt-modularity-baseline/v1",
        violations: [
          {
            rule: "line_limit",
            path: "src/file.ts",
            observed: { count: 500 },
            detail: "Bad observed type",
          },
        ],
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(
        /violation has invalid observed value/,
      );
    });

    it("rejects empty string path", async () => {
      writeDoc("baseline.json", {
        schema: "olt-modularity-baseline/v1",
        violations: [
          {
            rule: "line_limit",
            path: "",
            observed: 500,
            detail: "Empty path",
          },
        ],
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(
        /violation has invalid required fields/,
      );
    });
  });

  describe("sharded baseline validation", () => {
    it("fails when a referenced shard file is missing", async () => {
      writeDoc("baseline.json", {
        schema: "olt-modularity-baseline/v1",
        shards: ["ghost-shard.json"],
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(
        /missing baseline shard ghost-shard\.json/,
      );
    });

    it("rejects shard entry that is not a JSON array", async () => {
      writeDoc("shard.json", { notAnArray: true });
      writeDoc("baseline.json", {
        schema: "olt-modularity-baseline/v1",
        shards: ["shard.json"],
      });
      await expect(loadBaseline(root, "baseline.json")).rejects.toThrow(/must be an array/);
    });
  });
});
