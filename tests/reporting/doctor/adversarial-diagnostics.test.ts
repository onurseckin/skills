import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDoctorDiagnostics } from "../../../olt/scripts/src/reporting/doctor/adversarial-doctor/diagnostics.ts";
import type { HarnessHealthCheck } from "../../../olt/scripts/src/reporting/doctor/adversarial-doctor/types.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";

describe("adversarial-doctor diagnostics coverage", () => {
  it("evaluates bun runtime version check correctly (pass, fail, and disabled)", async () => {
    const checksPass = await runDoctorDiagnostics({ minimumBunVersion: "0.1.0" });
    const bunPass = checksPass.find((c) => c.name === "bun_runtime_version");
    expect(bunPass?.status).toBe("pass");
    expect(bunPass?.passed).toBe(true);

    const checksFail = await runDoctorDiagnostics({ minimumBunVersion: "99.9.9" });
    const bunFail = checksFail.find((c) => c.name === "bun_runtime_version");
    expect(bunFail?.status).toBe("fail");
    expect(bunFail?.passed).toBe(false);
    expect(bunFail?.remediation).toContain("Upgrade Bun");

    const checksDisabled = await runDoctorDiagnostics({ checkBunVersion: false });
    expect(checksDisabled.find((c) => c.name === "bun_runtime_version")).toBeUndefined();
  });

  it("audits capsule root confinement (pass, fail, and exception branches)", async () => {
    const tempRoot = join(tmpdir(), `test-diag-root-${Date.now()}`);
    const repoRoot = join(tempRoot, "repo");
    const validRun = join(repoRoot, ".olt", "capsules", "run-1");
    const invalidRun = join(tempRoot, "outside", "run-2");
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    mkdirSync(validRun, { recursive: true });
    mkdirSync(invalidRun, { recursive: true });

    try {
      const pass = await runDoctorDiagnostics({
        checkBunVersion: false,
        runRoot: validRun,
        repoRoot,
      });
      const rootPass = pass.find((c) => c.name === "capsule_root_confinement");
      expect(rootPass?.status).toBe("pass");

      const fail = await runDoctorDiagnostics({
        checkBunVersion: false,
        runRoot: invalidRun,
        repoRoot,
      });
      const rootFail = fail.find((c) => c.name === "capsule_root_confinement");
      expect(rootFail?.status).toBe("fail");
      expect(rootFail?.remediation).toBeDefined();

      const skipped = await runDoctorDiagnostics({
        checkCapsuleRoot: false,
        runRoot: invalidRun,
      });
      expect(skipped.find((c) => c.name === "capsule_root_confinement")).toBeUndefined();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("audits unified evidence locations (pass, fail, and exception branches)", async () => {
    const tempDir = join(tmpdir(), `test-diag-ev-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      const statePass = {
        tasks: {
          t1: {
            validations: [{ findings: [{ evidence: [{ path: "evidence/test.png" }] }] }],
          },
        },
      };
      const pass = await runDoctorDiagnostics({
        checkBunVersion: false,
        runRoot: tempDir,
        state: statePass,
      });
      const evPass = pass.find((c) => c.name === "unified_evidence_location");
      expect(evPass?.status).toBe("pass");

      const stateFail = {
        tasks: {
          t2: {
            validations: [{ findings: [{ evidence: [{ path: "/var/tmp/bad-evidence.png" }] }] }],
          },
        },
      };
      const fail = await runDoctorDiagnostics({
        checkBunVersion: false,
        runRoot: tempDir,
        state: stateFail,
      });
      const evFail = fail.find((c) => c.name === "unified_evidence_location");
      expect(evFail?.status).toBe("fail");
      expect(evFail?.remediation).toBeDefined();

      const throwingState = new Proxy(
        {},
        {
          get() {
            throw new Error("Evidence inspection failure");
          },
        },
      );
      const exc = await runDoctorDiagnostics({
        checkBunVersion: false,
        runRoot: tempDir,
        state: throwingState,
      });
      const evExc = exc.find((c) => c.name === "unified_evidence_location");
      expect(evExc?.status).toBe("fail");
      expect(evExc?.message).toContain("Evidence inspection failure");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("audits tier confinement isolation (pass, fail, and exception branches)", async () => {
    const tempDir = join(tmpdir(), `test-diag-tier-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      const cleanState = { grants: {}, commands: {}, tasks: {} };
      const pass = await runDoctorDiagnostics({
        checkBunVersion: false,
        runRoot: tempDir,
        state: cleanState,
      });
      const tierPass = pass.find((c) => c.name === "tier_confinement_isolation");
      expect(tierPass?.status).toBe("pass");

      const contaminatedState = {
        commands: {
          cmd1: {
            id: "cmd1",
            actor: "orch-lead",
            tool: "write_to_file",
            argv: ["write_to_file", "foo.ts"],
          },
        },
        tasks: {},
      };
      const fail = await runDoctorDiagnostics({
        checkBunVersion: false,
        runRoot: tempDir,
        state: contaminatedState,
      });
      const tierFail = fail.find((c) => c.name === "tier_confinement_isolation");
      expect(tierFail?.status).toBe("fail");
      expect(tierFail?.remediation).toBeDefined();

      const throwingState = new Proxy(
        {},
        {
          get() {
            throw new Error("Tier confinement crash");
          },
        },
      );
      const exc = await runDoctorDiagnostics({
        checkBunVersion: false,
        runRoot: tempDir,
        state: throwingState,
      });
      const tierExc = exc.find((c) => c.name === "tier_confinement_isolation");
      expect(tierExc?.status).toBe("fail");
      expect(tierExc?.message).toContain("Tier confinement crash");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("audits capsule state integrity and runs custom health checks", async () => {
    const tempDir = join(tmpdir(), `test-diag-integ-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      const runDir = initRun(tempDir, "run-valid", new Uint8Array(), "file", true);
      const passInteg = await runDoctorDiagnostics({
        checkBunVersion: false,
        runRoot: runDir,
      });
      const integCheck = passInteg.find((c) => c.name === "capsule_state_integrity");
      expect(integCheck?.status).toBe("pass");

      const customCheckPass: HarnessHealthCheck = {
        name: "custom_ok",
        category: "custom",
        status: "pass",
        passed: true,
        message: "All good",
      };
      const customChecks = [
        async () => customCheckPass,
        async () => {
          throw new Error("Simulated custom check crash");
        },
      ];
      const withCustom = await runDoctorDiagnostics({
        checkBunVersion: false,
        runRoot: tempDir,
        customChecks,
      });

      const okCheck = withCustom.find((c) => c.name === "custom_ok");
      expect(okCheck?.passed).toBe(true);
      const thrownCheck = withCustom.find((c) => c.name === "custom_diagnostic_check");
      expect(thrownCheck?.status).toBe("fail");
      expect(thrownCheck?.message).toContain("Simulated custom check crash");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
