import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  checkRuntimeToolchainSealing,
  isSealedHarnessPath,
  SEALED_TOOLCHAIN_INVARIANT,
  validateWriteScopeSealing,
} from "../../../olt/scripts/src/reporting/doctor/verification/index.ts";
import { buildOltBinaryContent, ensureGlobalOltBinary } from "../../../scripts/sync/olt-bin.ts";
import {
  cleanupVirtualSyncFS,
  getVirtualSyncFS,
  getVirtualSyncSession,
  isSymbolicLink,
  scratchRoot,
  setupVirtualSyncFS,
} from "../sync-fixture.ts";

let vfs: ReturnType<typeof getVirtualSyncFS>;
let session: ReturnType<typeof getVirtualSyncSession>;

beforeEach(() => {
  vfs = setupVirtualSyncFS();
  session = getVirtualSyncSession();
});

afterEach(() => {
  cleanupVirtualSyncFS();
});

describe("buildOltBinaryContent", () => {
  test("generates expected bash wrapper script with multi-path Bun discovery", () => {
    const content = buildOltBinaryContent("/custom/path/harness.ts");
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain('GLOBAL_HARNESS="/custom/path/harness.ts"');
    expect(content).toContain("command -v bun");
    expect(content).toContain("${HOME}/.bun/bin/bun");
    expect(content).toContain("/opt/homebrew/bin/bun");
    expect(content).toContain('exec "${BUN_BIN}" "${GLOBAL_HARNESS}" "$@"');
  });
});

describe("ensureGlobalOltBinary", () => {
  test("creates global binary in target directory if it does not exist", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-create");
    const targetBinDir = join(root, "bin");
    const harnessPath = join(root, "harness.ts");

    const result = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
      harnessPath,
    });

    expect(result.status).toBe("created");
    expect(result.binaryPath).toBe(join(targetBinDir, "olt"));
    expect(vfs.existsSync(result.binaryPath)).toBe(true);

    const content = vfs.readFileSync(result.binaryPath, "utf-8");
    expect(content).toBe(buildOltBinaryContent(harnessPath));
  });

  test("verifies existing binary if content and executable permissions match", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-verify");
    const targetBinDir = join(root, "bin");
    const harnessPath = join(root, "harness.ts");

    // First create
    const firstResult = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
      harnessPath,
    });
    expect(firstResult.status).toBe("created");

    // Second call should verify
    const secondResult = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
      harnessPath,
    });
    expect(secondResult.status).toBe("verified");
    expect(secondResult.binaryPath).toBe(firstResult.binaryPath);
  });

  test("updates existing binary if content differs", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-update-content");
    const targetBinDir = join(root, "bin");
    vfs.mkdirSync(targetBinDir, { recursive: true });
    const binaryPath = join(targetBinDir, "olt");

    // Write outdated content
    vfs.writeFileSync(binaryPath, "#!/bin/bash\necho old\n", { encoding: "utf-8", mode: 0o755 });

    const result = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
      harnessPath: "/new/harness.ts",
    });

    expect(result.status).toBe("updated");
    expect(vfs.readFileSync(binaryPath, "utf-8")).toBe(buildOltBinaryContent("/new/harness.ts"));
  });

  test("updates existing binary if not executable", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-update-chmod");
    const targetBinDir = join(root, "bin");
    vfs.mkdirSync(targetBinDir, { recursive: true });
    const binaryPath = join(targetBinDir, "olt");
    const harnessPath = "/custom/harness.ts";

    vfs.writeFileSync(binaryPath, buildOltBinaryContent(harnessPath), "utf-8");
    session.chmodSync(binaryPath, 0o644); // Not executable

    const result = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
      harnessPath,
    });

    expect(result.status).toBe("updated");
  });

  test("updates binary if existing binary cannot be read or throws error", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-catch-read");
    const targetBinDir = join(root, "bin");
    vfs.mkdirSync(targetBinDir, { recursive: true });
    const binaryPath = join(targetBinDir, "olt");
    vfs.writeFileSync(binaryPath, "old-content", { encoding: "utf-8", mode: 0o000 });
    try {
      session.chmodSync(binaryPath, 0o000);
    } catch {}

    try {
      const result = ensureGlobalOltBinary({
        homeDir: root,
        targetBinDir,
        harnessPath: "/custom/harness.ts",
      });

      expect(result.status).toBe("updated");
    } finally {
      try {
        session.chmodSync(binaryPath, 0o755);
      } catch {}
    }
  });

  test("creates symlink in ~/.bun/bin if directory exists", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-bun");
    const bunBinDir = join(root, ".bun", "bin");
    vfs.mkdirSync(bunBinDir, { recursive: true });

    const targetBinDir = join(root, "bin");
    const result = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
    });

    expect(result.status).toBe("created");
    expect(result.bunBinaryCreated).toBe(true);

    const bunOlt = join(bunBinDir, "olt");
    expect(vfs.existsSync(bunOlt)).toBe(true);
    expect(isSymbolicLink(bunOlt)).toBe(true);
  });

  test("handles existing symlink in ~/.bun/bin gracefully", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-bun-existing");
    const bunBinDir = join(root, ".bun", "bin");
    vfs.mkdirSync(bunBinDir, { recursive: true });

    const targetBinDir = join(root, "bin");
    // Run twice
    ensureGlobalOltBinary({ homeDir: root, targetBinDir });
    const result2 = ensureGlobalOltBinary({ homeDir: root, targetBinDir });

    expect(result2.bunBinaryCreated).toBe(false); // skipped on second run
  });

  test("handles existing directory in ~/.bun/bin gracefully via catch block", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-bun-dir-catch");
    const bunBinDir = join(root, ".bun", "bin");
    vfs.mkdirSync(join(bunBinDir, "olt"), { recursive: true }); // Real directory makes smartEnsureSymlink throw

    const targetBinDir = join(root, "bin");
    const result = ensureGlobalOltBinary({ homeDir: root, targetBinDir });
    expect(result.bunBinaryCreated).toBe(false);
  });

  test("handles default options without throwing", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-defaults");
    const result = ensureGlobalOltBinary({ homeDir: root });
    expect(result.binaryPath).toBe(join(root, ".local", "bin", "olt"));
    expect(vfs.existsSync(result.binaryPath)).toBe(true);
  });
});

