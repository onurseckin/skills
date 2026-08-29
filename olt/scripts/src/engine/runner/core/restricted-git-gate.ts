import {
  isGitArgv,
  isRestrictedGitDiffArgv,
  restrictedGitDiffArgv,
} from "../../../core/restricted-git";
import { commandLayers } from "../models/command-wrappers";

function effective(argv: readonly string[]): { index: number; argv: readonly string[] } {
  const layers = commandLayers(argv);
  return layers.valid
    ? { index: layers.effectiveIndex, argv: argv.slice(layers.effectiveIndex) }
    : { index: 0, argv };
}

export function isRestrictedGitGate(argv: readonly string[]): boolean {
  const layers = commandLayers(argv);
  return (
    layers.valid &&
    layers.executableIndices.every((index) => {
      const value = argv[index] ?? "";
      return value !== "" && !value.includes("/") && !value.includes("\\");
    }) &&
    isRestrictedGitDiffArgv(argv.slice(layers.effectiveIndex))
  );
}

export function isGitGateCommand(argv: readonly string[]): boolean {
  return isGitArgv(effective(argv).argv);
}

export function restrictedGateGitArgv(argv: readonly string[]): string[] {
  const command = effective(argv);
  if (!isRestrictedGitDiffArgv(command.argv)) return [...argv];
  return [...argv.slice(0, command.index), ...restrictedGitDiffArgv(command.argv)];
}
