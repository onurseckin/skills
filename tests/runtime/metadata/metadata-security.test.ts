import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  createAgentMetadata,
  findAgentMetadataLocation,
  getAgentMetadataPath,
  setAgentMetadataDependenciesForTesting,
  writeAgentMetadata,
} from "../../../olt/scripts/src/runtime/index.ts";
import {
  createRuntimeFsHarness,
  type RuntimeFsHarness,
  sampleMetadata,
  writeVirtualMetadata,
} from "../fixtures/runtime-fixture.ts";

describe("agent metadata security and validation (in-memory virtualization)", () => {
  let harness: RuntimeFsHarness;

  beforeEach(() => {
    harness = createRuntimeFsHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it("rejects cyclic metadata before creating a runtime directory or partial metadata file", () => {
    const root = "/virtual/runtime/metadata-serialization";
    const agentId = "impl-cyclic";
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const record = createAgentMetadata({
      agent_id: agentId,
      role: "implementer",
      metadata: cyclic,
    });

    expect(() => writeAgentMetadata(record, root)).toThrow(HarnessError);
    expect(fs.existsSync(join(root, "runtime"))).toBe(false);
  });

  it("does not fall through from corrupt preferred metadata", () => {
    const root = "/virtual/runtime/corrupt-preferred";
    const filePath = writeVirtualMetadata(harness, root, "impl-corrupt", "not metadata");

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
    const root = "/virtual/runtime/mismatched-agent-id";
    writeVirtualMetadata(harness, root, "impl-requested", sampleMetadata("impl-other"));

    expect(() => findAgentMetadataLocation("impl-requested", root)).toThrow(HarnessError);
  });

  it("rejects malformed authority fields before exposing preferred metadata", () => {
    const root = "/virtual/runtime/malformed-authority";
    const invalidRecords: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["fractional tier", { ...sampleMetadata("impl-invalid-tier"), tier: 2.5 }],
      ["out of range tier", { ...sampleMetadata("impl-invalid-tier-domain"), tier: 4 }],
      [
        "unsafe tier",
        { ...sampleMetadata("impl-invalid-tier-unsafe"), tier: Number.MAX_SAFE_INTEGER + 1 },
      ],
      [
        "non-string scope entry",
        { ...sampleMetadata("impl-invalid-scope"), write_scope: ["safe", 9] },
      ],
      [
        "non-boolean shell permission",
        { ...sampleMetadata("impl-invalid-shell"), can_execute_shell: "yes" },
      ],
      ["empty run id", { ...sampleMetadata("impl-invalid-run"), run_id: "" }],
      [
        "zero review max",
        {
          ...sampleMetadata("impl-invalid-review-max"),
          review_config: { max_adversarial_pushes: 0, cognitive_pushes: 0 },
        },
      ],
      [
        "fractional review cognitive",
        {
          ...sampleMetadata("impl-invalid-review-cognitive"),
          review_config: { max_adversarial_pushes: 1, cognitive_pushes: 0.5 },
        },
      ],
    ];

    for (const [label, record] of invalidRecords) {
      const agentId = record["agent_id"] as string;
      const subRoot = join(root, label.replaceAll(" ", "-"));
      writeVirtualMetadata(harness, subRoot, agentId, record);
      try {
        findAgentMetadataLocation(agentId, subRoot);
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
    const root = "/virtual/runtime/unreadable-preferred";
    const agentId = "impl-unreadable";
    const filePath = join(root, "runtime", `agent-${agentId}.json`);
    harness.dirs.add(root);
    harness.dirs.add(join(root, "runtime"));
    harness.files.set(filePath, JSON.stringify(sampleMetadata(agentId)));

    const denied = Object.create(null) as { code?: string; message?: string };
    Object.defineProperty(denied, "code", { value: "EACCES" });
    Object.defineProperty(denied, "message", { value: "access denied" });
    const restore = setAgentMetadataDependenciesForTesting({
      readFile(path, encoding) {
        if (path === filePath) throw denied;
        return fs.readFileSync(path, encoding);
      },
    });

    try {
      expect(() => findAgentMetadataLocation(agentId, root)).toThrow(HarnessError);
    } finally {
      restore();
    }
  });

  it("does not fall back to legacy metadata when the canonical read is denied", () => {
    const root = "/virtual/runtime/canonical-denied";
    const agentId = "impl-canonical-denied";
    const canonicalPath = join(root, "runtime", `agent-${agentId}.json`);
    const legacyPath = join(root, "runtime", `${agentId}.json`);
    harness.dirs.add(root);
    harness.dirs.add(join(root, "runtime"));
    harness.files.set(legacyPath, JSON.stringify(sampleMetadata(agentId)));

    const denied = Object.create(null) as { code?: string; message?: string };
    Object.defineProperty(denied, "code", { value: "EACCES" });
    Object.defineProperty(denied, "message", { value: "access denied" });
    const restore = setAgentMetadataDependenciesForTesting({
      readFile(path, encoding) {
        if (path === canonicalPath) throw denied;
        return fs.readFileSync(path, encoding);
      },
    });

    try {
      expect(() => findAgentMetadataLocation(agentId, root)).toThrow(HarnessError);
    } finally {
      restore();
    }
  });
});
