I did a deep pass over the rewritten design and code you surfaced. There’s a lot to like here — but there are also a few places where I think you may have introduced real security or robustness risks, and at least one place where the current documented security claim is **too strong** for the actual construction.

I’ll organize this by:

1. **Big-picture assessment**
2. **High-severity issues**
3. **Medium-severity issues / edge cases**
4. **Things that are good and sound**
5. **What I would change next, in priority order**

---

# Executive summary

## Overall
This is now a **much more serious protocol design** than the earlier versions:
- cleaner size model,
- better separation of concerns,
- much better tests,
- more principled compression dispatch,
- more honest treatment of intro vs ordinary message flows.

But if I focus specifically on **cryptographic soundness, subtle failure modes, and corner cases that could actually hurt users**, then my top conclusions are:

## Top conclusions
### 1. **The 64-bit GCM tag is the most questionable security choice**
It may still be acceptable for your product, but your current docs overstate how safe it is. It is not “astronomically unlikely” in the same rhetorical sense as 96-bit/128-bit tags, and the security story depends more heavily on the product’s no-oracle/manual-use assumptions than the docs currently admit.

### 2. **`CONTACT` detection is much better than before, but still weak compared to AEAD-protected frames**
2-byte check is a lot better than 1 byte, but in a headerless autodetect system it still creates a real false-accept surface.

### 3. **The Ed25519-from-X25519 derivation design is clever, but it deserves much more caution**
It may work operationally, but it is not a standard identity construction, and your docs risk making it sound more natural/obvious than it is.

### 4. **There is a subtle but important mismatch between “deniable authentication” claims and actual behavior**
The docs’ deniability framing is too broad now that you also have optional signed broadcasts and cached TOFU signing keys.

### 5. **The protocol is now relying more on trial parsing and heuristic frame classification**
That’s okay for compactness, but it means **misclassification risk and parser behavior matter a lot more**.

---

# High-severity concerns

---

## 1. 64-bit GCM tags: acceptable tradeoff maybe, but currently over-justified

### What you do
In `src/crypto.ts`:

- `TAG_LENGTH = 64`

In `docs/crypto.md` you justify this as safe because:
- manual copy-paste
- no decryption oracle
- NIST concerns target high-throughput protocols

### My assessment
This is the biggest **security-policy** decision in the entire design.

I am **not saying it is definitely wrong**.  
I am saying:

> it is a deliberate weakening, and the docs currently sell it a bit too confidently.

### Why this matters
AEAD tags are the actual integrity line for your encrypted protocol.  
With 64-bit tags:
- random forgery success per attempt is `2^-64`
- that is still large enough to be considered strong in many low-volume contexts
- but it is **materially** weaker than 96 or 128

### The main issue
Your current doc language says:

> “AES-GCM's 64-bit tag makes false accepts astronomically unlikely”

I would tone that down. `2^-64` is strong, but in protocol/security writing, “astronomically unlikely” is usually language I’d reserve for 96+ bit AEAD tags in adversarial parsing settings.

### Why users could actually be hurt
If the product ever drifts toward:
- more automated workflows,
- repeated untrusted-input parsing,
- or broadcast-style public reposting in adversarial environments,

then the safety assumptions around 64-bit tags become weaker.

### My recommendation
Two choices:

#### If you keep 64-bit tags:
Document it more honestly:
- “We use a shorter authentication tag to reduce message size. This is a size-first tradeoff suitable for manual low-volume use, but weaker than standard 96/128-bit AEAD tags.”

#### If you want the more conservative choice:
Go back to **96-bit tags** for encrypted frames and keep the rest of the size wins.
That still leaves you in a much better place than v1.

### My actual opinion
- For **this product**, 64-bit tags are **defensible**
- But the design should present them as **acceptable for this exact use case**, not as broadly “safe” in a generic sense

---

## 2. CONTACT false-positive detection remains a real concern

### Current design
In `src/wire.ts`:

```ts
CONTACT: [pub:32][check:2]
```

with `contactCheckBytes(pub)` using two XOR-ish checks:
- `a = 0x5A ^ bytes`
- `b = 0xA5 ^ bytes ^ i`

False positive rate is documented as `1/65536`.

### Improvement over before?
Yes — much better than 1 byte.

