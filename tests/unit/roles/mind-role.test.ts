import { describe, expect, test } from "bun:test";
import { loadRoleContract } from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";
import { isAgentRole } from "../../../orchestrating-long-tasks/scripts/src/contracts/packets.ts";

describe("mind role contract", () => {
  test("mind role is registered with tier 0", () => {
    expect(isAgentRole("mind")).toBe(true);
    const contract = loadRoleContract("mind");
    expect(contract.tier).toBe(0);
  });
});
