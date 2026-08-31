import { describe, expect, test } from "bun:test";
import { runAndRecordCommand } from "../../../olt/scripts/src/integration/record-command.ts";

describe("runAndRecordCommand — stranded-recovery short-circuit", () => {
  test("refuses to run a new command while a prior running intent still lacks terminal evidence", async () => {
    const reconcile = () => ({ reconciled: [], stranded: ["C-STRANDED-1"] });

    await expect(
      runAndRecordCommand(
        "/irrelevant-run-root",
        { argv: ["bun", "test"], cwd: "/repo", commandDir: "commands/C-1", actor: "coordinator" },
        { reconcile },
      ),
    ).rejects.toThrow(/running command intents lack terminal evidence: C-STRANDED-1/);
  });
});
