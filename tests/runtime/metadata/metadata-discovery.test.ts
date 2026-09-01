import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
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

describe("agent metadata discovery (in-memory virtualization)", () => {
  let harness: RuntimeFsHarness;

  beforeEach(() => {
    harness = createRuntimeFsHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it("keeps explicit uncreated run roots when generating metadata paths", () => {
    const root = "./run-does-not-exist";
    expect(getAgentMetadataPath("impl-uncreated", root)).toBe(
      join(resolve(root), "runtime", "agent-impl-uncreated.json"),
    );
  });

  it("refuses a symlinked canonical metadata file without changing its external target", () => {
    const root = "/virtual/runtime/metadata-final-symlink";
    const agentId = "impl-final-symlink";
    const runtime = join(root, "runtime");
    const external = join(root, "external-sentinel.json");
    const target = join(runtime, `agent-${agentId}.json`);

    harness.dirs.add(root);
    harness.dirs.add(runtime);
    harness.files.set(external, "sentinel");
    harness.files.set(target, "sentinel");
    harness.symlinks.add(target);

    expect(() =>
      writeAgentMetadata(createAgentMetadata({ agent_id: agentId, role: "implementer" }), root),
    ).toThrow(HarnessError);
    expect(fs.readFileSync(external, "utf8")).toBe("sentinel");
  });

  it("refuses a symlinked runtime directory without changing its external target", () => {
    const root = "/virtual/runtime/metadata-runtime-symlink";
    const agentId = "impl-runtime-symlink";
    const runtime = join(root, "runtime");

    harness.dirs.add(root);
    harness.dirs.add(runtime);
    harness.symlinks.add(runtime);

    expect(() =>
      writeAgentMetadata(createAgentMetadata({ agent_id: agentId, role: "implementer" }), root),
    ).toThrow(HarnessError);
  });

  it("refuses canonical and legacy hard-linked metadata without changing the external inode", () => {
    const root = "/virtual/runtime/metadata-hard-links";
    const runtime = join(root, "runtime");
    harness.dirs.add(root);
    harness.dirs.add(runtime);

    for (const [agentId, name] of [
      ["impl-canonical-hard-link", "agent-impl-canonical-hard-link.json"],
      ["impl-legacy-hard-link", "impl-legacy-hard-link.json"],
    ]) {
      const external = join(root, `external-${agentId}.json`);
      const target = join(runtime, name);
      const bytes = JSON.stringify(sampleMetadata(agentId));
      harness.files.set(external, bytes);
      harness.files.set(target, bytes);
      harness.fileNlinks.set(target, 2);

      expect(() => findAgentMetadataLocation(agentId, root)).toThrow(HarnessError);
      expect(() =>
        writeAgentMetadata(createAgentMetadata({ agent_id: agentId, role: "implementer" }), root),
      ).toThrow(HarnessError);
      expect(fs.readFileSync(external, "utf8")).toBe(bytes);
    }
  });

  it("returns undefined when neither exact filename exists in a preferred run", () => {
    const root = "/virtual/runtime/missing-preferred";
    harness.dirs.add(root);
    expect(findAgentMetadataLocation("impl-missing", root)).toBeUndefined();
  });

  it("uses a legacy filename only after the canonical file is genuinely absent", () => {
    const root = "/virtual/runtime/legacy-only";
    const legacyPath = join(root, "runtime", "impl-legacy.json");
    harness.dirs.add(root);
    harness.dirs.add(join(root, "runtime"));
    harness.files.set(legacyPath, JSON.stringify(sampleMetadata("impl-legacy")));

    expect(findAgentMetadataLocation("impl-legacy", root)?.filePath).toBe(legacyPath);
  });

  it("uses legacy metadata only after a genuine Error ENOENT from the canonical read", () => {
    const root = "/virtual/runtime/trusted-canonical-enoent";
    const agentId = "impl-trusted-enoent";
    const canonicalPath = join(root, "runtime", `agent-${agentId}.json`);
    const legacyPath = join(root, "runtime", `${agentId}.json`);
    harness.dirs.add(root);
    harness.dirs.add(join(root, "runtime"));
    harness.files.set(legacyPath, JSON.stringify(sampleMetadata(agentId)));
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const restore = setAgentMetadataDependenciesForTesting({
      readFile(path, encoding) {
        if (path === canonicalPath) throw missing;
        return fs.readFileSync(path, encoding);
      },
    });

    try {
      expect(findAgentMetadataLocation(agentId, root)?.filePath).toBe(legacyPath);
    } finally {
      restore();
    }
  });

  it("rejects ambiguous ENOENT-shaped canonical errors without legacy fallback", () => {
    const root = "/virtual/runtime/untrusted-canonical-enoent";
    const agentId = "impl-untrusted-enoent";
    const canonicalPath = join(root, "runtime", `agent-${agentId}.json`);
    const legacyPath = join(root, "runtime", `${agentId}.json`);
    harness.dirs.add(root);
    harness.dirs.add(join(root, "runtime"));
    harness.files.set(legacyPath, JSON.stringify(sampleMetadata(agentId)));

    const inherited = Object.create({ code: "ENOENT" });
    Object.defineProperty(inherited, "message", { value: "inherited code" });
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
      ["proxy descriptor trap", proxy],
    ];

    for (const [, failure] of failures) {
      let legacyReads = 0;
      const restore = setAgentMetadataDependenciesForTesting({
        readFile(path, encoding) {
          if (path === canonicalPath) throw failure;
          if (path === legacyPath) legacyReads += 1;
          return fs.readFileSync(path, encoding);
        },
      });
      try {
        expect(() => findAgentMetadataLocation(agentId, root)).toThrow(HarnessError);
        expect(legacyReads).toBe(0);
      } finally {
        restore();
      }
    }
  });

  it("rejects duplicate matches regardless of capsule enumeration order", () => {
    const root = "/virtual/runtime/duplicate-capsules";
    const capsules = join(root, "capsules");
    const scratch = join(root, "scratch");
    const agentId = "impl-duplicate";
    harness.dirs.add(root);
    harness.dirs.add(capsules);
    harness.dirs.add(scratch);
    writeVirtualMetadata(harness, join(capsules, "a"), agentId, sampleMetadata(agentId));
    writeVirtualMetadata(harness, join(capsules, "b"), agentId, sampleMetadata(agentId));

    const discover = (reverse: boolean): string => {
      const restore = setAgentMetadataDependenciesForTesting({
        findRepoRoot: () => root,
        resolveCapsulesDir: () => capsules,
        resolveScratchDir: () => scratch,
        readDirectory(path, options) {
          const entries = fs.readdirSync(path, options);
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
    const root = "/virtual/runtime/malformed-capsule-entry";
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
    const root = "/virtual/runtime/preferred-wins";
    const capsules = join(root, "capsules");
    const scratch = join(root, "scratch");
    const preferred = join(root, "explicit-run");
    const agentId = "impl-preferred";
    harness.dirs.add(root);
    harness.dirs.add(capsules);
    harness.dirs.add(scratch);
    harness.dirs.add(preferred);
    writeVirtualMetadata(harness, join(capsules, "first"), agentId, sampleMetadata(agentId));
    writeVirtualMetadata(harness, join(capsules, "second"), agentId, sampleMetadata(agentId));
    const preferredPath = writeVirtualMetadata(
      harness,
      preferred,
      agentId,
      sampleMetadata(agentId),
    );
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
