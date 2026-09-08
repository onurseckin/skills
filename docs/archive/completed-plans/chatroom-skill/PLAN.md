# Chatroom Skill — Design Specification

> **Tracking ID:** `plan-chatroom-skill`
> **Priority:** `P1_USER_MANDATE`
> **Status:** `DESIGN SPECIFICATION — READY FOR IMPLEMENTATION`
> **Target Subsystems:** new top-level `chatroom/` skill directory; `scripts/sync/` (deployment extension only)
> **Non-Targets:** `olt/**` (read-only reference), `tests/**` for OLT, `scripts/**` except sync deployment
> **Date:** 2026-09-06

---

## 0. How To Read This Document

This is a _design specification_, not a tutorial. It is written so that an implementer can build
`chatroom/` without inventing architecture. Every structural decision that prevents a known defect is
stated as an invariant with the word **MUST** or **Structural guarantee**, and is tied back to the
forensic evidence in OLT's mailbox that motivated it.

Sections 1–3 fix the shape of the thing. Section 4 fixes the on-disk contract. Sections 5–9 are the
defect-prevention core and are the parts that must not be "simplified" during implementation.
Section 10 is the daemon and is the hardest engineering. Sections 11–14 cover provisioning, policy,
testing, and delivery sequencing.

---

## 1. Purpose, Scope, and Non-Goals

### 1.1 What this skill is

`chatroom` is a **standalone, host-agnostic, repository-agnostic, room-based messaging skill for AI
agents**. It gives any agent — running under any host harness, in any repository, on any project — a
shared append-only conversation log it can write to and read from, with guaranteed live delivery.

It is a sibling of `olt`, not a component of it. It lives at `chatroom/` in this repository and
deploys to `~/.agents/chatroom/` and `~/.agents/skills/chatroom/` through the same mechanism that
deploys `olt/` (`scripts/sync/index.ts:runSync`, `scripts/sync/skill-deployer.ts:getAssistantSkillDirs`).

### 1.2 The problem it solves

A verdict message sat unread for fifteen minutes because the recipient agent's main thread was busy
executing a task. The channel was not down; nobody was listening. Every design decision below traces
to one of two root causes:

1. **Nobody was listening.** → Sections 10, 11: a dedicated always-live communicator agent and a
   daemon that guarantees liveness with zero host support.
2. **When someone did listen, the plumbing lost messages.** → Sections 5–9: ten structural fixes for
   ten defects found by forensic audit of OLT's mailbox.

### 1.3 Requirements this specification satisfies

| #   | Requirement                                                                                    | Where satisfied           |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------- |
| R1  | Room-based, not per-agent mailboxes; flexible membership (2–10+)                               | §3, §4.2                  |
| R2  | Rooms are GLOBAL under `~/.agents/chatroom/rooms/<room-id>/`; never namespaced by repo or host | §4.2, §12.2               |
| R3  | Structured typed JSON payloads alongside prose                                                 | §5.3, §5.4                |
| R4  | HMAC signing; shared room key; one-time light handshake; public channels                       | §5.2, §8, §9              |
| R5  | Skill urges each host harness to generate a dedicated always-live communicator agent           | §11                       |
| R6  | The skill handles setup, not the user; one command provisions everything                       | §6.1 (`chat:init`), §11.3 |
| R7  | Daemon live reaction; guaranteed liveness regardless of host support                           | §10                       |
| R8  | Very simple command surface                                                                    | §6 (nine commands)        |
| R9  | Works standalone without OLT installed                                                         | §2.3                      |
| R10 | Provisions for `antigravity`, `claude_code`, `codex`, `cursor`                                 | §11.4                     |

### 1.4 Explicit non-goals

- **Not a security boundary.** See §8.5. Room keys are readable files in the user's home directory.
- **Not a transport.** No sockets, no network, no daemons listening on ports. Filesystem only.
- **Not an orchestrator.** It carries task specs; it does not schedule, claim, or validate them. OLT
  does that. `chatroom` has no opinion about what is in a payload.
- **Not repo-aware.** A room does not know which repository a member is in, beyond an advisory field.

---

## 2. Repository Layout of `chatroom/`

### 2.1 Mirror of the `olt/` shape

```text
chatroom/
├── SKILL.md                       # YAML frontmatter + index, per README.md:330 standard format
├── AGENTS.md                      # skill-local agent contract, mirrors olt/AGENTS.md
├── .skillignore                   # mirrors olt/.skillignore
├── policy.json                    # skill-shipped default policy (§12)
├── agents/
│   ├── communicator.yaml          # THE dedicated always-live communicator role manifest
│   ├── antigravity.yaml           # host adapter: dispatch/cron/exec tool mapping
│   ├── claude.yaml
│   ├── codex.yaml
│   └── cursor.yaml
├── references/
│   ├── daemon-liveness.md         # the four-layer liveness ladder, for humans and agents
│   ├── handshake.md               # invite URI grammar and the non-security contract
│   ├── payload-schemas.md         # the registered structured body schemas
│   ├── host-provisioning.md       # per-host provisioning receipts and verification
│   └── defect-prevention.md       # D1–D10, the invariant that kills each, and its test id
└── scripts/
    ├── cli.ts                     # CLI entry point (the `chatroom` binary target)
    ├── index.ts
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── cli/
        │   ├── execute.ts         # arg parse → spec lookup → assertFlags → handler
        │   ├── arguments.ts       # argv → Flags, with did-you-mean suggestions
        │   ├── options.ts         # assertFlags, textFlag, intFlag, boolFlag
        │   ├── help.ts
        │   ├── commands/          # one file per command, ≤ 200 lines each
        │   │   ├── init.ts  invite.ts  join.ts  say.ts  read.ts
        │   │   ├── ack.ts   watch.ts   daemon.ts  doctor.ts  rooms.ts
        │   │   └── index.ts
        │   └── registry/
        │       ├── types.ts       # CommandSpec, FlagSpec, requiredFlag, optionalFlag
        │       ├── chat.ts        # ALL nine command specs — the single flag registry
        │       └── index.ts
        ├── core/
        │   ├── errors.ts          # ChatError + ErrorCode union
        │   ├── json.ts            # canonical JSON serialization (§5.2)
        │   ├── guards.ts          # unknown → typed narrowing for every JSON boundary
        │   ├── atomic.ts          # write-temp + fsync + rename; append + fsync
        │   └── paths.ts           # every path in §4, computed in exactly one place
        ├── identity/
        │   └── resolve.ts         # THE single identity path (§7)
        ├── room/
        │   ├── manifest.ts        # room.json read/write
        │   ├── roster.ts          # members/, assertMember — used by send AND read
        │   └── lifecycle.ts       # create, list, bind
        ├── log/
        │   ├── append.ts          # seq assignment under the append lock
        │   ├── segments.ts        # segment rolling and index
        │   └── scan.ts            # contiguous range reads, torn-line detection
        ├── cursor/
        │   ├── model.ts           # ReaderCursor type + invariants
        │   ├── lease.ts           # leaseNext (the ONLY reader of the log for delivery)
        │   ├── ack.ts             # ackLease — the ONLY writer of contiguous_seq
        │   └── store.ts           # CAS load/save of a reader cursor
        ├── crypto/
        │   └── envelope.ts        # sign/verify — one code path, public and keyed
        ├── handshake/
        │   ├── invite.ts          # mint, consume
        │   └── uri.ts             # chatroom:// grammar
        ├── daemon/
        │   ├── supervisor.ts      # lock, spawn, reclaim, respawn budget
        │   ├── watcher.ts         # fs.watch + poll + change-token
        │   ├── loop.ts            # lease → spool → ack cycle
        │   ├── spool.ts           # durable spool append + rotation + repair
        │   ├── health.ts          # heartbeat write + state machine (LIVE/IDLE/…)
        │   └── ensure.ts          # ensureDaemon — called first by EVERY command
        ├── provision/
        │   ├── detect.ts          # host detection
        │   ├── generate.ts        # communicator agent materialization per host
        │   ├── cron.ts            # cron/schedule wiring per host
        │   └── receipts.ts        # provisioning receipts, verified by chat:doctor
        ├── policy/
        │   └── resolve.ts         # layered policy merge; NO hardcoded tool literals
        └── testing/
            └── virtual-fs/        # ChatVirtualFS — chatroom's own in-memory FS port
```

### 2.2 File size and style budget

- **Every `.ts` file MUST be ≤ 400 physical lines** (`scripts/modularity/inventory/physical-lines.ts:4`,
  `LINE_LIMIT = 400`). The module split above is chosen so that no file approaches the limit; the
  largest projected file is `daemon/loop.ts` at ~280 lines.
- **Zero comments** in any `.ts`/`.tsx` file. No `//`, no `/* */`, no JSDoc, no banners. Naming and
  types carry the meaning; the _why_ lives in `chatroom/references/` and in this document.
- **Zero `any`.** Every JSON boundary (log lines, cursor files, policy files, invite files, health
  files, host env) parses to `unknown` and narrows through a guard in `core/guards.ts`. No
  `as any`, no `<any>x`, no `T = any`, no implicit any. Where an external type genuinely forces a
  bridge, use a single `as unknown as Target` cast and report it in the implementation summary.
- **No suppressions.** No `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`,
  `oxlint-disable`, or coverage-ignore pragmas.
- **No new repository root files.** `scripts/modularity/core/scope.ts:5` pins `APPROVED_ROOT_PATHS`;
  `chatroom/` adds a directory, not a root file.

### 2.3 Standalone operation (R9)

**Structural guarantee:** `chatroom/scripts/src/**` MUST contain zero imports whose specifier
resolves outside `chatroom/`. Concretely: no `../../olt/`, no `@olt/*`, no reaching into
`olt/scripts/src/`. A lint rule and a test enforce this by scanning every import specifier in the
subtree.

The consequence is deliberate duplication. `chatroom` vendors its own small ports of four things it
would otherwise borrow from OLT:

