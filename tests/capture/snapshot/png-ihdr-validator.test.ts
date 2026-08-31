import { describe, expect, it } from "bun:test";
import {
  extractPngDimensions,
  isPngBuffer,
  PNG_SIGNATURE,
  validatePngBuffer,
} from "../../../olt/scripts/src/capture/runners/png-ihdr-validator.ts";
import { createSyntheticPngBuffer } from "../../../olt/scripts/src/capture/runners/live-capture-runner/synthetic-png.ts";

describe("png-ihdr-validator", () => {
  describe("isPngBuffer", () => {
    it("returns true for valid 8-byte PNG signature in Buffer", () => {
      const buf = Buffer.from(PNG_SIGNATURE);
      expect(isPngBuffer(buf)).toBe(true);
    });

    it("returns true for valid 8-byte PNG signature in Uint8Array", () => {
      const arr = new Uint8Array(PNG_SIGNATURE);
      expect(isPngBuffer(arr)).toBe(true);
    });

    it("returns false for null/undefined or short buffers", () => {
      expect(isPngBuffer(Buffer.alloc(0))).toBe(false);
      expect(isPngBuffer(Buffer.from([137, 80, 78]))).toBe(false);
      expect(isPngBuffer(new Uint8Array(7))).toBe(false);
    });

    it("returns false if any of the first 8 bytes mismatch", () => {
      const corrupt = Buffer.from(PNG_SIGNATURE);
      corrupt[4] = 0x00;
      expect(isPngBuffer(corrupt)).toBe(false);
    });
  });

  describe("extractPngDimensions", () => {
    it("returns dimensions for valid synthetic PNG", () => {
      const png = createSyntheticPngBuffer(320, 240, 100);
      const dims = extractPngDimensions(png);
      expect(dims).toEqual({ width: 320, height: 240 });
    });

    it("returns null if buffer is shorter than 24 bytes", () => {
      const short = Buffer.from([...PNG_SIGNATURE, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      expect(extractPngDimensions(short)).toBeNull();
    });

    it("returns null if IHDR chunk length is not 13", () => {
      const png = createSyntheticPngBuffer(100, 100);
      const modified = Buffer.from(png);
      modified.writeUInt32BE(12, 8);
      expect(extractPngDimensions(modified)).toBeNull();
    });

    it("returns null if chunk type is not IHDR", () => {
      const png = createSyntheticPngBuffer(100, 100);
      const modified = Buffer.from(png);
      modified[12] = 0x41;
      expect(extractPngDimensions(modified)).toBeNull();
    });

    it("returns null if width is 0", () => {
      const png = createSyntheticPngBuffer(100, 100);
      const modified = Buffer.from(png);
      modified.writeUInt32BE(0, 16);
      expect(extractPngDimensions(modified)).toBeNull();
    });

    it("returns null if height is 0", () => {
      const png = createSyntheticPngBuffer(100, 100);
      const modified = Buffer.from(png);
      modified.writeUInt32BE(0, 20);
      expect(extractPngDimensions(modified)).toBeNull();
    });

    it("returns null if width exceeds 2^31 - 1", () => {
      const png = createSyntheticPngBuffer(100, 100);
      const modified = Buffer.from(png);
      modified.writeUInt32BE(0x80000000, 16);
      expect(extractPngDimensions(modified)).toBeNull();
    });

    it("returns null if height exceeds 2^31 - 1", () => {
      const png = createSyntheticPngBuffer(100, 100);
      const modified = Buffer.from(png);
      modified.writeUInt32BE(0x80000000, 20);
      expect(extractPngDimensions(modified)).toBeNull();
    });
  });

  describe("validatePngBuffer", () => {
    it("returns true when dimensions match expected values", () => {
      const png = createSyntheticPngBuffer(800, 600);
      expect(validatePngBuffer(png, 800, 600)).toBe(true);
    });

    it("returns false for non-finite or non-positive expected dimensions", () => {
      const png = createSyntheticPngBuffer(800, 600);
      expect(validatePngBuffer(png, Number.NaN, 600)).toBe(false);
      expect(validatePngBuffer(png, 800, Number.POSITIVE_INFINITY)).toBe(false);
      expect(validatePngBuffer(png, 0, 600)).toBe(false);
      expect(validatePngBuffer(png, 800, -10)).toBe(false);
    });

    it("returns false if extractPngDimensions returns null", () => {
      expect(validatePngBuffer(Buffer.from("invalid"), 800, 600)).toBe(false);
    });

    it("returns false if dimensions do not match expected", () => {
      const png = createSyntheticPngBuffer(800, 600);
      expect(validatePngBuffer(png, 800, 601)).toBe(false);
      expect(validatePngBuffer(png, 799, 600)).toBe(false);
    });
  });
});
