export type HygieneScope = "repo_root" | "scripts_root" | "static_package";
export type HygieneSeverity = "ERROR" | "WARNING";
export type HygieneViolationType =
  | "UNAPPROVED_ROOT_FILE"
  | "UNAPPROVED_ROOT_DIR"
  | "LOOSE_EXECUTABLE"
  | "TEST_ARTIFACT_IN_SCRIPTS"
  | "MISPLACED_FILE"
  | "UNCONFINED_SCRATCH_SCRIPT"
  | "STATIC_PACKAGE_RUNTIME_POLLUTION";

export interface RootHygieneFinding {
  readonly path: string;
  readonly relativePath: string;
  readonly scope: HygieneScope;
  readonly violationType: HygieneViolationType;
  readonly severity: HygieneSeverity;
  readonly message: string;
  readonly isExecutable: boolean;
  readonly sizeBytes: number;
}

export interface QuarantinedFileRecord {
  readonly originalPath: string;
  readonly relativePath: string;
  readonly quarantinePath: string;
  readonly timestamp: string;
  readonly scope: HygieneScope;
  readonly success: boolean;
  readonly error?: string | undefined;
}

export type QuarantineRecord = QuarantinedFileRecord;

export interface RootHygieneOptions {
  readonly repoRoot?: string | undefined;
  readonly quarantineDir?: string | undefined;
  readonly allowedRootFiles?: ReadonlySet<string> | undefined;
  readonly allowedRootDirNames?: ReadonlySet<string> | undefined;
  readonly allowedScriptsDirs?: ReadonlySet<string> | undefined;
  readonly allowedScriptsFiles?: ReadonlySet<string> | undefined;
  readonly fix?: boolean | undefined;
}

export interface RootHygieneScanResult {
  readonly passed: boolean;
  readonly repoRoot: string;
  readonly totalEntriesScanned: number;
  readonly violations: RootHygieneFinding[];
  readonly quarantinedFiles: QuarantinedFileRecord[];
  readonly scanDurationMs: number;
}

export const DEFAULT_ALLOWED_SCRIPTS_DIRS: ReadonlySet<string> = new Set([
  "modularity",
  "sync",
  "testing",
  "src",
  "tools",
  "bin",
  "lib",
  "config",
]);

export const DEFAULT_ALLOWED_SCRIPTS_FILES: ReadonlySet<string> = new Set([
  "README.md",
  ".gitkeep",
  "index.ts",
  "package.json",
  "tsconfig.json",
]);

export const SCRATCH_PATTERNS: readonly RegExp[] = [
  /^fix-.*\.ts$/u,
  /^refactor-.*\.ts$/u,
  /^temp-.*\.ts$/u,
  /^test-.*\.ts$/u,
  /^scratch.*\.ts$/u,
  /.*\.tmp$/u,
  /.*\.log$/u,
  /.*\.coverage$/u,
];

export const TEST_ARTIFACT_PATTERNS: readonly RegExp[] = [
  /\.test\.[a-z]+$/u,
  /\.spec\.[a-z]+$/u,
  /^test-.*$/u,
  /^temp-.*$/u,
  /^scratch-.*$/u,
  /^fix-.*$/u,
  /.*\.tmp$/u,
  /.*\.log$/u,
  /.*\.coverage$/u,
];

export const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".bin",
  ".exe",
  ".cmd",
  ".py",
  ".rb",
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
]);
