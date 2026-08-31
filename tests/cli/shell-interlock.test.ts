import { describe, expect, test } from "bun:test";
import {
  existsSync,
  fsyncSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  persistStandaloneReceipt,
  setShellCommandDependenciesForTesting,
  shellCommand,
} from "../../olt/scripts/src/cli/commands/shell.ts";
import { runExecCommand } from "../../olt/scripts/src/cli/commands/run-ops.ts";
import { scopeExpandCommand } from "../../olt/scripts/src/cli/commands/scope-expand.ts";
import {
  checkReadScopeAuthorization,
  isWithinNeighborhood,
} from "../../olt/scripts/src/runtime/read-scope-guard.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  createAgentMetadata,
  getAgentMetadataPath,
  writeAgentMetadata,
} from "../../olt/scripts/src/runtime/index.ts";
import { workflowPort } from "../../olt/scripts/src/integration/store-ports.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

function registerStandaloneActor(actor: string, role: string): void {
  writeAgentMetadata(
    createAgentMetadata({
      agent_id: actor,
      role,
      can_execute_shell: role === "implementer",
    }),
  );
}

describe("CLI Shell Interlock & Read Scope Expansion", () => {
  describe("shellCommand", () => {
    test("instantly blocks un-targeted whole-repo test run for implementer", async () => {
      registerStandaloneActor("imp-test", "implementer");
      let thrown: unknown;
      try {
        await shellCommand({ actor: "imp-test", role: "implementer" }, {}, ["bun", "test"]);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(HarnessError);
      const harnessErr = thrown as HarnessError;
      expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(harnessErr.message).toContain("[UNBOUNDED_TEST_RUNNER_FORBIDDEN]");
      expect(harnessErr.message).toContain("Un-targeted whole-repo test run detected");
    });

    test("instantly blocks cognitive validator from running any shell commands", async () => {
      registerStandaloneActor("val-test", "validator");
      let thrown: unknown;
      try {
        await shellCommand({ actor: "val-test", role: "validator" }, {}, ["git", "status"]);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(HarnessError);
      const harnessErr = thrown as HarnessError;
      expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(harnessErr.message).toContain("[COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN]");
      expect(harnessErr.message).toContain(
        "Cognitive Validators are locked to 0 command execution",
      );
    });

    test("instantly blocks unshielded subshells and chaining attempts", async () => {
      registerStandaloneActor("imp-test", "implementer");
      let thrownSh: unknown;
      try {
        await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
          "sh",
          "-c",
          "bun test",
        ]);
      } catch (err) {
        thrownSh = err;
      }
      expect(thrownSh).toBeInstanceOf(HarnessError);
      expect((thrownSh as HarnessError).message).toContain("[UNSHIELDED_COMMAND_DEFECT]");

      let thrownChain: unknown;
      try {
        await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
          "git",
          "status",
          "&&",
          "git",
          "push",
        ]);
      } catch (err) {
        thrownChain = err;
      }
      expect(thrownChain).toBeInstanceOf(HarnessError);
      expect((thrownChain as HarnessError).message).toContain("[UNSHIELDED_COMMAND_DEFECT]");
    });

    test("executes authorized diagnostic command and outputs cryptographic receipt with evidence file", async () => {
      registerStandaloneActor("imp-test", "implementer");
      const result = await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
        "echo",
        "harness-shell-ok",
      ]);

      expect(result.exit_code).toBe(0);
      expect(result.command).toBe("echo harness-shell-ok");
      expect(result.receipt_sha256).toBeDefined();
      expect(result.receipt_sha256.length).toBe(64);
      expect(result.evidence_path).toBeDefined();
      expect(result.markdown).toContain("### Shell Execution Receipt");
      expect(result.markdown).toContain("harness-shell-ok");
      expect(result.markdown).toContain("Cryptographic Receipt SHA-256");
      expect(result.markdown).toContain("Evidence Receipt Path");
      expect(statSync(result.evidence_path!).mode & 0o777).toBe(0o600);
    });

    test("preserves a prior receipt and removes the exclusive temporary file on pre-rename failure", () => {
      const evidenceDir = mkdtempSync(join(tmpdir(), "shell-receipt-pre-rename-"));
      const receiptPath = join(evidenceDir, "receipt.json");
      try {
        const priorBody = "prior-receipt\n";
        writeFileSync(receiptPath, priorBody, "utf-8");
        const restore = setShellCommandDependenciesForTesting({
          fsyncSync: () => {
            throw new Error("forced pre-rename fsync failure");
          },
        });
        try {
          expect(() => persistStandaloneReceipt(evidenceDir, receiptPath, "new-receipt\n")).toThrow(
            "receipt persistence failed before atomic rename",
          );
        } finally {
          restore();
        }
        expect(readFileSync(receiptPath, "utf-8")).toBe(priorBody);
        expect(readdirSync(evidenceDir)).toEqual(["receipt.json"]);
      } finally {
        rmSync(evidenceDir, { recursive: true, force: true });
      }
    });

    test("reports outcome uncertainty and removes no temporary file after post-rename failure", () => {
      const evidenceDir = mkdtempSync(join(tmpdir(), "shell-receipt-post-rename-"));
      const receiptPath = join(evidenceDir, "receipt.json");
      try {
        let fsyncCalls = 0;
        const restore = setShellCommandDependenciesForTesting({
          fsyncSync: (fd) => {
            fsyncCalls += 1;
            if (fsyncCalls === 2) throw new Error("forced directory fsync failure");
            fsyncSync(fd);
          },
        });
        try {
          expect(() =>
            persistStandaloneReceipt(evidenceDir, receiptPath, "durable-receipt\n"),
          ).toThrow("receipt persistence outcome uncertain after atomic rename");
        } finally {
          restore();
        }
        expect(readFileSync(receiptPath, "utf-8")).toBe("durable-receipt\n");
        expect(readdirSync(evidenceDir)).toEqual(["receipt.json"]);
      } finally {
        rmSync(evidenceDir, { recursive: true, force: true });
      }
    });

    test("throws INVALID_ARGUMENT when remainder is empty", async () => {
      let thrown: unknown;
      try {
        await shellCommand({ actor: "imp-test", role: "implementer" }, {}, []);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(HarnessError);
      expect((thrown as HarnessError).code).toBe("INVALID_ARGUMENT");
      expect((thrown as HarnessError).message).toContain(
        "shell command requires an executable command",
      );
    });

    test("refuses a standalone gate before it can execute", async () => {
      registerStandaloneActor("imp-standalone-gate", "implementer");

      await expect(
        shellCommand({ actor: "imp-standalone-gate", role: "implementer", gate: "G-1" }, {}, [
          "echo",
          "must-not-run",
        ]),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    test("refuses unknown capsule gate before recording command evidence", async () => {
      const { setupCompiledRun } = await import("./task-ops-fixture.ts");
      const { writeAgentMetadata, createAgentMetadata } =
        await import("../../../olt/scripts/src/runtime/index.ts");
      const { join } = await import("node:path");
      const { run: runRoot } = await setupCompiledRun("shell-unknown-gate", []);
      writeAgentMetadata(
        createAgentMetadata({
          agent_id: "impl-shell-unknown-gate",
          role: "implementer",
          write_scope: ["src/"],
          can_execute_shell: true,
        }),
        runRoot,
      );

      await expect(
        shellCommand(
          {
            actor: "impl-shell-unknown-gate",
            role: "implementer",
            run: runRoot,
            task: "missing-task",
            gate: "G-1",
          },
          {},
          ["echo", "must-not-run"],
        ),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(readdirSync(join(runRoot, "commands"))).toEqual([]);
    });

    test("formats stderr in standalone direct execution when command writes to stderr", async () => {
      registerStandaloneActor("imp-test", "implementer");
      const result = await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
        "git",
        "diff",
        "--no-index",
        "package.json",
        ".missing-shell-interlock-input",
      ]);

      expect(result.exit_code).not.toBe(0);
      expect(result.markdown).toContain("#### Stderr (last lines):");
    });

    test("refuses unknown standalone authority even when --role claims implementer", async () => {
      const actor = "impl-no-durable-grant";
      const metadataPath = getAgentMetadataPath(actor);
      expect(existsSync(metadataPath)).toBe(false);
      await expect(
        shellCommand({ actor, role: "implementer" }, {}, ["echo", "must-not-run"]),
      ).rejects.toMatchObject({ code: "ROLE_CONFINEMENT_VIOLATION" });
      expect(existsSync(metadataPath)).toBe(false);
    });

    test("treats --role only as a consistency assertion against durable metadata", async () => {
      registerStandaloneActor("impl-role-assertion", "implementer");
      await expect(
        shellCommand({ actor: "impl-role-assertion", role: "validator" }, {}, ["echo", "nope"]),
      ).rejects.toMatchObject({ code: "ROLE_CONFINEMENT_VIOLATION" });
    });

    test("records task-only command evidence through the capsule lifecycle", async () => {
      const { join } = await import("node:path");
      const { writeFile } = await import("node:fs/promises");
      const { execute } = await import("../../../olt/scripts/src/cli/execute.ts");
      const { scratchRoot } = await import("../shared/scratch-root.ts");

      const scratch = scratchRoot(import.meta.path, "shell-capsule-run");
      const promptPath = join(scratch, "prompt.txt");
      await writeFile(promptPath, "Test prompt for capsule shell command");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(scratch, "src/task01"), { recursive: true });
      await writeFile(join(scratch, "gate.ts"), "console.log('pass');\n");

      const init = await execute([
        "plan:init",
        "--repo",
        scratch,
        "--run",
        "shell-run-01",
        "--prompt-file",
        promptPath,
      ]);
      const runRoot = init.run_root as string;

      await execute([
        "plan:add",
        "--run",
        runRoot,
        "--id",
        "task-01",
        "--label",
        "Task 01",
        "--scope",
        "src/task01",
        "--gate",
        "bun gate.ts",
        "--actor",
        "planner",
      ]);
      await execute(["plan:brainstorm", "--run", runRoot, "--actor", "planner"]);
      await execute([
        "plan:compile",
        "--run",
        runRoot,
        "--actor",
        "planner",
        "--completion-gate",
        "bun gate.ts",
      ]);
      await execute([
        "agent:register",
        "--run",
        runRoot,
        "--agent",
        "worker-1",
        "--role",
        "implementer",
        "--host",
        "antigravity",
      ]);
      await execute([
        "task:claim",
        "--run",
        runRoot,
        "--task",
        "task-01",
        "--agent",
        "worker-1",
        "--role",
        "implementer",
      ]);

      const { writeAgentMetadata, createAgentMetadata } =
        await import("../../../olt/scripts/src/runtime/index.ts");
      writeAgentMetadata(
        createAgentMetadata({
          agent_id: "worker-1",
          role: "implementer",
          write_scope: ["src/task01"],
          can_execute_shell: true,
        }),
        runRoot,
      );

      let runExecCalls = 0;
      const restore = setShellCommandDependenciesForTesting({
        runExecCommand: async (...args) => {
          runExecCalls += 1;
          return runExecCommand(...args);
        },
      });
      let result: Awaited<ReturnType<typeof shellCommand>>;
      try {
        result = await shellCommand(
          {
            actor: "worker-1",
            role: "implementer",
            run: runRoot,
            cwd: scratch,
            task: "task-01",
            wave: "1",
            "tool-category": "test-runner",
          },
          {},
          ["echo", "capsule-shell-recorded"],
        );
      } finally {
        restore();
      }

      expect(result.exit_code).toBe(0);
      expect(runExecCalls).toBe(1);
      expect(result.command).toBe("echo capsule-shell-recorded");
      expect(result.evidence_path).toBeDefined();
      expect(result.evidence_path).toContain(join(runRoot, "commands"));
      expect(result.markdown).toContain("Command completed successfully");

      const failResult = await shellCommand(
        {
          actor: "worker-1",
          role: "implementer",
          run: runRoot,
          cwd: scratch,
          task: "task-01",
        },
        {},
        ["git", "diff", "--no-index", "prompt.txt", "missing-shell-input"],
      );

      expect(failResult.exit_code).not.toBe(0);
      expect(failResult.markdown).toContain("Command returned non-zero exit code");
    });

    test("delegates gates to run execution lifecycle with canonical output hashes", async () => {
      const { run: runRoot } = await setupCompiledRun("shell-gate-lifecycle", []);
      const actor = "impl-shell-gate-lifecycle";
      writeAgentMetadata(
        createAgentMetadata({
          agent_id: actor,
          role: "implementer",
          write_scope: ["src/"],
          can_execute_shell: true,
        }),
        runRoot,
      );
      const port = workflowPort(runRoot);
      port.transact("test", "shell-gate-setup", {}, (state) => {
        state.tasks["T-1"] = {
          id: "T-1",
          status: "validated",
          requirement_ids: ["R-1"],
          write_scope: ["src/owned"],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
          report: { summary: "shell gate fixture" },
          validations: [
            {
              validator_id: "validator",
              domain: "code-quality",
              token_digest: "digest",
              attempt: 1,
              started_at: "2026-08-01T00:00:00.000Z",
              deadline_at: "2026-08-01T01:00:00.000Z",
              verdict: "pass",
              reviewed_requirement_ids: ["R-1"],
              checks: [],
            },
          ],
        };
        state.requirements = [
          {
            id: "R-1",
            status: "planned",
            evidence: [],
            disposition: "actionable",
            dependencies: [],
          },
        ];
        state.gates = [
          {
            id: "G-1",
            command: ["echo", "gate"],
            cwd: ".",
            scope: "task",
            requirement_ids: ["R-1"],
            mandatory: true,
          },
          {
            id: "G-2",
            command: ["echo", "gate"],
            cwd: ".",
            scope: "task",
            requirement_ids: ["R-1"],
            mandatory: true,
          },
        ];
      });

      await expect(
        shellCommand(
          { actor, role: "implementer", run: runRoot, task: "T-1", gate: "not-applicable" },
          {},
          ["echo", "must-not-run"],
        ),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(Object.values(port.read().commands)).toHaveLength(0);

      const first = await shellCommand(
        { actor, role: "implementer", run: runRoot, task: "T-1", gate: "G-1" },
        {},
        ["echo", "nonempty-shell-output"],
      );
      const firstState = port.read();
      const firstRecord = Object.values(firstState.commands)[0]!;
      expect(firstState.tasks["T-1"]).toMatchObject({
        status: "gating",
        gate_results: [{ gate_id: "G-1", status: "passed" }],
      });
      expect(first.stdout_sha256).toBe(firstRecord.logs?.stdout.sha256);
      expect(first.stdout_sha256).not.toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );

      await expect(
        shellCommand({ actor, role: "implementer", run: runRoot, task: "T-1", gate: "G-1" }, {}, [
          "echo",
          "duplicate-gate",
        ]),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
      expect(Object.values(port.read().commands)).toHaveLength(2);
      expect(port.read().tasks["T-1"]?.gate_results).toHaveLength(1);

      const final = await shellCommand(
        { actor, role: "implementer", run: runRoot, task: "T-1", gate: "G-2" },
        {},
        ["echo", "final-gate"],
      );
      expect(final.exit_code).toBe(0);
      expect(port.read().tasks["T-1"]?.status).toBe("done");
      await expect(
        shellCommand({ actor, role: "implementer", run: runRoot, task: "T-1", gate: "G-2" }, {}, [
          "echo",
          "idempotent-gate",
        ]),
      ).resolves.toMatchObject({ exit_code: 0 });
    });
  });

  describe("scopeExpandCommand", () => {
    test("expands read scope dynamically and records granted path", () => {
      const result = scopeExpandCommand({
        actor: "imp-expand-test",
        read: "src/policy/repo-policy.ts",
      });

      expect(result.actor).toBe("imp-expand-test");
      expect(result.expanded_path).toBe("src/policy/repo-policy.ts");
      expect(result.allowed_read_scope).toContain("src/policy/repo-policy.ts");
      expect(result.markdown).toContain("### Read Scope Expanded");
    });
  });

  describe("read-scope-guard invariants", () => {
    test("prevents unbounded root crossover in isWithinNeighborhood", () => {
      // Disjoint top-level directories: common === 0
      const isNeighborDisjoint = isWithinNeighborhood("docs/plan-92.md", ["src/foo.ts"], 2);
      expect(isNeighborDisjoint).toBe(false);

      const isNeighborTools = isWithinNeighborhood(
        "tools/audit.sh",
        ["src/policy/repo-policy.ts"],
        2,
      );
      expect(isNeighborTools).toBe(false);

      // Shared top-level directory: common >= 1
      const isNeighborPolicy = isWithinNeighborhood(
        "src/runtime/index.ts",
        ["src/policy/repo-policy.ts"],
        2,
      );
      expect(isNeighborPolicy).toBe(true);

      // Deep subtree exceeding max depth
      const isNeighborDeep = isWithinNeighborhood(
        "src/a/b/c/d/deep.ts",
        ["src/policy/repo-policy.ts"],
        2,
      );
      expect(isNeighborDeep).toBe(false);
    });

    test("intercepts path traversal outside repository root with PATH_SAFETY", () => {
      const actor = {
        agent_id: "imp-test",
        role: "implementer",
        tier: 3,
        write_scope: ["src/foo.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const resEsc = checkReadScopeAuthorization(actor, "../../other-dir/shared/secret.json");
      expect(resEsc.authorized).toBe(false);
      expect(resEsc.error_code).toBe("PATH_SAFETY");
      expect(resEsc.message).toContain("[PATH_SAFETY]");
    });

    test("authorizes always-accessible global project files and in-scope files", () => {
      const actor = {
        agent_id: "imp-test",
        role: "implementer",
        tier: 3,
        write_scope: ["src/policy/repo-policy.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const resPkg = checkReadScopeAuthorization(actor, "package.json");
      expect(resPkg.authorized).toBe(true);

      const resPolicy = checkReadScopeAuthorization(actor, "olt/policy.json");
      expect(resPolicy.authorized).toBe(true);

      const resTypes = checkReadScopeAuthorization(actor, "src/types/index.ts");
      expect(resTypes.authorized).toBe(true);
    });
  });

  describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    test("verifies shell-interlock test file contains zero any and zero suppressions", async () => {
      const testContent = await Bun.file(import.meta.path).text();
      const forbiddenAnyRegex = new RegExp(":[ \\t]*" + "any\\b");
      const forbiddenCastRegex = new RegExp("\\bas[ \\t]+" + "any\\b");
      const forbiddenSuppressionsRegex = new RegExp("@ts-" + "(ignore|expect-error|nocheck)");
      const forbiddenLintRegex = new RegExp("(eslint|oxlint)" + "-disable");

      expect(testContent).not.toMatch(forbiddenAnyRegex);
      expect(testContent).not.toMatch(forbiddenCastRegex);
      expect(testContent).not.toMatch(forbiddenSuppressionsRegex);
      expect(testContent).not.toMatch(forbiddenLintRegex);
    });
  });
});
