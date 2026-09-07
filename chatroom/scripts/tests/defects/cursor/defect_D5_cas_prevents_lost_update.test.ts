import { afterAll, describe, expect, it, spyOn } from "bun:test";
import * as coreModule from "../../../src/core/index.ts";
import { ChatError, createInitialCursor, type ReaderCursor } from "../../../src/cursor/index.ts";
import * as storeModule from "../../../src/cursor/index.ts";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";

const mockFs = await import("node:fs");

describe("Defect D5: CAS token prevents lost updates on concurrent cursor writes", () => {
  const vfs = new ChatVirtualFS();
  vfs.mkdirSync("/cursors", { recursive: true });

  const originalExists = mockFs.existsSync;
  const originalRead = mockFs.readFileSync;
  const originalWriteAtomic = coreModule.writeAtomic;

  const existsSpy = spyOn(mockFs, "existsSync").mockImplementation((targetPath: unknown) => {
    if (String(targetPath).startsWith("/cursors")) {
      return vfs.existsSync(String(targetPath));
    }
    return originalExists(targetPath as Parameters<typeof originalExists>[0]);
  });

  const readSpy = spyOn(mockFs, "readFileSync").mockImplementation(
    (targetPath: unknown, options?: unknown) => {
      if (typeof targetPath === "string" && targetPath.startsWith("/cursors")) {
        return vfs.readFileSync(targetPath, "utf-8") as string;
      }
      return originalRead(
        targetPath as Parameters<typeof originalRead>[0],
        options as Parameters<typeof originalRead>[1],
      );
    },
  );

  const writeSpy = spyOn(coreModule, "writeAtomic").mockImplementation(
    (targetPath: string, content: string | Uint8Array, options) => {
      if (targetPath.startsWith("/cursors")) {
        vfs.writeFileSync(targetPath, content);
        return;
      }
      originalWriteAtomic(targetPath, content, options);
    },
  );

  afterAll(() => {
    existsSpy.mockRestore();
    readSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("ensures no unconditional saveCursor exists and saveCursorCas requires expected token", () => {
    const exportedKeys = Object.keys(storeModule);
    expect(exportedKeys).toContain("saveCursorCas");
    expect(exportedKeys).not.toContain("saveCursor");

    expect(storeModule.saveCursorCas.length).toBeGreaterThanOrEqual(3);
  });

  it("throws CURSOR_CONFLICT when writing against a stale checksum token", () => {
    const testPath = "/cursors/test-cursor.cursor.json";
    const initial = createInitialCursor("room-d5", "reader-d5");

    const firstSave = storeModule.saveCursorCas(testPath, initial, initial.checksum);
    const tokenA = firstSave.checksum;
    expect(tokenA.startsWith("sha256:")).toBe(true);

    const updated1: ReaderCursor = {
      ...firstSave.cursor,
      contiguous_seq: 1,
      last_ack_at: new Date().toISOString(),
    };
    const secondSave = storeModule.saveCursorCas(testPath, updated1, tokenA);
    const tokenB = secondSave.checksum;
    expect(tokenB).not.toBe(tokenA);

    const staleWrite: ReaderCursor = {
      ...firstSave.cursor,
      contiguous_seq: 999,
      last_ack_at: new Date().toISOString(),
    };

    let thrownError: unknown;
    try {
      storeModule.saveCursorCas(testPath, staleWrite, tokenA);
    } catch (err: unknown) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError instanceof ChatError).toBe(true);
    expect((thrownError as ChatError).code).toBe("CURSOR_CONFLICT");

    const loaded = storeModule.loadCursor(testPath);
    expect(loaded.cursor.contiguous_seq).toBe(1);
    expect(loaded.checksum).toBe(tokenB);
  });

  it("rejects CAS update when expected token is empty string", () => {
    const testPath = "/cursors/test-cursor-empty.cursor.json";
    const initial = createInitialCursor("room-d5", "reader-d5");

    expect(() => storeModule.saveCursorCas(testPath, initial, "")).toThrow(ChatError);
  });
});
