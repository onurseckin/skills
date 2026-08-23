import { cause, example, type ExplainEntry } from "./explain-data-types.ts";

export const PLATFORM_AND_LOCK_ENTRIES: readonly ExplainEntry[] = [
  {
    code: "LOCK_TIMEOUT",
    summary:
      "The capsule or installer lock was still held by someone else when this command's wait deadline passed.",
    rule: "A capsule run-root lock, or an installer's per-parent lock, was still held by another process at the moment this command's own configured wait deadline expired.",
    causes: [
      cause(
        "lock-held-by-another-process",
        "Lock is actively held elsewhere",
        "Another agent process, or a concurrent installer run, holds the same run-root or installer-parent lock this command needed.",
        "Another agent or process is actively holding the run or installer lock. Wait and retry. If the holder is a dead process from a crash mid-command, that's what doctor / recover exist to find and clear - never force a lock by hand.",
        [
          example(
            "platform/run-lock.ts",
            "timed out after ${maximum}ms waiting for run lock: ${root}",
          ),
          example("installer/installer-lock.ts", "installer parent is already owned: ${parent}"),
        ],
      ),
    ],
  },
  {
    code: "NOT_IMPLEMENTED",
    summary:
      "The command was asked to do something this build does not support for the given input.",
    rule: "The command reached an input shape the current implementation has deliberately not built support for, rather than a caller error or a state problem.",
    causes: [
      cause(
        "gate-prove-unsupported-blob-mode",
        "gate:prove cannot revert a symlink or submodule entry",
        "A task's write scope includes a symlink or submodule blob mode, which gate:prove's scratch-copy revert does not support reconstructing.",
        "Narrow the task's write scope away from the symlink or submodule entry, or prove that gate by hand instead of through gate:prove.",
        [
          example(
            "graph/gate-proof.ts",
            "gate:prove cannot revert ${entry.path}: a symlink or submodule in the write scope is not supported",
          ),
        ],
      ),
    ],
  },
  {
    code: "UNSUPPORTED_PLATFORM",
    summary: "This host cannot provide a POSIX primitive the harness needs.",
    rule: "The harness needs a POSIX primitive this build only knows how to reach on macOS or Linux - process groups, pipe-ownership introspection, inode-bound flock, or atomic rename via renamex_np/renameat2 - and either the OS itself is neither, or the expected libc/library on that host could not be loaded.",
    causes: [
      cause(
        "os-not-darwin-or-linux",
        "Running on neither macOS nor Linux",
        "process.platform is something other than darwin or linux at a point that requires POSIX process groups, flock, or atomic rename.",
        "Run the harness on macOS or Linux; there is no fallback path for another platform.",
        [
          example(
            "runner/platform-policy.ts",
            "monitored commands are unsupported on ${platform}; POSIX process groups are required",
          ),
          example("installer/platform.ts", "installer is unsupported on ${platform}"),
          example(
            "installer/native-rename.ts",
            "atomic installer rename is unsupported on ${process.platform}",
          ),
        ],
      ),
      cause(
        "libc-binding-unavailable",
        "The host's libc could not be located",
        "The dynamic-library candidates this build tries for flock or rename (libSystem.B.dylib, libc.so variants) did not resolve on this host, even though the OS is darwin or linux.",
        "The dynamic-library candidates this build tries didn't resolve on this host - typically an unusual musl/libc layout. Check the underlying error and the host's libc; this is not a flag-level fix.",
        [
          example(
            "platform/flock-ffi.ts",
            "could not load a libc flock implementation: ${String(lastError)}",
          ),
          example(
            "installer/native-rename.ts",
            "could not load atomic installer rename support: ${String(lastError)}",
          ),
        ],
      ),
    ],
  },
];
