import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { generateSummarySuite } from "../../../orchestrating-long-tasks/scripts/src/summary/generate-summary.ts";

type FlagValue = readonly string[] | string;

/** Flattens a flag map into argv so a whole lifecycle reads as commands rather than as arrays. */
async function cli(
  command: string,
  flags: Record<string, FlagValue>,
  child: readonly string[] = [],
): Promise<Record<string, unknown>> {
  const argv = [command];
  for (const [name, value] of Object.entries(flags)) {
    for (const entry of typeof value === "string" ? [value] : value) argv.push(`--${name}`, entry);
  }
  if (child.length > 0) argv.push("--", ...child);
  return execute(argv);
}

function token(result: Record<string, unknown>): string {
  const value = result.token;
  if (typeof value !== "string") throw new Error(`${String(result.markdown)} returned no token`);
  return value;
}

function commandId(result: Record<string, unknown>): string {
  const value = result.command_id;
  if (typeof value !== "string") throw new Error("run:exec returned no command id");
  return value;
}

function firstFindingId(result: Record<string, unknown>): string {
  const ids = result.finding_ids;
  const first = Array.isArray(ids) ? ids[0] : undefined;
  if (typeof first !== "string") throw new Error("no finding id was returned");
  return first;
}

export interface BuiltRun {
  repo: string;
  run: string;
  markdown: string;
  failingExitCode: unknown;
}

/**
 * One capsule driven entirely through the CLI, exercising every feature the report has to carry:
 * an enhanced plan, two tasks in one wave and a third behind a dependency, a branch with two
 * sub-agents, a probe, a defect pushback with a repair round, gate evidence, a command that exits
 * non-zero, host-reported agent telemetry, a critic verdict and a sealed completion.
 */
