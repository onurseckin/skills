import { captureEvalCommand } from "../commands/capture-eval.ts";
import { captureInitCommand } from "../commands/capture-init.ts";
import { captureRunCommand } from "../commands/capture-run.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const CAPTURE_COMMANDS: readonly CommandSpec[] = [
  {
    name: "capture:init",
    aliases: [],
    domain: "capture",
    summary: "Initialize standard capture configuration in repository.",
    description:
      "Generates .capture.yaml or .capture.json with standard presets, default viewports, authentication settings, and example screen targets.",
    flags: [
      optionalFlag("config-dir", "string", "Directory to create the configuration file in."),
      optionalFlag(
        "format",
        "string",
        "Configuration format: yaml or json (default: yaml).",
        "yaml",
      ),
      optionalFlag(
        "preset",
        "string",
        "Preset template: standard-dashboard, marketing-site, mobile-app, full-matrix.",
        "standard-dashboard",
      ),
      optionalFlag("force", "bool", "Overwrite existing configuration file if present."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts capture:init",
      "bun harness.ts capture:init --format json --preset standard-dashboard",
    ],
    handler: captureInitCommand,
  },
  {
    name: "capture:run",
    aliases: [],
    domain: "capture",
    summary: "Execute multi-viewport UI capture and companion manifest persistence.",
    description:
      "Dispatches Playwright or simulated runner across configured screens and viewports, generating screenshots and 1-to-1 companion manifest JSON records.",
    flags: [
      optionalFlag(
        "run",
        "string",
        "Capsule run root for artifact and screenshot ledger ingestion.",
      ),
      optionalFlag("config", "string", "Explicit path to .capture.yaml or .capture.json."),
      optionalFlag("config-dir", "string", "Directory containing capture configuration."),
      optionalFlag("screen", "string", "Filter execution to a specific screen ID."),
      optionalFlag("viewport", "string", "Filter execution to a specific viewport name."),
      optionalFlag("out-dir", "string", "Explicit output directory for captures and manifests."),
      optionalFlag(
        "actor",
        "string",
        "Actor recorded in ledger captures (default: capture-runner).",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts capture:run --config .capture.yaml",
      "bun harness.ts capture:run --run .olt/capsules/<run-id> --screen dashboard --viewport desktop",
    ],
    handler: captureRunCommand,
  },
  {
    name: "capture:eval",
    aliases: [],
    domain: "capture",
    summary: "Evaluate companion manifests against 4-pillar validation engines.",
    description:
      "Performs strict binary certification across mechanical, cognitive, custom, and synthesis pillars with 0 numeric scores.",
    flags: [
      optionalFlag("manifest", "string", "Path to single .manifest.json companion file."),
      optionalFlag(
        "manifest-dir",
        "string",
        "Directory containing .manifest.json companion files.",
      ),
      optionalFlag("strict", "bool", "Exit non-zero (exit code 3) if any defects are found."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts capture:eval --manifest .captures/dashboard-desktop.manifest.json",
      "bun harness.ts capture:eval --manifest-dir .captures --strict",
    ],
    handler: captureEvalCommand,
  },
];
