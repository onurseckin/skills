import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  setShellCommandDependenciesForTesting,
  shellCommand,
} from "../../../../olt/scripts/src/cli/commands/shell.ts";
import { textFlag } from "../../../../olt/scripts/src/cli/options.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { CommandRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../../olt/scripts/src/runtime/index.ts";
import { workflowPort } from "../../../../olt/scripts/src/integration/store-ports.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../commands/fixtures/full-lifecycle-fixture.ts";

describe("CLI Shell Interlock - Gate Execution", () => {
  let vfs: ReturnType<typeof setupVirtualCliFS>;

  beforeEach(() => {
    vfs = setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
  });

  test("delegates gates to run execution lifecycle with canonical output hashes", async () => {
    const repo = "/virtual/shell-gate-repo";
    vfs.mkdirSync(repo, { recursive: true });
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    const runRoot = initRun(
      repo,
      "shell-gate-lifecycle",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );
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
      state.graph_revision = 1;
      state.tasks["T-1"] = {
        id: "T-1",
        status: "validated",
        requirement_ids: ["R-1"],
        write_scope: ["src/owned"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        bypass_cognitive_pushback: true,
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
        { id: "R-1", status: "planned", evidence: [], disposition: "actionable", dependencies: [] },
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

    let cmdCount = 0;
    const restore = setShellCommandDependenciesForTesting({
      runExecCommand: async (flags, _ctx, argv) => {
        cmdCount += 1;
        const gateId = textFlag(flags, "gate", false);
        const taskId = textFlag(flags, "task", false);
        const p = workflowPort(runRoot);
        const state = p.read();

        const validGates = state.gates.map((g) => g.id);
        if (gateId && !validGates.includes(gateId)) {
          throw new HarnessError("INVALID_ARGUMENT", `unknown gate: ${gateId}`);
        }

        const cmdId = `C-${cmdCount}`;
        const stdoutSha = createHash("sha256").update(argv.join(" ")).digest("hex");
        const record = {
          id: cmdId,
          status: "succeeded",
          exit_code: 0,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          logs: {
            stdout: { sha256: stdoutSha, bytes: 20, path: "stdout.log" },
            stderr: {
              sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
              bytes: 0,
              path: "stderr.log",
            },
          },
        } as unknown as CommandRecord;

        const evidenceFile = join(runRoot, "commands", `${cmdId}.json`);
        vfs.mkdirSync(join(runRoot, "commands"), { recursive: true });
        vfs.writeFileSync(evidenceFile, JSON.stringify(record));

        let isDuplicateError = false;
        p.transact("test", "record-cmd-and-gate", {}, (st) => {
          st.commands[cmdId] = record as unknown as Record<string, unknown>;
          if (taskId && gateId) {
            const taskRecord = st.tasks[taskId];
            if (taskRecord) {
              const existingPassed = (taskRecord.gate_results ?? []).some(
                (r: { gate_id: string; status: string }) =>
                  r.gate_id === gateId && r.status === "passed",
              );
              if (existingPassed) {
                if (taskRecord.status !== "done") {
                  isDuplicateError = true;
                }
              } else {
                taskRecord.status = "gating";
                taskRecord.gate_results = [
                  ...(taskRecord.gate_results ?? []),
                  { gate_id: gateId, status: "passed", command_id: cmdId },
                ];
                const allPassed = state.gates.every((g) =>
                  (taskRecord.gate_results ?? []).some(
                    (r: { gate_id: string; status: string }) =>
                      r.gate_id === g.id && r.status === "passed",
                  ),
                );
                if (allPassed) {
                  taskRecord.status = "done";
                }
              }
            }
          }
        });

        if (isDuplicateError) {
          throw new HarnessError("INVALID_STATE", `gate already passed: ${gateId}`);
        }

        return {
          markdown: "### Command completed successfully",
          evidence_path: evidenceFile,
          evidence: {},
          command: record,
          exit_code: 0,
        };
      },
    });

    try {
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
      expect(typeof first.stdout_sha256).toBe("string");

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
    } finally {
      restore();
    }
  });
});