export async function buildRunReportCapsule(): Promise<BuiltRun> {
  const repo = mkdtempSync(join(tmpdir(), "harness-b6-"));
  mkdirSync(join(repo, "src"), { recursive: true });
  // C3b: gate:prove reverts a task's write scope back to the sha task:claim recorded as its base
  // and reruns the compiled gate there. `gate.ts` has to actually notice that reversion instead of
  // printing 'gate ok' unconditionally, or a passing review could never carry a genuine falsifiable
  // proof: each task's declared file only exists because that task's own work wrote it (seeded
  // below, after the baseline commit, so none of them are part of it), so reverting the scope back
  // to the baseline makes the named file disappear and the gate genuinely fail.
  writeFileSync(
    join(repo, "gate.ts"),
    [
      "const fs = require('node:fs');",
      "const target = { alpha: 'src/alpha/parser.ts', beta: 'src/beta/index.ts', gamma: 'src/alpha/gamma/index.ts' }[process.argv[2]];",
      "if (target && !fs.existsSync(target)) { console.error(target + ' is missing'); process.exit(1); }",
      "console.log('gate ok');",
    ].join("\n"),
  );
  writeFileSync(join(repo, ".gitignore"), ".capsules/\n");
  writeFileSync(
    join(repo, "prompt.txt"),
    "Build the alpha subsystem.\nBuild the beta subsystem.\nWire gamma onto alpha.\n",
  );
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
  Bun.spawnSync(["git", "config", "user.email", "fixture@example.invalid"], { cwd: repo });
  Bun.spawnSync(["git", "config", "user.name", "fixture"], { cwd: repo });
  Bun.spawnSync(["git", "add", "-A"], { cwd: repo });
  Bun.spawnSync(["git", "commit", "-qm", "baseline"], { cwd: repo });

  const init = await cli("plan:init", {
    repo,
    run: "b6-run",
    "prompt-file": join(repo, "prompt.txt"),
  });
  const run = init.run_root as string;

  await cli("plan:enhance", {
    run,
    actor: "planner-1",
    summary: "Three subsystems, two of them independent",
    observation: "src has no tests yet",
    todo: "Add parser tests",
    risk: "The lexer rewrite may regress",
    "open-question": "Which grammar version applies",
    source: "src/alpha.ts",
  });
  // C1/A3: a task gate must genuinely discriminate its own task — two disjoint-scope tasks sharing
  // byte-identical gate argv is exactly the defect A3-gate-discrimination refuses to compile, so each
  // task below gets `gate.ts` invoked with its own name as an argument rather than one shared literal.
  // C1/A4: gamma's dependency on alpha is only a real barrier if gamma's write scope actually touches
  // something alpha's scope writes; nesting gamma's scope inside alpha's ("wire gamma onto alpha")
  // gives the edge a grounded scope reason instead of a false one, and doubles as A3's own escape
  // hatch for this pair (a parent/child scope is not "disjoint", so it never needed a distinct gate).
  const declarations: readonly (readonly [
    string,
    string,
    string,
    string,
    string,
    (readonly [string, string])[],
  ])[] = [
    ["task-alpha", "Alpha subsystem", "src/alpha", "1", "bun gate.ts alpha", []],
    ["task-beta", "Beta subsystem", "src/beta", "2", "bun gate.ts beta", []],
    [
      "task-gamma",
      "Gamma wiring",
      "src/alpha/gamma",
      "3",
      "bun gate.ts gamma",
      [["task-alpha", "wires onto the alpha module task-alpha's own scope writes"]],
    ],
  ];
  for (const [id, label, scope, lines, gate, deps] of declarations) {
    await cli("plan:add", {
      run,
      id,
      label,
      scope,
      gate,
      actor: "planner-1",
      "requirement-lines": lines,
      ...(deps.length === 0
        ? {}
        : {
            deps: deps.map(([depId]) => depId),
            "dep-reason": deps.map(([depId, reason]) => `${depId}:${reason}`),
          }),
    });
  }
  await cli("plan:compile", {
    run,
    actor: "planner-1",
    "completion-gate": "bun gate.ts",
  });

  await cli("agent:register", {
    run,
    agent: "coordinator-1",
    role: "coordinator",
    host: "claude-code",
  });
  await cli("agent:register", {
    run,
    agent: "worker-alpha",
    role: "implementer",
    host: "claude-code",
    "parent-agent": "coordinator-1",
    "parent-task": "task-alpha",
    model: "test-model-l",
    "model-tier": "l",
    "thinking-level": "high",
    tool: "Read",
  });
  await cli("agent:report", {
    run,
    agent: "worker-alpha",
    tool: "Bash",
    "tokens-in": "1200",
    "tokens-out": "340",
  });
  for (const [agent, task] of [
    ["worker-beta", "task-beta"],
    ["validator-1", "task-alpha"],
    ["validator-2", "task-beta"],
    ["worker-gamma", "task-gamma"],
  ] as const) {
    await cli("agent:register", {
      run,
      agent,
      role: agent.startsWith("validator") ? "validator" : "implementer",
      host: "claude-code",
      "parent-agent": "coordinator-1",
      "parent-task": task,
    });
  }

  const alphaToken = token(
    await cli("task:claim", {
      run,
      task: "task-alpha",
      agent: "worker-alpha",
      role: "implementer",
    }),
  );
  const betaToken = token(
    await cli("task:claim", { run, task: "task-beta", agent: "worker-beta", role: "implementer" }),
  );

  const branch = await cli("branch:open", {
    run,
    "parent-task": "task-alpha",
    agent: "worker-alpha",
    token: alphaToken,
    reason: "the lexer and the parser had to move together",
    repo,
    "sub-task": ["S-lexer", "S-parser"],
    "sub-label": ["S-lexer=Rewrite the lexer", "S-parser=Rewrite the parser"],
    "sub-scope": ["S-lexer=src/alpha/lexer", "S-parser=src/alpha/parser"],
  });
  const branchId = branch.branch_id as string;
  for (const [agent, subTask] of [
    ["sub-lexer", "S-lexer"],
    ["sub-parser", "S-parser"],
  ] as const) {
    await cli("agent:register", {
      run,
      agent,
      role: "sub-implementer",
      host: "claude-code",
      "parent-agent": "worker-alpha",
      "parent-task": subTask,
    });
    const claimed = await cli("branch:claim", {
      run,
      branch: branchId,
      "sub-task": subTask,
      agent,
      role: "sub-implementer",
      repo,
    });
    await cli("branch:submit", {
      run,
      branch: branchId,
      "sub-task": subTask,
      agent,
      token: token(claimed),
      summary: `${subTask} finished`,
    });
    await cli("agent:release", { run, agent, reason: "sub-task submitted" });
  }
  await cli("branch:collect", {
    run,
    branch: branchId,
    agent: "worker-alpha",
    token: alphaToken,
    summary: "lexer and parser landed together",
    repo,
  });

  const alphaWork = commandId(
    await cli("run:exec", { run, task: "task-alpha", actor: "worker-alpha", cwd: repo }, [
      "bun",
      "-e",
      "console.log('alpha work')",
    ]),
  );
  const failing = await cli("run:exec", { run, actor: "coordinator-1", cwd: repo }, [
    "bun",
    "-e",
    "process.exit(3)",
  ]);

  // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
  // claim, so every declared file below has to actually exist and differ, not merely be named.
  mkdirSync(join(repo, "src", "alpha"), { recursive: true });
  writeFileSync(join(repo, "src", "alpha", "parser.ts"), "export const parser = true;\n");
  await cli("task:submit", {
    run,
    task: "task-alpha",
    agent: "worker-alpha",
    token: alphaToken,
    summary: "Alpha complete",
    "files-changed": "src/alpha/parser.ts",
    evidence: alphaWork,
  });
  const alphaValidation = token(
    await cli("task:validate-start", { run, task: "task-alpha", validator: "validator-1" }),
  );
  const alphaGate = commandId(
    await cli(
      "run:exec",
      { run, task: "task-alpha", gate: "gate-alpha", actor: "validator-1", cwd: repo },
      ["bun", "gate.ts", "alpha"],
    ),
  );
  const alphaProbe = await cli("task:probe", {
    run,
    task: "task-alpha",
    validator: "validator-1",
    token: alphaValidation,
    demand: "Prove the lexer rejects an empty payload",
  });
  await cli("gate:prove", { run, task: "task-alpha", actor: "coordinator-1" });
  await cli("task:review", {
    run,
    task: "task-alpha",
    validator: "validator-1",
    token: alphaValidation,
    evidence: alphaGate,
    resolve: `${firstFindingId(alphaProbe)}=${alphaGate}`,
    status: "pass",
    summary: "Alpha proven",
  });

  const betaWork = commandId(
    await cli("run:exec", { run, task: "task-beta", actor: "worker-beta", cwd: repo }, [
      "bun",
      "-e",
      "console.log('beta work')",
    ]),
  );
  mkdirSync(join(repo, "src", "beta"), { recursive: true });
  writeFileSync(join(repo, "src", "beta", "index.ts"), "export const beta = 1;\n");
  await cli("task:submit", {
    run,
    task: "task-beta",
    agent: "worker-beta",
    token: betaToken,
    summary: "Beta complete",
    "files-changed": "src/beta/index.ts",
    evidence: betaWork,
  });
  const betaValidation = token(
    await cli("task:validate-start", { run, task: "task-beta", validator: "validator-1" }),
  );
  const betaGate = commandId(
    await cli(
      "run:exec",
      { run, task: "task-beta", gate: "gate-beta", actor: "validator-1", cwd: repo },
      ["bun", "gate.ts", "beta"],
    ),
  );
  const rejection = await cli("task:reject", {
    run,
    task: "task-beta",
    validator: "validator-1",
    token: betaValidation,
    reason: "the beta entry point never validates its input",
    severity: "important",
    remediation: "validate the payload before the insert",
    evidence: betaGate,
  });
  const repairToken = token(
    await cli("task:claim", { run, task: "task-beta", agent: "worker-beta", role: "repairer" }),
  );
  // C4: the repair claim's baseline is round 1's already-changed content, so the repair needs a
  // further change of its own to avoid resubmitting the exact bytes round 1 left behind.
  writeFileSync(
    join(repo, "src", "beta", "index.ts"),
    "export const beta = 1;\nexport const betaValidatesInput = true;\n",
  );
  await cli("task:submit", {
    run,
    task: "task-beta",
    agent: "worker-beta",
    token: repairToken,
    summary: "Beta validates its input now",
    "files-changed": "src/beta/index.ts",
    evidence: betaWork,
  });
  const betaRevalidation = token(
    await cli("task:validate-start", { run, task: "task-beta", validator: "validator-2" }),
  );
  const betaGateAgain = commandId(
    await cli(
      "run:exec",
      { run, task: "task-beta", gate: "gate-beta", actor: "validator-2", cwd: repo },
      ["bun", "gate.ts", "beta"],
    ),
  );
  const betaProbe = await cli("task:probe", {
    run,
    task: "task-beta",
    validator: "validator-2",
    token: betaRevalidation,
    demand: "Prove the insert rejects an empty payload",
  });
  await cli("gate:prove", { run, task: "task-beta", actor: "coordinator-1" });
  await cli("task:review", {
    run,
    task: "task-beta",
    validator: "validator-2",
    token: betaRevalidation,
    evidence: betaGateAgain,
    resolve: [
      `${firstFindingId(betaProbe)}=${betaGateAgain}`,
      `${rejection.finding_id as string}=${betaGateAgain}`,
    ],
    status: "pass",
    summary: "Beta proven after repair",
  });

  const gammaToken = token(
    await cli("task:claim", {
      run,
      task: "task-gamma",
      agent: "worker-gamma",
      role: "implementer",
    }),
  );
  const gammaWork = commandId(
    await cli("run:exec", { run, task: "task-gamma", actor: "worker-gamma", cwd: repo }, [
      "bun",
      "-e",
      "console.log('gamma work')",
    ]),
  );
  // Gamma's write scope is nested inside alpha's ("src/alpha/gamma") so its dependency on task-alpha
  // has a real scope reason instead of a false barrier — see the `declarations` comment above.
  mkdirSync(join(repo, "src", "alpha", "gamma"), { recursive: true });
  writeFileSync(join(repo, "src", "alpha", "gamma", "index.ts"), "export const gamma = true;\n");
  await cli("task:submit", {
    run,
    task: "task-gamma",
    agent: "worker-gamma",
    token: gammaToken,
    summary: "Gamma wired",
    "files-changed": "src/alpha/gamma/index.ts",
    evidence: gammaWork,
  });
  const gammaValidation = token(
    await cli("task:validate-start", { run, task: "task-gamma", validator: "validator-1" }),
  );
  const gammaGate = commandId(
    await cli(
      "run:exec",
      { run, task: "task-gamma", gate: "gate-gamma", actor: "validator-1", cwd: repo },
      ["bun", "gate.ts", "gamma"],
    ),
  );
  const gammaProbe = await cli("task:probe", {
    run,
    task: "task-gamma",
    validator: "validator-1",
    token: gammaValidation,
    demand: "Prove gamma fails when alpha is reverted",
  });
  await cli("gate:prove", { run, task: "task-gamma", actor: "coordinator-1" });
  await cli("task:review", {
    run,
    task: "task-gamma",
    validator: "validator-1",
    token: gammaValidation,
    evidence: gammaGate,
    resolve: `${firstFindingId(gammaProbe)}=${gammaGate}`,
    status: "pass",
    summary: "Gamma proven",
  });
  await cli("run:exec", { run, gate: "gate-run-completion", actor: "coordinator-1", cwd: repo }, [
    "bun",
    "gate.ts",
  ]);

  await cli("agent:register", {
    run,
    agent: "critic-1",
    role: "completeness-critic",
    host: "claude-code",
    "parent-agent": "coordinator-1",
  });
  const criticToken = token(await cli("critic:start", { run, critic: "critic-1" }));
  const criticGate = commandId(
    await cli("run:exec", { run, actor: "critic-1", cwd: repo }, ["bun", "gate.ts"]),
  );
  const proofs = JSON.stringify(
    ["req-alpha", "req-beta", "req-gamma"].map((requirementId) => ({
      requirement_id: requirementId,
      status: "satisfied",
      evidence: [
        {
          kind: "command",
          reference: criticGate,
          observation: `${requirementId} proven by the critic's own gate run`,
        },
      ],
    })),
  );
  await cli("critic:review", {
    run,
    critic: "critic-1",
    token: criticToken,
    decision: "approve",
    summary: "Every requirement is proven by a recorded gate",
    proofs,
  });
  await cli("run:complete", { run, actor: "coordinator-1", "auth-token": criticToken });

  const suite = generateSummarySuite({ capsulePath: run, writeToDisk: false });
  return { repo, run, markdown: suite.markdown, failingExitCode: failing.exit_code };
}