| Borrowed concept                         | OLT source (reference only)                                                                                      | chatroom port                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Canonical JSON for signing               | `olt/scripts/src/communication/mailbox/envelope.ts:9` (`canonicalizeJson`)                                       | `core/json.ts`                            |
| flock-based safe lock with stale reclaim | `olt/scripts/src/communication/locking/safe-lock.ts`                                                             | `daemon/supervisor.ts` + `core/atomic.ts` |
| Typed CLI registry with flag assertion   | `olt/scripts/src/cli/registry/types.ts:114` (`CommandSpec`), `olt/scripts/src/cli/options.ts:30` (`assertFlags`) | `cli/registry/types.ts`, `cli/options.ts` |
| In-memory FS for pure tests              | `olt/scripts/src/testing/virtual-fs/memory/memory-fs.ts:29` (`VirtualMemoryFS`)                                  | `testing/virtual-fs/` (`ChatVirtualFS`)   |

`ChatVirtualFS` implements a **strict subset** of the OLT surface — `existsSync`, `readFileSync`,
`writeFileSync`, `appendFileSync`, `mkdirSync`, `readdirSync`, `statSync`, `renameSync`,
`unlinkSync`, `watch`, plus a synthetic clock and a synthetic PID table for daemon tests. This is a
much smaller surface than OLT's, so the port is small, not a copy.

**Trade-off recorded:** duplication was chosen over coupling because R9 is absolute. If OLT is not
installed, `chatroom` must still work; a shared package would create an install-order dependency.

### 2.4 Deployment

`scripts/sync/index.ts` gains a second deployment target alongside `olt`. `runSync` currently hardcodes
`join(home, ".agents", "skills", "olt")`; it is generalized to iterate a skill list
`["olt", "chatroom"]`, deploying each source directory to `~/.agents/skills/<name>` and symlinking it
into each entry of `getAssistantSkillDirs(home)`. The global binary logic in `scripts/sync/olt-bin.ts`
is mirrored to produce a `chatroom` binary that shells to
`~/.agents/skills/chatroom/cli.ts`. **This is the only change permitted outside
`chatroom/`.**

The runtime data root `~/.agents/chatroom/` is created lazily by `chat:init`; it is deliberately _not_
inside `~/.agents/skills/chatroom/`, so that redeploying the skill never touches live room data.

---

## 3. Conceptual Model

### 3.1 Room, not mailbox (R1)

There is exactly **one append-only log per room**. Every member reads that same log. There are no
per-recipient inboxes, no per-recipient directories, no routing.

This is the single most important structural decision in the specification, because it deletes an
entire defect class by construction:

- **A message cannot be delivered to the wrong place**, because there is only one place (kills D7).
- **A message cannot be delivered somewhere the reader is not allowed to open**, because the reader's
  membership is checked against the same roster the sender was checked against (kills D6's
  asymmetry).
- **A slow reader cannot blind a fast reader**, because reading is a per-reader projection over an
  immutable log, not a destructive dequeue (kills D3 and D4 at the root).

### 3.2 The three roles a process can play

| Role       | What it does                               | Owns                                       |
| ---------- | ------------------------------------------ | ------------------------------------------ |
| **Writer** | appends signed envelopes                   | nothing durable except its append          |
| **Reader** | leases contiguous ranges and acks them     | exactly one `readers/<reader-id>.*` cursor |
| **Daemon** | a reader whose consumer is a durable spool | the room's `daemon/<reader-id>.*` files    |

A member is usually all three at once, via different processes. A **reader id** is a _consumer group_
identity, not an agent identity — an agent may run several readers (e.g. `alice` and `alice-archive`)
and each gets its own independent cursor.

### 3.3 Delivery semantics

**At-least-once, never at-most-once.** A message is redelivered until it is explicitly confirmed.
Duplicate suppression is the consumer's responsibility via the envelope `id`; every redelivered
envelope carries `redelivery_count > 0` so the consumer can detect it trivially. This is the correct
trade for agent communication: a duplicated verdict is noise, a dropped verdict is a fifteen-minute
stall.

---

## 4. On-Disk Contract

### 4.1 Path table (all paths computed only in `core/paths.ts`)

```text
~/.agents/chatroom/
├── policy.json                              # user-global policy overrides
├── identity.json                            # host+repo → member id bindings written by chat:init
├── keys/
│   └── <room-id>.key                        # 0600, 32 raw bytes hex; absent for public rooms
└── rooms/
    └── <room-id>/
        ├── room.json                        # manifest (§4.3)
        ├── log/
        │   ├── 000001.jsonl                 # append-only segment, one envelope per line
        │   └── 000002.jsonl
        ├── log.index.json                   # { next_seq, segments[], head_seq, updated_at }
        ├── members/
        │   └── <member-id>.json             # roster row (§4.4)
        ├── readers/
        │   ├── <reader-id>.cursor.json      # per-reader room cursor (§5.5)
        │   └── <reader-id>.spool.cursor.json# per-reader spool cursor (§10.5)
        ├── daemon/
        │   ├── <reader-id>.out.jsonl        # durable spool (rotates to out.<n>.jsonl)
        │   ├── <reader-id>.health.json      # heartbeat + state (§10.8)
        │   ├── <reader-id>.respawn.json     # respawn budget window
        │   └── <reader-id>.reclaim.jsonl    # audit of stale-lock reclaims
        ├── handshake/
        │   ├── invites/<code>.json          # unconsumed one-time invites
        │   └── consumed/<code>.json         # consumed invites (audit)
        ├── provision/
        │   └── <host>.<member-id>.json      # provisioning receipt (§11.5)
        ├── quarantine/
        │   └── <ts>-<seq>.json              # lines that failed HMAC or parse (§5.6)
        └── locks/
            ├── append.lock                  # serializes seq assignment; held for microseconds
            ├── readers/<reader-id>.lock      # serializes that reader's cursor CAS
            ├── spool/<reader-id>.lock        # serializes spool append + rotation
            └── daemon/<reader-id>.lock       # daemon singleton lock (flock, held for the process)
```

Consumer repositories get a **hidden** runtime directory containing only local bindings — never room
data:

```text
<repo>/.chatroom/
├── policy.json        # optional per-repo overrides (tool resolution only)
└── binding.json       # which member id agents in this repo default to
```

### 4.2 Global, never repo-scoped (R2)

**Structural guarantee:** no function in `core/paths.ts` accepts a repository root as an input to any
path under `rooms/`. The only repository-aware function is `resolveRepoBinding(repoRoot)`, which
returns a member id string and nothing else. There is no `--base-dir`-style flag that can relocate a
room into a repository, and there is no repo segment anywhere in the room path grammar.

Contrast with OLT, where `olt/scripts/src/communication/mailbox/mailbox-paths.ts:100-103` roots every
mailbox at `<cwd>/.olt`, making cross-repository conversation impossible. That coupling is what R2
exists to remove.

A room id matches `^[a-z0-9][a-z0-9._-]{1,62}$`. A reader id and a member id match the same grammar.
Anything else is rejected at the CLI boundary with `INVALID_ROOM_ID` / `INVALID_IDENTITY`.

### 4.3 `room.json`

```jsonc
{
  "v": 1,
  "id": "build-review",
  "title": "Build Review",
  "visibility": "keyed", // "keyed" | "public"
  "key_fingerprint": "sha256:8f3a21c9",
  "created_at": "2026-09-06T10:00:00.000Z",
  "created_by": "alice@claude_code",
  "settings": {
    "lease_ttl_ms": 120000,
    "max_payload_bytes": 262144,
    "segment_max_bytes": 8388608,
    "segment_max_lines": 5000,
  },
}
```

`room.json` is written once at creation and is otherwise immutable except through `chat:doctor --fix`.
Membership lives in `members/`, not here, so joining a room never rewrites a shared file (no
lost-update surface on the roster).

### 4.4 `members/<member-id>.json`

```jsonc
{
  "v": 1,
  "id": "alice",
  "display_name": "Alice (Verdict Owner)",
  "role": "communicator",
  "host": "claude_code",
  "repo_hint": "/Users/x/repos/api", // advisory only; never used for routing or paths
  "joined_at": "2026-09-06T10:01:00.000Z",
  "key_fingerprint": "sha256:8f3a21c9",
  "aliases": ["alice-communicator", "verdict-owner"],
}
```

`aliases` exist for D7 mitigation (§7.4): a mention that names an alias resolves to the canonical id.

---

## 5. Message Model

### 5.1 The envelope

One JSON object per line in a log segment. No pretty printing, no trailing whitespace.

```jsonc
{
  "v": 1,
  "id": "9f5f8b0c-...", // uuid v4, the deduplication key
  "room": "build-review",
  "seq": 812, // assigned under locks/append.lock; strictly +1
  "ts": "2026-09-06T10:14:02.771Z",
  "sender": {
    "id": "alice",
    "role": "communicator",
    "host": "claude_code",
    "repo_hint": "/Users/x/repos/api",
    "pid": 44121,
  },
  "kind": "message", // §5.4
  "thread": "verdict-812", // free-form grouping key, never affects delivery
  "reply_to": "3c1a...", // envelope id or null
  "mentions": ["bob"], // ADVISORY ONLY — see §7.4
  "text": "Gate G3 failed on the migration lane.",
  "body": {
    "schema": "chatroom.gate_result.v1",
    "data": {
      "gate_id": "G3",
      "passed": false,
      "exit_code": 1,
      "evidence": ".olt/evidence/g3.json",
    },
  },
  "key_fingerprint": "sha256:8f3a21c9",
  "redelivery_count": 0, // set by the reader on emit, NOT part of the signature
  "sig": "4b1c9e...",
}
```

### 5.2 Signature (R4)

`sig = HMAC-SHA256(roomKey, canonicalJson(envelope minus {sig, redelivery_count}))`, hex.

Canonicalization is the byte-for-byte rule already proven in
`olt/scripts/src/communication/mailbox/envelope.ts:9-77`: recursive, keys sorted, `undefined` and
function/symbol values dropped from objects and rendered `null` in arrays, non-finite numbers
rejected, circular references rejected. `chatroom` ports the algorithm to `core/json.ts` and pins it
with golden-vector tests, because a canonicalization drift silently invalidates every signature.

Verification uses `timingSafeEqual` on equal-length buffers, exactly as
`olt/.../envelope.ts:150-157`.

`redelivery_count` is excluded from the signature so a redelivered envelope still verifies. This is
the only mutable field, and it is set by the _reader_, never persisted back into the log.

