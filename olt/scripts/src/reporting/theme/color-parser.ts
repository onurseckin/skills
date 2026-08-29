import type { RgbaColor } from "./types.ts";
import { NAMED_COLORS } from "./named-colors.ts";

export function clampByte(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function clampAlpha(n: number): number {
  if (Number.isNaN(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

export function parseChannelValue(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed.slice(0, -1));
    return (pct / 100) * 255;
  }
  return parseFloat(trimmed);
}

export function parseAlphaValue(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed.slice(0, -1));
    return clampAlpha(pct / 100);
  }
  return clampAlpha(parseFloat(trimmed));
}

export function parseHue(hueStr: string): number {
  const trimmed = hueStr.trim().toLowerCase();
  if (trimmed.endsWith("turn")) {
    const turns = parseFloat(trimmed.slice(0, -4));
    if (Number.isNaN(turns)) return 0;
    return (((turns * 360) % 360) + 360) % 360;
  }
  if (trimmed.endsWith("grad")) {
    const grad = parseFloat(trimmed.slice(0, -4));
    if (Number.isNaN(grad)) return 0;
    const deg = (grad * 360) / 400;
    return ((deg % 360) + 360) % 360;
  }
  if (trimmed.endsWith("rad")) {
    const rad = parseFloat(trimmed.slice(0, -3));
    if (Number.isNaN(rad)) return 0;
    const deg = (rad * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }
  if (trimmed.endsWith("deg")) {
    const deg = parseFloat(trimmed.slice(0, -3));
    if (Number.isNaN(deg)) return 0;
    return ((deg % 360) + 360) % 360;
  }
  const deg = parseFloat(trimmed);
  if (Number.isNaN(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

export function parsePercentage(str: string): number {
  const trimmed = str.trim();
  if (trimmed.endsWith("%")) {
    const val = parseFloat(trimmed.slice(0, -1));
    return Math.max(0, Math.min(1, val / 100));
  }
  const val = parseFloat(trimmed);
  if (Number.isNaN(val)) return 0;
  return val <= 1 ? Math.max(0, val) : Math.max(0, Math.min(1, val / 100));
}

export function isValidColor(color: string): boolean {
  if (typeof color !== "string") return false;
  const trimmed = color.trim().toLowerCase();
  if (trimmed === "") return false;
  if (trimmed in NAMED_COLORS) return true;
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    return (
      (hex.length === 3 || hex.length === 4 || hex.length === 6 || hex.length === 8) &&
      /^[0-9a-f]+$/i.test(hex)
    );
  }
  if (/^[0-9a-f]{3,8}$/i.test(trimmed)) {
    return (
      trimmed.length === 3 || trimmed.length === 4 || trimmed.length === 6 || trimmed.length === 8
    );
  }
  if (/^rgba?\s*\(/i.test(trimmed)) {
    const match = trimmed.match(
      /^rgba?\s*\(\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:\s*(?:,|\/)\s*([^,\s/]+))?\s*\)$/i,
    );
    return match !== null;
  }
  if (/^hsla?\s*\(/i.test(trimmed)) {
    const match = trimmed.match(
      /^hsla?\s*\(\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:\s*(?:,|\/)\s*([^,\s/]+))?\s*\)$/i,
    );
    return match !== null;
  }
  return false;
}

export function parseRgb(color: string): RgbaColor {
  if (typeof color !== "string") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const trimmed = color.trim().toLowerCase();
  if (trimmed === "" || trimmed === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const named = NAMED_COLORS[trimmed];
  if (named !== undefined) {
    const [nr, ng, nb] = named;
    return { r: nr, g: ng, b: nb, a: 1 };
  }

  const hexStr = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{3}$/i.test(hexStr)) {
    const rChar = hexStr[0];
    const gChar = hexStr[1];
    const bChar = hexStr[2];
    if (rChar !== undefined && gChar !== undefined && bChar !== undefined) {
      return {
        r: parseInt(rChar + rChar, 16),
        g: parseInt(gChar + gChar, 16),
        b: parseInt(bChar + bChar, 16),
        a: 1,
      };
    }
  }
  if (/^[0-9a-f]{4}$/i.test(hexStr)) {
    const rChar = hexStr[0];
    const gChar = hexStr[1];
    const bChar = hexStr[2];
    const aChar = hexStr[3];
    if (rChar !== undefined && gChar !== undefined && bChar !== undefined && aChar !== undefined) {
      return {
        r: parseInt(rChar + rChar, 16),
        g: parseInt(gChar + gChar, 16),
        b: parseInt(bChar + bChar, 16),
        a: clampAlpha(parseInt(aChar + aChar, 16) / 255),
      };
    }
  }
  if (/^[0-9a-f]{6}$/i.test(hexStr)) {
    return {
      r: parseInt(hexStr.slice(0, 2), 16),
      g: parseInt(hexStr.slice(2, 4), 16),
      b: parseInt(hexStr.slice(4, 6), 16),
      a: 1,
    };
  }
  if (/^[0-9a-f]{8}$/i.test(hexStr)) {
    return {
      r: parseInt(hexStr.slice(0, 2), 16),
      g: parseInt(hexStr.slice(2, 4), 16),
      b: parseInt(hexStr.slice(4, 6), 16),
      a: clampAlpha(parseInt(hexStr.slice(6, 8), 16) / 255),
    };
  }

  const rgbMatch = trimmed.match(
    /^rgba?\s*\(\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:\s*(?:,|\/)\s*([^,\s/]+))?\s*\)$/i,
  );
  if (rgbMatch) {
    const rRaw = rgbMatch[1];
    const gRaw = rgbMatch[2];
    const bRaw = rgbMatch[3];
    const aRaw = rgbMatch[4];
    if (rRaw !== undefined && gRaw !== undefined && bRaw !== undefined) {
      const r = clampByte(parseChannelValue(rRaw));
      const g = clampByte(parseChannelValue(gRaw));
      const b = clampByte(parseChannelValue(bRaw));
      const a = parseAlphaValue(aRaw);
      return { r, g, b, a };
    }
  }

  const hslMatch = trimmed.match(
    /^hsla?\s*\(\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:\s*(?:,|\/)\s*([^,\s/]+))?\s*\)$/i,
  );
  if (hslMatch) {
    const hRaw = hslMatch[1];
    const sRaw = hslMatch[2];
    const lRaw = hslMatch[3];
    const aRaw = hslMatch[4];
    if (hRaw !== undefined && sRaw !== undefined && lRaw !== undefined) {
      const h = parseHue(hRaw);
      const s = parsePercentage(sRaw);
      const l = parsePercentage(lRaw);
      const a = parseAlphaValue(aRaw);

      const k = (n: number): number => (n + h / 30) % 12;
      const f = (n: number): number =>
        l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));

      return {
        r: clampByte(f(0) * 255),
        g: clampByte(f(8) * 255),
        b: clampByte(f(4) * 255),
        a,
      };
    }
  }

  return { r: 0, g: 0, b: 0, a: 0 };
}

export function compositeRgb(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const fgA = Math.max(0, Math.min(1, foreground.a));
  const bgA = Math.max(0, Math.min(1, background.a));
  const outA = fgA + bgA * (1 - fgA);

  if (outA <= 0.0001) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const r = Math.round((foreground.r * fgA + background.r * bgA * (1 - fgA)) / outA);
  const g = Math.round((foreground.g * fgA + background.g * bgA * (1 - fgA)) / outA);
  const b = Math.round((foreground.b * fgA + background.b * bgA * (1 - fgA)) / outA);

  return {
    r: clampByte(r),
    g: clampByte(g),
    b: clampByte(b),
    a: clampAlpha(outA),
  };
}
