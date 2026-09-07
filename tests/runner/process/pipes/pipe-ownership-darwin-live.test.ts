import { describe, expect, spyOn, test } from "bun:test";
import {
  addedPipeHandles,
  authenticatedOwnerPids,
  ownedProcessPids,
  ownershipTokenIdentities,
  runnerPipeHandles,
} from "../../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";
import {
  darwinPipeHandles,
  darwinPipeOwners,
  darwinProcessIdentity,
  darwinTokenOwnerIdentities,
} from "../../../../olt/scripts/src/engine/runner/process/darwin/darwin-pipes.ts";
import {
  processHasToken,
  scanDarwinTokenOwners,
} from "../../../../olt/scripts/src/engine/runner/process/darwin/darwin-token-owners.ts";

describe("authenticatedOwnerPids", () => {
  test("keeps only pids present in both the pipe-owner and token-owner sets", () => {
    expect(authenticatedOwnerPids(new Set([1, 2, 3]), new Set([2, 3, 4]))).toEqual(new Set([2, 3]));
    expect(authenticatedOwnerPids(new Set(), new Set([1]))).toEqual(new Set());
    expect(authenticatedOwnerPids(new Set([1]), new Set())).toEqual(new Set());
  });
});

describe("runnerPipeHandles / addedPipeHandles (real darwin dispatch)", () => {
  test("returns this live process's own pipe/socket handle set without throwing", () => {
    const handles = runnerPipeHandles();
    expect(handles).toBeInstanceOf(Set);
    expect(runnerPipeHandles(process.pid)).toEqual(handles);
  });

  test("computes only the handles added since a given baseline", () => {
    const baseline = runnerPipeHandles();
    const added = addedPipeHandles(baseline);
    expect(added).toBeInstanceOf(Set);
    for (const handle of added) expect(baseline.has(handle)).toBe(false);
  });
});

describe("platform dispatch seam", () => {
  test("runnerPipeHandles rejects a platform that is neither darwin nor linux", () => {
    expect(() => runnerPipeHandles(process.pid, "win32")).toThrow(
      "pipe ownership inspection is unavailable",
    );
  });

  test("ownedProcessPids rejects a platform that is neither darwin nor linux", () => {
    expect(() => ownedProcessPids(new Set(), "some-token", "win32")).toThrow(
      "pipe ownership inspection is unavailable",
    );
  });

  test("ownershipTokenIdentities rejects a platform that is neither darwin nor linux", () => {
    expect(() => ownershipTokenIdentities("some-token", "win32")).toThrow(
      "ownership-token inspection is unavailable",
    );
  });

  test("runnerPipeHandles dispatches to the real linux implementation when told to", () => {
    expect(runnerPipeHandles(process.pid, "linux")).toEqual(new Set());
  });

  test("ownershipTokenIdentities dispatches to the real linux implementation when told to", () => {
    expect(() => ownershipTokenIdentities("some-token", "linux")).toThrow(
      "cannot enumerate processes for ownership tokens",
    );
  });

  test("ownedProcessPids dispatches to the real linux implementation when told to", () => {
    expect(() => ownedProcessPids(new Set(), "some-token", "linux")).toThrow(
      "cannot enumerate processes for ownership tokens",
    );
  });

  test("ownedProcessPids maps linux token owners to pids", async () => {
    const linuxPipes =
      await import("../../../../olt/scripts/src/engine/runner/process/linux-pipes.ts");
    const spyOwners = spyOn(linuxPipes, "linuxPipeOwners").mockReturnValue(new Set([101, 102]));
    const spyTokens = spyOn(linuxPipes, "linuxTokenOwnerIdentities").mockReturnValue([
      { pid: 101, parent: 1, group: 101, birth: "1000" },
    ]);
    try {
      const result = ownedProcessPids(new Set([999n]), "some-token", "linux");
      expect(result).toEqual(new Set([101]));
    } finally {
      spyOwners.mockRestore();
      spyTokens.mockRestore();
    }
  });
});