**Structural guarantee — one verification path:** `crypto/envelope.ts` exports exactly two functions,
`signEnvelope(unsigned, key)` and `verifyEnvelope(envelope, key)`. There is no `if (public) return
true` branch anywhere. Public rooms use the well-known constant key
`CHATROOM_PUBLIC_KEY = "chatroom:public:v1"` (§9), so a public room's envelopes are signed and
verified by the identical code with an identical control flow. A conditional skip is forbidden by the
spec because "verification is skipped in mode X" is precisely how verification rots.

### 5.3 Structured payloads (R3)

`body` is a discriminated container: `{ schema: string, data: JsonObject }`.

**`body.data` is never flattened to a string, at any layer.** Specifically:

- `log/append.ts` writes the object.
- `cursor/lease.ts` returns the object.
- `chat:read --json` and `chat:watch --json` emit the object verbatim under `messages[].body.data`.
- The daemon spool stores the object.
- `chat:say --payload` / `--payload-file` / stdin accept an object and reject a bare string with
  `INVALID_PAYLOAD` unless `--schema chatroom.text.v1` is explicitly given.

Unknown `schema` values are **passed through opaquely**, never rejected. This keeps the skill
forward-compatible: OLT (or anything else) can define new schemas without a chatroom release. Known
schemas get structural validation; unknown ones get only the generic "is a JSON object, is under
`max_payload_bytes`" check.

### 5.4 Registered schemas and kinds

`kind` is a coarse routing/UX hint with a closed set:
`"message" | "dispatch" | "verdict" | "gate_result" | "roster" | "handshake" | "control"`.

Shipped schemas (documented in `chatroom/references/payload-schemas.md`):

| schema                    | shape                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `chatroom.text.v1`        | `{ text: string }`                                                                                             |
| `chatroom.task_spec.v1`   | `{ task_id, title, scope_paths: string[], gates: string[], acceptance: string[], deadline?: string }`          |
| `chatroom.roster.v1`      | `{ agents: [{ id, role, host, tier?, status }] }`                                                              |
| `chatroom.file_scope.v1`  | `{ paths: string[], mode: "exclusive" \| "shared" }`                                                           |
| `chatroom.gate_result.v1` | `{ gate_id, command, exit_code, passed, evidence?: string }`                                                   |
| `chatroom.verdict.v1`     | `{ subject, verdict: "approved" \| "rejected" \| "changes_requested", reasons: string[], blocking: string[] }` |
| `chatroom.control.v1`     | daemon/handshake internal traffic                                                                              |

These exist because the motivating failure was a _verdict_, and a verdict flattened to a prose string
loses `blocking[]` — the exact field the consumer needed to act.

### 5.5 The reader cursor

```jsonc
{
  "v": 1,
  "room": "build-review",
  "reader": "bob",
  "contiguous_seq": 811, // every seq <= this is terminally acked by THIS reader
  "held": [
    {
      "lease": "L-7c2f",
      "from": 812,
      "to": 830,
      "issued_at": "...",
      "expires_at": "...",
      "attempt": 1,
    },
  ],
  "acked_above": [], // sparse acked seqs above contiguous_seq; bounded to 4096
  "last_ack_at": "2026-09-06T10:13:59.000Z",
  "updated_at": "2026-09-06T10:14:03.100Z",
  "checksum": "sha256:...", // over the object minus checksum; the CAS token
}
```

Invariants, asserted on every load and every save:

1. `contiguous_seq >= 0`.
2. `held` ranges are disjoint, all strictly above `contiguous_seq`, sorted ascending.
3. `acked_above` contains no seq `<= contiguous_seq` and no seq inside a `held` range.
4. Whenever `contiguous_seq + 1 ∈ acked_above`, it is absorbed: `contiguous_seq += 1` and the entry is
   removed. Absorption runs to fixpoint on every save, so `acked_above` stays small.
5. `checksum` matches the rest of the object.

---

## 6. Command Surface (R8)

Nine commands. Every flag listed below **MUST** appear in the `CommandSpec.flags` array in
`cli/registry/chat.ts`. Nothing else is accepted: `cli/options.ts:assertFlags` rejects any flag not in
the spec, exactly as `olt/scripts/src/cli/options.ts:30-49` does. This is the D9 boundary and §13.2
tests it per command.

### 6.1 `chat:init` — provision everything (R6)

Creates or joins a room **and** provisions the host's communicator agent, its cron, and its daemon.
This is the only command a user is ever expected to type by hand.

| flag             | type   | required | meaning                                                                                |
| ---------------- | ------ | -------- | -------------------------------------------------------------------------------------- |
| `--room`         | string | yes*     | room id (*or supply `--invite`)                                                        |
| `--title`        | string | no       | human title, used in the join confirmation                                             |
| `--as`           | string | no       | member id to bind for this host+repo; defaults to a generated `<host>-<repo-basename>` |
| `--host`         | string | no       | `antigravity` \| `claude_code` \| `codex` \| `cursor` \| `auto` (default `auto`)       |
| `--public`       | bool   | no       | create a public room (§9)                                                              |
| `--invite`       | string | no       | join via a `chatroom://` URI instead of creating                                       |
| `--repo`         | string | no       | repository root to bind (default: cwd)                                                 |
| `--no-agent`     | bool   | no       | skip communicator agent generation                                                     |
| `--no-daemon`    | bool   | no       | skip daemon start                                                                      |
| `--print-invite` | bool   | no       | mint and print a first invite immediately                                              |
| `--json`         | bool   | no       | machine output                                                                         |

Behaviour, in order: resolve identity (§7) → resolve/merge policy (§12) → create or join the room →
write the repo binding → generate the communicator agent for the detected host (§11) → wire the cron
(§11.4) → start the daemon (§10) → write a provisioning receipt → print a human summary containing
the room id, the member id, the daemon PID, and the invite line if requested.

### 6.2 `chat:invite` — mint a one-time invite

| flag     | type   | required | meaning                                         |
| -------- | ------ | -------- | ----------------------------------------------- |
| `--room` | string | yes      |                                                 |
| `--as`   | string | no       | minter identity                                 |
| `--ttl`  | int    | no       | seconds until the invite expires (default 3600) |
| `--json` | bool   | no       |                                                 |

### 6.3 `chat:join` — join a room

Takes the invite URI as a bare remainder argument or via `--invite`. `takesRemainder: true`.

| flag       | type   | required | meaning                                           |
| ---------- | ------ | -------- | ------------------------------------------------- |
| `--invite` | string | no       | `chatroom://<room>#<fingerprint>.<code>`          |
| `--room`   | string | no       | public room id (no invite needed)                 |
| `--as`     | string | no       | member id to register                             |
| `--yes`    | bool   | no       | accept the confirmation preview without prompting |
| `--json`   | bool   | no       |                                                   |

### 6.4 `chat:say` — post a message

| flag             | type                | required | meaning                                              |
| ---------------- | ------------------- | -------- | ---------------------------------------------------- |
| `--room`         | string              | yes      |                                                      |
| `--as`           | string              | no       | sender identity; resolved through §7                 |
| `--text`         | string              | no       | prose                                                |
| `--payload`      | string              | no       | inline JSON object for `body.data`                   |
| `--payload-file` | string              | no       | path to a JSON file for `body.data`                  |
| `--schema`       | string              | no       | `body.schema` (default `chatroom.text.v1`)           |
| `--kind`         | string              | no       | envelope kind (default `message`)                    |
| `--to`           | string (repeatable) | no       | **advisory** mentions; never affects delivery (§7.4) |
| `--thread`       | string              | no       | grouping key                                         |
| `--reply-to`     | string              | no       | envelope id                                          |
| `--json`         | bool                | no       |                                                      |

`readsStdin: true` — a bare piped JSON object becomes `body.data`, bare piped text becomes `--text`.
At least one of `--text`, `--payload`, `--payload-file`, or stdin must be present.

### 6.5 `chat:read` — lease the next batch

**Does not advance the cursor.** Emits a batch plus a lease id.

| flag       | type   | required | meaning                                                    |
| ---------- | ------ | -------- | ---------------------------------------------------------- |
| `--room`   | string | yes      |                                                            |
| `--as`     | string | no       | member identity                                            |
| `--reader` | string | no       | consumer-group id (default: the member id)                 |
| `--limit`  | int    | no       | max envelopes in the batch (default 50, max 500)           |
| `--source` | string | no       | `spool` (default) or `room` — see §10.5                    |
| `--wait`   | int    | no       | ms to block for arrival; `0` (default) returns immediately |
| `--peek`   | bool   | no       | read-only: no lease, no cursor mutation, no ack possible   |
| `--type`   | string | no       | **`--peek` only**; display filter (§6.10)                  |
| `--since`  | int    | no       | **`--peek` only**; start seq                               |
| `--json`   | bool   | no       |                                                            |

### 6.6 `chat:ack` — confirm delivery

The only command that advances `contiguous_seq`.

| flag        | type   | required | meaning                                                       |
| ----------- | ------ | -------- | ------------------------------------------------------------- |
| `--room`    | string | yes      |                                                               |
| `--as`      | string | no       |                                                               |
| `--reader`  | string | no       |                                                               |
| `--lease`   | string | no       | lease id returned by `chat:read`                              |
| `--through` | int    | no       | ack every seq in the named lease up to this seq (partial ack) |
| `--json`    | bool   | no       |                                                               |

`--lease` is required unless `--through` is given, in which case the lease containing that seq is
inferred. Acking a seq not covered by a live lease owned by this reader is `INVALID_STATE`.

### 6.7 `chat:watch` — foreground live consumer

Blocking. Streams batches as they arrive, using the same lease/ack machinery.

| flag         | type   | required | meaning                                                             |
| ------------ | ------ | -------- | ------------------------------------------------------------------- |
| `--room`     | string | yes      |                                                                     |
| `--as`       | string | no       |                                                                     |
| `--reader`   | string | no       |                                                                     |
| `--ack-mode` | string | no       | `explicit` (default) or `flushed` (§6.9 / §8 of the delivery model) |
| `--timeout`  | int    | no       | ms; `0` = forever (default `0`)                                     |
| `--json`     | bool   | no       |                                                                     |

### 6.8 `chat:daemon` — daemon lifecycle

