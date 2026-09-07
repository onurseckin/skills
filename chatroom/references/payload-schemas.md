# Payload Schemas & Message Model Specification

> **Target:** `chatroom/scripts/src/core/json.ts`, `chatroom/scripts/src/crypto/envelope.ts`  
> **Reference File:** `chatroom/references/payload-schemas.md`  
> **Invariants:** Single canonical JSON signing path; non-flattened structured payloads; opaque forward-compatible schema handling; strictly monotonic sequence assignment.

---

## 1. The Canonical Envelope Model

Messages in Chatroom are serialized as single-line JSON objects within segment files (`log/000001.jsonl`). Each envelope adheres to the following structural schema:

```json
{
  "v": 1,
  "id": "9f5f8b0c-1122-3344-5566-778899aabbcc",
  "room": "core-dev",
  "seq": 812,
  "ts": "2026-09-06T10:14:02.771Z",
  "sender": {
    "id": "alice",
    "role": "communicator",
    "host": "claude_code",
    "repo_hint": "/Users/onur/repos/api",
    "pid": 44121
  },
  "kind": "verdict",
  "thread": "verdict-812",
  "reply_to": "3c1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "mentions": ["bob"],
  "text": "Gate G3 passed on the migration lane; changes approved.",
  "body": {
    "schema": "chatroom.verdict.v1",
    "data": {
      "subject": "task-migration-44",
      "verdict": "approved",
      "reasons": ["All gates green", "Unit tests clean"],
      "blocking": []
    }
  },
  "key_fingerprint": "sha256:8f3a21c9",
  "redelivery_count": 0,
  "sig": "4b1c9e82a3..."
}
```

### Envelope Field Definitions

| Field              | Type              | Description                                                                                                           |
| ------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `v`                | integer           | Protocol schema version (always `1`).                                                                                 |
| `id`               | string (UUID v4)  | Unique message identifier used as the primary deduplication key.                                                      |
| `room`             | string            | Target room identifier.                                                                                               |
| `seq`              | integer           | Strictly monotonic sequence number assigned under `locks/append.lock`.                                                |
| `ts`               | string (ISO-8601) | Message creation timestamp in UTC with millisecond precision.                                                         |
| `sender`           | object            | Sender metadata: `id`, `role`, `host`, `repo_hint`, and `pid`.                                                        |
| `kind`             | enum              | Coarse routing hint: `"message" \| "dispatch" \| "verdict" \| "gate_result" \| "roster" \| "handshake" \| "control"`. |
| `thread`           | string \| null    | Optional correlation key for conversation threading. Does not alter routing.                                          |
| `reply_to`         | string \| null    | Parent envelope UUID if replying to a specific message.                                                               |
| `mentions`         | string[]          | Advisory recipient identifiers. Does not restrict log delivery.                                                       |
| `text`             | string            | Human-readable prose summary.                                                                                         |
| `body`             | object            | Container for structured machine-readable payload: `{ schema, data }`.                                                |
| `key_fingerprint`  | string            | First 8 hex chars of SHA-256 room key hash.                                                                           |
| `redelivery_count` | integer           | Incremented by the reader upon re-issuing an expired lease. Excluded from signature.                                  |
| `sig`              | string (hex)      | HMAC-SHA256 signature calculated over canonicalized envelope.                                                         |

---

## 2. Canonical JSON Serialization & HMAC Signing

### Invariant: Deterministic Signing Algorithm

To ensure signature verification is immutable across platforms, runtimes, and languages:

1. `sig` is computed as:
   $$\text{sig} = \text{HMAC-SHA256}(\text{roomKey}, \text{canonicalJson}(\text{envelope} \setminus \{\text{sig}, \text{redelivery\_count}\}))$$
2. `redelivery_count` is **strictly excluded** from the signature. This ensures that an envelope redelivered due to an unacknowledged lease verifies with the exact same signature.
3. Canonicalization rules in `core/json.ts`:
   - Object keys are recursively sorted lexicographically by UTF-16 code units.
   - `undefined`, functions, and symbol values are dropped from objects and rendered as `null` in arrays.
   - Non-finite numbers (`NaN`, `Infinity`, `-Infinity`) are rejected with `INVALID_JSON`.
   - Circular references are rejected with `CIRCULAR_REFERENCE`.
4. Verification executes `crypto.timingSafeEqual` over fixed-length buffer digests to prevent timing side-channels.

---

## 3. The Zero-Flattening Invariant

**`body.data` MUST NEVER be flattened or string-escaped at any layer.**
Specifically:

- `log/append.ts` appends the native JSON object.
- `cursor/lease.ts` yields the native JSON object.
- `chat:read --json` and `chat:watch --json` emit the native object under `.body.data`.
- The daemon durable spool persists the native JSON object.
- `chat:say --payload` requires valid JSON; bare strings are rejected unless `--schema chatroom.text.v1` is explicitly specified.

### Forward-Compatible Schema Handling

Chatroom parses unknown `schema` values opaquely:

- If a message arrives carrying a schema not registered in this skill (e.g. `olt.custom_event.v3`), the message is accepted and persisted as long as `body.data` is a valid JSON object within `max_payload_bytes` (default: 256 KiB).
- This ensures that higher-level orchestrators (such as OLT) can evolve communication protocols without requiring a new release of Chatroom.

---

## 4. Registered Payload Schemas

Chatroom ships with seven standardized, structurally validated schemas:

### 4.1 `chatroom.text.v1`

Plain text message wrapper.

```json
{
  "text": "Hello team, starting wave 3."
}
```

### 4.2 `chatroom.task_spec.v1`

Formal task assignment carrying write scopes, gates, and criteria.

```json
{
  "task_id": "T-402",
  "title": "Refactor database connection pool",
  "scope_paths": ["src/db/pool.ts", "src/db/connection.ts"],
  "gates": ["bun test tests/db/", "tsc --noEmit"],
  "acceptance": ["Connection leak eliminated", "Idle pool timeout <= 30s"],
  "deadline": "2026-09-06T18:00:00.000Z"
}
```

### 4.3 `chatroom.gate_result.v1`

Verification gate execution evidence.

```json
{
  "gate_id": "G-UNIT-TEST",
  "command": "bun test tests/auth/",
  "exit_code": 0,
  "passed": true,
  "evidence": ".olt/capsules/run-44/evidence/g_unit_test.json"
}
```

### 4.4 `chatroom.verdict.v1`

Authoritative multi-agent review decision.

```json
{
  "subject": "task-review-T-402",
  "verdict": "changes_requested",
  "reasons": [
    "Connection timeout configuration missing validation",
    "Unit test coverage dropped 2%"
  ],
  "blocking": ["src/db/pool.ts:142"]
}
```

### 4.5 `chatroom.roster.v1`

Fleet presence and membership announcements.

```json
{
  "agents": [
    {
      "id": "alice",
      "role": "communicator",
      "host": "claude_code",
      "tier": 2,
      "status": "active"
    },
    {
      "id": "bob",
      "role": "implementer",
      "host": "antigravity",
      "tier": 3,
      "status": "active"
    }
  ]
}
```

### 4.6 `chatroom.file_scope.v1`

Concurrency lock coordination across distributed agents.

```json
{
  "paths": ["src/core/auth/", "src/core/session.ts"],
  "mode": "exclusive"
}
```

### 4.7 `chatroom.control.v1`

Internal daemon and protocol supervisory control directives.

```json
{
  "action": "reclaim",
  "details": {
    "reclaimed_pid": 41201,
    "reason": "stale_heartbeat"
  }
}
```
