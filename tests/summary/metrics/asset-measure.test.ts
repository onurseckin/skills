import { beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  measureAssets,
  measureCapsuleAsset,
  readHeader,
} from "../../../olt/scripts/src/summary/assets/index.ts";
import type { MediaAsset } from "../../../olt/scripts/src/summary/graph/index.ts";
import { setupVirtualSummaryFS } from "../fixture.ts";

let rootCounter = 0;

beforeEach(() => {
  setupVirtualSummaryFS();
});

function runRoot(): string {
  rootCounter += 1;
  const root = `/virtual/asset-measure-${rootCounter}`;
  fs.mkdirSync(join(root, "evidence"), { recursive: true });
  return root;
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt8(0x89, 0);
  header.write("PNG\r\n \n", 1, "latin1");
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
    fs.writeFileSync(join(root, "evidence", "shot.png"), bytes);

    expect(measureCapsuleAsset(root, "evidence/shot.png")).toEqual({
      sizeBytes: bytes.length,
      dimensions: { width: 1440, height: 900 },
    });
  });

  test("reads a GIF and a top-down BMP, whose headers state their size differently", () => {
    const root = runRoot();
    fs.writeFileSync(join(root, "evidence", "loop.gif"), gif(320, 240));
    fs.writeFileSync(join(root, "evidence", "raster.bmp"), bmp(64, 48));

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
    fs.writeFileSync(join(root, "evidence", "trace.zip"), Buffer.alloc(12, 7));

    const measured = measureCapsuleAsset(root, "evidence/trace.zip");
    expect(measured?.sizeBytes).toBe(12);
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
    rootCounter += 1;
    const outside = `/virtual/asset-outside-${rootCounter}`;
    fs.writeFileSync(join(outside, "secret.png"), png(10, 10));
    fs.symlinkSync(join(outside, "secret.png"), join(root, "evidence", "linked.png"));

    expect(measureCapsuleAsset(root, "../../secret.png")).toBeUndefined();
    expect(measureCapsuleAsset(root, join(outside, "secret.png"))).toBeUndefined();
    expect(measureCapsuleAsset(root, "https://example.invalid/secret.png")).toBeUndefined();
    expect(measureCapsuleAsset(root, "evidence/linked.png")).toBeUndefined();
  });

  test("refuses a path whose parent directory is itself a link out of the capsule", () => {
    const root = runRoot();
    rootCounter += 1;
    const outside = `/virtual/asset-outside-dir-${rootCounter}`;
    fs.writeFileSync(join(outside, "secret.png"), png(10, 10));
    fs.symlinkSync(outside, join(root, "evidence", "elsewhere"));

    expect(measureCapsuleAsset(root, "evidence/elsewhere/secret.png")).toBeUndefined();
  });

  test("refuses a directory, which is not an asset", () => {
    const root = runRoot();
    expect(measureCapsuleAsset(root, "evidence")).toBeUndefined();
  });

  test("reports nothing when the file passes containment checks but cannot be opened", () => {
    const root = runRoot();
    const target = join(root, "evidence", "locked.png");
    fs.writeFileSync(target, png(4, 4));
    fs.chmodSync(target, 0o000);

    try {
      expect(readHeader(target)).toBeUndefined();
    } finally {
      fs.chmodSync(target, 0o644);
    }
  });
});

describe("filling in what nobody measured", () => {
  test("fills the gaps and leaves every recorded value alone", () => {
    const root = runRoot();
    const bytes = png(800, 600);
    fs.writeFileSync(join(root, "evidence", "shot.png"), bytes);

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
    expect(reported?.sizeBytes).toBe(11);
    expect(reported?.dimensions).toEqual({ width: 1, height: 2 });
    expect(absent?.sizeBytes).toBeUndefined();
    expect(absent?.dimensions).toBeUndefined();
  });

  test("keeps the size a source reported while adding the pixels it did not", () => {
    const root = runRoot();
    fs.writeFileSync(join(root, "evidence", "shot.png"), png(120, 90));

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
