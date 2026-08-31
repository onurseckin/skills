import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  createAgentMetadata,
  findAgentMetadataLocation,
  getAgentMetadataPath,
  setAgentMetadataDependenciesForTesting,
  writeAgentMetadata,
} from "../../../olt/scripts/src/runtime/index.ts";

const scratchBase = join(process.cwd(), "coverage", "scratch", "metadata-security");

function getScratch(label: string): string {
  const dir = join(scratchBase, `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function metadata(agentId: string): Record<string, unknown> {
  return {
    agent_id: agentId,
    role: "implementer",
    tier: 3,
    write_scope: ["olt/scripts/src/runtime/index.ts"],
    allowed_read_scope: ["olt/scripts/src/runtime"],
    can_execute_shell: true,
    spawned_at: "2026-08-26T00:00:00.000Z",
  };
}

function writeMetadata(root: string, agentId: string, value: unknown): string {
  const path = join(root, "runtime", `agent-${agentId}.json`);
  mkdirSync(join(root, "runtime"), { recursive: true });
  writeFileSync(path, JSON.stringify(value), "utf-8");
  return path;
}

describe("agent metadata security and validation", () => {
  afterEach(() => {
    try {
      rmSync(scratchBase, { recursive: true, force: true });
    } catch {}
  });

  it("rejects cyclic metadata before creating a runtime directory or partial metadata file", () => {
    const root = getScratch("metadata-serialization");
    const agentId = "impl-cyclic";
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const record = createAgentMetadata({
      agent_id: agentId,
      role: "implementer",
      metadata: cyclic,
    });

    expect(() => writeAgentMetadata(record, root)).toThrow(HarnessError);
    expect(existsSync(join(root, "runtime"))).toBe(false);
  });

  it("does not fall through from corrupt preferred metadata", () => {
    const root = getScratch("corrupt-preferred");
    const filePath = writeMetadata(root, "impl-corrupt", "not metadata");

    try {
      findAgentMetadataLocation("impl-corrupt", root);
      expect.unreachable("corrupt preferred metadata must fail closed");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect((error as HarnessError).message).toContain(filePath);
    }
  });

  it("rejects preferred metadata whose embedded identity differs from the lookup", () => {
    const root = getScratch("mismatched-agent-id");
    writeMetadata(root, "impl-requested", metadata("impl-other"));

    expect(() => findAgentMetadataLocation("impl-requested", root)).toThrow(HarnessError);
  });

  it("rejects malformed authority fields before exposing preferred metadata", () => {
    const root = getScratch("malformed-authority");
    const invalidRecords: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["fractional tier", { ...metadata("impl-invalid-tier"), tier: 2.5 }],
      ["out of range tier", { ...metadata("impl-invalid-tier-domain"), tier: 4 }],
      [
        "unsafe tier",
        { ...metadata("impl-invalid-tier-unsafe"), tier: Number.MAX_SAFE_INTEGER + 1 },
      ],
      ["non-string scope entry", { ...metadata("impl-invalid-scope"), write_scope: ["safe", 9] }],
      [
        "non-boolean shell permission",
        { ...metadata("impl-invalid-shell"), can_execute_shell: "yes" },
      ],
      ["empty run id", { ...metadata("impl-invalid-run"), run_id: "" }],
      [
        "zero review max",
        {
          ...metadata("impl-invalid-review-max"),
          review_config: { max_adversarial_pushes: 0, cognitive_pushes: 0 },
        },
      ],
      [
        "fractional review cognitive",
        {
          ...metadata("impl-invalid-review-cognitive"),
          review_config: { max_adversarial_pushes: 1, cognitive_pushes: 0.5 },
        },
      ],
    ];

    for (const [label, record] of invalidRecords) {
      const agentId = record["agent_id"] as string;
      writeMetadata(join(root, label.replaceAll(" ", "-")), agentId, record);
      try {
        findAgentMetadataLocation(agentId, join(root, label.replaceAll(" ", "-")));
        expect.unreachable(`${label} must fail metadata validation`);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).code).toBe("INTEGRITY");
      }
    }
  });

  it("refuses unsafe agent identifiers before constructing metadata paths", () => {
    const invalidIds = ["", " ", ".", "..", "nested/id", "nested\\id", "nul\0id"];

    for (const agentId of invalidIds) {
      expect(() => getAgentMetadataPath(agentId, ".")).toThrow(HarnessError);
    }
    const unsafeMetadata = createAgentMetadata({ agent_id: "../escape", role: "implementer" });
    expect(() => writeAgentMetadata(unsafeMetadata, ".")).toThrow(HarnessError);
    expect(() => findAgentMetadataLocation("../escape", ".")).toThrow(HarnessError);
  });

  it("reports unreadable preferred metadata as integrity failure", () => {
    const root = getScratch("unreadable-preferred");
    const agentId = "impl-unreadable";
    const filePath = join(root, "runtime", `agent-${agentId}.json`);
    const denied = Object.create(null) as { code?: string; message?: string };
    Object.defineProperty(denied, "code", { value: "EACCES" });
    Object.defineProperty(denied, "message", { value: "access denied" });
    const restore = setAgentMetadataDependenciesForTesting({
      readFile(path, encoding) {
        if (path === filePath) throw denied;
        return readFileSync(path, encoding);
      },
    });

    try {
      expect(() => findAgentMetadataLocation(agentId, root)).toThrow(HarnessError);
    } finally {
      restore();
    }
  });

  it("does not fall back to legacy metadata when the canonical read is denied", () => {
    const root = getScratch("canonical-denied");
    const agentId = "impl-canonical-denied";
    const canonicalPath = join(root, "runtime", `agent-${agentId}.json`);
    const legacyPath = join(root, "runtime", `${agentId}.json`);
    mkdirSync(join(root, "runtime"), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify(metadata(agentId)), "utf-8");
    const denied = Object.create(null) as { code?: string; message?: string };
    Object.defineProperty(denied, "code", { value: "EACCES" });
    Object.defineProperty(denied, "message", { value: "access denied" });
    const restore = setAgentMetadataDependenciesForTesting({
      readFile(path, encoding) {
        if (path === canonicalPath) throw denied;
        return readFileSync(path, encoding);
      },
    });

    try {
      expect(() => findAgentMetadataLocation(agentId, root)).toThrow(HarnessError);
    } finally {
      restore();
    }
  });
});
