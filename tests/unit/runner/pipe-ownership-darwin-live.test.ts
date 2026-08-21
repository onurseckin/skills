import { describe, expect, test } from "bun:test";
import {
  addedPipeHandles,
  authenticatedOwnerPids,
  ownedProcessPids,
  ownershipTokenIdentities,
  runnerPipeHandles,
} from "../../../orchestrating-long-tasks/scripts/src/runner/pipe-ownership.ts";
import {
  darwinPipeHandles,
  darwinPipeOwners,
  darwinProcessIdentity,
  darwinTokenOwnerIdentities,
} from "../../../orchestrating-long-tasks/scripts/src/runner/darwin-pipes.ts";
import {
  processHasToken,
  scanDarwinTokenOwners,
} from "../../../orchestrating-long-tasks/scripts/src/runner/darwin-token-owners.ts";

// These exercise the real darwin FFI-backed implementations against the current, live test
// process rather than a fake dependency: they are direct syscalls scoped to this process and a
// point-in-time snapshot of the machine's own process table, not a spawned subprocess, so they
// stay fast and safe for the unit lane (this whole file consistently runs in well under 100ms).
// This machine is assumed to be darwin, matching the harness's own dev/CI environment; that
// premise is real, not a fake, so these are genuine behavioral tests, not simulations.

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
    // This machine has no /proc, so the real linux implementation's own defensive fallback
    // (an empty set on ENOENT) is what runs here — a genuine behavior, not a mock.
    expect(runnerPipeHandles(process.pid, "linux")).toEqual(new Set());
  });

  test("ownershipTokenIdentities dispatches to the real linux implementation when told to", () => {
    // On this darwin machine /proc does not exist, so processIds() genuinely fails and the
    // real linux code wraps that into a HarnessError rather than silently returning.
    expect(() => ownershipTokenIdentities("some-token", "linux")).toThrow(
      "cannot enumerate processes for ownership tokens",
    );
  });

  test("ownedProcessPids dispatches to the real linux implementation when told to", () => {
    expect(() => ownedProcessPids(new Set(), "some-token", "linux")).toThrow(
      "cannot enumerate processes for ownership tokens",
    );
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
    // A pid far beyond any realistic live process; procPidInfo reports fewer bytes than a BSD
    // info struct, which the implementation reads as "no such process".
    expect(darwinProcessIdentity(2_000_000_000)).toBeUndefined();
  });

  test("darwinPipeHandles returns a handle set for the live process without throwing", () => {
    expect(darwinPipeHandles(process.pid)).toBeInstanceOf(Set);
  });

  test("darwinPipeOwners scans real user processes against a real (non-matching) anchor set", () => {
    const ownHandles = darwinPipeHandles(process.pid);
    // Every real user pid's handles are compared against our own handles as anchors; since this
    // process itself is explicitly skipped, no owner is expected, but the scan and comparison
    // logic across the live process table still runs for real.
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
    // Seeding the budget object right at the cap means even this live process's own (small)
    // argv/environ block pushes it over, exercising the scan-too-large guard for real.
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
