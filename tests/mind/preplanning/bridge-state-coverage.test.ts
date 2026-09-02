import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import * as flockModule from "../../../olt/scripts/src/platform/fs/flock-ffi.ts";
import {
  resolveLedgerPath,
  transitionBacklogItemsToPlanned,
  transitionDefectsToPlanned,
  updateBridgeState,
  updateBridgeStateBatch,
} from "../../../olt/scripts/src/mind/preplanning/bridge-state.ts";
import type {
  RawBacklogItem,
  RawDefectItem,
  ThematicCluster,
} from "../../../olt/scripts/src/mind/preplanning/types.ts";

const sampleCluster: ThematicCluster = {
  cluster_id: "cluster-mind-001",
  domain: "mind",
  title: "Mind Core Architecture Refactor",
  plan_path: "plans/mind-core-plan.md",
  backlog_item_ids: ["item-1", "item-2"],
  defect_ids: ["defect-1"],
  planned_at: "2026-09-01T12:00:00.000Z",
};

describe("Bridge State Transition Module", () => {
  let tempDir: string;
  let oltDir: string;
  let backlogFile: string;
  let defectsFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bridge-state-test-"));
    oltDir = join(tempDir, ".olt");
    mkdirSync(oltDir, { recursive: true });
    backlogFile = join(oltDir, "backlog.jsonl");
    defectsFile = join(oltDir, "defects.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("resolveLedgerPath", () => {
    it("resolves default relative path against process.cwd or custom rootDir", () => {
      const defaultPath = resolveLedgerPath(".olt/backlog.jsonl");
      expect(defaultPath).toBe(resolve(process.cwd(), ".olt/backlog.jsonl"));

      const customRootPath = resolveLedgerPath(".olt/backlog.jsonl", undefined, tempDir);
      expect(customRootPath).toBe(resolve(tempDir, ".olt/backlog.jsonl"));
    });

    it("resolves relative and absolute custom paths correctly", () => {
      const relativeCustom = resolveLedgerPath(".olt/backlog.jsonl", "custom/sub.jsonl", tempDir);
      expect(relativeCustom).toBe(resolve(tempDir, "custom/sub.jsonl"));

      const absPath = "/var/log/custom.jsonl";
      const resolvedAbs = resolveLedgerPath(".olt/backlog.jsonl", absPath, tempDir);
      expect(resolvedAbs).toBe(absPath);
    });
  });

  describe("transitionBacklogItemsToPlanned", () => {
    it("returns zero counts if backlog file does not exist", () => {
      const result = transitionBacklogItemsToPlanned(join(tempDir, "missing.jsonl"), sampleCluster);
      expect(result).toEqual({ updatedCount: 0, totalCount: 0 });
    });

    it("transitions matching backlog items and preserves non-matching or invalid lines", () => {
      const b1: RawBacklogItem = { id: "item-1", title: "Task 1", status: "PENDING" };
      const b2: RawBacklogItem = { id: "item-2", title: "Task 2", status: "PENDING" };
      const b3: RawBacklogItem = { id: "item-3", title: "Task 3", status: "PENDING" };
      writeFileSync(
        backlogFile,
        `${JSON.stringify(b1)}\n{invalid-json}\n${JSON.stringify(b2)}\n${JSON.stringify(b3)}\n\n`,
      );

      const result = transitionBacklogItemsToPlanned(backlogFile, sampleCluster);
      expect(result.updatedCount).toBe(2);
      expect(result.totalCount).toBe(4);

      const lines = readFileSync(backlogFile, "utf-8").trim().split("\n");
      const updated1 = JSON.parse(lines[0]!) as RawBacklogItem;
      expect(updated1.status).toBe("PLANNED");
      expect(updated1.plan_path).toBe(sampleCluster.plan_path);
      expect(updated1.planned_at).toBe(sampleCluster.planned_at);
      expect(lines[1]).toBe("{invalid-json}");

      const untouched = JSON.parse(lines[3]!) as RawBacklogItem;
      expect(untouched.id).toBe("item-3");
      expect(untouched.status).toBe("PENDING");
    });

    it("handles lock directory resolution when path parent is not named .olt", () => {
      const nonOltDir = join(tempDir, "other-dir");
      mkdirSync(nonOltDir, { recursive: true });
      const customBacklog = join(nonOltDir, "custom-backlog.jsonl");
      writeFileSync(customBacklog, `${JSON.stringify({ id: "item-1", status: "PENDING" })}\n`);

      const res = transitionBacklogItemsToPlanned(customBacklog, sampleCluster);
      expect(res.updatedCount).toBe(1);
      expect(existsSync(join(nonOltDir, ".olt", "locks"))).toBe(true);
    });
  });

  describe("transitionDefectsToPlanned", () => {
    it("returns zero counts if defects file does not exist", () => {
      const result = transitionDefectsToPlanned(
        join(tempDir, "missing-defects.jsonl"),
        sampleCluster,
      );
      expect(result).toEqual({ updatedCount: 0, totalCount: 0 });
    });

    it("transitions matching defect items and preserves non-matching or invalid lines", () => {
      const d1: RawDefectItem = { id: "defect-1", title: "Defect 1", status: "OPEN" };
      const d2: RawDefectItem = { id: "defect-2", title: "Defect 2", status: "OPEN" };
      writeFileSync(
        defectsFile,
        `${JSON.stringify(d1)}\n{bad-json-defect}\n${JSON.stringify(d2)}\n`,
      );

      const result = transitionDefectsToPlanned(defectsFile, sampleCluster);
      expect(result.updatedCount).toBe(1);
      expect(result.totalCount).toBe(3);

      const lines = readFileSync(defectsFile, "utf-8").trim().split("\n");
      const updated = JSON.parse(lines[0]!) as RawDefectItem;
      expect(updated.status).toBe("PLANNED");
      expect(updated.plan_path).toBe(sampleCluster.plan_path);
      expect(lines[1]).toBe("{bad-json-defect}");
      const untouched = JSON.parse(lines[2]!) as RawDefectItem;
      expect(untouched.status).toBe("OPEN");
    });
  });

  describe("updateBridgeState & updateBridgeStateBatch", () => {
    it("returns 0 updates if clusters array is empty", () => {
      const res = updateBridgeStateBatch([]);
      expect(res).toEqual({ itemsUpdated: 0, defectsUpdated: 0 });
    });

    it("updates both backlog and defects files in batch across multiple clusters", () => {
      const cluster2: ThematicCluster = {
        cluster_id: "cluster-mind-002",
        domain: "validation",
        title: "Validation Hardening",
        plan_path: "plans/validation-plan.md",
        backlog_item_ids: ["item-3"],
        defect_ids: ["defect-2"],
        planned_at: "2026-09-01T13:00:00.000Z",
      };

      const b1: RawBacklogItem = { id: "item-1", status: "PENDING" };
      const b2: RawBacklogItem = { id: "item-3", status: "PENDING" };
      const b3: RawBacklogItem = { id: "item-other", status: "PENDING" };
      writeFileSync(
        backlogFile,
        `${JSON.stringify(b1)}\n${JSON.stringify(b2)}\n${JSON.stringify(b3)}\n{broken-item}\n`,
      );

      const d1: RawDefectItem = { id: "defect-1", status: "OPEN" };
      const d2: RawDefectItem = { id: "defect-2", status: "OPEN" };
      writeFileSync(defectsFile, `${JSON.stringify(d1)}\n${JSON.stringify(d2)}\n{broken-defect}\n`);

      const result = updateBridgeStateBatch([sampleCluster, cluster2], {
        backlogFile,
        defectsFile,
        rootDir: tempDir,
      });

      expect(result.itemsUpdated).toBe(2);
      expect(result.defectsUpdated).toBe(2);

      const readBacklog = readFileSync(backlogFile, "utf-8");
      expect(readBacklog).toContain(sampleCluster.plan_path);
      expect(readBacklog).toContain(cluster2.plan_path);
      expect(readBacklog).toContain("{broken-item}");

      const readDefects = readFileSync(defectsFile, "utf-8");
      expect(readDefects).toContain(sampleCluster.plan_path);
      expect(readDefects).toContain(cluster2.plan_path);
      expect(readDefects).toContain("{broken-defect}");
    });

    it("handles single cluster update via updateBridgeState convenience wrapper", () => {
      writeFileSync(backlogFile, `${JSON.stringify({ id: "item-1", status: "PENDING" })}\n`);
      writeFileSync(defectsFile, `${JSON.stringify({ id: "defect-1", status: "OPEN" })}\n`);

      const result = updateBridgeState(sampleCluster, {
        backlogFile,
        defectsFile,
        rootDir: tempDir,
      });

      expect(result.itemsUpdated).toBe(1);
      expect(result.defectsUpdated).toBe(1);
    });

    it("handles missing target files gracefully when updating batch", () => {
      const result = updateBridgeStateBatch([sampleCluster], {
        backlogFile: join(tempDir, "missing-b.jsonl"),
        defectsFile: join(tempDir, "missing-d.jsonl"),
        rootDir: tempDir,
      });
      expect(result).toEqual({ itemsUpdated: 0, defectsUpdated: 0 });
    });
  });

  describe("Flock error conditions", () => {
    it("retries and succeeds when lock is initially unavailable", () => {
      writeFileSync(backlogFile, `${JSON.stringify({ id: "item-1", status: "PENDING" })}\n`);
      let attempts = 0;
      const flockSpy = spyOn(flockModule, "tryExclusiveFlock").mockImplementation(() => {
        attempts++;
        return attempts >= 2;
      });
      try {
        const result = transitionBacklogItemsToPlanned(backlogFile, sampleCluster);
        expect(result.updatedCount).toBe(1);
        expect(attempts).toBeGreaterThanOrEqual(2);
      } finally {
        flockSpy.mockRestore();
      }
    });

    it("throws HarnessError INVALID_STATE if flock acquisition throws an error", () => {
      writeFileSync(backlogFile, `${JSON.stringify({ id: "item-1" })}\n`);
      const spy = spyOn(flockModule, "tryExclusiveFlock").mockImplementation(() => {
        throw new Error("Simulated FFI failure");
      });
      try {
        expect(() => transitionBacklogItemsToPlanned(backlogFile, sampleCluster)).toThrow(
          /Flock FFI acquisition failed/,
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("throws HarnessError LOCK_TIMEOUT if flock cannot be acquired within timeout", () => {
      writeFileSync(backlogFile, `${JSON.stringify({ id: "item-1" })}\n`);
      const flockSpy = spyOn(flockModule, "tryExclusiveFlock").mockReturnValue(false);
      let currentTime = 100000;
      const dateSpy = spyOn(Date, "now").mockImplementation(() => {
        currentTime += 6000;
        return currentTime;
      });
      try {
        expect(() => transitionBacklogItemsToPlanned(backlogFile, sampleCluster)).toThrow(
          /Timed out acquiring flock lock/,
        );
      } finally {
        flockSpy.mockRestore();
        dateSpy.mockRestore();
      }
    });
  });
});
