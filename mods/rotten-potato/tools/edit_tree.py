#!/usr/bin/env python3
"""mods/rotten-potato — the mod's LIVE-TREE edits, in one idempotent script.

    python mods/rotten-potato/tools/edit_tree.py [LCLITE_ROOT]

Three edits, each marked so `regen` routes it to this mod:

  1. webclient/src/client/Client.ts  — the chat send path. The guard on the
     chatbox-typing branch is widened to also run when the page palette has armed
     a command, and a small block at the top of that branch fills the engine's own
     chat input from the reserved window slot `rottenPotatoCmd`. That makes a
     palette click ride the engine's REAL send path (so ::fpson, ::tcg, the colour
     prefixes and the CLIENT_CHEAT packet are all the engine's own) and lets it run
     while a chat modal is open, which typing into the chatbox cannot do.
     Site: `handleInputKey()`'s chat branch (old line ~3540). The nearest other
     mod's island is camera's at ~3434 (100 lines up) and tcg's ::tcg interception
     at ~3582 (42 lines down), so the 2-line context floor stays pristine — and
     this is the ONLY Client.ts edit this mod makes (no parked block at all, so the
     parked-block diff landmine cannot bite).
  2. webclient/bundle.ts — the terser property reserve for `rottenPotatoCmd`. A
     cross-realm name must be reserved or the mangler renames the string-keyed
     access too and the page's write is invisible to the bundle. Placed in the
     middle of the reserved list, >= 3 untouched lines from tcg's island (top) and
     control-panel's (bottom), so the three stay separate hunks.
  3. engine/view/client.ejs — the page tags (stylesheet + module script). Site:
     after the canvas div, before `#controls`. NOT the `<body>` gap: that one is
     mods/_template's own anchor, and selfcheck asserts the layout example still
     anchors with every other mod applied.

Idempotent BY REGION (strip the markers + revert the guard, then insert), CRLF-
preserving, and every anchor is asserted to match exactly once. Run it twice and
the tree must be byte-identical (that is what `regen` idempotency then proves).
"""
import io
import os
import sys

MARK = 'lclite:rotten-potato'
MOD = 'rotten-potato'

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('LCLITE_ROOT', '')
if not ROOT:
    sys.exit('usage: edit_tree.py <install root>   (or set LCLITE_ROOT)')
ROOT = os.path.abspath(ROOT)

CLIENT = os.path.join(ROOT, 'webclient', 'src', 'client', 'Client.ts')
BUNDLE = os.path.join(ROOT, 'webclient', 'bundle.ts')
EJS = os.path.join(ROOT, 'engine', 'view', 'client.ejs')

GUARD_OLD = "                    } else if (this.chatModalId === -1) {"
GUARD_NEW = ("                    } else if (this.chatModalId === -1 || "
             "typeof (window as any)['rottenPotatoCmd'] === 'string') {")

CLIENT_BLOCK = """                        // lclite:rotten-potato
                        /// custom (lclite "rotten-potato" mod): the staff palette's command
                        /// handoff. The page's ui.js writes the command BODY into the reserved
                        /// window slot and queues the Enter that lands here; this fills the
                        /// engine's OWN chat input with it, so the send below is the engine's own
                        /// path — every command behaves exactly as if it had been typed (::fpson,
                        /// ::tcg, the colour prefixes and CLIENT_CHEAT included), and it works
                        /// while a chat modal is open, which is the whole reason this mod has an
                        /// engine hunk at all (see mods/rotten-potato/README.md). The guard above
                        /// is widened for exactly the tick this arrives on.
                        const rottenPotato: unknown = (window as any)['rottenPotatoCmd'];
                        if (typeof rottenPotato === 'string' && (key === 10 || key === 13)) {
                            (window as any)['rottenPotatoCmd'] = null;
                            if (this.ingame) {
                                this.chatInput = '::' + rottenPotato.slice(0, 77);
                                this.redrawChat = true;
                            }
                        }
                        // lclite:rotten-potato end"""