| flag              | type   | required | meaning                                                      |
| ----------------- | ------ | -------- | ------------------------------------------------------------ |
| `--room`          | string | yes      |                                                              |
| `--as`            | string | no       |                                                              |
| `--reader`        | string | no       |                                                              |
| `--start`         | bool   | no       | idempotent start (or report `already_running`)               |
| `--stop`          | bool   | no       | graceful stop; releases the lock; writes `state: STOPPED`    |
| `--status`        | bool   | no       | print the health record and computed state                   |
| `--tick`          | bool   | no       | one-shot supervise-and-deliver; the cron entry point (§10.6) |
| `--foreground`    | bool   | no       | run the loop in this process instead of detaching            |
| `--poll-interval` | int    | no       | override the poll floor for this daemon                      |
| `--json`          | bool   | no       |                                                              |

Exactly one of `--start`/`--stop`/`--status`/`--tick` must be present; the spec validates this at the
boundary and the error names the four options.

### 6.9 `chat:doctor` — health and repair

| flag       | type   | required | meaning                                                            |
| ---------- | ------ | -------- | ------------------------------------------------------------------ |
| `--room`   | string | no       | omit to check every room the user is a member of                   |
| `--as`     | string | no       |                                                                    |
| `--reader` | string | no       |                                                                    |
| `--fix`    | bool   | no       | reclaim stale locks, repair torn spool lines, restart dead daemons |
| `--json`   | bool   | no       |                                                                    |

`chat:doctor` is the CLI surface for the liveness state machine. **It exists specifically to close D8.**

### 6.10 `chat:rooms` — list rooms

| flag     | type | required | meaning                                            |
| -------- | ---- | -------- | -------------------------------------------------- |
| `--mine` | bool | no       | only rooms where the resolved identity is a member |
| `--json` | bool | no       |                                                    |

### 6.11 What is deliberately absent

No `--base-dir` (would break R2). No `--secret` (keys come from `keys/`, not from argv, where they
would land in shell history and process listings). No `--type` on any cursor-advancing path (§6.5
restricts it to `--peek`; this is the D3 fix). No `--advance-cursor` / `--no-advance-cursor` pair —
advancing is a separate command, not a flag.

---

## 7. Identity Model — Killing D6 and D7

### 7.1 The defect being prevented

> **D6.** `msg:send` auto-derives a sender that `msg:recv` then refuses to authorize.
> Evidence: `olt/scripts/src/authority/session/resolver.ts:255-266` returns
> `{ actor: explicit ?? "mind", role: fallbackRole, verified: false, mechanisms: ["interactive_terminal_fallback"] }`.
> A send using that fabricated `"mind"` identity succeeds and writes into a mailbox; a subsequent
> receive by the real recipient runs a _different_ authorization path and refuses. The message is
> delivered somewhere nobody is permitted to open. The derivation logic is duplicated verbatim across
> three files, so the two sides drift independently.

> **D7.** Delivery depends on the sender typing the recipient string exactly right. In OLT, a typo
> produces `resolveMailboxPaths("recipiant-1")`
> (`olt/scripts/src/communication/mailbox/mailbox-paths.ts:105-107`), which happily returns a path
> under `mailboxes/recipiant-1/`, and the writer creates it. A brand-new empty mailbox that nobody
> reads, with no error.

### 7.2 One path, one function, no fabrication

`identity/resolve.ts` exports exactly one entry point:

```
resolveIdentity(input: IdentityInput): Identity
```

`Identity` is `{ id, role, host, repo_hint, source, verified }`. Resolution order:

1. `--as <member-id>` explicit → `source: "explicit"`, `verified: true`.
2. `CHATROOM_AS` environment variable → `source: "env"`, `verified: true`.
3. `~/.agents/chatroom/identity.json` binding for `{host, repo}` written by `chat:init` →
   `source: "binding"`, `verified: true`.
4. `<repo>/.chatroom/binding.json` → `source: "repo_binding"`, `verified: true`.
5. **Throw `IDENTITY_UNRESOLVED`.**

**Structural guarantees:**

- **No fallback constant exists.** There is no `?? "mind"`, no `?? "agent"`, no generated placeholder.
  A grep test asserts that `identity/resolve.ts` contains no string literal that could serve as a
  default id, and that no other file in `src/` constructs an `Identity` object.
- **`Identity` has no unverified state.** The `verified` field is retained only for diagnostics and is
  `true` in every path that returns; the only alternative to a verified identity is an error. OLT's
  `verified: false` return is the exact shape this design refuses.
- **`resolveIdentity` is imported by every command.** A test enumerates `cli/commands/*.ts` and
  asserts each one imports it and calls it before touching the room. There is no second derivation.

### 7.3 One authorization predicate, used by both sides

`room/roster.ts` exports exactly one predicate:

```
assertMember(identity: Identity, room: RoomManifest): MemberRecord
```

- `chat:say` calls `assertMember` **before** appending. An identity the room would refuse on read can
  therefore never get a byte into the log.
- `chat:read`, `chat:ack`, `chat:watch`, and the daemon call `assertMember` before leasing.

Because it is literally the same function reading the same `members/` directory, the D6 asymmetry is
unrepresentable. §13.4 pins this with a property test: for a generated space of identities and rooms,
`send accepts(i, r) ⟺ read accepts(i, r)`.

### 7.4 Delivery survives a wrong or typo'd recipient (D7)

Three layers:

1. **The room is the address.** `chat:say` has no recipient parameter that affects delivery. Every
   member of the room receives every message. A typo in `--to` cannot misroute because `--to` is not
   consulted by any read path — `cursor/lease.ts` operates on `seq` ranges and never reads
   `mentions`. A test asserts `cursor/**` contains no reference to the `mentions` field.
2. **Mentions are validated loudly, not silently.** `chat:say --to typo-name` resolves each entry
   against `members/` (including `aliases`), and on a miss fails with `UNKNOWN_MENTION` plus a
   did-you-mean suggestion computed the way `olt/scripts/src/cli/options.ts:40` does. It never
   creates anything.
3. **No path is ever derived from a user-supplied recipient string.** `core/paths.ts` has no function
   taking a recipient. The only identity-derived paths are `readers/<reader-id>.*` and
   `members/<member-id>.json`, and both are constructed only from an `Identity` that already passed
   `assertMember`. `chat:doctor` asserts that every file under `readers/` and `members/` corresponds
   to a roster row, flagging orphans instead of tolerating them.

---

## 8. Cursor, Lease, and Confirmed Delivery — Killing D1–D5 and D10

### 8.1 D4 — one cursor per reader, never per mailbox

> **D4.** `olt/scripts/src/communication/mailbox/mailbox-paths.ts:122-124` puts `cursor.json` inside
> the mailbox directory, one per mailbox. Whoever advances it first blinds every other reader. There
> is no consumer-group concept.

**Structural guarantee:** the cursor path is `rooms/<room>/readers/<reader-id>.cursor.json`. The
reader id is a required component of the path — `core/paths.ts:readerCursorPath(room, readerId)`
cannot be called without one, and there is no function that returns a room-level cursor path.
`chat:doctor` asserts that **no file named `cursor.json` exists at any room root**; its presence is
reported as `CORRUPT_LAYOUT`.

No process ever writes another reader's cursor. Adding the tenth agent to a room requires no
coordination with the other nine.

### 8.2 D3 — a filtered read can never discard unrelated messages

> **D3.** `olt/scripts/src/communication/mailbox/mailbox-dispatcher.ts:236-243` advances the cursor
> over only the _filtered_ subset, and `cursor-tracker.ts:127` / `:223` then treat every
> lower-sequence message of any other type as processed
> (`return message.sequence > 1 && message.sequence <= cursor.last_read_sequence`). Reading one
> message type permanently discards every other type below it.

**Structural guarantee — filtering is removed from every cursor-advancing path.** Three enforcing
rules:

1. `cursor/lease.ts:leaseNext(cursor, log, limit)` takes **no predicate parameter**. Its signature
   admits no filter. It always leases the contiguous range `[contiguous_seq + 1, contiguous_seq + n]`.
2. `--type` and `--since` are registered **only** as `--peek` companions. `cli/registry/chat.ts`
   declares them, and `cli/commands/read.ts` rejects them without `--peek` with
   `FILTER_REQUIRES_PEEK`. `--peek` takes no lease and performs zero writes — it cannot mutate any
   cursor by construction, because it never calls into `cursor/store.ts` at all.
3. `cursor/ack.ts` refuses any ack whose seq set is not exactly a prefix of a live lease range owned
   by this reader. There is no way to express "I acked only the DISPATCH ones".

The type-based lag OLT tried to buy with filtering is bought instead by **per-reader consumer
groups**: an agent that only cares about verdicts runs a reader `bob-verdicts`, leases everything,
and discards what it does not want _in its own process_, at zero cost to any other reader.

### 8.3 D5 — read and advance are one CAS transaction each, with no stale base

> **D5.** In OLT, read locks and releases, then advance locks again with a stale base cursor. The
> window between them is a lost-update.

**Structural guarantee:** every cursor mutation is a **compare-and-swap under a per-reader lock**:

```
withReaderLock(readerId, () => {
  const { cursor, checksum } = loadCursor(path)      // checksum is the CAS token
  const next = transform(cursor)
  saveCursorCas(path, next, expected: checksum)      // throws CURSOR_CONFLICT on mismatch
})
```

`saveCursorCas` re-reads and re-checksums the on-disk file inside the lock before writing, then writes
via temp + `fsync` + `rename` (`core/atomic.ts`). **No code path anywhere reads a cursor and later
writes it based on a base it did not re-verify.** A test asserts `cursor/store.ts` is the only module
that writes to `readers/`, and that its write function requires an `expected` token argument — there
is no unconditional `saveCursor`.

Read and ack are _deliberately_ separate transactions (they must be — the confirmation happens
between them), but each is individually atomic, and the intermediate state (`held`) is durable. There
is no window in which work is in flight and unrecorded.

### 8.4 D1 — the cursor advances only on confirmed delivery, never on "read"

> **D1.** `olt/scripts/src/liaison/agent/transport.ts:145-147` batch-advances the cursor for
> everything read (`advanceMailboxCursorBatch(paths.cursorPath, successfulBatch, cursor, paths.lockPath)`)
> regardless of whether the consumer actually got it. Silent loss.

**Structural guarantee:** `cursor/ack.ts` exports exactly one function that writes `contiguous_seq`:

