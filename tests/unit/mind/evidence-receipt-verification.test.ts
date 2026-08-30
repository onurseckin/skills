import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MindAuditorEngine } from "../../../olt/scripts/src/mind/auditing/cognitive/index.ts";

describe("Evidence Receipt Verification & Anti-Prose Bias", () => {
  it("verifies valid cryptographic command receipts with exit code 0", () => {
    const receipts = {
      "cmd-1": {
        command: "bun test",
        exit_code: 0,
        status: "succeeded",
        stdout_hash: "abc123hash",
      },
    };

    const verified = MindAuditorEngine.verifyEvidenceReceipts(receipts, ["cmd-1"]);
    expect(verified.valid).toBe(true);
    expect(verified.unprovenClaims.length).toBe(0);
  });

  it("rejects ungrounded prose milestone claims when command receipt is missing", () => {
    const receipts = {};

    const verified = MindAuditorEngine.verifyEvidenceReceipts(receipts, ["cmd-missing"]);
    expect(verified.valid).toBe(false);
    expect(verified.unprovenClaims).toContain("cmd-missing");
  });

  it("rejects failed command receipts with non-zero exit codes", () => {
    const receipts = {
      "cmd-failed": {
        command: "bun test",
        exit_code: 1,
        status: "failed",
        stdout_hash: "errorhash",
      },
    };

    const verified = MindAuditorEngine.verifyEvidenceReceipts(receipts, ["cmd-failed"]);
    expect(verified.valid).toBe(false);
    expect(verified.unprovenClaims).toContain("cmd-failed");
  });
});
