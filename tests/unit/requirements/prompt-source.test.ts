import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { promptSource } from "../../../olt/scripts/src/requirements/prompt-source.ts";

describe("promptSource", () => {
  test("digests a string prompt and splits it into the same lines promptLines would", () => {
    const source = promptSource("First line\nSecond line");
    expect(source?.lines).toEqual(["First line", "Second line"]);
    expect(source?.digest).toBe(
      createHash("sha256").update("First line\nSecond line", "utf8").digest("hex"),
    );
  });

  test("digests raw UTF-8 bytes identically to the equivalent string", () => {
    const bytes = new TextEncoder().encode("café\n");
    const fromBytes = promptSource(bytes);
    const fromString = promptSource("café\n");
    expect(fromBytes?.digest).toBe(fromString?.digest);
    expect(fromBytes?.lines).toEqual(fromString?.lines);
  });

  test("rejects a value that is neither a string nor a byte array", () => {
    expect(promptSource(null)).toBeNull();
    expect(promptSource(undefined)).toBeNull();
    expect(promptSource(42)).toBeNull();
    expect(promptSource({ prompt: "text" })).toBeNull();
  });

  test("rejects bytes that are not valid UTF-8", () => {
    // 0xff is not a valid UTF-8 lead byte anywhere.
    expect(promptSource(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull();
  });
});