BUNDLE_ANCHOR = "                    'Answer',"
BUNDLE_BLOCK = """                    // lclite:rotten-potato — the page palette's command handoff: ui.js
                    // writes the command BODY into this window slot and the client reads it
                    // in the chat send path (Client.ts). Cross-realm names must be reserved:
                    // the property mangler rewrites string-keyed access too.
                    'rottenPotatoCmd',
                    // lclite:rotten-potato end"""

EJS_ANCHOR = '        <div class="centered" id="controls">'
EJS_BLOCK = """    <!-- lclite:rotten-potato -->
    <!-- lclite rotten potato: the staff command palette's page layer. The ENGINE
         half is the Client.ts hunk that reads the reserved window slot ui.js writes
         (see mods/rotten-potato/README.md); both halves ship in this mod. It is a
         module because ui.js imports its catalogue from core.js.
         Version-keyed like every page asset: bump ?v= here and VERSION in ui.js
         together (core.js is pulled at the same version). -->
    <link rel="stylesheet" href="/lclite/rotten-potato/ui.css?v=1">
    <script type="module" src="/lclite/rotten-potato/ui.js?v=1" data-rp-ui="1"></script>
    <!-- lclite:rotten-potato end -->"""


def read(path):
    """(text with LF endings, uses_crlf) — CRLF is restored on write."""
    with io.open(path, 'rb') as fh:
        raw = fh.read()
    crlf = b'\r\n' in raw
    return raw.decode('utf-8').replace('\r\n', '\n'), crlf


def write(path, text, crlf):
    data = text.replace('\n', '\r\n') if crlf else text
    with io.open(path, 'wb') as fh:
        fh.write(data.encode('utf-8'))


def strip_block(text, start_marker, end_marker):
    """Remove every marker..end block (inclusive) and report how many went."""
    out, removed, i = [], 0, 0
    lines = text.split('\n')
    while i < len(lines):
        if start_marker in lines[i]:
            j = i
            while j < len(lines) and end_marker not in lines[j]:
                j += 1
            if j >= len(lines):
                raise SystemExit('unterminated %s block at line %d' % (start_marker.strip(), i + 1))
            removed += 1
            i = j + 1
            continue
        out.append(lines[i])
        i += 1
    return '\n'.join(out), removed


def once(text, needle):
    n = text.count(needle)
    if n != 1:
        raise SystemExit('anchor matched %d times (expected 1): %r' % (n, needle[:70]))
    return True


def edit_client(path):
    text, crlf = read(path)
    # strip (region idempotency): my block first, then the guard back to pristine
    text, removed = strip_block(text, '// lclite:rotten-potato', 'lclite:rotten-potato end')
    text = text.replace(GUARD_NEW, GUARD_OLD)
    once(text, GUARD_OLD)
    text = text.replace(GUARD_OLD, GUARD_NEW + '\n' + CLIENT_BLOCK, 1)
    write(path, text, crlf)
    return 'Client.ts: guard widened + %d-line handoff block' % (CLIENT_BLOCK.count('\n') + 1)


def edit_bundle(path):
    text, crlf = read(path)
    text, removed = strip_block(text, '// lclite:rotten-potato', 'lclite:rotten-potato end')
    once(text, BUNDLE_ANCHOR)
    text = text.replace(BUNDLE_ANCHOR, BUNDLE_ANCHOR + '\n' + BUNDLE_BLOCK, 1)
    write(path, text, crlf)
    return 'bundle.ts: rottenPotatoCmd reserved'


def edit_ejs(path):
    text, crlf = read(path)
    text, removed = strip_block(text, '<!-- lclite:rotten-potato -->', 'lclite:rotten-potato end')
    once(text, EJS_ANCHOR)
    text = text.replace(EJS_ANCHOR, EJS_BLOCK + '\n' + EJS_ANCHOR, 1)
    write(path, text, crlf)
    return 'client.ejs: stylesheet + module script tags'


for fn, label in ((edit_client, CLIENT), (edit_bundle, BUNDLE), (edit_ejs, EJS)):
    if not os.path.exists(label):
        sys.exit('missing %s — is LCLITE_ROOT an install root?' % label)
    print('  %-28s %s' % (MOD, fn(label)))
print('mods/%s: tree edited (run regen, then apply --check)' % MOD)
