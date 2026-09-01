import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildPacket } from "../../../../olt/scripts/src/packets/render-packet.ts";
import {
  loadChecklist,
  loadRoleContract,
  loadValidatorDomainContract,
  parseRoleContract,
  VALIDATOR_DOMAINS,
} from "../../../../olt/scripts/src/packets/role-contract.ts";
import { beginValidation } from "../../../../olt/scripts/src/workflow/review/begin-validation.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../../../olt/scripts/src/workflow/submission/submit.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "../../../workflow/index.ts";
import { inspectionContext } from "../../payloads/slicing/inspection-fixture.ts";

const encoder = new TextEncoder();
const clock = at("2026-08-13T12:00:00.000Z");
const commonBytes = encoder.encode("Preserve unrelated changes. Run focused tests.");

// A validator packet's own authentication (authenticatePacketIdentity) demands a task genuinely in
// "validating" status with a live validation record — so the fixture drives the real submission and
// validation-start transitions rather than fabricating that state directly.
function base() {
  const port = new TestPort(workflowState());
  const { token: implToken } = claimTask(port, "T-1", "impl-agent", "implementer", { clock });
  registerTaskPacket(port, "implementer", "impl-agent", 1);
  submitTask(
    port,
    "T-1",
    "impl-agent",
    implToken,
    {
      summary: "done",
      requirement_ids: ["R-1"],
      files_changed: ["src/owned/a.ts"],
      checks: [{ command: "bun test", status: "passed" }],
      evidence: [{ kind: "diff" }],
    },
    clock,
  );
  const started = beginValidation(port, "T-1", "val-agent", clock);
  const task = started.tasks["T-1"]!;
  return {
    runId: "run-1",
    graphRevision: started.graph_revision ?? 1,
    agentId: "val-agent",
    attempt: task.validations!.at(-1)!.attempt,
    state: started,
    task,
    commonInstructions: {
      bytes: commonBytes,
      sha256: createHash("sha256").update(commonBytes).digest("hex"),
    },
    evidenceSchema: { required: ["evidence"] },
    targetedCommands: [["bun", "test"]],
    leaseToken: task.validation_token,
    clock,
    authoritativeContext: { ...inspectionContext() },
  };
}