describe("bin/olt wrapper script and package.json bin entry", () => {
  test("bin/olt script format and executable permissions in virtual filesystem", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-wrapper");
    const binDir = join(root, "bin");
    const binOltPath = join(binDir, "olt");
    vfs.mkdirSync(binDir, { recursive: true });
    vfs.writeFileSync(
      binOltPath,
      '#!/usr/bin/env bash\nDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nexec bun "${DIR}/../olt/scripts/harness.ts" "$@"\n',
      { mode: 0o755 },
    );
    session.chmodSync(binOltPath, 0o755);

    expect(vfs.existsSync(binOltPath)).toBe(true);
    const stats = session.statSync(binOltPath);
    expect((stats.mode & 0o111) !== 0).toBe(true);

    const content = vfs.readFileSync(binOltPath, "utf-8");
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain('exec bun "${DIR}/../olt/scripts/harness.ts" "$@"');
  });

  test("package.json exposes bin/olt under olt command in virtual filesystem", () => {
    const root = scratchRoot(import.meta.path, "olt-pkg-bin");
    const pkgPath = join(root, "package.json");
    vfs.writeFileSync(
      pkgPath,
      JSON.stringify({
        name: "@onurseckin/skills",
        bin: {
          chat: "./chatroom/cli.ts",
          chatroom: "./chatroom/cli.ts",
          olt: "./bin/olt",
        },
      }),
    );

    expect(vfs.existsSync(pkgPath)).toBe(true);
    const parsed = JSON.parse(vfs.readFileSync(pkgPath, "utf-8")) as {
      bin?: Record<string, string>;
    };
    expect(parsed.bin).toBeDefined();
    expect(parsed.bin?.olt).toBe("./bin/olt");
    expect(parsed.bin?.chat).toBe("./chatroom/cli.ts");
    expect(parsed.bin?.chatroom).toBe("./chatroom/cli.ts");
  });
});