describe("ownedProcessPids / ownershipTokenIdentities (real darwin dispatch)", () => {
  test("returns immediately for an empty token without scanning any processes", () => {
    expect(ownedProcessPids(new Set(), "")).toEqual(new Set());
    expect(ownershipTokenIdentities("")).toEqual([]);
  });

  test("scans real live processes for a token nothing holds and finds no owners", () => {
    const token = `unit-test-nonexistent-ownership-token-${process.pid}`;
    expect(ownedProcessPids(new Set(), token)).toEqual(new Set());
    expect(ownershipTokenIdentities(token)).toEqual([]);
  });

  test("ownedProcessPids maps darwin token owners to pids when owners exist", async () => {
    const darwinPipes =
      await import("../../../../olt/scripts/src/engine/runner/process/darwin/darwin-pipes.ts");
    const spyOwners = spyOn(darwinPipes, "darwinPipeOwners").mockReturnValue(new Set([201, 202]));
    const spyTokens = spyOn(darwinPipes, "darwinTokenOwnerIdentities").mockReturnValue([
      { pid: 201, parent: 1, group: 201, birth: "1000" },
    ]);
    try {
      const result = ownedProcessPids(new Set([999n]), "some-token", "darwin");
      expect(result).toEqual(new Set([201]));
    } finally {
      spyOwners.mockRestore();
      spyTokens.mockRestore();
    }
  });
});

describe("darwin-pipes real dispatch", () => {
  test("darwinProcessIdentity resolves this live process's own identity", () => {
    const identity = darwinProcessIdentity(process.pid);
    expect(identity).toBeDefined();
    expect(identity!.pid).toBe(process.pid);
    expect(Number.isSafeInteger(identity!.parent)).toBe(true);
    expect(Number.isSafeInteger(identity!.group)).toBe(true);
    expect(identity!.birth.length).toBeGreaterThan(0);
  });

  test("darwinProcessIdentity returns undefined for a pid that does not exist", () => {
    expect(darwinProcessIdentity(2_000_000_000)).toBeUndefined();
  });

  test("darwinPipeHandles returns a handle set for the live process without throwing", () => {
    expect(darwinPipeHandles(process.pid)).toBeInstanceOf(Set);
  });

  test("darwinPipeOwners scans real user processes against a real (non-matching) anchor set", () => {
    const ownHandles = darwinPipeHandles(process.pid);

    expect(darwinPipeOwners(ownHandles)).toBeInstanceOf(Set);
    expect(darwinPipeOwners(new Set())).toEqual(new Set());
  });

  test("darwinTokenOwnerIdentities returns [] immediately for an empty token", () => {
    expect(darwinTokenOwnerIdentities("")).toEqual([]);
  });

  test("darwinTokenOwnerIdentities scans real processes for a token nothing holds", () => {
    const token = `unit-test-nonexistent-ownership-token-${process.pid}`;
    expect(darwinTokenOwnerIdentities(token)).toEqual([]);
  });
});

describe("darwin-token-owners real dispatch", () => {
  test("processHasToken returns false immediately for an empty token", () => {
    expect(processHasToken(process.pid, "", { bytes: 0 })).toBe(false);
  });

  test("processHasToken inspects the live process's real argv/environ and finds no match", () => {
    const budget = { bytes: 0 };
    expect(
      processHasToken(process.pid, `unit-test-nonexistent-ownership-token-${process.pid}`, budget),
    ).toBe(false);
    expect(budget.bytes).toBeGreaterThan(0);
  });

  test("processHasToken throws once the caller-supplied scan budget is already exhausted", () => {
    const exhaustedBudget = { bytes: 64 * 1024 * 1024 };
    expect(() => processHasToken(process.pid, "any-token", exhaustedBudget)).toThrow(
      "ownership-token environment scan is too large",
    );
  });

  test("scanDarwinTokenOwners returns [] immediately for an empty token without identifying anyone", () => {
    let identifyCalls = 0;
    expect(
      scanDarwinTokenOwners([process.pid], "", () => {
        identifyCalls += 1;
        return undefined;
      }),
    ).toEqual([]);
    expect(identifyCalls).toBe(0);
  });

  test("scanDarwinTokenOwners skips the caller's own pid and reports no other owners", () => {
    const owners = scanDarwinTokenOwners(
      [process.pid],
      `unit-test-nonexistent-ownership-token-${process.pid}`,
      darwinProcessIdentity,
    );
    expect(owners).toEqual([]);
  });

  test("scanDarwinTokenOwners skips a pid that identify() cannot resolve", () => {
    const owners = scanDarwinTokenOwners([2_000_000_000], "some-token", () => undefined);
    expect(owners).toEqual([]);
  });
});
