import { existsSync, readdirSync, readFileSync } from "node:fs";

export interface FileDensityViolation {
  readonly filePath: string;
  readonly lineCount: number;
  readonly limit: number;
}

export interface DirectoryDensityViolation {
  readonly directoryPath: string;
  readonly fileCount: number;
  readonly limit: number;
}

export interface DensityCheckOptions {
  readonly files?:
    | readonly {
        readonly path: string;
        readonly content?: string | undefined;
        readonly lineCount?: number | undefined;
      }[]
    | undefined;
  readonly directories?:
    | readonly {
        readonly path: string;
        readonly fileCount?: number | undefined;
        readonly filePaths?: readonly string[] | undefined;
      }[]
    | undefined;
  readonly maxLinesPerFile?: number | undefined;
  readonly maxFilesPerDirectory?: number | undefined;
  readonly rootDir?: string | undefined;
}

export interface DensityValidationResult {
  readonly valid: boolean;
  readonly maxLinesPerFile: number;
  readonly maxFilesPerDirectory: number;
  readonly fileViolations: readonly FileDensityViolation[];
  readonly directoryViolations: readonly DirectoryDensityViolation[];
}

export function validateDensityBudgets(options: DensityCheckOptions): DensityValidationResult {
  const maxLines = options.maxLinesPerFile ?? 300;
  const maxFiles = options.maxFilesPerDirectory ?? 10;
  const fileViolations: FileDensityViolation[] = [];
  const directoryViolations: DirectoryDensityViolation[] = [];

  if (options.files) {
    for (const f of options.files) {
      let count = f.lineCount;
      if (count === undefined && f.content !== undefined) count = f.content.split("\n").length;
      if (count === undefined && existsSync(f.path)) {
        count = readFileSync(f.path, "utf-8").split("\n").length;
      }
      if (count !== undefined && count > maxLines) {
        fileViolations.push({ filePath: f.path, lineCount: count, limit: maxLines });
      }
    }
  }

  if (options.directories) {
    for (const d of options.directories) {
      let count = d.fileCount;
      if (count === undefined && d.filePaths) count = d.filePaths.length;
      if (count === undefined && existsSync(d.path)) {
        count = readdirSync(d.path, { withFileTypes: true }).filter((e) => e.isFile()).length;
      }
      if (count !== undefined && count > maxFiles) {
        directoryViolations.push({ directoryPath: d.path, fileCount: count, limit: maxFiles });
      }
    }
  }

  return {
    valid: fileViolations.length === 0 && directoryViolations.length === 0,
    maxLinesPerFile: maxLines,
    maxFilesPerDirectory: maxFiles,
    fileViolations,
    directoryViolations,
  };
}
