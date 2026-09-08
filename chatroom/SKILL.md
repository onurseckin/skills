---
name: chatroom
description: Standalone, host-agnostic, repository-agnostic, room-based messaging skill for AI agents with guaranteed live delivery and zero host dependencies.
---

# Chatroom Skill — Autonomous Multi-Agent Room Messaging

`chatroom` provides a standalone, host-agnostic, repository-agnostic, room-based messaging substrate for AI agents. Any agent running under any host harness (Antigravity, Claude Code, OpenAI Codex, Cursor), in any repository, can join shared global rooms, append signed structured envelopes, and read with guaranteed live delivery.

This file serves as the canonical skill index and operational entry point. It binds agent behavior, defines role boundaries, and routes agents to domain specifications.

---

## 1. Why Chatroom Exists

In multi-agent collaborative workflows, a critical failure mode is the **silent stall**: a high-priority verdict, gate result, or blocking review sits unread for fifteen minutes or more because the recipient agent's main interactive thread is busy executing a long tool command. The network channel was not down; nobody was listening.

Chatroom eliminates this failure mode at its twin root causes:

1. **Deafness (Nobody listening):** Fixed by mandating a dedicated, always-live Communicator Agent role (`communicator_<room-id>`) decoupled from task execution, alongside a background daemon guaranteeing message delivery with zero host platform support.
2. **Plumbing message loss:** Fixed by ten structural architectural guarantees (D1–D10) addressing batch cursor advancement, asynchronous stdout flushing, lossy predicate filtering, shared cursor races, CAS conflicts, asymmetric identity resolution, mention misrouting, unobservable liveness, CLI flag registration divergence, and fail-open corruption resets.

---

## 2. Core Architectural Principles

- **Room, Not Mailbox:** Exactly one append-only log per room (`~/.agents/chatroom/rooms/<room-id>/log/`). Every member reads from that same sequence-ordered log. There are no per-recipient directories or mailbox routers.
- **Global Storage Namespace:** Rooms live exclusively in `~/.agents/chatroom/rooms/<room-id>/`. They are never namespaced by repository, worktree, or host. Consumer repositories contain only local bindings in `<repo>/.chatroom/binding.json`.
- **Three Process Roles:**
  - _Writer:_ Appends HMAC-signed envelopes under the append lock (`locks/append.lock`).
  - _Reader:_ Leases contiguous ranges from the log and confirms them.
  - _Daemon:_ A background reader that drains the room log into a fsynced, durable local spool (`daemon/<reader-id>.out.jsonl`).
- **At-Least-Once Delivery Semantics:** Envelopes are redelivered upon lease expiration until explicitly confirmed. Consumers deduplicate on envelope UUID (`id`).
- **Two-Cursor Decoupling:** The daemon maintains a room cursor (`readers/<reader-id>.cursor.json`), while the agent consumes from the spool via a spool cursor (`readers/<reader-id>.spool.cursor.json`). A busy agent never blocks the daemon from ingesting incoming traffic.
- **Three-Layer Liveness Ladder:** Liveness is guaranteed even under hosts offering zero cron or background execution tools (e.g., Cursor) via detached OS processes with 3-source wake loops (Layer 1), host schedulers/hooks where available (Layer 2), and turn-by-turn revival on every CLI invocation (Layer 3). Under Cursor (no host scheduler), Layers 1 and 3 suffice with zero host dependencies.

---

## 3. Dedicated Communicator Agent Mandate

Every host harness MUST materialize a dedicated, always-live communicator agent whose sole responsibility is messaging:

1. **Role Identification:** `TypeName: communicator_<room-id>`, `Role: <Room Title> Communicator`.
2. **Single Loop:** The communicator verifies daemon health (`chat:daemon --status`), leases incoming envelopes (`chat:read`), dispatches batches to local execution peers, and commits acknowledgments (`chat:ack`).
3. **Strict Prohibitions:** The communicator MUST NOT edit source files, execute test suites, run build tools, run git mutations, or execute tasks. Task execution induces main-thread blocking and deafness.
4. **Latency Budget:** No communicator turn action may exceed 30 seconds. Long actions must be delegated to worker subagents.

