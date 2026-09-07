import { afterAll, describe, expect, it, spyOn } from "bun:test";
import {
  assertCursorInvariants,
  ChatError,
  createInitialCursor,
  loadCursor,
  type ReaderCursor,
} from "../../../src/cursor/index.ts";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";

const mockFs = await import("node:fs");

describe("Defect D10: corrupted cursor fails closed, never silently resets to zero", () => {
  const vfs = new ChatVirtualFS();
  vfs.mkdirSync("/cursors", { recursive: true });

  const originalExists = mockFs.existsSync;
  const originalRead = mockFs.readFileSync;

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

  afterAll(() => {
    existsSpy.mockRestore();
    readSpy.mockRestore();
  });

  it("throws CURSOR_CORRUPT on truncated cursor file and does not reset", () => {
    const cursorPath = "/cursors/truncated.cursor.json";
    vfs.writeFileSync(cursorPath, '{"v":1,"room":"room-d10","reader":"r1","contig');

    let caughtError: unknown;
    try {
      loadCursor(cursorPath);
    } catch (err: unknown) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError instanceof ChatError).toBe(true);
    expect((caughtError as ChatError).code).toBe("CURSOR_CORRUPT");
  });

  it("throws CURSOR_CORRUPT on checksum mismatch and does not reset", () => {
    const cursorPath = "/cursors/mismatch.cursor.json";
    const initial = createInitialCursor("room-d10", "r1");
    const tampered: ReaderCursor = {
      ...initial,
      contiguous_seq: 50,
    };
    vfs.writeFileSync(cursorPath, JSON.stringify(tampered));

    let caughtError: unknown;
    try {
      loadCursor(cursorPath);
    } catch (err: unknown) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError instanceof ChatError).toBe(true);
    expect((caughtError as ChatError).code).toBe("CURSOR_CORRUPT");
  });

  it("throws CURSOR_CORRUPT on unsupported cursor version and does not reset", () => {
    const cursorPath = "/cursors/wrong-version.cursor.json";
    const initial = createInitialCursor("room-d10", "r1");
    const wrongVersion = {
      ...initial,
      v: 2,
    };
    vfs.writeFileSync(cursorPath, JSON.stringify(wrongVersion));

    let caughtError: unknown;
    try {
      loadCursor(cursorPath);
    } catch (err: unknown) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError instanceof ChatError).toBe(true);
    expect((caughtError as ChatError).code).toBe("CURSOR_CORRUPT");
  });

  it("returns fresh zero cursor ONLY when file is genuinely absent", () => {
    const absentPath = "/cursors/absent.cursor.json";
    const loaded = loadCursor(absentPath, {
      room: "room-absent",
      reader: "reader-absent",
    });
    expect(loaded.cursor.contiguous_seq).toBe(0);
    expect(loaded.cursor.held).toHaveLength(0);
    expect(loaded.cursor.acked_above).toHaveLength(0);
    expect(loaded.checksum.startsWith("sha256:")).toBe(true);
  });

  it("assertCursorInvariants rejects negative sequence numbers", () => {
    const initial = createInitialCursor("room-d10", "r1");
    const invalidSeq: ReaderCursor = {
      ...initial,
      contiguous_seq: -1,
    };
    expect(() => assertCursorInvariants(invalidSeq)).toThrow(ChatError);
  });
});