### Is it enough?
Maybe for this app, but I still consider it the weakest structural part of the protocol.

### Why
Your decode order in `main.ts` is:

1. try MSG AEAD
2. try INTRO AEAD
3. try signed broadcast
4. try CONTACT check bytes
5. try unsigned broadcast

This means arbitrary noise or malformed data that:
- doesn’t decrypt,
- doesn’t verify,
- but happens to be length 34 and match the two-byte check

gets interpreted as a contact token.

### Why users could actually be hurt
This can produce:
- spurious “new contact” flows
- misleading UI actions
- bad UX from malformed/malicious pasted text
- maybe contact pollution if user confirms something bogus

### Important nuance
Because this is a no-server copy/paste app, accidental or malicious weird text paste is very plausible. Users do paste junk.

### My recommendation
If you stay headerless, I would strongly consider:

#### Best next fix:
Use a **3-byte** or **cryptographic truncated hash** check for contacts.

Examples:
- first 3 bytes of `SHA-256(pub || "paternoster-contact-v1")`
- or first 2 bytes if you are very strict on size, but cryptographic not XOR-fold

Why?
Because XOR checks are not just short — they are also structurally weak and easy to collide intentionally.

### My severity judgment
This is not “catastrophic crypto break,” but it is one of the more realistic ways users could be confused or socially engineered by malformed input.

---

## 3. The Ed25519 signing key derivation from X25519 private key is nonstandard and underexplained

### What you do
In `src/sign.ts`:

- derive 32-byte Ed25519 seed from X25519 private key via HKDF
- wrap into Ed25519 PKCS8
- import as signing key

This gives a single-root identity:
- X25519 for ECDH
- Ed25519 for signatures
derived from one underlying private key material

### Why this is attractive
- user manages one identity
- no second long-lived secret to store
- compact and convenient

### My concern
This is not obviously a standard or widely reviewed construction.

The construction may be okay as a deterministic seed-derivation mechanism, but it is not something I’d describe lightly. There are a few questions:

#### a) Key separation
HKDF with strong domain separation should help, yes.

#### b) Long-term cross-protocol coupling
You now have:
- encryption identity
- signing identity
both irreversibly linked by derivation

That changes some privacy properties:
- a recovered X25519 private key implies signing identity too
- identity export/import ties them permanently
- there is no cryptographic unlinkability between your P2P and broadcast identities

That may be acceptable, but it is a product/security choice, not just an implementation convenience.

#### c) Browser interoperability
The import/export path for Ed25519 private keys is more fragile across Web Crypto implementations than common symmetric constructions.

### Why users could be hurt
- Future browser inconsistencies could break signed broadcast functionality unexpectedly
- A compromise of one identity function automatically compromises the other
- Users may incorrectly assume signing is a separate security boundary

### My recommendation
This is not necessarily wrong, but the docs should say more clearly:

- “Broadcast signing keys are deterministically derived from the messaging private key for convenience. This links the two roles permanently and is a design tradeoff.”

Also: keep good tests here. You already have decent coverage, which helps.

---

## 4. “Deniable authentication” claim is now too broad

### In docs
You write:

> Deniable authentication: ECDH is symmetric ...

This is broadly true for unsiged P2P message derivation.

### But now you also have:
- **signed broadcasts**
- cached signing keys
- explicit Ed25519 verification

That means the project as a whole no longer has a simple global “deniable authentication” story.

### Why this matters
A user or reader could infer:
- “Paternoster is deniable”
full stop

But actually:
- unsiged P2P messages have one set of properties
- signed broadcasts have non-deniable signatures by design

### Recommendation
Split the docs:

- **P2P messages:** not digitally signed; identity is inferred and TOFU-based
- **Broadcast-signed messages:** explicitly signed, therefore not deniable in the same sense

This is partly doc correctness, but also protects users from misunderstanding what signatures imply.

---

# Medium-severity issues / subtle risks

---

## 5. The protocol now relies heavily on heuristic frame classification
This is a tradeoff you chose intentionally. It saves bytes. But it means:

- parser order matters
- false-positive probabilities matter
- malformed inputs matter more
- the code must stay very disciplined

### Good news
Your current order is reasonable.

