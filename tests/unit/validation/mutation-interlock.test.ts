import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertLeaseTokenForFileMutation } from "../../../olt/scripts/src/validation/anti-leak/index.ts";
import { registerSessionGrant } from "../../../olt/scripts/src/authority/session/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Mutation Interlock Enforcement", () => {
  it("throws INVALID_ARGUMENT when target file path is empty or whitespace", () => {
    expect(() => assertLeaseTokenForFileMutation("", "tok_live_1234567890")).toThrow(
      HarnessError,
    );
    expect(() => assertLeaseTokenForFileMutation("   ", "tok_live_1234567890")).toThrow(
      HarnessError,
    );
    try {
      assertLeaseTokenForFileMutation("", "tok_live_1234567890");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INVALID_ARGUMENT");
    }
  });

  it("throws PERMISSION_DENIED when lease token is empty, whitespace, none, or unauthenticated", () => {
    const invalidTokens = ["", "   ", "none", "unauthenticated"];
    for (const token of invalidTokens) {
      expect(() =>
        assertLeaseTokenForFileMutation("olt/scripts/src/workflow/lease/guard.ts", token),
      ).toThrow(HarnessError);

      try {
        assertLeaseTokenForFileMutation("olt/scripts/src/workflow/lease/guard.ts", token);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).code).toBe("PERMISSION_DENIED");
      }
    }
  });

  it("permits mutation when a valid token is provided without active session restrictions", () => {
    expect(() =>
      assertLeaseTokenForFileMutation(
        "olt/scripts/src/workflow/lease/guard.ts",
        "tok_live_validtoken123456789",
      ),
    ).not.toThrow();
  });

  it("rejects file mutation when the authenticated session role cannot edit files", () => {
    const sandboxDir = scratchRoot(import.meta.path, "val-mutation-block");
    mkdirSync(join(sandboxDir, ".olt", ".sessions"), { recursive: true });

    const session = registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "val-reviewer",
      role: "validator",
      customToken: "tok_live_val_987654321",
      pid: 91101,
      ppid: 91100,
    });

    expect(session.can_edit_files).toBe(false);

    try {
      assertLeaseTokenForFileMutation(
        "olt/scripts/src/validation/anti-leak/validator.ts",
        session.token,
        { runRoot: sandboxDir },
      );
      expect.unreachable("validator session must be blocked from mutating files");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("PERMISSION_DENIED");
    } finally {
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  });

  it("rejects file mutation when target file is outside the leased write scope", () => {
    const sandboxDir = scratchRoot(import.meta.path, "scope-mutation-block");
    mkdirSync(join(sandboxDir, ".olt", ".sessions"), { recursive: true });

    const session = registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "impl-scoped",
      role: "implementer",
      customToken: "tok_live_impl_scope_test",
      pid: 91103,
      ppid: 91102,
      writeScope: ["olt/scripts/src/workflow/lease/"],
    });

    expect(session.can_edit_files).toBe(true);

    try {
      assertLeaseTokenForFileMutation(
        "docs/planning/capsule-connectivity/PLAN.md",
        session.token,
        { runRoot: sandboxDir },
      );
      expect.unreachable("out-of-scope mutation must be blocked");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("PERMISSION_DENIED");
    } finally {
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  });

  it("permits file mutation when target file is inside the leased write scope", () => {
    const sandboxDir = scratchRoot(import.meta.path, "scope-mutation-allow");
    mkdirSync(join(sandboxDir, ".olt", ".sessions"), { recursive: true });

    const session = registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "impl-scoped-allowed",
      role: "implementer",
      customToken: "tok_live_impl_scope_allow",
      pid: 91105,
      ppid: 91104,
      writeScope: [
        "olt/scripts/src/workflow/lease/",
        "tests/unit/workflow/lease/guard.test.ts",
      ],
    });

    expect(() =>
      assertLeaseTokenForFileMutation(
        "olt/scripts/src/workflow/lease/guard.ts",
        session.token,
        { runRoot: sandboxDir },
      ),
    ).not.toThrow();

    expect(() =>
      assertLeaseTokenForFileMutation(
        "tests/unit/workflow/lease/guard.test.ts",
        session.token,
        { runRoot: sandboxDir },
      ),
    ).not.toThrow();

    rmSync(sandboxDir, { recursive: true, force: true });
  });
});
