import { describe, expect, test } from "bun:test";
import { verifyCommandAuthorization } from "../../../olt/scripts/src/policy/rbac/index.ts";
import { parseRepoPolicy, type RepoPolicy } from "../../../olt/scripts/src/policy/index.ts";
import { createActor, samplePolicy } from "./fixtures.ts";

describe("RBAC Role Confinement & Fail-Closed Enforcement", () => {
  test("validators and supervisors are authorized for read-only CLI commands and blocked when can_execute_shell: false", () => {
    const validatorActors = [
      createActor("validator", true),
      createActor("critic", true),
      createActor("completeness-critic", true),
      createActor("plan-validator", true),
      createActor("sub-investigator", true),
    ];
    for (const actor of validatorActors) {
      const res = verifyCommandAuthorization(actor, "git status", samplePolicy);
      expect(res.authorized).toBe(true);
    }

    const disabledValidator = createActor("validator", false);
    const disabledRes = verifyCommandAuthorization(disabledValidator, "git status", samplePolicy);
    expect(disabledRes.authorized).toBe(false);
    expect(disabledRes.error_code).toBe("PERMISSION_DENIED");
  });

  test("supervisors are forbidden from executing tests", () => {
    const supervisors = ["coordinator", "orchestrator", "mind", "meta-auditor", "mind-auditor"];
    const testCommands = [
      "bun test",
      "vitest",
      "npm test",
      "pytest",
      "cargo test",
      "run_all.spec.ts",
    ];
    for (const role of supervisors) {
      for (const cmd of testCommands) {
        const res = verifyCommandAuthorization(
          { role, can_execute_shell: true },
          cmd,
          samplePolicy,
        );
        expect(res.authorized).toBe(false);
        expect(res.error_code).toBe("SUPERVISOR_TEST_EXECUTION_FORBIDDEN");
      }
    }
  });

  test("implementers are restricted by policy snapshots and unbounded tests", () => {
    const imp = createActor("implementer");
    expect(verifyCommandAuthorization(imp, "git commit -m 'feat'", samplePolicy).error_code).toBe(
      "PERMISSION_DENIED",
    );
    expect(verifyCommandAuthorization(imp, "git push", samplePolicy).error_code).toBe(
      "PERMISSION_DENIED",
    );
    expect(verifyCommandAuthorization(imp, "bun test", samplePolicy).error_code).toBe(
      "UNBOUNDED_TEST_RUNNER_FORBIDDEN",
    );
    expect(
      verifyCommandAuthorization(imp, "bun test tests/policy/foo.test.ts", samplePolicy).authorized,
    ).toBe(true);
    expect(
      verifyCommandAuthorization(imp, ["curl", "https://example.test"], samplePolicy).error_code,
    ).toBe("PERMISSION_DENIED");
  });

  test("unregistered, unverified, or non-executable actors calling recover or commands fail closed with PERMISSION_DENIED", () => {
    const unresolvedActors: readonly (
      | { readonly role?: string; readonly agent_id?: string }
      | null
      | undefined
    )[] = [
      { role: "" },
      { role: "   " },
      { role: "unresolved" },
      { agent_id: "ghost" },
      null,
      undefined,
    ];

    for (const actor of unresolvedActors) {
      const res = verifyCommandAuthorization(actor, "recover", samplePolicy);
      expect(res.authorized).toBe(false);
      expect(res.error_code).toBe("PERMISSION_DENIED");
      expect(res.reason).toBe("Unresolved actor role");
      expect(res.message).toBe(
        "[PERMISSION_DENIED] Unresolved actor role is not authorized to execute commands.",
      );
    }

    const unverifiedActors: readonly {
      readonly role: string;
      readonly agent_id?: string;
      readonly can_execute_shell?: boolean;
    }[] = [
      { role: "unregistered", agent_id: "anon-1" },
      { role: "unknown_actor", agent_id: "unresolved_id" },
      { role: "anonymous" },
      { role: "intruder" },
      { role: "guest" },
      { role: "unregistered_worker", can_execute_shell: true },
    ];

    const recoverInvocations = [
      "recover",
      "bun harness.ts recover --run .olt/capsules/test-run",
      ["recover"],
      ["bun", "harness.ts", "recover"],
      ["bun", "harness.ts", "recover", "--run", ".olt/capsules/r-1", "--actor", "unregistered"],
      ["bun", "run", "recover"],
      ["node", "recover.js"],
    ];

    for (const actor of unverifiedActors) {
      for (const cmd of recoverInvocations) {
        const res = verifyCommandAuthorization(actor, cmd, samplePolicy);
        expect(res.authorized).toBe(false);
        expect(res.error_code).toBe("PERMISSION_DENIED");
        expect(res.message).toContain("[PERMISSION_DENIED]");
      }
      const diagnosticRes = verifyCommandAuthorization(actor, "git status", samplePolicy);
      expect(diagnosticRes.authorized).toBe(false);
      expect(diagnosticRes.error_code).toBe("PERMISSION_DENIED");
    }

    const explicitDisabled = createActor("worker", false);
    expect(verifyCommandAuthorization(explicitDisabled, "ls", samplePolicy).error_code).toBe(
      "PERMISSION_DENIED",
    );

    const malformed = { ...samplePolicy, forbidden_commands: "curl" } as unknown as RepoPolicy;
    expect(() =>
      verifyCommandAuthorization(createActor("implementer"), ["curl"], parseRepoPolicy(malformed)),
    ).toThrow(/forbidden_commands/i);
  });
});
