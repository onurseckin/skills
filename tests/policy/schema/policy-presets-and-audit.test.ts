import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupVirtualPolicyFS, setupVirtualPolicyFS } from "../fixture.ts";
import {
  AuditTrailWriter,
  PolicyEngineTelemetryCollector,
  SecurityAuditLogger,
  ViolationAlertDispatcher,
} from "../../../olt/scripts/src/policy/audit/index.ts";
import {
  getCargoPresets,
  getPythonPresets,
  getUnknownPresets,
} from "../../../olt/scripts/src/policy/generator/toolchain-presets.ts";
import {
  readMakefile,
  readPackageJson,
  readPythonManifests,
  readTurboJson,
} from "../../../olt/scripts/src/policy/generator/manifest-readers.ts";
import { inspectRepoPolicy, loadRepoPolicy } from "../../../olt/scripts/src/policy/repo-policy.ts";
import { detectRepoEcosystem } from "../../../olt/scripts/src/policy/generator/index.ts";

import {
  isKnownTestRunner,
  isTargetTestArgument,
  isUntargetedTestCommand,
} from "../../../olt/scripts/src/policy/rbac/test-runners.ts";

describe("Policy Presets, Manifest Readers, Audit, Telemetry & RBAC Runners Comprehensive", () => {
  const scratchBase = "/virtual/policy/schema/presets-audit";

  beforeEach(() => {
    setupVirtualPolicyFS();
  });

  afterEach(() => {
    cleanupVirtualPolicyFS();
  });

  test("toolchain presets returns ecosystem analysis structures", () => {
    const cargo = getCargoPresets();
    expect(cargo.ecosystem).toBe("cargo");
    expect(cargo.packageManager).toBe("cargo");
    expect(cargo.typecheckCommand).toBe("cargo check");

    const python = getPythonPresets();
    expect(python.ecosystem).toBe("python");
    expect(python.packageManager).toBe("pip");
    expect(python.typecheckCommand).toBe("mypy .");

    const unknown = getUnknownPresets();
    expect(unknown.ecosystem).toBe("unknown");
    expect(unknown.allowedCommands.length).toBeGreaterThan(0);
  });

  test("manifest readers handle valid, invalid, and missing files", () => {
    const scratch = join(scratchBase, "manifest-readers");
    mkdirSync(scratch, { recursive: true });

    // package.json
    expect(readPackageJson(scratch).exists).toBe(false);
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify({
        name: "my-pkg",
        scripts: { test: "vitest" },
        dependencies: { react: "^18" },
      }),
      "utf-8",
    );
    const pkg = readPackageJson(scratch);
    expect(pkg.exists).toBe(true);
    expect(pkg.hasScript("test")).toBe(true);
    expect(pkg.hasDep("react")).toBe(true);

    // turbo.json
    expect(readTurboJson(scratch).exists).toBe(false);
    writeFileSync(
      join(scratch, "turbo.json"),
      JSON.stringify({ pipeline: { build: { dependsOn: ["^build"] } } }),
      "utf-8",
    );
    const turbo = readTurboJson(scratch);
    expect(turbo.exists).toBe(true);
    expect(turbo.hasTask("build")).toBe(true);

    // Python manifests
    expect(readPythonManifests(scratch).hasPyproject).toBe(false);
    writeFileSync(
      join(scratch, "pyproject.toml"),
      '[project]\nname = "my-py-proj"\n[tool.ruff]\n',
      "utf-8",
    );
    writeFileSync(join(scratch, "requirements.txt"), "pytest>=7.0.0\nmypy\n", "utf-8");
    const py = readPythonManifests(scratch);
    expect(py.hasPyproject).toBe(true);
    expect(py.hasRequirements).toBe(true);
    expect(py.usesRuff).toBe(true);
    expect(py.usesPytest).toBe(true);
    expect(py.usesMypy).toBe(true);

    // Makefile
    expect(readMakefile(scratch).exists).toBe(false);
    writeFileSync(join(scratch, "Makefile"), "build:\n\techo build\ntest:\n\techo test\n", "utf-8");
    const makefile = readMakefile(scratch);
    expect(makefile.exists).toBe(true);
    expect(makefile.hasTarget("build")).toBe(true);
    expect(makefile.hasTarget("test")).toBe(true);
  });

  test("AuditTrailWriter, SecurityAuditLogger, TelemetryCollector, ViolationAlertDispatcher lifecycle", async () => {
    const scratch = join(scratchBase, "audit-system");
    mkdirSync(scratch, { recursive: true });
    const auditFile = join(scratch, "audit.jsonl");

    const logger = new SecurityAuditLogger({
      writerOptions: { logFilePath: auditFile, maxInMemoryEvents: 50 },
    });

    // Record various events
    await logger.logRbacDecision({
      actor: { id: "worker-1", role: "implementer" },
      command: "bun test",
      allowed: false,
      reason: "supervisory constraint",
    });

    await logger.logEnforcementAction({
      actor: { id: "worker-1", role: "implementer" },
      actionType: "file_density",
      allowed: true,
      target: "src/app.ts",
    });

    const recent = logger.queryAuditTrail({ limit: 10 });
    expect(recent.length).toBeGreaterThan(0);
    expect(logger.verifyAuditIntegrity().valid).toBe(true);

    const snapshot = logger.getTelemetry();
    expect(snapshot.totalEvaluations).toBe(2);

    logger.resetTelemetry();
    expect(logger.getTelemetry().totalEvaluations).toBe(0);

    logger.clearAuditTrail();
    expect(logger.queryAuditTrail().length).toBe(0);
  });

  test("test runners detection across tools and patterns", () => {
    expect(isKnownTestRunner(["vitest", "run"])).toBe(true);
    expect(isKnownTestRunner(["jest"])).toBe(true);
    expect(isKnownTestRunner(["pytest", "-v"])).toBe(true);
    expect(isKnownTestRunner(["cargo", "test"])).toBe(true);
    expect(isKnownTestRunner(["bun", "test"])).toBe(true);
    expect(isKnownTestRunner(["echo", "hello"])).toBe(false);

    expect(isTargetTestArgument("tests/policy/a.test.ts")).toBe(true);
    expect(isTargetTestArgument("--coverage")).toBe(false);

    expect(isUntargetedTestCommand("vitest")).toBe(true);
    expect(isUntargetedTestCommand("vitest tests/a.test.ts")).toBe(false);
  });
});