describe("toolchain sealing invariants and runtime-doctor-checker", () => {
  test("identifies sealed harness paths correctly", () => {
    expect(isSealedHarnessPath("olt/scripts/harness.ts")).toBe(true);
    expect(isSealedHarnessPath("olt/scripts/src/cli/execute.ts")).toBe(true);
    expect(isSealedHarnessPath("~/.agents/skills/olt/scripts/harness.ts")).toBe(true);
    expect(isSealedHarnessPath(".agents/skills/something.ts")).toBe(true);

    expect(isSealedHarnessPath("src/index.ts")).toBe(false);
    expect(isSealedHarnessPath("bin/olt")).toBe(false);
    expect(isSealedHarnessPath("package.json")).toBe(false);
  });

  test("validates write scope and blocks workers from editing sealed harness files", () => {
    const permittedScope = ["bin/olt", "package.json", "tests/sync/shell/olt-bin.test.ts"];
    const permittedFindings = validateWriteScopeSealing(permittedScope, "worker-1");
    expect(permittedFindings.length).toBe(0);

    const prohibitedScope = ["src/code.ts", "olt/scripts/harness.ts"];
    const prohibitedFindings = validateWriteScopeSealing(prohibitedScope, "worker-bad");
    expect(prohibitedFindings.length).toBe(1);
    const firstFinding = prohibitedFindings[0];
    expect(firstFinding).toBeDefined();
    if (firstFinding !== undefined) {
      expect(firstFinding.invariant).toBe(SEALED_TOOLCHAIN_INVARIANT);
      expect(firstFinding.severity).toBe("ERROR");
      expect(firstFinding.path).toBe("olt/scripts/harness.ts");
    }
  });

  test("checkRuntimeToolchainSealing verifies repository root and bin/olt integrity using virtual fs", () => {
    const root = scratchRoot(import.meta.path, "olt-doctor-verify");
    const binDir = join(root, "bin");
    const binOltPath = join(binDir, "olt");
    vfs.mkdirSync(binDir, { recursive: true });
    vfs.writeFileSync(binOltPath, '#!/usr/bin/env bash\nexec bun harness.ts "$@"\n', {
      mode: 0o755,
    });
    session.chmodSync(binOltPath, 0o755);

    const result = checkRuntimeToolchainSealing({
      repoRoot: root,
      writeScopes: [["bin/olt", "package.json"]],
      fs: {
        existsSync: (p: string) => vfs.existsSync(p),
        statSync: (p: string) => session.statSync(p),
      },
    });
    expect(result.passed).toBe(true);
    expect(result.invariant).toBe(SEALED_TOOLCHAIN_INVARIANT);
    expect(result.findings.length).toBe(0);
  });

  test("agent manifests declare SEALED_TOOLCHAIN_INVARIANT and instructions in virtual filesystem", () => {
    const root = scratchRoot(import.meta.path, "olt-manifest-verify");
    const manifestPaths = [
      "olt/agents/skill-auditor.yaml",
      "olt/agents/coordinator.yaml",
      "olt/agents/implementer.yaml",
      "olt/agents/validator.yaml",
    ];

    for (const relPath of manifestPaths) {
      const fullPath = join(root, relPath);
      vfs.mkdirSync(join(fullPath, ".."), { recursive: true });
      vfs.writeFileSync(
        fullPath,
        `invariants:\n  - "SEALED_TOOLCHAIN_INVARIANT"\ninstructions: |\n  The OLT harness is an external, sealed execution runtime.\n`,
      );
      expect(vfs.existsSync(fullPath)).toBe(true);
      const content = vfs.readFileSync(fullPath, "utf-8");
      expect(content).toContain("SEALED_TOOLCHAIN_INVARIANT");
      expect(content).toContain("The OLT harness is an external, sealed execution runtime");
    }
  });
});
