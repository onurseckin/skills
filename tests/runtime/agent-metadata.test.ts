import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  createAgentMetadata,
  findAgentMetadataLocation,
  getAgentMetadataPath,
  setAgentMetadataDependenciesForTesting,
  writeAgentMetadata,
} from "../../olt/scripts/src/runtime/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const caller = import.meta.path;

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

describe("agent metadata discovery", () => {
  it("keeps explicit uncreated run roots when generating metadata paths", () => {
    const root = "./run-does-not-exist";

    expect(getAgentMetadataPath("impl-uncreated", root)).toBe(
      join(resolve(root), "runtime", "agent-impl-uncreated.json"),
    );
  });

  it("refuses a symlinked canonical metadata file without changing its external target", () => {
    const root = scratchRoot(caller, "metadata-final-symlink");
    const agentId = "impl-final-symlink";
    const runtime = join(root, "runtime");
    const external = join(root, "external-sentinel.json");
    const target = join(runtime, `agent-${agentId}.json`);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(external, "sentinel", "utf8");
    symlinkSync(external, target);

    expect(() =>
      writeAgentMetadata(createAgentMetadata({ agent_id: agentId, role: "implementer" }), root),
    ).toThrow(HarnessError);
    expect(readFileSync(external, "utf8")).toBe("sentinel");
  });

  it("refuses a symlinked runtime directory without changing its external target", () => {
    const root = scratchRoot(caller, "metadata-runtime-symlink");
    const agentId = "impl-runtime-symlink";
    const externalRuntime = join(root, "external-runtime");
    const runtime = join(root, "runtime");
    const externalFile = join(externalRuntime, `agent-${agentId}.json`);
    mkdirSync(externalRuntime, { recursive: true });
    writeFileSync(externalFile, "sentinel", "utf8");
    symlinkSync(externalRuntime, runtime);

    expect(() =>
      writeAgentMetadata(createAgentMetadata({ agent_id: agentId, role: "implementer" }), root),
    ).toThrow(HarnessError);
    expect(readFileSync(externalFile, "utf8")).toBe("sentinel");
  });

  it("refuses canonical and legacy hard-linked metadata without changing the external inode", () => {
    const root = scratchRoot(caller, "metadata-hard-links");
    const runtime = join(root, "runtime");
    mkdirSync(runtime, { recursive: true });
    for (const [agentId, name] of [
      ["impl-canonical-hard-link", "agent-impl-canonical-hard-link.json"],
      ["impl-legacy-hard-link", "impl-legacy-hard-link.json"],
    ]) {
      const external = join(root, `external-${agentId}.json`);
      const bytes = JSON.stringify(metadata(agentId));
      writeFileSync(external, bytes, "utf8");
      linkSync(external, join(runtime, name));

      expect(() => findAgentMetadataLocation(agentId, root)).toThrow(HarnessError);
      expect(() =>
        writeAgentMetadata(createAgentMetadata({ agent_id: agentId, role: "implementer" }), root),
      ).toThrow(HarnessError);
      expect(readFileSync(external, "utf8")).toBe(bytes);
    }
  });

  it("rejects cyclic metadata before creating a runtime directory or partial metadata file", () => {
    const root = scratchRoot(caller, "metadata-serialization");
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
    const root = scratchRoot(caller, "corrupt-preferred");
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
    const root = scratchRoot(caller, "mismatched-agent-id");
    writeMetadata(root, "impl-requested", metadata("impl-other"));

    expect(() => findAgentMetadataLocation("impl-requested", root)).toThrow(HarnessError);
  });

  it("returns undefined when neither exact filename exists in a preferred run", () => {
    const root = scratchRoot(caller, "missing-preferred");

    expect(findAgentMetadataLocation("impl-missing", root)).toBeUndefined();
  });

  it("uses a legacy filename only after the canonical file is genuinely absent", () => {
    const root = scratchRoot(caller, "legacy-only");
    const legacyPath = join(root, "runtime", "impl-legacy.json");
    mkdirSync(join(root, "runtime"), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify(metadata("impl-legacy")), "utf-8");

    expect(findAgentMetadataLocation("impl-legacy", root)?.filePath).toBe(legacyPath);
  });

  it("uses legacy metadata only after a genuine Error ENOENT from the canonical read", () => {
    const root = scratchRoot(caller, "trusted-canonical-enoent");
    const agentId = "impl-trusted-enoent";
    const canonicalPath = join(root, "runtime", `agent-${agentId}.json`);
    const legacyPath = join(root, "runtime", `${agentId}.json`);
    mkdirSync(join(root, "runtime"), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify(metadata(agentId)), "utf-8");
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const restore = setAgentMetadataDependenciesForTesting({
      readFile(path, encoding) {
        if (path === canonicalPath) throw missing;
        return readFileSync(path, encoding);
      },
    });

    try {
      expect(findAgentMetadataLocation(agentId, root)?.filePath).toBe(legacyPath);
    } finally {
      restore();
    }
  });

  it("rejects ambiguous ENOENT-shaped canonical errors without legacy fallback", () => {
    const root = scratchRoot(caller, "untrusted-canonical-enoent");
    const agentId = "impl-untrusted-enoent";
    const canonicalPath = join(root, "runtime", `agent-${agentId}.json`);
    const legacyPath = join(root, "runtime", `${agentId}.json`);
    mkdirSync(join(root, "runtime"), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify(metadata(agentId)), "utf-8");

    const inherited = Object.create({ code: "ENOENT" });
    Object.defineProperty(inherited, "message", { value: "inherited code" });
    let getterRead = false;
    const accessor = {};
    Object.defineProperty(accessor, "code", {
      get() {
        getterRead = true;
        return "ENOENT";
      },
    });
    let messageGetterRead = false;
    const messageAccessor = { code: "ENOENT" };
    Object.defineProperty(messageAccessor, "message", {
      get() {
        messageGetterRead = true;
        return "missing";
      },
    });
    const proxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("descriptor trap");
        },
      },
    );
    const failures: ReadonlyArray<readonly [string, unknown]> = [
      ["plain object", { code: "ENOENT" }],
      ["inherited code", inherited],
      ["accessor code", accessor],
      ["accessor message", messageAccessor],
      ["proxy descriptor trap", proxy],
    ];

    for (const [label, failure] of failures) {
      let legacyReads = 0;
      const restore = setAgentMetadataDependenciesForTesting({
        readFile(path, encoding) {
          if (path === canonicalPath) throw failure;
          if (path === legacyPath) legacyReads += 1;
          return readFileSync(path, encoding);
        },
      });
      try {
        expect(() => findAgentMetadataLocation(agentId, root)).toThrow(HarnessError);
        expect(legacyReads).toBe(0);
      } finally {
        restore();
      }
    }
    expect(getterRead).toBe(false);
    expect(messageGetterRead).toBe(false);
  });

  it("rejects malformed authority fields before exposing preferred metadata", () => {
    const root = scratchRoot(caller, "malformed-authority");
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
    const root = scratchRoot(caller, "unreadable-preferred");
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
    const root = scratchRoot(caller, "canonical-denied");
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

  it("rejects duplicate matches regardless of capsule enumeration order", () => {
    const root = scratchRoot(caller, "duplicate-capsules");
    const capsules = join(root, "capsules");
    const scratch = join(root, "scratch");
    const agentId = "impl-duplicate";
    writeMetadata(join(capsules, "a"), agentId, metadata(agentId));
    writeMetadata(join(capsules, "b"), agentId, metadata(agentId));

    const discover = (reverse: boolean): string => {
      const restore = setAgentMetadataDependenciesForTesting({
        findRepoRoot: () => root,
        resolveCapsulesDir: () => capsules,
        resolveScratchDir: () => scratch,
        readDirectory(path, options) {
          const entries = readdirSync(path, options);
          return reverse ? entries.reverse() : entries;
        },
      });
      try {
        findAgentMetadataLocation(agentId);
        return "missing ambiguity error";
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).code).toBe("INTEGRITY");
        return (error as HarnessError).message;
      } finally {
        restore();
      }
    };

    const forward = discover(false);
    const reverse = discover(true);
    expect(forward).toContain("ambiguous");
    expect(reverse).toBe(forward);
  });

  it("wraps malformed injected capsule entries as integrity failures", () => {
    const root = scratchRoot(caller, "malformed-capsule-entry");
    const capsules = join(root, "capsules");
    const malformedEntry = {
      name: "bad-entry",
      isDirectory() {
        throw new Error("malformed dirent");
      },
    };
    const restore = setAgentMetadataDependenciesForTesting({
      findRepoRoot: () => root,
      resolveCapsulesDir: () => capsules,
      resolveScratchDir: () => join(root, "scratch"),
      readDirectory: () => [malformedEntry as unknown as import("node:fs").Dirent],
    });

    try {
      expect(() => findAgentMetadataLocation("impl-malformed-dirent")).toThrow(HarnessError);
    } finally {
      restore();
    }
  });

  it("binds a preferred run even when another discovered run has the same agent", () => {
    const root = scratchRoot(caller, "preferred-wins");
    const capsules = join(root, "capsules");
    const scratch = join(root, "scratch");
    const preferred = join(root, "explicit-run");
    const agentId = "impl-preferred";
    writeMetadata(join(capsules, "first"), agentId, metadata(agentId));
    writeMetadata(join(capsules, "second"), agentId, metadata(agentId));
    const preferredPath = writeMetadata(preferred, agentId, metadata(agentId));
    const restore = setAgentMetadataDependenciesForTesting({
      findRepoRoot: () => root,
      resolveCapsulesDir: () => capsules,
      resolveScratchDir: () => scratch,
    });

    try {
      const found = findAgentMetadataLocation(agentId, preferred);
      expect(found?.runRoot).toBe(resolve(preferred));
      expect(found?.filePath).toBe(preferredPath);
    } finally {
      restore();
    }
  });
});
