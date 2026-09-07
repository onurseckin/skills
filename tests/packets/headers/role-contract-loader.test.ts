import { describe, expect, test } from "bun:test";
import {
  loadChecklist,
  loadRoleContract,
  loadValidatorDomainContract,
  resolveChecklistPath,
  resolveRoleContractPath,
  resolveValidatorDomainContractPath,
} from "../../../olt/scripts/src/packets/role-contract.ts";

/**
 * In-memory synthetic document fixtures.
 * Zero physical disk reads occur; 100% in-memory Uint8Array buffers.
 */
const encoder = new TextEncoder();

const implementerDocBytes = encoder.encode(`name: "implementer"
role: "implementer"
provider:
  - "antigravity"
tier: 3
tools:
  enable_subagent_tools: false
  enable_write_tools: true
communication_contract:
  mandatory_turn_completion_actions: []
  protocol: "mailbox_ipc"
  mailbox_path: ".olt/mailboxes/{agent_id}/"
  lock_path: ".olt/locks/mailboxes/{agent_id}.lock"
  allowed_channels: []
  ban_raw_jsonl_reading: true
  forbid_native_messaging: true
permissions:
  may: []
  must_not: []
  commands: []
  spawns: []
instructions: |
  # Implementer
`);

const securityChecklistBytes = encoder.encode(
  [
    "# Security checklist",
    "Domain: security",
    "",
    "## SEC-AUTHN-001",
    "",
    "rule: A credential is required",
    "rationale: Security boundary",
    "how-to-check: Check auth token",
    "severity: critical",
    "sources:",
    "  - OWASP",
    "",
  ].join("\n"),
);

const securityContractBytes = encoder.encode(
  "---\nrole: validator\ntier: 3\ndomain: security\nmay:\n  - a\nmust_not:\n  - b\ncommands: []\nspawns: []\n---\n\n# Validator Security\n",
);

function throwingRead(): never {
  throw new Error("simulated read failure");
}

describe("loadRoleContract", () => {
  test("wraps a read failure as an unreadable role contract", () => {
    expect(() => loadRoleContract("implementer", throwingRead)).toThrow(
      `role contract is unreadable: ${resolveRoleContractPath("implementer")}`,
    );
  });

  test("wraps custom reader error with error cause details", () => {
    const customFailureRead = () => {
      throw new Error("Simulated I/O corruption code 404");
    };
    expect(() => loadRoleContract("implementer", customFailureRead)).toThrow(
      `role contract is unreadable: ${resolveRoleContractPath("implementer")}`,
    );
  });

  test("rejects a document at the requested path that declares a different role", () => {
    expect(() => loadRoleContract("validator", () => implementerDocBytes)).toThrow(
      `role contract ${resolveRoleContractPath("validator")} declares role implementer`,
    );
  });

  test("fails closed when document bytes contain malformed frontmatter", () => {
    const malformedBytes = encoder.encode("not valid frontmatter at all without fences\n");
    expect(() => loadRoleContract("implementer", () => malformedBytes)).toThrow();
  });
});

describe("loadChecklist", () => {
  test("wraps a read failure as an unreadable checklist", () => {
    expect(() => loadChecklist("security", throwingRead)).toThrow(
      `checklist is unreadable: ${resolveChecklistPath("security")}`,
    );
  });

  test("rejects a document at the requested path that declares a different domain", () => {
    expect(() => loadChecklist("product", () => securityChecklistBytes)).toThrow(
      `checklist ${resolveChecklistPath("product")} declares domain security`,
    );
  });

  test("fails closed on corrupt checklist content", () => {
    const corruptBytes = encoder.encode("---\nmalformed yaml : [incomplete\n---\n");
    expect(() => loadChecklist("security", () => corruptBytes)).toThrow();
  });
});

describe("loadValidatorDomainContract", () => {
  test("wraps a read failure as an unreadable role contract", () => {
    expect(() => loadValidatorDomainContract("security", throwingRead)).toThrow(
      `role contract is unreadable: ${resolveValidatorDomainContractPath("security")}`,
    );
  });

  test("rejects a document that does not declare the validator role", () => {
    expect(() => loadValidatorDomainContract("security", () => implementerDocBytes)).toThrow(
      `validator domain contract ${resolveValidatorDomainContractPath("security")} declares role implementer`,
    );
  });

  test("rejects a validator document that declares a different domain", () => {
    expect(() => loadValidatorDomainContract("product", () => securityContractBytes)).toThrow(
      `validator domain contract ${resolveValidatorDomainContractPath("product")} declares domain security`,
    );
  });
});
