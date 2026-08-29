import { describe, expect, test } from "bun:test";
import {
  identitiesMatch,
  identityValid,
  signalLedgerValid,
} from "../../../olt/scripts/src/engine/runner/attempt-cleanup-validation.ts";
import type { CommandProcessIdentity } from "../../../olt/scripts/src/core/contracts/index.ts";

const validIdentity: CommandProcessIdentity = {
  pid: 100,
  parent: 1,
  group: 100,
  birth: "2026-08-19T00:00:00.000Z",
};

describe("identityValid", () => {
  test("accepts a well-formed identity", () => {
    expect(identityValid(validIdentity)).toBe(true);
  });

  test("rejects non-object values", () => {
    expect(identityValid(null)).toBe(false);
    expect(identityValid("nope")).toBe(false);
    expect(identityValid(42)).toBe(false);
    expect(identityValid([])).toBe(false);
  });

  test("rejects a pid that is not a safe integer greater than 1", () => {
    expect(identityValid({ ...validIdentity, pid: 1 })).toBe(false);
    expect(identityValid({ ...validIdentity, pid: 1.5 })).toBe(false);
    expect(identityValid({ ...validIdentity, pid: "100" })).toBe(false);
  });

  test("rejects a parent that is not a safe integer greater than 0", () => {
    expect(identityValid({ ...validIdentity, parent: 0 })).toBe(false);
    expect(identityValid({ ...validIdentity, parent: -1 })).toBe(false);
  });

  test("rejects a group that is not a safe integer greater than 1", () => {
    expect(identityValid({ ...validIdentity, group: 1 })).toBe(false);
  });

  test("rejects a missing or empty birth token", () => {
    expect(identityValid({ ...validIdentity, birth: "" })).toBe(false);
    expect(identityValid({ ...validIdentity, birth: 123 })).toBe(false);
  });
});

describe("signalLedgerValid", () => {
  test("accepts the empty ledger, [SIGTERM], and [SIGTERM, SIGKILL]", () => {
    expect(signalLedgerValid([])).toBe(true);
    expect(signalLedgerValid(["SIGTERM"])).toBe(true);
    expect(signalLedgerValid(["SIGTERM", "SIGKILL"])).toBe(true);
  });

  test("rejects a non-array value", () => {
    expect(signalLedgerValid("SIGTERM")).toBe(false);
    expect(signalLedgerValid(null)).toBe(false);
  });

  test("rejects any signal name outside SIGTERM/SIGKILL", () => {
    expect(signalLedgerValid(["SIGKILL"])).toBe(false);
    expect(signalLedgerValid(["SIGINT"])).toBe(false);
  });

  test("rejects duplicate entries", () => {
    expect(signalLedgerValid(["SIGTERM", "SIGTERM"])).toBe(false);
  });

  test("rejects out-of-order or overlong ledgers", () => {
    expect(signalLedgerValid(["SIGKILL", "SIGTERM"])).toBe(false);
    expect(signalLedgerValid(["SIGTERM", "SIGKILL", "SIGTERM"])).toBe(false);
  });
});

describe("identitiesMatch", () => {
  test("matches two null identities", () => {
    expect(identitiesMatch(null, null)).toBe(true);
  });

  test("matches two structurally equal identities", () => {
    expect(identitiesMatch(validIdentity, { ...validIdentity })).toBe(true);
  });

  test("does not match a null against a present identity, or differing identities", () => {
    expect(identitiesMatch(null, validIdentity)).toBe(false);
    expect(identitiesMatch(validIdentity, null)).toBe(false);
    expect(identitiesMatch(validIdentity, { ...validIdentity, pid: 200 })).toBe(false);
  });
});
