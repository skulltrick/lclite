# mods/no-censor — "Disable profanity filter"

The 2004 chat censor, switched off. **On by default** (the panel's switch is checked
out of the box), and the only mod in the overlay that patches **both** sides of the
stack, because the game censors chat in two places:

| Layer | Where | Who it affects |
|---|---|---|
| client | `WordFilter.filter()` — `webclient/src/wordfilter/WordFilter.ts` | what **your** client shows: your own message echoed locally, other players' chat and private messages as they arrive |
| server | `WordEnc.filter()` — `engine/src/cache/wordenc/WordEnc.ts` | what the world **sends out**: `MessagePublicHandler` (public chat to everyone nearby) and `MessagePrivateEncoder` (private messages) |

Both are the same Jagex algorithm over the same cache list (`badenc.txt`,
`domainenc.txt`, `fragmentsenc.txt`, `tldlist.txt` in the `wordenc` jag) — Lost City's
own writeup of it is in the forum thread
[censorship & better communication](https://lostcity.rs/t/censorship-better-communication/5042):
*"there are 2 ways the game does filter chats — client sided filtering / server sided
filtering … we copied and pasted the exact same code from the client, over to the
server"*. The client half is the layer that can see a player's setting, so the mod makes
the client the decision-maker and takes the server's **pre**-censoring out of the way.

Player-visible effect with the mod on: a masked word arrives as the word. Everything
else about the line is unchanged — the chat alphabet, the space collapsing and the
capitalisation are `format()`/`replaceUppercases()`/`formatUppercases()`, which the mod
deliberately leaves alone (so text still renders and reads exactly like vanilla, just
without `****`). Off, both halves are byte-for-byte upstream.

## What's in the box

- `patches/289/WordFilter_ts.json` — ONE hunk. In `WordFilter.filter()` the four
  masking passes (`filterTlds`, `filterBadWords`, `filterDomains`, `filterFragments`)
  are wrapped in `if (localStorage.getItem('noCensor') === 'false')`. That single guard
  covers **all four** client call sites at once, because they all go through
  `filter()`: the outgoing public-chat echo (`chatInput`), the outgoing PM echo
  (`socialInput`), received player chat (`player.chatMessage` + the chatbox line) and
  received private messages. (The outgoing packets are packed **before** the filter
  runs, so what the server receives was never censored by the client either.)
- `patches/289/WordEnc_ts.json` — TWO hunks. A `static censor: boolean = false` field
  next to `whitelist`, and the same guard around the same four passes in
  `WordEnc.filter()`. The server has no per-player setting to read, so this half is
  unconditional by design — see *Deliberate divergences*.
- `patches/274/…` — none: **274 inherits** the 289 corpus (matrix: 122/122 exact).
  254 is not ported (it has no corpus for this mod, like camera/hotkeys/stat-orbs).
- `tools/no_censor_test.ts` — 30-check bun harness (see *Verified*).

## Settings contract

- `localStorage['noCensor']` — this mod's OWN key, read at its own hook site inside
  `filter()` **per call** (not cached). `filter()` only ever runs on a chat event, never
  per frame, so the read is free and the panel switch applies to the very next message
  with no reload. Anything other than the exact string `'false'` — unset, `'true'`,
  junk — means **filter off**, which is what makes the mod on by default for an
  existing player whose storage has no key yet. `'false'` is upstream verbatim.
- Panel row: `MOD_REGISTRY` entry `no-censor` in
  `mods/control-panel/files/engine/public/lclite/panel.js`
  (`master.key === 'noCensor'`, `def: 'true'`). Not `invert`: the row's name is the
  action ("Disable profanity filter"), so checked = filter off = the key's own `'true'`
  — the `hide-roofs` shape, not the `anti-cheat` one. `noCensor` is in the panel's
  Reset-all clear list.
- Single-toggle mod: no settings rows, no `status()` — the row's master switch IS the
  whole setting.

## Deliberate divergences

- **The server half is unconditional, and that is what makes it safe.** The server
  cannot see a client's `noCensor` key (no protocol change was wanted for this), so it
  simply stops pre-censoring and lets each client decide. It stays **display-neutral
  for everyone else**: the client filters every incoming message on receipt, so a
  vanilla client — including one with this mod switched off — re-applies the identical
  algorithm and shows exactly what it always showed. The only client that can tell the
  difference is one with the mod on, which is the point. (Confirmed in the harness:
  `WordEnc.censor = true` restores masking, and the client's own OFF mode masks the same
  corpus.)
- **Only the masking passes go.** `format()` (the chat alphabet: disallowed chars →
  space, runs of spaces collapsed) and the sentence-case passes still run on both sides,
  so nothing downstream sees characters the 2004 font cannot draw. A line that vanilla
  formats but does not censor is byte-identical in both modes (asserted over a benign
  corpus).
- **The censor's whitelist behaviour is inherited, not fixed.** Vanilla restores
  `cook/cooks/cook's/seeks/sheet` (the client adds `woop/woops/faq`) and some entries are
  unreachable in isolation (`faq`, `hashish`, `natsi`, `sodomy`, `toolkit` are masked
  364/369 by vanilla's own logic). This mod removes masking, it does not re-tune the
  list — with the filter off, `filtered` is just the lowercased text, so the whitelist
  restore is a no-op by construction.
- **`WordEnc.filter()` is a chat-only entry point in this rev.** Its two callers are the
  public-chat handler and the private-message encoder; nothing validates names or any
  other content through it. If a future revision starts calling it on, say, character
  names, this mod would silence that too — re-check the callers when the anchor moves.
- **Not the same thing as the chat *mode* filter.** `chatPublicMode`/`chatDisabled`
  (the "Hide public chat" options, `CHAT_FILTER_SETTINGS` packet) are upstream's own
  message filters and are untouched.

## Verified

- `bun run mods/no-censor/tools/no_censor_test.ts` — **30 checks**, all green, against
  the **real** shipped files and the real `wordenc` jag from the cache (369 bad words,
  453 domains, 258 TLDs, parsed independently in the harness, so the corpus is a real
  oracle and not a copy of the code):
  - filter off: **0 of 369** bad words, **0 of 453** domains, **0 of 258** TLD probes
    and **0 of 300** realistic chat lines come back with a `*`;
  - filter on: vanilla still masks 364/369 / 453/453 / 299/300 — which is what keeps
    the previous line from being vacuous;
  - key semantics (unset/`'true'`/junk = off, `'false'` = vanilla), whitelist survival,
    determinism, and the formatting equivalence in both modes;
  - the engine half: `WordEnc.censor === false`, the whole corpus passes through
    unmasked, flipping `censor` back to `true` restores masking (365/369), and the
    engine's formatting matches the client's on the same input.
- `LCLITE_ROOT=<install> node tools/lclite.mjs apply --check` → `✗0` on every mod ·
  `node tools/doctor.mjs` → exit 0 (122 hunks, markers 122/122).
- `tsc --noEmit` clean in both the install's `webclient` and `engine`.
- `node tools/matrix.mjs` → 289 122/122 exact · 274 122/122 exact (inherits) · 254
  unaffected.
- Pristine-clone acceptance: `apply` on clones at the pinned revisions reproduces the
  live tree byte-for-byte (see the repo's acceptance recipe).