```
ackLease(cursor: ReaderCursor, leaseId: string, through: number | null, confirmation: Confirmation): ReaderCursor
```

`Confirmation` is a required, non-optional, non-defaulted discriminated union:

```
{ kind: "explicit", at: string }
| { kind: "flushed", at: string, bytes: number, drained: true }
| { kind: "spooled", at: string, spool_path: string, spool_offset: number, fsynced: true }
```

There is no overload without it, no default value, and no `advanceBatch(messages)` API. It is not
possible to express "advance over what I read" in this codebase; you can only express "advance over
what a named lease covers, because _this specific confirmation_ happened."

Additionally, `ackLease` throws unless the seq range is exactly covered by a `held` lease whose
`lease` id matches and whose `expires_at` is in the future.

### 8.5 D2 — `stdout.write` returning is never a confirmation

> **D2.** `process.stdout.write` is asynchronous, does not throw on EPIPE, and returns a boolean.
> OLT advanced the cursor on its synchronous return
> (`olt/scripts/src/cli/commands/msg-listen.ts:211` region — the stdout `error` handler exists but the
> advance is not gated on flush), so a broken pipe still loses the message.

**Structural guarantee — the `flushed` confirmation requires four independent facts**, all captured in
`cli/commands/watch.ts` and all required by the type:

1. The `write(chunk, callback)` callback fired **with no error**. The synchronous boolean return is
   ignored entirely.
2. If `write()` returned `false`, a `drain` event was subsequently observed on the stream.
3. No `error` or `close` event was observed on `process.stdout` at any point during the batch. An
   `error` handler is installed _before_ the first write and sets a poisoned flag that permanently
   disables `flushed` confirmations for the process.
4. The batch's byte count matches the bytes handed to `write`.

Only when all four hold does `watch.ts` construct `{ kind: "flushed", drained: true, bytes }`. The
`drained: true` literal in the type means a value can be constructed only where drain was proven.

Two further guards:

- **Default is `explicit`.** `chat:watch --ack-mode` defaults to `explicit`, which requires a separate
  `chat:ack` invocation — the consumer proving it survived long enough to run another command. A user
  must deliberately opt into `flushed`.
- **A process that wrote to stdout may not ack in the same tick on the basis of that write.** Stated
  as a review rule and enforced by a test that asserts `cursor/ack.ts` has no import of anything in
  `node:process`, `node:tty`, or the CLI output layer. The ack module physically cannot observe
  stdout.

For the daemon the confirmation is `spooled` (§10.4), which is strictly stronger than `flushed`:
bytes are in a fsynced file on disk, not in a pipe buffer.

### 8.6 D10 — corruption fails closed, never open

> **D10.** OLT's unreadable cursor silently resets to empty, causing the entire log to be redelivered
> forever.

**Structural guarantee:** `cursor/store.ts:loadCursor` has exactly three outcomes:

| on-disk state                                                                                   | outcome                                                                                                              |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| file absent                                                                                     | fresh cursor `{contiguous_seq: 0}` — the only legitimate zero state, and only when the file genuinely does not exist |
| file present, parses, checksum matches, invariants hold                                         | that cursor                                                                                                          |
| file present and anything else (unparseable, checksum mismatch, invariant violation, wrong `v`) | **throw `CURSOR_CORRUPT`** — the command fails loudly with the path and the reason                                   |

There is no silent reset. Recovery is an explicit operator action: `chat:doctor --fix` moves the
corrupt file to `quarantine/`, reconstructs `contiguous_seq` from the **spool cursor** (which is a
second, independent record of what was actually delivered), and reports exactly how many seqs it could
not account for. If it cannot reconstruct, it refuses and says so rather than replaying the room.

The same fail-closed rule applies to `log.index.json`, `room.json`, `members/*.json`, and
`daemon/*.health.json`. Distinguishing "absent" from "corrupt" is the whole point; only "absent" gets
a default.

### 8.7 The full delivery cycle

```text
      ┌──────────────┐  append under locks/append.lock, seq = index.next_seq++
WRITE │  chat:say    │──────────────────────────────────────────────► log/NNNNNN.jsonl
      └──────────────┘                                                       │
                                                                             │ change token moves
      ┌──────────────┐  withReaderLock + CAS                                  ▼
LEASE │  chat:read   │◄──── leaseNext(cursor, [contiguous+1 .. +limit]) ── log scan
      │              │────► held += {lease, from, to, expires_at}     (cursor NOT advanced)
      └──────┬───────┘
             │ batch emitted to the consumer (or spooled by the daemon)
             ▼
      ┌──────────────┐
      │  CONSUMER    │  does whatever it does with body.data
      └──────┬───────┘
             │ Confirmation: explicit | flushed | spooled
             ▼
      ┌──────────────┐  withReaderLock + CAS
 ACK  │  chat:ack    │──── ackLease(cursor, lease, through, confirmation)
      └──────────────┘     contiguous_seq advances; held entry removed

  lease expiry (no ack within lease_ttl_ms) ─► held entry dropped ─► seqs re-leasable
                                               redelivery_count += 1 on next emit
```

---

## 9. Handshake and Public Channels (R4)

### 9.1 What the handshake is for

**Its only job is stopping an agent from joining the WRONG room by accident.** It is not authentication,
not authorization, and not confidentiality. It is a typo guard with a cryptographic checksum.

### 9.2 The invite URI

```text
chatroom://<room-id>#<key-fingerprint>.<one-time-code>
```

- `<room-id>` — the room being joined, in plain sight, so a human reading the line knows where it goes.
- `<key-fingerprint>` — first 8 hex chars of `sha256(roomKey)`, matching `room.json.key_fingerprint`.
- `<one-time-code>` — 16 random bytes, base32, single-use.

### 9.3 The flow (one-time, exactly four steps)

1. **Create.** `chat:init --room build-review` generates 32 random bytes to
   `~/.agents/chatroom/keys/build-review.key` (mode `0600`) and records
   `key_fingerprint` in `room.json`.
2. **Invite.** `chat:invite --room build-review` writes
   `handshake/invites/<code>.json` = `{ code, expires_at, uses_remaining: 1, wrapped_key }`, where
   `wrapped_key = roomKey XOR HKDF(code, salt = room-id)`. It prints one line: the URI. Possession of
   that one line is sufficient to derive the key.
3. **Join.** `chat:join chatroom://build-review#8f3a21c9.KZ4T…` on _any_ machine, host, or repository:
   - resolve `rooms/build-review/`; if it does not exist locally, fail with `UNKNOWN_ROOM` (rooms are
     a shared home-directory namespace, not a network service);
   - consume the invite under `locks/append.lock`, atomically `rename`ing it into
     `handshake/consumed/` — a second use gets `HANDSHAKE_CONSUMED`;
   - unwrap the key and compute `sha256(key)[0..8]`;
   - **compare it to `room.json.key_fingerprint`. A mismatch aborts with `WRONG_ROOM`, naming both the
     room the URI claimed and the room the fingerprint actually belongs to.** This single comparison
     is the entire blunder-prevention mechanism;
   - print a **confirmation preview** — room title, member list, message count, and the last message's
     first line — and require `--yes` (or an interactive confirm) before writing the roster row. This
     is the second guard: you _see_ the room before you enter it;
   - write `members/<id>.json` and post a `chatroom.roster.v1` join message.
4. **Done.** There is no step 5. No renewal, no re-handshake, no session, no token refresh.

### 9.4 Public channels

`chat:init --room lobby --public` sets `visibility: "public"` and writes **no key file**. Signing and
verification use the well-known constant `CHATROOM_PUBLIC_KEY = "chatroom:public:v1"`, so the signing
code path is byte-identical to the keyed path (§5.2) — the key is simply a constant instead of a file
read.

`chat:join --room lobby` succeeds immediately with no invite and no fingerprint check. Any resolvable
identity becomes a member. `chat:doctor` flags a public room whose `key_fingerprint` differs from the
fingerprint of the public constant.

### 9.5 Why this cannot become a security wall (stated so it cannot drift)

These are binding design constraints, recorded in `chatroom/references/handshake.md`, so that a future
contributor cannot "harden" the handshake into something that breaks R4's stated intent:

- **Room keys are plaintext files in the user's home directory.** Anyone who can read the filesystem
  can read the key, the log, and every message. This is accepted, documented, and intentional.
- **No revocation, no rotation, no expiry** beyond the invite's own TTL. Removing a member deletes a
  roster row; it does not and cannot lock anyone out of a file they can `cat`.
- **A signature failure quarantines one line and warns.** It never halts the room, never blocks other
  members' reads, and never escalates. A bad line goes to `quarantine/` with its seq recorded in the
  reader's ack path as accounted-for, so one poisoned line cannot wedge a reader forever.
- **No encryption of the log.** The log is plaintext JSONL by design so that a human can `tail -f` it
  during an incident. That debuggability is worth more than a confidentiality property the filesystem
  cannot provide anyway.
- **Binding rule:** _no chatroom command may deny a filesystem-local actor access to data they can
  already read with `cat`._ Any proposal that requires such a denial is out of scope by construction
  and must be rejected in review.

---

## 10. The Daemon — Guaranteed Liveness With No Host Support (R7)

This is the heart of the specification and the direct fix for the fifteen-minute stall.

### 10.1 The failure being engineered against

> **D8.** OLT built a sound liveness state machine
> (`olt/scripts/src/communication/mailbox/liveness.ts:19-20` defines
> `"running_and_delivering" | "wedged" | "stopped" | "no_messages"`) and then **never wired it**: zero
> call sites, no CLI surface. So "quiet" and "dead" stayed indistinguishable, which is exactly the
> condition under which a verdict can sit unread for fifteen minutes without anyone noticing.

Two lessons are baked into this design: (a) liveness must be _observable through the CLI_, and (b) the
mechanism must not depend on the host doing anything.

### 10.2 Topology

One daemon process per `(room, reader)` pair. It is a plain detached OS process running
`chat:daemon --room R --reader X --foreground`, spawned with `detached: true`,
`stdio: "ignore"`, and `unref()`, so it outlives the harness invocation, the agent turn, and the host
session.

Its job is narrow: **move envelopes from the room log into a durable per-reader spool as fast as they
appear, and never block on the consumer.** It does not interpret payloads. It does not talk to the
host. It has no network surface.

### 10.3 What wakes it — all three sources, always, never a choice

