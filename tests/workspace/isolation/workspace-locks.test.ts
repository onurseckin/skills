import { describe, expect, it } from "bun:test";
import { withRunLock } from "../../../olt/scripts/src/platform/process/run-lock.ts";

describe("Workspace Isolation: Workspace Run Locks & Concurrency", () => {
  it("executes operations within run lock synchronously", () => {
    const result = withRunLock(process.cwd(), () => {
      return 42 * 2;
    });
    expect(result).toBe(84);
  });

  it("propagates errors thrown inside locked operation cleanly", () => {
    expect(() => {
      withRunLock(process.cwd(), () => {
        throw new Error("test error inside lock");
      });
    }).toThrow("test error inside lock");
  });

  it("rejects negative timeout values", () => {
    expect(() => {
      withRunLock(
        process.cwd(),
        () => {
          return true;
        },
        { timeoutMs: -100 },
      );
    }).toThrow();
  });
});
