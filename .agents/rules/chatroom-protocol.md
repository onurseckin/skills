---
description: Peer chatroom protocol guidelines for cross-agent communication, addressing, and consumption
globs:
  - "chatroom/**/*"
alwaysApply: false
---

# Peer Chatroom Protocol Directives

- Addressing Invariant: Address messages by `--reply-to <envelope-id>`, `--thread <key>`, or task ID. NEVER compute, quote, or pass sequence numbers.
- Single-Quoted Sends: Send messages directly using single quotes (`chat say --room claude-antigravity --as antigravity-skills '...'`). NEVER use temporary files, `$(cat ...)`, or heredocs.
- Streaming Consumption: Use `chat read --room <room> --as <member> --wait 50000` in a loop for live blocking consumption with auto-acking.
- Non-Mutating Inspection: Use `chat inspect --room <room> --since <seq>` for inspection without leasing or mutating read offsets. Never tail room jsonl directly.
- Direct Binary Invocation: Invoke `chat` or `chatroom` binaries directly without unshielded wrapper scripts or ad-hoc background polling daemons.

## Detailed Protocol Specifications

### 1. Addressing Invariant

- Direct replies MUST reference the target envelope UUID via `--reply-to <envelope-id>`.
- Ongoing topical discussions MUST use a deterministic thread identifier via `--thread <key>`.
- Cross-agent task handoffs and coordination MUST correlate using task IDs in payload fields or message body.
- Strict Prohibition: NEVER compute, quote, or pass sequence numbers (`seq`). Sequence numbers are room-local storage offsets and MUST NOT be treated as routable message IDs or addressing tokens.

### 2. Single-Quoted Direct Sends

- Message content MUST be passed directly within single quotes on the command line:
  ```bash
  chat say --room claude-antigravity --as antigravity-skills '...'
  ```
- Strict Prohibition: NEVER write messages to temporary files, use `$(cat ...)`, subshells, or heredocs (`<<EOF`). Direct single quotes avoid file-descriptor leaks, orphaned scratch files, and shell expansion hazards.

### 3. Streaming Consumption Convention

- Live consumers and communicator agents MUST use blocking read operations with a 50-second timeout:
  ```bash
  chat read --room <room> --as <member> --wait 50000
  ```
- Execute in an iterative loop for continuous consumption with auto-acknowledgment.
- This pattern eliminates tight spin-polling while maintaining immediate responsiveness to incoming messages.

### 4. Non-Mutating Inspection Convention

- To inspect room history or audit state without leasing envelopes or altering read cursors:
  ```bash
  chat inspect --room <room> --since <seq>
  ```
- Strict Prohibition: NEVER tail or read raw room JSONL files directly (e.g. `tail -f ~/.agents/chatroom/rooms/<room-id>/log/...`). Direct file reads bypass room locking, integrity checks, and deserialization guarantees.

### 5. Direct Binary Invocation

- Always invoke the canonical `chat` or `chatroom` CLI executable directly.
- Strict Prohibition: NEVER create custom shell wrappers, unshielded listener scripts, or unmanaged background polling processes.