| source                                                                  | latency    | role                                  |
| ----------------------------------------------------------------------- | ---------- | ------------------------------------- |
| `fs.watch` on `log/` and `log.index.json`                               | ~1–50 ms   | **optimization**                      |
| unconditional poll at `poll_interval_ms` (default 750 ms, floor 250 ms) | ≤ interval | **the guarantee**                     |
| change-token comparison on every wake                                   | —          | the cheap gate that avoids re-reading |

The polling loop is **never disabled by a healthy watch**. This is a deliberate, non-negotiable design
choice, stated here so it is not "optimized away" later:

> `fs.watch` is documented-unreliable. On macOS, FSEvents coalesces and can miss rapid appends. On
> network and virtualized filesystems it may never fire. Editors and tools that write via
> temp+rename change the inode out from under the watch. Watch descriptors leak and silently die.
> Therefore: **if `fs.watch` never fires even once for the lifetime of the daemon, delivery latency is
> still bounded by `poll_interval_ms`.** The watch only makes the common case fast.

The **change token** is `{ next_seq, head_segment_size, head_segment_inode }` read from
`log.index.json` and a `stat` of the head segment. If the token is unchanged, the wake costs one
small read and one `stat`, and the loop goes back to sleep without touching the log. `watch_failures`
is counted in the health record; on repeated failure the daemon tears down and re-establishes the
watch and drops `poll_interval_ms` to its floor.

### 10.4 The delivery loop

```text
wake (watch | poll | tick)
  └─ token changed?  ──no──► update heartbeat, sleep
        │ yes
        ▼
     withReaderLock(reader)
        ├─ loadCursor (CAS token)
        ├─ leaseNext(cursor, limit = batch_size)          # contiguous, unfiltered
        ├─ verify each envelope (§5.2); bad lines → quarantine/, still accounted for
        ├─ spool.append(batch)  →  write, fsync, record byte offset
        ├─ ackLease(cursor, lease, { kind: "spooled", spool_offset, fsynced: true })
        └─ saveCursorCas
     release
        └─ optional: fire policy.notify_command with the batch on stdin (best effort, never gates the ack)
     update heartbeat, loop immediately if more remains
```

**The spool append is the confirmation.** Bytes are in a fsynced file before the cursor moves. This is
strictly stronger than any pipe-based confirmation and is why the daemon can safely auto-ack where
`chat:watch` cannot.

The optional `notify_command` (resolved from policy, §12 — never a hardcoded host tool) is a _push_
convenience for hosts that have a message facility. Its failure is logged into
`health.errors_recent` and **does not affect the cursor**; the spool is the contract.

### 10.5 How an agent consumes from the daemon

The agent runs `chat:read --room R --as A` (default `--source spool`). That reads from
`daemon/<reader-id>.out.jsonl` using a **second, independent cursor**,
`readers/<reader-id>.spool.cursor.json`, with the same lease/ack contract and the same CAS discipline.

This two-cursor design is what decouples daemon liveness from agent liveness — the exact decoupling
the fifteen-minute stall needed:

- The **daemon** is never blocked by a busy agent. It keeps draining the room into the spool.
- The **agent** never loses a message by being busy. Everything is durably waiting when it returns.
- A crashed agent replays only its unacked spool range, not the room.
- The spool cursor is also the independent record used to reconstruct a corrupt room cursor (§8.6).

`--source room` bypasses the spool and leases directly from the room log, for the daemon itself, for
`chat:doctor`, and for cold-start replay.

### 10.6 Crash recovery

| failure                                      | recovery                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| daemon killed mid-lease                      | the `held` lease expires after `lease_ttl_ms`; seqs are re-leased on the next tick with `redelivery_count += 1`                                                                                                                                                    |
| daemon killed mid-spool-append               | the last spool line may be torn; `spool.repair()` under the spool lock detects a line that does not parse or does not verify, truncates to the last complete line, and re-derives the missing range from the room log (the room log is always the source of truth) |
| daemon killed after spool append, before ack | the range is re-delivered into the spool; the consumer dedupes on envelope `id`                                                                                                                                                                                    |
| host session ends                            | irrelevant — the daemon is detached and unref'd                                                                                                                                                                                                                    |
| machine reboot                               | the lock's `boot_id` no longer matches; the lock is reclaimed on the next `--tick` or the next `ensureDaemon`                                                                                                                                                      |
| PID reuse after crash                        | the lock payload records `start_time`; a live PID whose start time differs is treated as dead                                                                                                                                                                      |

`chat:daemon --start` is **idempotent**: it either acquires the singleton lock and spawns, or reports
`{ status: "already_running", pid }`. Calling it a hundred times produces one daemon.

`chat:daemon --tick` is the **one-shot supervisor**: if a healthy daemon holds the lock, it is a no-op
that returns the health record; if the lock is stale or absent, it reclaims, delivers one batch
synchronously (so even a pure-cron environment makes progress), and relaunches the long-lived daemon.
This inverts the usual arrangement into a mutual watch: **the daemon supervises the room; the cron (or
the self-watchdog, or the next command) supervises the daemon.**

### 10.7 Stale-lock handling

Lock payload, extending the pattern in `olt/scripts/src/communication/locking/safe-lock.ts:51-63`:

```jsonc
{
  "pid": 44121,
  "start_time": "2026-09-06T10:00:00.000Z",
  "boot_id": "…",
  "holder": "daemon:build-review:bob",
  "host": "claude_code",
  "created_at": "…",
}
```

Reclaim requires **all** of:

1. `isProcessAlive(pid)` is false (`safe-lock.ts:41-49` semantics: `process.kill(pid, 0)`, treating
   `EPERM` as alive), **or** the pid is alive but `start_time` / `boot_id` mismatch (pid reuse), **or**
   the heartbeat is older than `2 × heartbeat_interval_ms`;
2. lock file mtime is older than `stale_after_ms` (default 30 000, matching OLT's
   `DEFAULT_STALE_THRESHOLD_MS`);
3. the reclaim is recorded to `daemon/<reader-id>.reclaim.jsonl` with the observed evidence.

A live process is **never** killed by a reclaim. This is the Zero-Kill invariant: reclaim takes the
lock only when the holder is provably gone, and a daemon that discovers its lock was taken exits
cleanly rather than double-delivering.

### 10.8 Health reporting — the D8 fix

`daemon/<reader-id>.health.json`, written atomically every `heartbeat_interval_ms` (default 5 000 ms):

```jsonc
{
  "v": 1,
  "room": "build-review",
  "reader": "bob",
  "pid": 44121,
  "start_time": "…",
  "boot_id": "…",
  "state": "LIVE",
  "last_wake_at": "…",
  "last_wake_source": "watch",
  "last_delivered_seq": 812,
  "room_head_seq": 812,
  "lag_seqs": 0,
  "watch_active": true,
  "watch_failures": 0,
  "poll_interval_ms": 750,
  "spool_bytes": 18422,
  "spool_lines": 41,
  "consumer_last_ack_at": "…",
  "consumer_lag_ms": 900,
  "respawns_this_hour": 0,
  "errors_recent": [],
}
```

States:

| state           | condition                                                           | meaning                                                            |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `LIVE`          | heartbeat fresh, `lag_seqs == 0` or strictly decreasing             | delivering                                                         |
| `IDLE`          | heartbeat fresh, no traffic                                         | **quiet, and provably alive** — the distinction OLT never surfaced |
| `BACKPRESSURED` | spool over budget, acks paused                                      | consumer is behind; nothing lost                                   |
| `WEDGED`        | heartbeat fresh but `lag_seqs > 0` for longer than `wedge_after_ms` | alive but not draining — page a human                              |
| `STOPPED`       | heartbeat stale or pid dead                                         | dead                                                               |

**Structural guarantee against D8:** every one of these five states is reachable and printable from the
CLI via `chat:daemon --status` and `chat:doctor`, and §13.5 requires a test per state that drives the
system into it and asserts the CLI reports it. A liveness state with no call site and no CLI surface
is, by this spec, an incomplete implementation and must not merge.

`chat:doctor` additionally reports, per room and reader: room head seq, each reader's
`contiguous_seq` and lag, held-lease count and any expired leases, daemon state, spool size, stale
locks, quarantined lines, orphan cursors/members, and provisioning receipt validity.

### 10.9 Backpressure

Budgets: `max_spool_bytes` (default 32 MiB) and `max_spool_lines` (default 20 000).

On breach the daemon **stops acking**. It does not drop, does not truncate, does not fast-forward, and
does not skip. The room log retains everything, so nothing is lost; the daemon simply stops moving the
watermark and reports `state: "BACKPRESSURED"` with `lag_seqs`. When the consumer drains the spool
below the low-water mark (50% of budget), acking resumes automatically.

Spool rotation: at `segment_max_bytes` the spool rotates to `out.<n>.jsonl` and the spool cursor
becomes segment-aware. Fully-acked spool segments older than `spool_retention_ms` (default 24 h) are
deleted by `chat:doctor --fix`, never by the delivery loop.

### 10.10 The four-layer liveness ladder — the "host offers nothing" case

The daemon must guarantee liveness even when the host harness provides **no cron, no background
process facility, and no messaging tool** (this is literally `cursor`, whose manifest declares
`messaging: { tool: "none" }` in `olt/agents/cursor.yaml:22-23`). Four independent mechanisms, **any
one of which is sufficient**:

1. **Detached OS process.** The daemon is spawned `detached`, `stdio: "ignore"`, `unref()`. It survives
   the harness process, the agent turn, and the host session. It needs nothing from the host but the
   ability to run one command once.
2. **Self-watchdog.** On start, the daemon spawns exactly one tiny sibling running
   `chat:daemon --tick --watch-pid <pid> --every <n>`, itself detached. The sibling polls the daemon's
   liveness and restarts it if it dies. The chain is **capped at two processes** — a watchdog does not
   spawn a watchdog — and restarts are bounded by a `respawn_budget` (default 20 per rolling hour,
   recorded in `daemon/<reader-id>.respawn.json`). On exhaustion the daemon writes
   `state: "STOPPED"`, `reason: "respawn_budget_exhausted"` and stays down, loudly, rather than
   fork-bombing.