### Risk
As more frame types appear (`BROADCAST_SIGNED`, `BROADCAST_UNSIGNED`, `CONTACT`, maybe future classes), the complexity of “try this, then that” can become fragile.

### Recommendation
This is not an urgent bug, but I would document the frame-detection order as part of the actual protocol, not just app logic. Right now it lives partly in docs and partly in `main.ts`.

---

## 6. `CONTACT` and unsigned broadcast both use lightweight checksum-style validation
This compounds the previous point.

### `BROADCAST_UNSIGNED`
Also uses:
- flags discriminator
- XOR-ish checksum

Docs say false positive ~`2^-22`

That’s not crazy, but it is weak compared to the signed and encrypted classes.

### Practical concern
Unsigned broadcast and contact frames are the “cheaply self-checking” categories in a protocol otherwise protected by AEAD/signatures. This asymmetry is okay as a design tradeoff, but it should remain visible in your threat model:

- unsigned broadcast is authenticity-free and weakly structured
- contact frames are weakly structured and unauthenticated
- signed broadcast and encrypted frames are cryptographically strong

That distinction matters.

---

## 7. `checkEd25519Support()` and runtime derivation are decoupled
In `src/main.ts`:
- app only checks X25519 support during init
- Ed25519 signing keys are derived later, non-blocking, best-effort

That’s okay UX-wise, but subtle behavior may arise:
- broadcast signed mode may be shown before signing support is actually ready
- signing mode state may depend on environment support not clearly surfaced to the user

Not a crypto break, but a subtle product integrity issue.

### Recommendation
If signed broadcast is a real product surface, its availability should be explicit in the UI and tied to successful support detection.

---

## 8. `derivePublicKey()` is a clever PKCS8/import workaround, but worth extra paranoia
In `src/crypto.ts`, you derive X25519 public key from raw private key by:
- importing private key
- using X25519 deriveBits with base point public key `9`

This is clever and probably fine, but it’s one of those browser-interop-sensitive spots.

### Why mention it
You now rely on this for identity-import validation in `identity.ts`.
That is good in principle, but it also makes import correctness dependent on this trick continuing to work consistently in supported engines.

Not a reason to remove it, just worth remembering as a portability-sensitive zone.

---

## 9. `loadChat()` trusts sessionStorage JSON shape
`src/chat.ts`:

```ts
return JSON.parse(raw);
```

No schema validation.

This is not directly crypto, but it can cause:
- UI corruption
- weird message rendering behavior
- potential runtime weirdness if storage is polluted

This is low-to-medium severity because polluted state could confuse users. It won’t break crypto, but in a security-sensitive app “weird local state” is undesirable.

---

## 10. `inputEl.value.trim()` everywhere means leading/trailing whitespace is semantically dropped
This is more UX/data-integrity than crypto, but it does affect message content.

Messages that intentionally begin/end with whitespace are silently normalized away before encryption/decryption workflows.

In most chat use this is fine. But it is still a silent transform that users may not expect.

Not a serious risk, just something to be conscious of.

---

# Things that look good / mostly sound

---

## 11. Seedless INTRO is a good design choice
I think this is one of your best protocol improvements.

- ephemeral-static ECDH already provides uniqueness
- removing seed there is logical
- moving `compMode` inside encrypted plaintext is clean

This is good.

---

## 12. `compress()` choosing among literal / squash-only / squash+smaz is sound
This is one of the most practical wins in the codebase.

It reduces the risk of “compression” making typical messages worse, and it keeps the decompression model simple.

---

## 13. Identity import now validates keypair consistency
Very good fix.

`src/identity.ts` now:
- decrypts blob
- extracts priv/pub
- re-derives pub from priv
- rejects mismatch

That closes a real correctness hole.

---

## 14. Direction separation via canonical key ordering is fine
This is a simple, compact, and deterministic way to get directional separation.

I think this is sound enough for this protocol.

---

## 15. Tests are materially stronger than before
The test suite now actually reflects protocol properties, not just roundtrips. That’s a big improvement.

In particular I like:
- class/domain separation tests
- intro extraction tests
- comp mode persistence tests
- wire overhead tests
- sign/verify tests
- identity mismatch import rejection

Good.

---

# Specific subtle bugs / inconsistencies I noticed

