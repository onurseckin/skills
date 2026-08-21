import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  measureAssets,
  measureCapsuleAsset,
  readHeader,
} from "../../../orchestrating-long-tasks/scripts/src/summary/asset-measure.ts";
import type { MediaAsset } from "../../../orchestrating-long-tasks/scripts/src/summary/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "asset-measure-"));
  roots.push(root);
  mkdirSync(join(root, "evidence"), { recursive: true });
  return root;
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt8(0x89, 0);
  header.write("PNG\r\n\n", 1, "latin1");
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(40)]);
}

function gif(width: number, height: number): Buffer {
  const header = Buffer.alloc(16);
  header.write("GIF89a", 0, "latin1");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  return header;
}

function bmp(width: number, height: number): Buffer {
  const header = Buffer.alloc(30);
  header.write("BM", 0, "latin1");
  header.writeInt32LE(width, 18);
  // A negative height is how a bitmap says it is stored top-down; the size is still its magnitude.
  header.writeInt32LE(-height, 22);
  return header;
}

function asset(url: string, overrides: Partial<MediaAsset> = {}): MediaAsset {
  return { id: `asset-${url}`, type: "image", url, ...overrides };
}

describe("measuring an asset the capsule still holds", () => {
  test("reads the byte size and the pixel size out of a PNG header", () => {
    const root = runRoot();
    const bytes = png(1440, 900);
    writeFileSync(join(root, "evidence", "shot.png"), bytes);

    expect(measureCapsuleAsset(root, "evidence/shot.png")).toEqual({
      sizeBytes: bytes.length,
      dimensions: { width: 1440, height: 900 },
    });
  });

  test("reads a GIF and a top-down BMP, whose headers state their size differently", () => {
    const root = runRoot();
    writeFileSync(join(root, "evidence", "loop.gif"), gif(320, 240));
    writeFileSync(join(root, "evidence", "raster.bmp"), bmp(64, 48));

    expect(measureCapsuleAsset(root, "evidence/loop.gif")?.dimensions).toEqual({
      width: 320,
      height: 240,
    });
    expect(measureCapsuleAsset(root, "evidence/raster.bmp")?.dimensions).toEqual({
      width: 64,
      height: 48,
    });
  });

  test("reports the size but no dimensions for a format it cannot read", () => {
    const root = runRoot();
    writeFileSync(join(root, "evidence", "trace.zip"), Buffer.alloc(12, 7));

    const measured = measureCapsuleAsset(root, "evidence/trace.zip");
    expect(measured?.sizeBytes).toBe(12);
    // A guessed resolution would be indistinguishable from a measured one, so there is none.
    expect(measured?.dimensions).toBeUndefined();
  });

  test("measures nothing it cannot open", () => {
    const root = runRoot();
    expect(measureCapsuleAsset(root, "evidence/absent.png")).toBeUndefined();
    expect(measureCapsuleAsset(undefined, "evidence/absent.png")).toBeUndefined();
    expect(measureCapsuleAsset(root, "")).toBeUndefined();
    expect(measureCapsuleAsset("/nonexistent-capsule-root", "evidence/x.png")).toBeUndefined();
  });

  test("refuses to follow a url out of the capsule, however it is written", () => {
    const root = runRoot();
    const outside = mkdtempSync(join(tmpdir(), "asset-outside-"));
    roots.push(outside);
    writeFileSync(join(outside, "secret.png"), png(10, 10));
    symlinkSync(join(outside, "secret.png"), join(root, "evidence", "linked.png"));

    // An asset url is a string a command printed; following it must not let a log pick the reads.
    expect(measureCapsuleAsset(root, "../../secret.png")).toBeUndefined();
    expect(measureCapsuleAsset(root, join(outside, "secret.png"))).toBeUndefined();
    expect(measureCapsuleAsset(root, "https://example.invalid/secret.png")).toBeUndefined();
    expect(measureCapsuleAsset(root, "evidence/linked.png")).toBeUndefined();
  });

  test("refuses a path whose parent directory is itself a link out of the capsule", () => {
    const root = runRoot();
    const outside = mkdtempSync(join(tmpdir(), "asset-outside-dir-"));
    roots.push(outside);
    writeFileSync(join(outside, "secret.png"), png(10, 10));
    // The url stays under the run root and the file at the end of it is a regular file; only the
    // directory on the way in is the link, which is why containment is re-asked of the real path.
    symlinkSync(outside, join(root, "evidence", "elsewhere"));

    expect(measureCapsuleAsset(root, "evidence/elsewhere/secret.png")).toBeUndefined();
  });

  test("refuses a directory, which is not an asset", () => {
    const root = runRoot();
    expect(measureCapsuleAsset(root, "evidence")).toBeUndefined();
  });

  test("reports nothing when the file passes containment checks but cannot be opened", () => {
    const root = runRoot();
    const target = join(root, "evidence", "locked.png");
    writeFileSync(target, png(4, 4));
    chmodSync(target, 0o000);

    // Permission loss alone denies capsuleFile's own realpath containment check before
    // readHeader ever runs, so this covers readHeader's own open failure directly.
    try {
      expect(readHeader(target)).toBeUndefined();
    } finally {
      chmodSync(target, 0o644);
    }
  });
});

describe("filling in what nobody measured", () => {
  test("fills the gaps and leaves every recorded value alone", () => {
    const root = runRoot();
    const bytes = png(800, 600);
    writeFileSync(join(root, "evidence", "shot.png"), bytes);

    const [measured, reported, absent] = measureAssets(
      [
        asset("evidence/shot.png"),
        asset("evidence/shot.png", {
          id: "reported",
          sizeBytes: 11,
          dimensions: { width: 1, height: 2 },
        }),
        asset("evidence/gone.png"),
      ],
      root,
    );

    expect(measured?.sizeBytes).toBe(bytes.length);
    expect(measured?.dimensions).toEqual({ width: 800, height: 600 });
    // What a source reported stands; this pass measures what nobody measured.
    expect(reported?.sizeBytes).toBe(11);
    expect(reported?.dimensions).toEqual({ width: 1, height: 2 });
    expect(absent?.sizeBytes).toBeUndefined();
    expect(absent?.dimensions).toBeUndefined();
  });

  test("keeps the size a source reported while adding the pixels it did not", () => {
    const root = runRoot();
    writeFileSync(join(root, "evidence", "shot.png"), png(120, 90));

    const [only] = measureAssets([asset("evidence/shot.png", { sizeBytes: 4 })], root);
    expect(only?.sizeBytes).toBe(4);
    expect(only?.dimensions).toEqual({ width: 120, height: 90 });
  });

  test("does nothing at all without a capsule to measure against", () => {
    const assets = [asset("evidence/shot.png")];
    expect(measureAssets(assets, undefined)).toBe(assets);
    expect(assets[0]?.sizeBytes).toBeUndefined();
  });
});
