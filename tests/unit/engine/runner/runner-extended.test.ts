import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  inspectFailureText,
  classifySignals,
} from "../../../../olt/scripts/src/engine/runner/core/classify-failure.ts";
import {
  shouldRetry,
} from "../../../../olt/scripts/src/engine/runner/core/retry-policy.ts";
import {
  isRestrictedGitGate,
  isGitGateCommand,
  restrictedGateGitArgv,
} from "../../../../olt/scripts/src/engine/runner/core/restricted-git-gate.ts";
import {
  commandId,
  canonicalCommandFingerprint,
} from "../../../../olt/scripts/src/engine/runner/models/command/command-id.ts";
import {
  OutputBudget,
} from "../../../../olt/scripts/src/engine/runner/receipt/output-budget.ts";

describe("engine/runner/core/classify-failure.ts", () => {
  it("inspects failure text and classifies failure signals", () => {
    const authSignals = inspectFailureText("Error: 401 Unauthorized access");
    expect(authSignals.authorization).toBe(true);
    expect(classifySignals(1, authSignals, null)).toBe("authorization");

    const testSignals = inspectFailureText("AssertionError: expected true but got false");
    expect(testSignals.testFailure).toBe(true);
    expect(classifySignals(1, testSignals, null)).toBe("test_failure");

    const transientSignals = inspectFailureText("fatal: Connection refused by remote host");
    expect(transientSignals.networkTransient).toBe(true);
    expect(classifySignals(1, transientSignals, null)).toBe("network_transient");

    expect(classifySignals(0, { authorization: false, testFailure: false, networkTransient: false }, null)).toBeUndefined();
    expect(classifySignals(1, { authorization: false, testFailure: false, networkTransient: false }, "wall")).toBe("timeout");
    expect(classifySignals(1, { authorization: false, testFailure: false, networkTransient: false }, null, true)).toBe("host_interruption");
    expect(classifySignals(1, { authorization: false, testFailure: false, networkTransient: false }, null, false)).toBe("unknown");
  });
});

describe("engine/runner/core/retry-policy.ts", () => {
  it("determines retry eligibility based on idempotency and failure class", () => {
    expect(shouldRetry("network_transient", true, 1, 3)).toBe(true);
    expect(shouldRetry("host_interruption", true, 2, 3)).toBe(true);
    expect(shouldRetry("network_transient", false, 1, 3)).toBe(false);
    expect(shouldRetry("test_failure", true, 1, 3)).toBe(false);
    expect(shouldRetry("network_transient", true, 4, 3)).toBe(false);
  });
});

describe("engine/runner/core/restricted-git-gate.ts", () => {
  it("identifies and processes restricted git gate commands", () => {
    expect(isGitGateCommand(["git", "diff"])).toBe(true);
    expect(isGitGateCommand(["npm", "test"])).toBe(false);

    expect(isRestrictedGitGate(["git", "diff", "--check"])).toBe(true);
    expect(isRestrictedGitGate(["git", "diff", "--cached", "--check"])).toBe(true);
    expect(isRestrictedGitGate(["git", "commit", "-m", "msg"])).toBe(false);

    const rewritten = restrictedGateGitArgv(["git", "diff", "--check"]);
    expect(rewritten.length).toBeGreaterThanOrEqual(2);
  });
});

describe("engine/runner/models/command/command-id.ts", () => {
  it("generates valid command IDs and computes canonical fingerprints", () => {
    const id = commandId();
    expect(id.startsWith("C-")).toBe(true);

    const fp1 = canonicalCommandFingerprint("/tmp", ["git", "status"]);
    const fp2 = canonicalCommandFingerprint("/tmp", ["git", "status"]);
    expect(fp1).toBe(fp2);

    const fp3 = canonicalCommandFingerprint("/tmp", ["git", "diff"]);
    expect(fp1).not.toBe(fp3);
  });
});

describe("engine/runner/receipt/output-budget.ts", () => {
  it("manages and enforces output budget claims", () => {
    const budget = new OutputBudget(100);
    expect(budget.maximum).toBe(100);
    expect(budget.consumed).toBe(0);

    budget.claim(50);
    expect(budget.consumed).toBe(50);

    budget.claim(50);
    expect(budget.consumed).toBe(100);

    expect(() => budget.claim(1)).toThrow(HarnessError);
  });
});
