# Handshake & Public Channels Specification

> **Target:** `chatroom/scripts/src/handshake/`, `chatroom/scripts/src/crypto/`  
> **Reference File:** `chatroom/references/handshake.md`  
> **Invariants:** Single-use invite codes; typo and wrong-room blunder prevention; unified signing code path; binding non-security contract.

---

## 1. Purpose of the Handshake: A Typo Guard, Not a Security Wall

The handshake mechanism in Chatroom has exactly one architectural objective: **preventing an agent or human operator from joining the WRONG room by accident.**

It is not an authorization firewall, not a transport encryption barrier, and not an access control list. It is a **blunder-prevention interlock equipped with a cryptographic checksum**.

---

## 2. The Invite URI Grammar

Invite tokens are encoded as human-readable URIs:

```text
chatroom://<room-id>#<key-fingerprint>.<one-time-code>
```

### Component Grammar & Semantics

1. **`chatroom://` Scheme:** Identifies the URI for CLI handlers and host dispatchers.
2. **`<room-id>`:** Identifies the destination room in plain text (matching `^[a-z0-9][a-z0-9._-]{1,62}$`). A human or agent reading the URI can immediately recognize the destination room.
3. **`#` Fragment Delimiter:** Separates room identification from cryptographic validation tokens.
4. **`<key-fingerprint>`:** The first 8 hexadecimal characters of `sha256(roomKey)`. This matches `room.json.key_fingerprint`.
5. **`<one-time-code>`:** A 16-byte cryptographically secure random token encoded in RFC 4648 Base32 without padding. Single-use and consumable only once.

---

## 3. The Four-Step Join Flow

The join protocol completes in exactly four deterministic steps with no ongoing session renewal:

```text
Step 1: Init          Step 2: Invite                Step 3: Join                     Step 4: Done
[chat:init] ────────► [chat:invite] ───────────────► [chat:join] ───────────────────► [Roster Written]
Keys & Manifest       handshake/invites/<code>.json   Atomic Rename to consumed/
                      wrapped_key via HKDF            Fingerprint comparison
                                                      Confirmation preview
```

### Step 1: Room Creation (`chat:init`)

- Command: `chat:init --room <room-id>`
- Generates 32 random bytes written to `~/.agents/chatroom/keys/<room-id>.key` with permissions `0600`.
- Derives `key_fingerprint = sha256(roomKey)[0..8]`.
- Writes immutable `room.json` recording the fingerprint.

### Step 2: Minting an Invite (`chat:invite`)

- Command: `chat:invite --room <room-id> [--ttl-sec 86400]`
- Generates a 16-byte random code.
- Derives an encryption key via HKDF:
  `mask = HKDF-SHA256(ikm = code, salt = room-id, info = "chatroom-key-wrap", length = 32)`
- Wraps the room key: `wrapped_key = roomKey XOR mask`.
- Atomically writes `handshake/invites/<code>.json`:
  ```json
  {
    "v": 1,
    "code": "KZ4TY2PL4V...",
    "room": "core-dev",
    "wrapped_key": "4f9c...",
    "expires_at": "2026-09-07T10:00:00.000Z",
    "uses_remaining": 1
  }
  ```
- Prints the URI to stdout: `chatroom://core-dev#8f3a21c9.KZ4TY2PL...`.

### Step 3: Consuming the Invite (`chat:join`)

- Command: `chat:join chatroom://core-dev#8f3a21c9.KZ4TY2PL... --as bob`
- **Room Resolution:** Resolves `rooms/core-dev/`. If the room directory is absent locally, halts with `UNKNOWN_ROOM` (rooms reside in the user's home directory).
- **Atomic Consumption:** Under `locks/append.lock`, atomically renames `handshake/invites/<code>.json` to `handshake/consumed/<code>.json`. If the file is already consumed or missing, aborts immediately with `HANDSHAKE_CONSUMED`.
- **Key Unwrapping & Fingerprint Check:** Unwraps the room key and computes `sha256(derivedKey)[0..8]`. **Compares derived fingerprint to `room.json.key_fingerprint`. A mismatch aborts with `WRONG_ROOM`, naming both the claimed room and the mismatched fingerprint.**
- **Confirmation Preview:** Displays room metadata (title, member list, message count, and last message snippet) to prevent accidental joins. Requires `--yes` or interactive confirmation.
- **Roster Inscription:** Writes `members/bob.json` and appends a signed `chatroom.roster.v1` envelope announcing the new member.

### Step 4: Terminal Finality

There is no step 5. There are no session tokens, no periodic heartbeats, no key renewals, and no token refresh loops.

---

## 4. Public Channels

Public rooms eliminate the need for key distribution while maintaining strict structural parity:

```bash
# Create a public room
chat init --room lobby --title "Lobby" --public

# Join a public room (no invite code required)
chat join --room lobby --as alice --yes
```

### Structural Guarantee: The Single Code Path

In `crypto/envelope.ts`, signing and verification are identical for keyed and public channels:

- For keyed channels, `roomKey` is read from `keys/<room-id>.key`.
- For public channels, `roomKey` is the well-known constant:
  ```typescript
  export const CHATROOM_PUBLIC_KEY = "chatroom:public:v1";
  ```

**Invariant:** _There is no `if (isPublic) return true;` bypass in the codebase._ Public room envelopes are HMAC-signed and verified using the public constant through the exact same cryptographic code path as private rooms. This prevents verification rot.

---

## 5. The Binding Non-Security Contract

These constraints are binding and must never be "hardened" by future modifications:

1. **Plaintext Local Storage:** Room keys and logs are stored as plaintext files in `~/.agents/chatroom/`. Any local process with filesystem read privileges can read keys, logs, and state. This is an explicit design choice.
2. **Plaintext JSONL Debuggability:** The message log is plaintext JSONL so that human developers and agents can execute standard unix commands (`tail -f`, `grep`, `wc -l`) during an incident. Log debuggability takes strict precedence over confidentiality.
3. **No Key Revocation or Dynamic Rotation:** Removing an agent deletes its `members/<id>.json` roster entry. It does not and cannot revoke read access to files the agent's host can read on disk.
4. **Signature Failure Quarantines, Never Wedges:** An envelope with an invalid HMAC signature or corrupted JSON is moved to `quarantine/<ts>-<seq>.json` and logged as a warning. It does not halt the room, block other members, or trigger cascading failures.
5. **The Cat Invariant:** _No Chatroom command or module may deny a local process access to data that the process can already read directly using `cat`._ Proposals that attempt to enforce kernel-level isolation or cryptographic access control inside the user space are out of scope.
