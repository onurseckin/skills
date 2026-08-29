import type { ApcaBadgeInfo, AuditedDefect, RGBColor } from "./types.ts";

function sRgbToLinearY(r: number, g: number, b: number): number {
  const rLin = Math.pow(r / 255, 2.4);
  const gLin = Math.pow(g / 255, 2.4);
  const bLin = Math.pow(b / 255, 2.4);
  return 0.2126729 * rLin + 0.7151522 * gLin + 0.072175 * bLin;
}

export function calculateApcaLightnessContrast(textColor: RGBColor, bgColor: RGBColor): number {
  let yTxt = sRgbToLinearY(textColor.r, textColor.g, textColor.b);
  let yBg = sRgbToLinearY(bgColor.r, bgColor.g, bgColor.b);

  const blackThresh = 0.022;
  const expBlack = 1.414;

  if (yTxt < blackThresh) {
    yTxt = yTxt + Math.pow(blackThresh - yTxt, expBlack);
  }
  if (yBg < blackThresh) {
    yBg = yBg + Math.pow(blackThresh - yBg, expBlack);
  }

  const scaleFactor = 1.14;
  let contrast = 0;

  if (yBg > yTxt) {
    const yBgExp = Math.pow(yBg, 0.56);
    const yTxtExp = Math.pow(yTxt, 0.57);
    contrast = (yBgExp - yTxtExp) * scaleFactor;
  } else {
    const yBgExp = Math.pow(yBg, 0.65);
    const yTxtExp = Math.pow(yTxt, 0.62);
    contrast = (yBgExp - yTxtExp) * scaleFactor;
  }

  if (Math.abs(contrast) < 0.1) {
    return 0;
  }
  const rawLc = contrast > 0 ? (contrast - 0.027) * 100 : (contrast + 0.027) * 100;
  return Number(Math.abs(rawLc).toFixed(1));
}

const APCA_PALETTE: Readonly<
  Record<string, { fg: RGBColor; bg: RGBColor; fgHex: string; bgHex: string; glyph: string }>
> = {
  critical: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 183, g: 28, b: 28 },
    fgHex: "#FFFFFF",
    bgHex: "#B71C1C",
    glyph: "●",
  },
  warning: {
    fg: { r: 0, g: 0, b: 0 },
    bg: { r: 255, g: 193, b: 7 },
    fgHex: "#000000",
    bgHex: "#FFC107",
    glyph: "▲",
  },
  open: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 211, g: 47, b: 47 },
    fgHex: "#FFFFFF",
    bgHex: "#D32F2F",
    glyph: "🟢",
  },
  admitted: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 25, g: 118, b: 210 },
    fgHex: "#FFFFFF",
    bgHex: "#1976D2",
    glyph: "✓",
  },
  resolved: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 46, g: 125, b: 50 },
    fgHex: "#FFFFFF",
    bgHex: "#2E7D32",
    glyph: "✓",
  },
  declined: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 97, g: 97, b: 97 },
    fgHex: "#FFFFFF",
    bgHex: "#616161",
    glyph: "✕",
  },
  ignored: {
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 117, g: 117, b: 117 },
    fgHex: "#FFFFFF",
    bgHex: "#757575",
    glyph: "○",
  },
};

export function getApcaBadgeInfo(statusOrSeverity: string): ApcaBadgeInfo {
  const normalized = statusOrSeverity.trim().toLowerCase();
  const warningPalette = APCA_PALETTE["warning"];
  const matchedPalette = APCA_PALETTE[normalized];
  const palette = matchedPalette !== undefined ? matchedPalette : warningPalette;
  if (palette === undefined) {
    throw new Error("unreachable: missing warning palette");
  }
  const lc = calculateApcaLightnessContrast(palette.fg, palette.bg);
  const requiredLc = 60.0;
  const passes = lc >= requiredLc;
  const badgeText = `[${palette.glyph} ${normalized.toUpperCase()} (Lc=${lc.toFixed(1)} | ${passes ? "PASS" : "FAIL"})]`;

  return {
    label: normalized,
    badge_text: badgeText,
    fg_color: palette.fgHex,
    bg_color: palette.bgHex,
    lc,
    required_lc: requiredLc,
    passes_apca: passes,
  };
}

export function renderApcaContrastBadge(statusOrSeverity: string): string {
  return getApcaBadgeInfo(statusOrSeverity).badge_text;
}

function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return `${str}${" ".repeat(width - str.length)}`;
}

export function renderAsciiDefectTable(defects: readonly AuditedDefect[]): string {
  if (defects.length === 0) {
    return [
      "┌────────────────────────────────────────────────────────────────────────┐",
      "│ No recorded defects discovered matching filter criteria               │",
      "└────────────────────────────────────────────────────────────────────────┘",
    ].join("\n");
  }

  const colIdWidth = 24;
  const colCatWidth = 28;
  const colSevWidth = 10;
  const colStatWidth = 10;
  const colApcaWidth = 26;

  const topBorder = `┌${"─".repeat(colIdWidth + 2)}┬${"─".repeat(colCatWidth + 2)}┬${"─".repeat(colSevWidth + 2)}┬${"─".repeat(colStatWidth + 2)}┬${"─".repeat(colApcaWidth + 2)}┐`;
  const header = `│ ${padRight("Defect ID", colIdWidth)} │ ${padRight("Category / Type", colCatWidth)} │ ${padRight("Severity", colSevWidth)} │ ${padRight("Status", colStatWidth)} │ ${padRight("APCA Contrast Indicator", colApcaWidth)} │`;
  const separator = `├${"─".repeat(colIdWidth + 2)}┼${"─".repeat(colCatWidth + 2)}┼${"─".repeat(colSevWidth + 2)}┼${"─".repeat(colStatWidth + 2)}┼${"─".repeat(colApcaWidth + 2)}┤`;
  const bottomBorder = `└${"─".repeat(colIdWidth + 2)}┴${"─".repeat(colCatWidth + 2)}┴${"─".repeat(colSevWidth + 2)}┴${"─".repeat(colStatWidth + 2)}┴${"─".repeat(colApcaWidth + 2)}┘`;

  const rows = defects.map((b) => {
    const idCell = padRight(truncateString(b.id, colIdWidth), colIdWidth);
    const catCell = padRight(truncateString(b.type, colCatWidth), colCatWidth);
    const sevCell = padRight(truncateString(b.severity.toUpperCase(), colSevWidth), colSevWidth);
    const statCell = padRight(truncateString(b.status.toUpperCase(), colStatWidth), colStatWidth);
    const apcaCell = padRight(
      truncateString(renderApcaContrastBadge(b.status), colApcaWidth),
      colApcaWidth,
    );
    return `│ ${idCell} │ ${catCell} │ ${sevCell} │ ${statCell} │ ${apcaCell} │`;
  });

  return [topBorder, header, separator, ...rows, bottomBorder].join("\n");
}
