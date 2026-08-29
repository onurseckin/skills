export type AnsiRgb = readonly [number, number, number];

export interface CanvasCell {
  readonly char: string;
  readonly width: number;
  readonly fg?: AnsiRgb | undefined;
  readonly bg?: AnsiRgb | undefined;
  readonly bold?: boolean | undefined;
  readonly dim?: boolean | undefined;
  readonly underline?: boolean | undefined;
}

export interface CanvasDiffSpan {
  readonly row: number;
  readonly col: number;
  readonly text: string;
  readonly fg?: AnsiRgb | undefined;
  readonly bg?: AnsiRgb | undefined;
  readonly bold?: boolean | undefined;
  readonly dim?: boolean | undefined;
  readonly underline?: boolean | undefined;
}

const EMPTY_CELL: CanvasCell = {
  char: " ",
  width: 1,
};

export class DoubleBufferedCanvas {
  private width: number;
  private height: number;
  private currentBuffer: CanvasCell[][];
  private previousBuffer: CanvasCell[][];

  constructor(width = 80, height = 24) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.currentBuffer = this.createGrid(this.width, this.height);
    this.previousBuffer = this.createGrid(this.width, this.height);
  }

  public getWidth(): number {
    return this.width;
  }

  public getHeight(): number {
    return this.height;
  }

  public resize(width: number, height: number): void {
    const newWidth = Math.max(1, width);
    const newHeight = Math.max(1, height);
    if (newWidth === this.width && newHeight === this.height) {
      return;
    }
    this.width = newWidth;
    this.height = newHeight;
    this.currentBuffer = this.createGrid(this.width, this.height);
    this.previousBuffer = this.createGrid(this.width, this.height);
  }

  public clear(): void {
    for (let r = 0; r < this.height; r++) {
      const row = this.currentBuffer[r];
      if (!row) continue;
      for (let c = 0; c < this.width; c++) {
        row[c] = EMPTY_CELL;
      }
    }
  }

  public writeCell(row: number, col: number, cell: Partial<CanvasCell>): void {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
      return;
    }
    const targetRow = this.currentBuffer[row];
    if (!targetRow) return;

    const existing = targetRow[col] ?? EMPTY_CELL;
    targetRow[col] = {
      char: cell.char !== undefined ? cell.char : existing.char,
      width: cell.width !== undefined ? cell.width : existing.width,
      fg: cell.fg !== undefined ? cell.fg : existing.fg,
      bg: cell.bg !== undefined ? cell.bg : existing.bg,
      bold: cell.bold !== undefined ? cell.bold : existing.bold,
      dim: cell.dim !== undefined ? cell.dim : existing.dim,
      underline: cell.underline !== undefined ? cell.underline : existing.underline,
    };
  }

  public writeString(
    row: number,
    col: number,
    text: string,
    style?: Partial<Omit<CanvasCell, "char" | "width">>,
  ): void {
    if (row < 0 || row >= this.height) {
      return;
    }

    let currentCol = col;
    for (let i = 0; i < text.length; i++) {
      if (currentCol >= this.width) {
        break;
      }
      const ch = text[i] ?? "";
      this.writeCell(row, currentCol, {
        char: ch,
        width: 1,
        ...style,
      });
      currentCol += 1;
    }
  }

  public computeDiff(): readonly CanvasDiffSpan[] {
    const diffs: CanvasDiffSpan[] = [];

    for (let r = 0; r < this.height; r++) {
      const currRow = this.currentBuffer[r];
      const prevRow = this.previousBuffer[r];
      if (!currRow || !prevRow) continue;

      let c = 0;
      while (c < this.width) {
        const currCell = currRow[c] ?? EMPTY_CELL;
        const prevCell = prevRow[c] ?? EMPTY_CELL;

        if (this.areCellsEqual(currCell, prevCell)) {
          c++;
          continue;
        }

        const startCol = c;
        let text = currCell.char;
        const fg = currCell.fg;
        const bg = currCell.bg;
        const bold = currCell.bold;
        const dim = currCell.dim;
        const underline = currCell.underline;

        c++;
        while (c < this.width) {
          const nextCurr = currRow[c] ?? EMPTY_CELL;
          const nextPrev = prevRow[c] ?? EMPTY_CELL;

          if (this.areCellsEqual(nextCurr, nextPrev)) {
            break;
          }

          if (!this.areStylesEqual(currCell, nextCurr)) {
            break;
          }

          text += nextCurr.char;
          c++;
        }

        diffs.push({
          row: r,
          col: startCol,
          text,
          fg,
          bg,
          bold,
          dim,
          underline,
        });
      }
    }

    return diffs;
  }

  public renderAnsiDiff(): string {
    const diffs = this.computeDiff();
    if (diffs.length === 0) {
      return "";
    }

    let out = "";
    for (const d of diffs) {
      out += `\x1b[${d.row + 1};${d.col + 1}H`;
      out += this.formatStyleEscapes(d);
      out += d.text;
      out += "\x1b[0m";
    }

    this.swapBuffers();
    return out;
  }

  public forceFullRepaint(): string {
    let out = "\x1b[H";
    for (let r = 0; r < this.height; r++) {
      const row = this.currentBuffer[r];
      if (!row) continue;
      out += `\x1b[${r + 1};1H`;
      let line = "";
      for (let c = 0; c < this.width; c++) {
        const cell = row[c] ?? EMPTY_CELL;
        line += cell.char;
      }
      out += line;
    }
    this.swapBuffers();
    return out;
  }

  public swapBuffers(): void {
    for (let r = 0; r < this.height; r++) {
      const currRow = this.currentBuffer[r];
      const prevRow = this.previousBuffer[r];
      if (!currRow || !prevRow) continue;
      for (let c = 0; c < this.width; c++) {
        prevRow[c] = currRow[c] ?? EMPTY_CELL;
      }
    }
  }

  public toString(): string {
    const lines: string[] = [];
    for (let r = 0; r < this.height; r++) {
      const row = this.currentBuffer[r];
      if (!row) continue;
      let line = "";
      for (let c = 0; c < this.width; c++) {
        line += (row[c] ?? EMPTY_CELL).char;
      }
      lines.push(line);
    }
    return lines.join("\n");
  }

  private createGrid(w: number, h: number): CanvasCell[][] {
    const grid: CanvasCell[][] = [];
    for (let r = 0; r < h; r++) {
      const row: CanvasCell[] = [];
      for (let c = 0; c < w; c++) {
        row.push(EMPTY_CELL);
      }
      grid.push(row);
    }
    return grid;
  }

  private areCellsEqual(a: CanvasCell, b: CanvasCell): boolean {
    return a.char === b.char && a.width === b.width && this.areStylesEqual(a, b);
  }

  private areStylesEqual(a: CanvasCell, b: CanvasCell): boolean {
    return (
      this.areColorsEqual(a.fg, b.fg) &&
      this.areColorsEqual(a.bg, b.bg) &&
      Boolean(a.bold) === Boolean(b.bold) &&
      Boolean(a.dim) === Boolean(b.dim) &&
      Boolean(a.underline) === Boolean(b.underline)
    );
  }

  private areColorsEqual(a?: AnsiRgb, b?: AnsiRgb): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  private formatStyleEscapes(span: CanvasDiffSpan): string {
    let esc = "";
    if (span.bold) esc += "\x1b[1m";
    if (span.dim) esc += "\x1b[2m";
    if (span.underline) esc += "\x1b[4m";
    if (span.fg) esc += `\x1b[38;2;${span.fg[0]};${span.fg[1]};${span.fg[2]}m`;
    if (span.bg) esc += `\x1b[48;2;${span.bg[0]};${span.bg[1]};${span.bg[2]}m`;
    return esc;
  }
}
