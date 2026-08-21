import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  loadChecklist,
  loadRoleContract,
  loadValidatorDomainContract,
  resolveChecklistPath,
  resolveRoleContractPath,
  resolveValidatorDomainContractPath,
} from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";

/**
 * loadRoleContract/loadChecklist/loadValidatorDomainContract's own unreadable-file and
 * declared-role/declared-domain-mismatch guards are integrity checks against a checked-in
 * document set that is (by construction) always internally consistent — so nothing on disk can
 * exercise them without editing the digested roles/checklists files, which this task must never
 * touch. The `read` parameter added to each loader (defaulting to readRegularFileNoFollow, so
 * every real caller is unaffected) is the injection seam that reaches them instead: swap in a
 * throwing reader, or a reader that returns a different real document than the one requested.
 */

function throwingRead(): never {
  throw new Error("simulated read failure");
}

describe("loadRoleContract", () => {
  test("wraps a read failure as an unreadable role contract", () => {
    expect(() => loadRoleContract("implementer", throwingRead)).toThrow(
      `role contract is unreadable: ${resolveRoleContractPath("implementer")}`,
    );
  });

  test("rejects a document at the requested path that declares a different role", () => {
    const implementerBytes = readFileSync(resolveRoleContractPath("implementer"));
    expect(() => loadRoleContract("validator", () => implementerBytes)).toThrow(
      `role contract ${resolveRoleContractPath("validator")} declares role implementer`,
    );
  });
});

describe("loadChecklist", () => {
  test("wraps a read failure as an unreadable checklist", () => {
    expect(() => loadChecklist("security", throwingRead)).toThrow(
      `checklist is unreadable: ${resolveChecklistPath("security")}`,
    );
  });

  test("rejects a document at the requested path that declares a different domain", () => {
    const securityChecklist = readFileSync(resolveChecklistPath("security"));
    expect(() => loadChecklist("product", () => securityChecklist)).toThrow(
      `checklist ${resolveChecklistPath("product")} declares domain security`,
    );
  });
});

describe("loadValidatorDomainContract", () => {
  test("wraps a read failure as an unreadable role contract", () => {
    expect(() => loadValidatorDomainContract("security", throwingRead)).toThrow(
      `role contract is unreadable: ${resolveValidatorDomainContractPath("security")}`,
    );
  });

  test("rejects a document that does not declare the validator role", () => {
    const implementerBytes = readFileSync(resolveRoleContractPath("implementer"));
    expect(() => loadValidatorDomainContract("security", () => implementerBytes)).toThrow(
      `validator domain contract ${resolveValidatorDomainContractPath("security")} declares role implementer`,
    );
  });

  test("rejects a validator document that declares a different domain", () => {
    const securityContract = readFileSync(resolveValidatorDomainContractPath("security"));
    expect(() => loadValidatorDomainContract("product", () => securityContract)).toThrow(
      `validator domain contract ${resolveValidatorDomainContractPath("product")} declares domain security`,
    );
  });
});