---

## 16. `crypto.ts` comments are stale in a couple places
In `encrypt()` comment:

> Returns [6-byte seed][ciphertext+96-bit tag].

But `TAG_LENGTH = 64`.

Similarly decrypt comments still mention 96-bit tag.

This is “just comment drift,” but in a crypto file comment drift is dangerous. Future you or other readers will trust the comments.

---

## 17. `wire.ts` comment for INTRO payload wording is stale
`splitIntro()` comment still says:

> rest = encrypted payload (seed + ciphertext + tag)

But INTRO is now seedless.

Again, comment drift, but in protocol code this is not harmless.

---

## 18. `docs/crypto.md` says CONTACT false positive is `1/65536`, but detection order and practical interpretation matter
That is numerically fine, but the docs should probably admit:

- CONTACT validation is lightweight integrity checking, not cryptographic authenticity
- CONTACT tokens are unauthenticated and TOFU-based

Right now the wording is technically okay but still a little too “clean” given the protocol complexity.

---

## 19. Broadcast signed TOFU mismatch handling may be too gentle
In `main.ts`:

- signed broadcast from known sender
- if cached Ed25519 key mismatches, label gets `⚠ ключ подписи изменился!`

That’s good as a warning, but what happens behaviorally?
It looks like the message is still treated as a valid signed broadcast, just with warning.

That is a product/security policy choice, but think through whether:
- a key mismatch should still render plaintext as “valid signed broadcast”
or
- should be escalated harder

Because from a user-risk perspective, changed signing key is exactly the kind of thing people may miss.

---

## 20. `tryParseInviteToken()` accepts raw 32-byte base64url as valid contact identity
That’s fine and convenient. But it means:
- the stronger 2-byte contact check on full contact tokens is bypassable by raw 32-byte input

This is intentional compatibility/convenience, but it weakens the practical value of the contact-check bytes for invite parsing.

Not necessarily wrong, but worth acknowledging:
- checked token path is stronger than raw 32-byte path
- both remain unauthenticated

---

# What I would change next

Here’s my actual priority list if the goal is **protect users from real crypt/protocol mistakes**.

---

## P0 — tighten the docs around security claims
Specifically:

1. make 64-bit-tag tradeoff more honestly framed
2. separate P2P deniability from signed-broadcast non-deniability
3. explain signing-key derivation tradeoff more explicitly

This is not cosmetic. Incorrect security expectations hurt users.

---

## P1 — strengthen CONTACT structure further
I would still consider moving from:
- XOR-based 2-byte check

to:
- **2-byte truncated cryptographic hash**
or maybe 3 bytes if you can afford it

That would make contact tokens much less forgeable/collidable than the current linear/XOR scheme.

This is my top protocol-hardening recommendation.

---

## P2 — consider whether 64-bit tags are truly the product line you want
I am not saying “change it back.”  
I am saying:
- either keep 64 and own it clearly,
- or choose 96 if you want the more conservative security posture.

This is the biggest explicit security/size trade in the whole system.

---

## P3 — validate `chat.ts` schema and clean storage edges
Not crypto, but worth it for robustness.

---

## P4 — clean stale comments in protocol/crypto files
Because stale crypto comments are dangerous.

---

# Final judgment

## Is the rewrite better?
Yes — absolutely.

## Is it more coherent?
Yes.

## Is it cryptographically sound?
### Mostly:
- yes in structure,
- with a few deliberate size-first tradeoffs that need more honest framing.

## Are there subtle bugs / corner cases that could hurt users?
Yes, chiefly:

1. **overconfident security framing around 64-bit GCM tags**
2. **weak contact-token validation relative to the rest of the protocol**
3. **nonstandard signing-key derivation deserving more caution**
4. **protocol parser complexity now depending heavily on ordered trial parsing**

None of these mean the system is broken.  
But they are the places where I would focus if you want this to be not just clever, but really responsibly engineered.

---

# Bottom line

I think this rewrite is **substantially better than earlier versions**, and it shows real protocol maturity.

If I had to summarize my review in one sentence:

> **The design is now good enough that the biggest remaining risks are no longer “basic crypto mistakes,” but “size-first tradeoffs and weakly structured edge-frame handling being explained or hardened insufficiently.”**