describe("B12.3: delivery of a validator domain's standing checklist through its role packet", () => {
  test("loadValidatorDomainContract folds the checklist into the contract's text and digest", () => {
    for (const domain of VALIDATOR_DOMAINS) {
      const base = loadRoleContract("validator");
      const checklist = loadChecklist(domain);
      const domainContract = loadValidatorDomainContract(domain);
      expect(domainContract.role).toBe("validator");
      expect(domainContract.domain).toBe(domain);
      // The domain contract's own may/must_not/commands come from validator-<domain>.md, not the
      // base validator.md — each domain genuinely differs, not merely a relabeled copy.
      expect(domainContract.may).not.toEqual(base.may);
      expect(domainContract.text).toContain(checklist.title);
      expect(domainContract.text).toContain(checklist.items[0]!.id);
      // The digest covers exactly what is delivered: change either input and the digest moves.
      expect(domainContract.sha256).not.toBe(base.sha256);
      expect(domainContract.sha256).not.toBe(
        createHash("sha256").update(checklist.bytes).digest("hex"),
      );
    }
  });

  test("refuses a domain contract file that does not declare role: validator", () => {
    const bytes = encoder.encode(
      [
        "---",
        "role: implementer",
        "domain: code-quality",
        "tier: 3",
        "may:",
        "  - Do the work",
        "must_not:",
        "  - Skip the work",
        "commands:",
        "  - task:claim",
        "spawns: []",
        "---",
        "",
        "# Not actually a validator",
      ].join("\n"),
    );
    // domain is only legal on role: validator — the frontmatter parser itself refuses this document.
    expect(() => parseRoleContract(bytes, "validator-code-quality.md")).toThrow(
      /domain is only valid for validator/u,
    );
  });

  test("refuses a domain scalar that is not a recognized validator domain", () => {
    const bytes = encoder.encode(
      [
        "---",
        "role: validator",
        "domain: made-up-domain",
        "tier: 3",
        "may:",
        "  - Validate",
        "must_not:",
        "  - Implement",
        "commands:",
        "  - task:review",
        "spawns: []",
        "---",
        "",
        "# Validator",
      ].join("\n"),
    );
    expect(() => parseRoleContract(bytes, "validator-made-up-domain.md")).toThrow(
      /domain is not a recognized validator domain/u,
    );
  });

  test("the domain contract is reachable as a packet override with zero changes to packet rendering", () => {
    // B12.3's delivery mechanism, proven end to end: render-packet.ts is not modified for this
    // feature at all — the existing `roleContract` override on PacketInput is the entire wire-up.
    const domainContract = loadValidatorDomainContract("security");
    const packet = buildPacket({ ...base(), role: "validator", roleContract: domainContract });
    expect(packet.metadata.role_contract_sha256).toBe(domainContract.sha256);
    expect(packet.metadata.role).toBe("validator");
    expect(packet.markdown).toContain("# validator packet");
    expect(packet.markdown).toContain("Actionable Task Checklist");
  });

  test("a domain-scoped validator packet still gets the base validator's context isolation", () => {
    // render-packet.ts isolates context for VALIDATION_ROLES by checking input.role, which stays
    // "validator" for a domain contract — so implementer-narrative exclusion is unaffected.
    const domainContract = loadValidatorDomainContract("product");
    const withNarrative = base();
    withNarrative.authoritativeContext = {
      ...withNarrative.authoritativeContext,
      implementer_confidence: "very confident, definitely correct",
    } as typeof withNarrative.authoritativeContext;
    const packet = buildPacket({
      ...withNarrative,
      role: "validator",
      roleContract: domainContract,
    });
    expect(packet.markdown).not.toContain("very confident, definitely correct");
  });

  test("every domain contract's declared commands are the same closed validator command set", () => {
    const base = loadRoleContract("validator");
    for (const domain of VALIDATOR_DOMAINS) {
      expect(loadValidatorDomainContract(domain).commands).toEqual(base.commands);
    }
  });

  test("loadValidatorDomainContract supports manifest without matched section", () => {
    const yamlManifest = [
      "name: validator",
      "role: validator",
      "tier: 3",
      "permissions:",
      "  may:",
      "    - Validate",
      "  must_not:",
      "    - Implement",
      "  commands:",
      "    - task:review",
      "  spawns: []",
      "domain: security",
      "instructions: |",
      "  Standard security validator instructions without markdown section headers.",
    ].join("\n");

    const mockRead = (path: string) => {
      if (path.includes("checklists/")) {
        return encoder.encode(
          "# Security checklist\nDomain: security\n\n## SEC-AUTHN-001\n\nrule: Token is verified\nrationale: Prevent spoofing\nhow-to-check: Verify signature\nseverity: critical\nsources:\n  - OWASP\n",
        );
      }
      return encoder.encode(yamlManifest);
    };

    const contract = loadValidatorDomainContract("security", mockRead);
    expect(contract.role).toBe("validator");
    expect(contract.domain).toBe("security");
    expect(contract.text).toContain("Standard security validator instructions");
  });

  test("loadValidatorDomainContract throws INTEGRITY when manifest declares wrong role", () => {
    const yamlManifest = [
      "name: implementer",
      "role: implementer",
      "tier: 3",
      "permissions:",
      "  may: []",
      "  must_not: []",
      "  commands: []",
      "  spawns: []",
      "domain: security",
      "instructions: Implementer instructions.",
    ].join("\n");

    const mockRead = () => encoder.encode(yamlManifest);
    expect(() => loadValidatorDomainContract("security", mockRead)).toThrow(
      /declares role implementer/u,
    );
  });

  test("loadValidatorDomainContract throws INTEGRITY when manifest declares mismatched domain", () => {
    const yamlManifest = [
      "name: validator",
      "role: validator",
      "tier: 3",
      "permissions:",
      "  may: []",
      "  must_not: []",
      "  commands: []",
      "  spawns: []",
      "domain: product",
      "instructions: Product instructions.",
    ].join("\n");

    const mockRead = (path: string) => {
      if (path.includes("checklists/")) {
        return encoder.encode(
          "# Security checklist\nDomain: security\n\n## SEC-AUTHN-001\n\nrule: Token is verified\nrationale: Prevent spoofing\nhow-to-check: Verify signature\nseverity: critical\nsources:\n  - OWASP\n",
        );
      }
      return encoder.encode(yamlManifest);
    };

    expect(() => loadValidatorDomainContract("security", mockRead)).toThrow(
      /declares domain product/u,
    );
  });
});