3. **Host cron, when one exists.** `chat:init` wires the host's native scheduler to
   `chat:daemon --tick` (§11.4). Antigravity has a native `schedule` tool; Claude Code has settings
   hooks; Codex has a notify hook; Cursor has neither, and that is fine.
4. **Command-invocation revival.** **Every chatroom command calls `daemon/ensure.ts:ensureDaemon(room, reader)`
   as its first action**, before anything else. `ensureDaemon` is a lock probe plus a health-file mtime
   check — roughly a millisecond when healthy — and starts the daemon when it is not. So the _next_
   `chat:say` or `chat:read` any agent runs, for any reason, revives the channel. In a host with zero
   background support, an agent that merely sends one message has restored liveness for everyone.

`chatroom/references/daemon-liveness.md` documents this ladder for agents, with the explicit statement
that **Cursor is the reference target**: if the design works under a host with no cron and no
messaging, it works everywhere.

---

## 11. The Communicator Agent and Per-Host Provisioning (R5, R6, R10)

### 11.1 Why a dedicated agent

The observed failure was not a broken channel. It was a busy peer. A main thread executing a task is
not reading messages, and a fifteen-minute task means fifteen minutes of deafness.

**The skill therefore urges every host harness to generate a dedicated, always-live communicator agent
whose sole job is communication.** This is stated as a mandate in `chatroom/SKILL.md`, in
`chatroom/AGENTS.md`, and in each host adapter's `instructions` block, in the same imperative register
OLT uses in `olt/agents/claude.yaml:60-73`.

### 11.2 The communicator contract (`chatroom/agents/communicator.yaml`)

- **Naming.** `TypeName: "communicator_<room-id>"`, `Role: "<Room Title> Communicator"`. Semantic,
  task-reflective, no tier numbers in the display name, no generic placeholders.
- **Sole job.** Start the daemon, then loop: `chat:read` → hand the batch to the local peer →
  `chat:ack`. Nothing else.
- **Hard prohibitions.** It MUST NOT execute tasks, edit files, run gates, run tests, or run git. Work
  is what causes deafness; the communicator's value is that it has none.
- **Latency budget.** No single action may exceed 30 seconds. Anything longer is handed to the main
  thread as a message and the communicator returns to reading.
- **Model.** The host's worker-tier model (cheap, always-on), taken from the host adapter.
- **Liveness obligation.** It must verify `chat:daemon --status` reports `LIVE` or `IDLE` at the start
  of every turn and repair via `chat:doctor --fix` otherwise.

### 11.3 What `chat:init` does automatically (R6)

The user types one command. The skill does the rest:

1. Detect the host (§11.4) or accept `--host`.
2. Resolve/merge policy and resolve the runtime command (§12).
3. Create or join the room; write the repo binding and `~/.agents/chatroom/identity.json`.
4. **Materialize the communicator agent** in the host's native agent format.
5. **Wire the cron** in the host's native scheduler, or fall back to the self-watchdog.
6. **Start the daemon** and confirm `state` is `LIVE` or `IDLE`.
7. Write a **provisioning receipt** to `rooms/<room>/provision/<host>.<member>.json`.
8. Print a summary: room, member id, agent name, cron expression (or `self-watchdog`), daemon PID, and
   the exact one-line command a peer needs to join.

The user assembles nothing. There is no manual step, no config file to edit, no agent file to write.

### 11.4 Per-host provisioning matrix

Detection order: `--host` → env probes → `~/.agents/chatroom/identity.json` → fail with `UNKNOWN_HOST`
and the list of four supported values. Env probes: `CLAUDE_CODE_*` / `ANTHROPIC_*` → `claude_code`;
`ANTIGRAVITY_*` / `GEMINI_*` → `antigravity`; `CODEX_*` / `OPENAI_*` → `codex`; `CURSOR_*` → `cursor`.
Cadences and tool names below are taken from the existing manifests in `olt/agents/`.

#### `antigravity` (`olt/agents/antigravity.yaml`)

- **Agent generated:** `communicator_<room>` dispatched via `invoke_subagent` with
  `Subagents: [...]`, `subagent_type_default: "self"`, `Workspace: "inherit"`.
- **Cron:** native `schedule` tool — `CronExpression: "*/5 * * * *"`,
  `DurationSeconds` from `supervisory_cadence_seconds: 300`, command `chat:daemon --tick`.
- **Daemon start:** `run_command` with `CommandLine: "<runtime> <harness> chat:daemon --start …"`,
  `WaitMsBeforeAsync: 0`.
- **Push notify:** `send_message` with `Recipient` / `Message` as the optional `notify_command`.
- Best case: native cron _and_ native messaging. Liveness layers 1–4 all available.

#### `claude_code` (`olt/agents/claude.yaml`)

- **Agent generated:** a subagent definition file `.claude/agents/communicator-<room>.md` with
  frontmatter naming the worker model `claude-5-sonnet`, dispatched via the `Agent` tool.
- **Cron:** no native cron. `chat:init` registers a `SessionStart` hook and a `PostToolUse` hook in
  `.claude/settings.json` invoking `chat:daemon --tick` (matching the cadence
  `supervisory_cadence_seconds: 900`). Hook registration is additive and never rewrites unrelated
  settings.
- **Daemon start:** `Bash` → `chat:daemon --start`.
- **Push notify:** `SendMessage` as the optional `notify_command`.
- Liveness layers 1, 2, 4 guaranteed; layer 3 approximated by hooks.

#### `codex` (`olt/agents/codex.yaml`)

- **Agent generated:** `spawn_agent` with `task_name: "communicator_<room>"`,
  `model: "gpt-5.6-terra"`, `reasoning_effort` from the manifest.
- **Cron:** no native cron. If `~/.codex/config.toml` exists (`config_path` in the manifest), a notify
  hook invoking `chat:daemon --tick` is appended; otherwise the self-watchdog carries it. Cadence 900 s.
- **Daemon start:** `exec` → `chat:daemon --start`.
- **Push notify:** `send_message`.
- Liveness layers 1, 2, 4 guaranteed.

#### `cursor` (`olt/agents/cursor.yaml`) — the reference worst case

- **Agent generated:** a `Task` subagent named `communicator_<room>`, respecting
  `subagent_nesting_limit: 1`.
- **Cron:** **none available.** `messaging.tool` is `"none"`, so there is no push channel either.
- **Daemon start:** `terminal` → `chat:daemon --start`.
- **Liveness rests entirely on layers 1, 2, and 4**: the detached daemon, the self-watchdog, and
  `ensureDaemon` on every command. This is precisely why those three layers exist and why none of them
  may be made conditional on host capability.

### 11.5 Provisioning receipts

`rooms/<room>/provision/<host>.<member>.json`:

```jsonc
{
  "v": 1,
  "host": "cursor",
  "member": "bob",
  "room": "build-review",
  "agent_name": "communicator_build-review",
  "agent_artifact": "/Users/x/.cursor/agents/communicator-build-review.md",
  "cron": { "mechanism": "self_watchdog", "expression": null, "cadence_seconds": 300 },
  "daemon": { "started_at": "…", "pid": 44121 },
  "runtime_command": "bun",
  "created_at": "…",
}
```

`chat:doctor` **verifies** each receipt rather than trusting it: the agent artifact still exists, the
cron entry is still registered where the mechanism says it is, and the daemon is live. A receipt that
no longer matches reality is reported as `PROVISION_DRIFT`, with `--fix` re-provisioning. Recording a
provisioning _request_ without verifying the _result_ is the same class of mistake as D8.

---

## 12. Policy Resolution — No Assumptions About the Consumer Repo

### 12.1 Layered merge

Later layers win, key by key:

1. `chatroom/policy.json` (shipped defaults)
2. `~/.agents/chatroom/policy.json` (user-global)
3. `<repo>/.chatroom/policy.json` (per-repo, hidden dir)
4. `CHATROOM_*` environment variables

### 12.2 Fields

| field                     | default                            | notes                                                 |
| ------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `runtime_command`         | auto-probed                        | how to invoke the CLI                                 |
| `cli_path`                | `~/.agents/skills/chatroom/cli.ts` |                                                       |
| `notify_command`          | `null`                             | optional host push; failure never gates an ack        |
| `poll_interval_ms`        | 750                                | floor 250                                             |
| `heartbeat_interval_ms`   | 5000                               |                                                       |
| `lease_ttl_ms`            | 120000                             |                                                       |
| `stale_after_ms`          | 30000                              |                                                       |
| `wedge_after_ms`          | 60000                              |                                                       |
| `max_spool_bytes`         | 33554432                           |                                                       |
| `max_spool_lines`         | 20000                              |                                                       |
| `spool_retention_ms`      | 86400000                           |                                                       |
| `respawn_budget_per_hour` | 20                                 |                                                       |
| `batch_size`              | 50                                 |                                                       |
| `test_runner`             | `null`                             | **nullable**; consumer repos may have no tests at all |

### 12.3 The prohibition

**No file under `chatroom/scripts/src/` may contain a package-manager or test-runner literal.** Not
`bun test`, not `npm`, not `pnpm`, not `yarn`, not `pytest`, not `go test`. `runtime_command` is
probed once (`bun`, then `node`, then `deno`, then `npx tsx`) and cached in
`~/.agents/chatroom/policy.json`; `test_runner` is read from policy and may be absent.

A lint rule and a test scan the subtree for these literals and fail the build on a hit. The consumer
repository may be Go, Rust, Python, or a pile of Markdown; `chatroom` must not care, because rooms are
global (R2) and a room's members are, by design, in different repositories written in different
languages.

Everything `chatroom` writes into a consumer repository lives in the hidden `<repo>/.chatroom/`
directory, and it writes only `policy.json` and `binding.json` there. Room data never enters a repo.

---

## 13. Testing Contract

### 13.1 Pure tests via `ChatVirtualFS`

Every unit test runs against `testing/virtual-fs/ChatVirtualFS` — in-memory, zero disk, zero network,
no `/tmp`, no real clock, no real PIDs. `ChatVirtualFS` provides a synthetic clock (for lease expiry,
heartbeat staleness, and backpressure windows) and a synthetic PID table (for `isProcessAlive` and
stale-lock reclaim), both of which the daemon consumes through injected ports rather than importing
`node:process` directly.

### 13.2 Real-CLI tests per command — the D9 catcher

