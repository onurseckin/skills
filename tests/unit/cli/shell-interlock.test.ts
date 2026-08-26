import { describe, expect, test } from "bun:test";
import { shellCommand } from "../../../olt/scripts/src/cli/commands/shell.ts";
import { scopeExpandCommand } from "../../../olt/scripts/src/cli/commands/scope-expand.ts";
import {
  checkReadScopeAuthorization,
  isWithinNeighborhood,
} from "../../../olt/scripts/src/runtime/read-scope-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("CLI Shell Interlock & Read Scope Expansion", () => {
  describe("shellCommand", () => {
    test("instantly blocks un-targeted whole-repo test run for implementer", async () => {
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

    test("formats stderr in standalone direct execution when command writes to stderr", async () => {
      const result = await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
        "git",
        "invalid-git-command-for-test",
      ]);

      expect(result.exit_code).not.toBe(0);
      expect(result.markdown).toContain("#### Stderr (last lines):");
    });

    test("executes command under capsule record with --run, --task, --wave, and --gate", async () => {
      const { join } = await import("node:path");
      const { writeFile } = await import("node:fs/promises");
      const { execute } = await import("../../../olt/scripts/src/cli/execute.ts");
      const { scratchRoot } = await import("../../support/scratch-root.ts");

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
        await import("../../../olt/scripts/src/runtime/agent-metadata.ts");
      writeAgentMetadata(
        createAgentMetadata({
          agent_id: "worker-1",
          role: "implementer",
          write_scope: ["src/task01"],
          can_execute_shell: true,
        }),
        runRoot,
      );

      const result = await shellCommand(
        {
          actor: "worker-1",
          role: "implementer",
          run: runRoot,
          cwd: scratch,
          task: "task-01",
          wave: "1",
          gate: "gate-01",
          "tool-category": "test-runner",
        },
        {},
        ["echo", "capsule-shell-recorded"],
      );

      expect(result.exit_code).toBe(0);
      expect(result.command).toBe("echo capsule-shell-recorded");
      expect(result.evidence_path).toBeDefined();
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
        ["git", "invalid-git-subcommand-xyz"],
      );

      expect(failResult.exit_code).not.toBe(0);
      expect(failResult.markdown).toContain("Command failed");
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
        "src/runtime/agent-metadata.ts",
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
