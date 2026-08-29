import { cause, example, type ExplainEntry } from "./explain-data-types.ts";

export const PATH_SAFETY_AND_INTEGRITY_ENTRIES: readonly ExplainEntry[] = [
  {
    code: "PATH_SAFETY",
    summary: "A path the harness touched does not resolve where its caller claims it does.",
    rule: "Every path a gate, installer, run-lock or submission-report check touches must resolve, by real filesystem identity (lstat/realpath/dev+ino, not string prefixing), to a location genuinely inside its declared boundary; it must not be a symlink, or gain one along its ancestry, at any point checked; and it must still be that same filesystem object when the harness actually uses it.",
    causes: [
      cause(
        "escapes-declared-root",
        "Path resolves outside its declared boundary",
        "A path argument resolves outside the boundary the command declared: repositoryRoot, runRoot, or a task's own write scope/ownership.",
        "Pass a path that already resolves inside the declared root. A bare '.' as a gate path operand is refused outright, not silently narrowed - name the actual path or glob instead of the whole tree.",
        [
          example("engine/runner/policy.ts", "cwd must be within repositoryRoot"),
          example(
            "engine/runner/artifact-paths.ts",
            "command artifact escapes run root: ${absolutePath}",
          ),
          example(
            "workflow/submission/validate-report.ts",
            "report changed a path outside task ownership",
          ),
          example("engine/runner/gate-path-operands.ts", "gate path operand is unsafe: ${operand}"),
        ],
      ),
      cause(
        "symlink-in-path",
        "Path is, or passes through, a symlink",
        "A path or one of its ancestors is a symbolic link where the harness requires a real file or directory.",
        "Replace the symlink with the real file/directory, or point the flag at the real target directly - these checks use lstat, so a symlink is refused even when it resolves somewhere valid.",
        [
          example("engine/runner/gate-path-file.ts", "gate path must not be symbolic"),
          example("installer/install-roots.ts", "home must be a real directory, not a symlink"),
          example(
            "workflow/lease/write-scope-hash.ts",
            "write scope entry is a symlink: ${absPath}",
          ),
          example("installer/durable-tree.ts", "cannot sync symlinked tree path: ${path}"),
        ],
      ),
      cause(
        "identity-drifted-mid-operation",
        "Path identity changed between check and use",
        "A path was re-stat'd mid-operation and no longer matches the identity captured when the operation started - a TOCTOU guard, not a one-time check.",
        "Something else mutated the path between the check and the read: another agent, a build step, a concurrent install. Stop the concurrent writer and rerun.",
        [
          example("engine/runner/gate-path-file.ts", "gate path changed while opening"),
          example("platform/index.ts", "run root identity changed while locked: ${runRoot}"),
        ],
      ),
      cause(
        "path-env-not-absolute",
        "PATH environment entry is not absolute",
        "A PATH environment variable the harness passes to a gate command contains a relative entry.",
        "Fix the PATH the gate command inherits so every entry is an absolute directory; a relative PATH entry is refused outright, not merely skipped.",
        [
          example(
            "engine/runner/gate-environment.ts",
            "gate PATH must contain only absolute directories",
          ),
        ],
      ),
      cause(
        "gate-executable-unresolvable",
        "Gate executable cannot be resolved or is not executable",
        "The command named by --gate cannot be found on PATH (or as an absolute path), or the file found is not marked executable.",
        "Point --gate at a command whose executable actually exists (on PATH or as an absolute path) and carries the executable bit.",
        [
          example(
            "engine/runner/gate-path-binding-verify.ts",
            "gate executable is not resolvable: ${argument}",
          ),
          example(
            "engine/runner/gate-path-bindings.ts",
            "resolved gate executable is not executable",
          ),
        ],
      ),
    ],
  },
  {
    code: "INTEGRITY",
    summary:
      "Something the harness persisted or is about to trust no longer matches what it must be.",
    rule: "An event chain, a durable command record, a role/packet contract, a compiled graph, or a repository/skill-tree scan failed its own structural shape check, drifted between two reads of the same thing, or exceeded a hard byte/entry limit while being captured.",
    causes: [
      cause(
        "scan-instability",
        "Repository or tree scan was unstable (TOCTOU)",
        "A file or listing changed identity between two reads taken during the same repository content scan, Git-control scan, or skill-tree hash.",
        "Nothing else may write to the repository or skill tree while a packet is being built or the installer is hashing it. Stop concurrent edits and rerun.",
        [
          example(
            "packets/repository-content-node.ts",
            "repository content scan was unstable: ${entry.path}",
          ),
          example(
            "packets/repository-git-controls.ts",
            "repository Git control changed during scan: ${name}",
          ),
          example(
            "installer/tree-digest.ts",
            "skill tree path changed identity while hashing: ${path}",
          ),
        ],
      ),
      cause(
        "scan-limit-exceeded",
        "Scan exceeded a configured byte/entry limit",
        "A repository content scan, Git command output capture, or write-scope hash exceeded the byte or entry ceiling configured for it.",
        "Narrow the scope (write scope, gate output, tracked tree) below the configured limit, or raise the matching limit in harness.config.json if the workload genuinely needs it.",
        [
          example("packets/repository-content.ts", "repository content file limit exceeded"),
          example(
            "packets/repository-git-command.ts",
            "repository Git command output byte limit exceeded",
          ),
          example(
            "workflow/lease/write-scope-hash.ts",
            "write scope entry count exceeds the hashing limit",
          ),
        ],
      ),
      cause(
        "persisted-state-malformed",
        "Persisted state failed its own shape check",
        "state.json, a manifest, or a capsule index was read back and does not match the structural shape the harness requires of it.",
        "This is state.json / manifest / index corruption, not a bad flag. Run doctor to confirm, then doctor:repair to re-derive state from the event chain - never hand-edit state.json.",
        [
          example("workflow/branch/ledger.ts", "state.branches must be an array of branch records"),
          example(
            "workflow/agents/ledger.ts",
            "state.agents must be an array of agent grant records",
          ),
          example("engine/store/capsule-index.ts", "${INDEX_FILE} is not a capsule index"),
        ],
      ),
      cause(
        "durable-command-intent-mismatch",
        "Durable command record does not match its intent",
        "A command's persisted durable-intent record does not match what is about to execute, or its retry count exceeds the configured policy.",
        "Internal consistency guard between a command's durable record and what's about to run, usually surfacing after a crash mid-command. Run doctor / recover rather than replaying the same command by hand.",
        [
          example(
            "engine/runner/execute-internal-command.ts",
            "prepared command does not match its durable intent",
          ),
          example(
            "integration/reconcile-command-attempts.ts",
            "durable command attempts exceed retry policy",
          ),
          example(
            "integration/record-command.ts",
            'command evidence is invalid: ${issues.join("; ")}',
          ),
        ],
      ),
      cause(
        "graph-or-plan-structurally-invalid",
        "Compiled graph or plan failed structural validation",
        "The dependency graph contains an execution cycle, or the compiled graph/plan projection failed its own validation.",
        "Fix the plan before compiling: remove the circular dependency, or correct whatever the reported issues list names.",
        [
          example("engine/scheduler/metrics.ts", "depends_on edges contain an execution cycle"),
          example("graph/compiler.ts", 'compiled graph failed validation: ${issues.join("; ")}'),
          example("graph/apply-plan.ts", "plan is invalid"),
        ],
      ),
      cause(
        "packet-or-role-contract-mismatch",
        "Packet or role contract does not match what it should",
        "A published packet's role, digest, or bundle does not match the packet or role contract it is checked against.",
        "Don't hand-edit role contract files or packet bundles under the run root; they are generated and digest-checked. Regenerate through the harness command that produced them.",
        [
          example(
            "packets/render-packet.ts",
            "packet role contract does not match the packet role",
          ),
          example(
            "packets/role-contract.ts",
            "role contract ${path} declares role ${contract.role}",
          ),
          example("packets/packet-bundle.ts", "packet bundle is missing or differs: ${id}"),
        ],
      ),
      cause(
        "lease-postcondition-failed",
        "A lease mutation left the record without a lease",
        "task:claim or queue:pop mutated a task's lease and, immediately afterward, the record does not carry the lease that mutation just set.",
        "An internal post-condition failed right after the mutation that should have set it - not something a flag can fix. Report it, and run doctor to check overall capsule health.",
        [
          example("cli/commands/task-claim.ts", "claim of ${taskId} left the task without a lease"),
          example("cli/commands/queue.ts", "pop of ${highest.id} left the task without a lease"),
        ],
      ),
    ],
  },
];