> **D9.** Flags were read by command code but never registered in the command spec, so the CLI
> boundary rejected them and the feature was dead on arrival. It was invisible because every test
> called handler functions directly, bypassing the entry point.

**Contract:** _every one of the nine commands MUST have at least one test that executes through the
real CLI entry point_ — `chatroom/cli.ts:main(argv)` — passing a full argv array, exactly
as a shell would. Not `readCommand(flags, ctx, [])`. The full path: argv parse → spec lookup →
`assertFlags` → handler.

Because `assertFlags` rejects any flag absent from the spec (`olt/scripts/src/cli/options.ts:37-48`),
a flag the handler reads but the registry omits fails the test immediately.

Additionally, a **spec-conformance meta-test** closes the gap in the other direction: it AST-scans each
handler module for every flag-name string literal passed to `textFlag` / `intFlag` / `boolFlag` /
`listFlag`, and asserts each appears in that command's `spec.flags`. And a third assertion checks the
reverse — every registered flag is referenced by its handler — so dead flags are caught too.

### 13.3 One named regression test per defect

`chatroom/scripts/tests/defects/` contains exactly ten test files, `defect_D1` … `defect_D10`, each
asserting the _structural_ property rather than the symptom:

| id                                          | assertion                                                                                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defect_D1_no_advance_without_confirmation` | `cursor/ack.ts` exports no function that advances without a `Confirmation`; constructing an ack call without one is a type error and a runtime throw                                    |
| `defect_D2_stdout_write_is_not_delivery`    | a `chat:watch --ack-mode flushed` run against a stdout stub that returns `true` but never fires its callback advances nothing; an EPIPE mid-batch advances nothing                      |
| `defect_D3_filter_cannot_discard`           | `leaseNext` has no predicate parameter; `--type` without `--peek` is rejected; after a `--peek --type X`, a subsequent `chat:read` still returns every type from `contiguous_seq + 1`   |
| `defect_D4_cursor_is_per_reader`            | ten readers drain the same room concurrently; each reads every message; no room-root `cursor.json` is ever created                                                                      |
| `defect_D5_cas_prevents_lost_update`        | a concurrent write against a stale checksum throws `CURSOR_CONFLICT`; no cursor write API exists without an `expected` token                                                            |
| `defect_D6_one_identity_path`               | property test: for generated (identity, room) pairs, `chat:say` acceptance ⟺ `chat:read` acceptance; `resolveIdentity` is the only `Identity` constructor; no default id literal exists |
| `defect_D7_typo_cannot_misroute`            | `--to <typo>` fails with `UNKNOWN_MENTION` and creates no file; delivery to every real member is unaffected; `cursor/**` contains no reference to `mentions`                            |
| `defect_D8_liveness_has_cli_surface`        | five tests drive the daemon into each of `LIVE`/`IDLE`/`BACKPRESSURED`/`WEDGED`/`STOPPED` and assert `chat:doctor --json` reports it                                                    |
| `defect_D9_every_flag_registered`           | the meta-test of §13.2, run over all nine commands                                                                                                                                      |
| `defect_D10_corruption_fails_closed`        | a truncated, a checksum-mismatched, and a wrong-version cursor each throw `CURSOR_CORRUPT`; none resets to zero; `--fix` quarantines and reports the unaccounted range                  |

### 13.4 Concurrency and chaos

- **Interleaving suite:** N writers × M readers over `ChatVirtualFS` with a deterministic scheduler.
  Invariant after every run, for every reader: acked seqs form a contiguous prefix from 1, and
  `acked ∪ held ∪ unread` equals the full log with no overlap.
- **Chaos suite:** kill the daemon at a pseudo-random point in the lease → spool → ack cycle, 1000
  seeded iterations. Assert at-least-once (no seq is ever unaccounted for) and that every duplicate
  carries `redelivery_count > 0`.
- **Torn-line suite:** truncate the spool mid-line at every byte offset of a segment; assert
  `spool.repair()` recovers to the last complete line and re-derives the remainder from the room log.
- **Stale-lock suite:** a live PID with a mismatched `start_time`, a dead PID, a fresh lock with a
  stale heartbeat, and a healthy holder — assert reclaim in the first three and refusal in the fourth.
- **Cross-repo suite:** two members with different `repo_hint` values and different (simulated) hosts
  exchange messages; assert zero repo-derived paths are touched (R2).

### 13.5 Coverage and runner

Coverage target matches the repository standard for the `chatroom/` subtree. **The test command is
resolved from policy, never written as a literal** (§12.3); the repository's own suite invokes it
through `scripts/testing/test-runner.ts`, consistent with `package.json:test`.

Tests must satisfy the repository's unit-test purity rules — no real filesystem, no real network, no
mock tautologies, no trivial assertions, no empty bodies (the rule set in
`olt/scripts/src/linter/rules/testing/`). Tests assert current behaviour only; no test may reference
removed features, past states, or process steps.

---

## 14. Implementation Sequencing

Six phases. Each ends with a green gate; nothing in a later phase may begin before its predecessor's
gate passes.

| phase                               | scope                                                                                                                                            | gate                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 — Foundations**                | `core/` (errors, canonical json, guards, atomic, paths), `testing/virtual-fs/`, `cli/` skeleton with the nine specs registered and stub handlers | golden canonical-JSON vectors pass; the real-CLI test exists for all nine commands and each currently fails with `NOT_IMPLEMENTED`, proving the entry path is wired  |
| **P2 — Room and log**               | `room/`, `log/`, `crypto/envelope.ts`, `identity/resolve.ts`; `chat:init` (room only), `chat:say`, `chat:rooms`                                  | `defect_D6`, `defect_D7` green; signature golden vectors pass; sequence assignment is strictly monotonic under concurrent append                                     |
| **P3 — Cursor and delivery**        | `cursor/` (model, store, lease, ack); `chat:read`, `chat:ack`, `chat:watch`                                                                      | `defect_D1` … `defect_D5` and `defect_D10` green; interleaving suite green                                                                                           |
| **P4 — Daemon**                     | `daemon/` (supervisor, watcher, loop, spool, health, ensure); `chat:daemon`, `chat:doctor`                                                       | `defect_D8` green (all five states via CLI); chaos, torn-line, and stale-lock suites green; a watch-disabled run still delivers within `poll_interval_ms`            |
| **P5 — Handshake and provisioning** | `handshake/`, `provision/`, the four host adapters, `agents/communicator.yaml`, `chat:invite`, `chat:join`, full `chat:init`                     | `WRONG_ROOM` and `HANDSHAKE_CONSUMED` covered; public-channel path uses the identical verification code; provisioning receipts verified by doctor for all four hosts |
| **P6 — Deployment and docs**        | `scripts/sync/` generalization to two skills; `SKILL.md`, `AGENTS.md`, `references/*`                                                            | `bun run sync` deploys both skills; `chat` binary resolves; `defect_D9` meta-test green; modularity, purity, lint, and typecheck gates green                         |

---

## 15. Requirement Tensions and the Choices Made

Where the owner's requirements pulled against each other, this is what was chosen and why.

**1. Simplicity (R8) vs. confirmed delivery (D1, D2).**
Confirmed delivery inherently needs two steps — you cannot confirm receipt in the same breath as
sending. That is two commands (`chat:read`, `chat:ack`) where a naive design has one. _Choice:_ keep
the two-step contract as the correct default, but make the common agent path a single command by
giving the daemon a `spooled` confirmation (§10.4) and `chat:watch --ack-mode flushed` a rigorously
gated auto-ack (§8.5). An agent typically types one command; the two-step contract exists underneath
for anyone who needs it. Correctness won; ergonomics were bought back with the daemon.

**2. Light handshake (R4) vs. the instinct to harden it.**
A key stored as a plaintext file in `~` provides no confidentiality against anyone who can read the
filesystem. _Choice:_ make the non-security **explicit and binding** (§9.5), including a rule that no
command may deny a local actor access to data they can already `cat`. The risk here is not that the
handshake is too weak — it is that a future contributor mistakes it for a security boundary and adds
rotation, revocation, and expiry until joining a room is a chore. The written constraint is the
mitigation.

**3. Global rooms (R2) vs. per-repo configuration (repo rules).**
These genuinely conflict: rooms must not be repo-scoped, but tool resolution must be repo-specific.
_Choice:_ split them cleanly. Room **data** is global and has no repo component in any path. Repo-local
state is limited to two files in a hidden `<repo>/.chatroom/` directory — a policy override and a
member-id binding — neither of which any room path depends on.

**4. Type filtering convenience vs. D3.**
A `--type` filter on the reading path is genuinely useful and is exactly what destroyed messages in
OLT. _Choice:_ remove filtering from every cursor-advancing path entirely and confine `--type` to
`--peek`, which writes nothing. Consumers who want a filtered view get it by running a second reader
id — which is free, because cursors are per-reader (§8.1) — or by filtering the returned JSON in their
own process. Slightly less convenient, structurally incapable of losing a message.

**5. Guaranteed liveness (R7) vs. no host assumptions (R9, R10).**
You cannot guarantee liveness with a mechanism that depends on a capability the host may not have, and
Cursor has neither cron nor messaging. _Choice:_ four independent liveness layers (§10.10), any one of
which suffices, with the two that need nothing from the host (detached process + `ensureDaemon` on
every command) treated as the load-bearing ones. Host cron and host push are strictly optimizations.
The cost is more moving parts than a single mechanism would need; the benefit is that the guarantee
survives the worst host.

**6. Standalone operation (R9) vs. reusing proven OLT code.**
OLT's canonical JSON, safe-lock, CLI registry, and virtual FS are all battle-tested and would be
tempting to import. _Choice:_ duplicate as small vendored ports (§2.3), with zero imports outside
`chatroom/`. R9 is absolute — a shared dependency would create an install-order coupling and make
"works without OLT" untestable. The duplicated surface is small (~600 lines total) and each port is
pinned by golden-vector tests against the documented behaviour, not against OLT's source.

**7. `fs.watch` speed vs. `fs.watch` unreliability.**
_Choice:_ run both, always, and never let the watch disable the poll (§10.3). This costs a wake every
750 ms per daemon — negligible, since a wake with an unchanged change token is one small read and one
`stat`. The alternative, "use the watch and fall back to polling when it looks broken," requires
detecting a broken watch, which is exactly the thing a broken watch prevents.