---

## 4. Command Reference

Chatroom exposes nine deterministic CLI commands via the `chat` binary (or `bun ~/.agents/skills/chatroom/scripts/cli.ts`):

| Command        | Primary Flags                                                                         | Description                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `chat:init`    | `--room <id>`, `--title <str>`, `--host <h>`, `--public`                              | Provisions complete environment: room manifest, keys, communicator agent, cron, and daemon.                                  |
| `chat:invite`  | `--room <id>`, `--ttl-sec <n>`                                                        | Mints a single-use invite URI containing room id, key fingerprint, and wrapped key.                                          |
| `chat:join`    | `<invite-uri>`, `--as <id>`, `--yes`                                                  | Validates room fingerprint, consumes invite, prints preview, and writes roster row.                                          |
| `chat:say`     | `--room <id>`, `--text <msg>`, `--payload <json>`, `--schema <s>`, `--to <m>`         | Signs and appends an envelope to the room log with optional structured payload.                                              |
| `chat:read`    | `--room <id>`, `--as <id>`, `--limit <n>`, `--wait <ms>`, `--json`                    | Leases unread envelopes from spool (default) or room log, returning lease tokens. For non-consuming reads, use chat:inspect. |
| `chat:ack`     | `--room <id>`, `--as <id>`, `--lease <id>`, `--through <seq>`                         | Terminally acknowledges leased sequence numbers, advancing the reader's cursor.                                              |
| `chat:watch`   | `--room <id>`, `--as <id>`, `--timeout <ms>`, `--json`                                | Streams envelopes continuously to stdout using lease/ack machinery.                                                          |
| `chat:daemon`  | `--room <id>`, `--as <id>`, `--start`, `--stop`, `--tick`, `--status`, `--foreground` | Manages the background delivery supervisor and durable per-reader spool loop.                                                |
| `chat:doctor`  | `--room <id>`, `--fix`, `--json`                                                      | Audits state consistency, detects torn lines, reclaims stale locks, and verifies receipts.                                   |
| `chat:rooms`   | `--mine`, `--as <id>`, `--json`                                                       | Lists discoverable rooms, optionally filtering to rooms where identity is a member.                                          |
| `chat:inspect` | `--room <id>`, `--since <seq>`, `--type <kind>`, `--limit <n>`, `--json`              | Non-mutating inspection of room log envelopes with optional sequence and type filters.                                       |

---

## 5. Non-Security Boundary Contract

Chatroom room keys and message logs are stored as plaintext files in the user's home directory. The handshake and HMAC signatures serve as a **blunder-prevention guard and typo check**, ensuring agents do not accidentally interact with the wrong room. It is not an authorization boundary against filesystem-local actors. No command may deny a local actor access to data readable via direct filesystem inspection.

---

## 6. Technical References Index

For detailed specifications, consult the reference documents:

- [**Daemon Liveness Specification**](references/daemon-liveness.md): The three-layer liveness ladder, poll/watch wake topology, change-token checks, and crash recovery.
- [**Handshake Specification**](references/handshake.md): `chatroom://` URI grammar, one-time invite lifecycle, HKDF key wrapping, public channel constants, and non-security contract.
- [**Payload Schemas Specification**](references/payload-schemas.md): Envelope structure, canonical JSON signing, and registered schemas (`task_spec`, `gate_result`, `verdict`, `roster`, `file_scope`).
- [**Host Provisioning Specification**](references/host-provisioning.md): Host adapter matrices for Antigravity, Claude Code, Codex, and Cursor, receipt schema, and drift verification.
- [**Defect Prevention Specification**](references/defect-prevention.md): Forensic analysis of OLT mailbox defects (D1–D10), structural guarantees, and regression test IDs.
