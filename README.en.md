# dsh-composer-pro (Composer Pro for DeepSeek Harness)

**[English](README.en.md) · [中文](README.md)**

![overview](docs/banner.svg)

![completion and pairing](docs/demo.gif)

*Four frames: word-table completion with inline ghost text (`inp` → `input`) · file-path completion · selecting a passage and wrapping it in brackets · context candidates*

Gives the DeepSeek Harness (DSH) web composer the **VS Code** editing feel: brackets and quotes pair up as you
type, typing an opener over a selection wraps the selection, a closer you type over an existing closer is simply
skipped, and backspace removes an empty pair. On top of that a completion popup fed by **words already in your draft,
per-language keywords and tags, workspace file paths and the model ids from your settings** opens after two letters.

A standard DSH bundle plugin: one command to install, **no third-party runtime dependency**, **writes no files**,
**changes no host source**, and needs no token. The browser half is plain DOM (no react, no editor library); the
server half exposes exactly two read-only routes.

## Where and how to install

| Target | Command | Note |
|---|---|---|
| **DSH Web (`dsh web`)** | `dsh plugin --profile web add https://github.com/mengge237/dsh-composer-pro` | Recommended. A local checkout works too: `dsh plugin --profile web add "<本地路径>"` |
| **Desktop app (Electron)** | Use the **desktop app's own plugin manager** | Do not use `dsh plugin --profile desktop` (that profile is owned by Electron and the CLI refuses); let DSH install it from inside a desktop session |
| **Development (editing code)** | checkout + a `file:` install | The browser half is **read from disk on every request**, so a page refresh picks up edits; **the server half (`lib/index.js`, `lib/words.js`) needs a `dsh web` restart** |

Uninstall: `dsh plugin --profile web remove dsh-composer-pro` (no data files are left behind).

## Features

### Editing feel (aligned with VS Code)

- **Auto pairing**: `(` `[` `{` `"` `'` and backtick insert as a pair with the caret in the middle; **full-width forms too** (`（` `【` `「` `《` `“` `‘`), completed through the `input` event because IME compositions do not always produce a keydown; no pairing when the character before the caret is an identifier or path character (keeps `call(` and `E:/path` intact)
- **Surround selection**: select a passage and type an opener → `(selection)`, with the **selection restored to the inner text** so you keep editing it. ASCII goes through keydown, **full-width and IME through `beforeinput`** (only `beforeinput` sees the character before the DOM changes); `Shift` combinations such as `{` and `"` work the same way
- **Inline ghost text**: the part of the top candidate that extends what you typed is shown in grey right after the caret (VS Code's inline suggestion feel); `Tab` takes it, `Esc` hides it
- **Type-over closers**: when the character to the right already is the matching closer, typing it just moves the caret
- **Delete empty pair**: with the caret between `()` hit backspace once and both sides go
- **Language hint**: a fenced code block in the draft (```` ```js ```` / ```` ```python ````) selects that language's word table

### Popup placement and behaviour (aligned with VS Code)

- **Anchored to the caret**, not to the left edge of the composer, so a long line cannot push it half off the screen
- **Prefers the space below the caret**; if there is none (the composer sits at the bottom of the window, usually the case) it flips to **6px above the caret** and never covers the line you are writing
- **Fixed width, capped height with scrolling**: the width does not jitter with candidate length, so fast typing does not make it bounce
- **Row layout follows VS Code**: type icon on the left, label in the middle (matched characters in bold), a muted type word on the **right** — type information never appears before the candidate name
- **No repaint when the list is unchanged**: no flicker while typing, and never two popups

### Candidates (four kinds)

- **Draft words**: identifiers already present in the draft, sorted by frequency, **computed locally without waiting for the network** (VS Code's word based suggestions)
- **Ranking = VS Code's fuzzy score**: `lib/fuzzy.js` is **copied verbatim from microsoft/vscode** (MIT, see THIRD-PARTY.md) — prefix, word boundaries, camel case and consecutive hits score higher, gaps and scattered hits lower; the match positions it returns are what bolds the matched characters in the list
- **Language word tables**: 112 HTML tags, 47 JS keywords, 129 Python, 56 Java, 600 CSS properties, 27 HTML global attributes (sources under "Sources and licenses")
- **Context candidates**: identifiers (4+ characters) from the **visible conversation text** are completed by prefix and labelled "上下文" (context) — a name you just discussed does not have to be retyped (page text is read-only, cached for 2 seconds, host DOM untouched)
- **Language inference**: without a fence it guesses from context (`def`/`import`/`.py` → python, `<div>` → html, `const`/`await` → javascript) and falls back to your habits
- **Language habit**: without a fence it uses the language **you have actually been using** — a fenced block or accepting a candidate from a table records one vote (stored in local `localStorage`, nothing uploaded)
- **Workspace files**: depth ≤3, `node_modules` skipped, matched on **path-segment prefixes** (see "Candidate matching rules")
- **Model ids and snippets**: model ids read from the settings source of truth, plus a few common snippets

### Trigger and accept

- **Opens automatically after two identifier characters**; `Ctrl+Space` opens it manually; `/` or `@` at line start or after whitespace opens it too
- **`Tab` accepts** (or click a row); `↑`/`↓` select; `Esc` closes
- **Enter is never swallowed**: in a chat box Enter sends. This comes from a real incident on 2026-10-16 — Enter used to accept, so pressing it twice in a row inserted the candidate over and over

### Performance

- The workspace file index and the model ids each carry a **20-second TTL cache**: one full pass costs about 23ms, cache hits 0–1ms
- Each keystroke issues exactly one loopback request; stale responses arriving late are dropped by sequence number

## Keymap (vs VS Code)

| Action | Key / trigger | Behaviour |
|---|---|---|
| Auto pair | `(` `[` `{` `"` `'` backtick; full-width `（` `【` `「` `《` `“` `‘` | No pairing after a path/identifier character; when the character to the **right** is a letter or digit only that single opener is inserted (typing an opening quote before existing text gives one quote); skipped when the matching closer is already to the right |
| Surround | type any opener over a selection | `selection` → `(selection)`, the selection stays on the inner text |
| Type-over | type a closer while it is already to the right | no duplicate, caret moves past it |
| Delete empty pair | backspace between `()` | removes both sides |
| Complete | two identifier characters / `Ctrl+Space` | popup: draft words first, then language tables / files / models / snippets |
| Accept | **`Tab` only**, or click a row | Enter stays the send key; the popup does not reopen after accepting |
| Dismiss / select | `Esc` / `↑` `↓` | `Shift+Enter` still inserts a newline |

## Candidate matching rules

- **File candidates must start a path segment**: `attrib` → `临时目录/attrib-index.diff` comes first; a match in the middle of a segment needs 3+ characters
- **No loose fuzzy (pure subsequence) matching**: paths are long, a subsequence almost always hits, which is "one letter, a pile of unrelated files" and forces manual checking
- Subsequences are kept only for short candidates (tables / models / snippets), and only for queries of 3+ characters

## Known limits

- **Server-half changes require a `dsh web` restart** (ESM is loaded into memory and not re-read); the browser half takes effect on a page refresh
- The word tables live on the **server** side, so `inp` → `input` only works after a restart following installation or table edits
- Verified only against **0.2.0-rc.2**, on the web and desktop profiles (re-run the self-check after a host upgrade)
- The legacy `textarea` composer form has offline coverage only; there is no real sample of it
- **The host composer's data model is not touched**, so editor-level operations such as `Alt+↑/↓` line moving, `Ctrl+D` line copy or `Ctrl+/` comment toggling are **not implemented** — do not expect them
- Completion inserts text only; there is no semantic analysis of which symbols are in scope

## Repository layout

| Path | Purpose |
|---|---|
| `lib/index.js` | Server half: the two read-only routes (`/dsh-composer-pro/words`, `/config.json`) and the loopback trust fence |
| `lib/client.js` | Browser half: capture-phase keydown, pairing and surround, the completion popup (plain DOM, no dependencies) |
| `lib/words.js` | Language word tables (static arrays; sources and commits in the file header) |
| `lib/fuzzy.js` | VS Code's fuzzy scoring (verbatim, MIT; provenance at the top of the file) |
| `test/` | Five test suites plus the live-acceptance report (`REPORT-2026-10-16.md`) |
| `docs/` | README images |
| `THIRD-PARTY.md` | Borrowed-data provenance and the **license texts** |
| `cordis.patch.yml` | DSH bundle declaration (`dsh.bundle.patch`) |

## Development and tests

```bash
npm test        # five suites, 60 items, zero network: data layer / routes and trust fence / bundle shape / fake-DOM behaviour / licensing compliance
```

- `test/selftest.mjs`: candidate ranking, model id parsing, file collection caps, `workspace.json` v2 shape, word-table hits
- `test/server-routes.mjs`: route shape, the **loopback trust fence** (non-loopback Host and cross-site Origin are 403), method gate, `config.json` payload
- `test/client-smoke.mjs`: bundle header and export shape, keymap decisions, draft words and fence detection
- `test/client-behavior.mjs`: **fake DOM driving the real listeners** — pairing, surround, type-over, delete-empty-pair, `Ctrl+Space` fetching, Tab accept replacing the token, Enter passing through, no reopen after accept
- `test/compliance.mjs`: **licensing and rule compliance (9 items)** — own MIT notice, every borrowed item present in THIRD-PARTY.md with repo + license + pinned commit, MIT/CC0 texts reproduced, verbatim-copied files carry their provenance header (including what was changed) and the upstream copyright notice, zero runtime dependencies, no secrets in the repo, version matches the changelog, and the registry-side `npm` key is legal. Reverse-controlled: deleting a ledger row or bumping the version to 9.9.9 makes it fail
- Live acceptance (headless run against a real composer, 11 items): results and reproduction commands in [test/REPORT-2026-10-16.md](test/REPORT-2026-10-16.md)

Before touching this, read the "Known limits" section and the word-table headers: the host composer is **Lexical**,
which ignores `sel.modify(...)`. Selection work must go through "flattened character offsets + an explicit Range",
and because our listener sits in the capture phase (before the host), selection changes after an insertion have to be
deferred by one tick.

## FAQ

- **Typing `inp` does not offer `input`?** The word tables live on the server half: restart `dsh web` once after installing (or after editing the tables)
- **Why does Enter not accept a candidate?** Enter is the send key in a chat box; use `Tab` (since 0.2.2 — Enter used to accept, which inserted candidates repeatedly)
- **Selecting a passage and typing a bracket does not wrap it?** Fixed in 0.3.0: ASCII goes through keydown, full-width and IME through `beforeinput`; upgrade if you are on an older version
- **Why are unrelated files no longer listed?** Since 0.2.2 file candidates must start a path segment; for wider matching use `/` or `@`
- **Does it modify my files?** No. It reads the workspace file list and the settings source of truth, and writes not a single byte
- **How about the desktop app?** It is a separate profile; install through the desktop app's own plugin manager (`dsh plugin --profile desktop` is rejected)

## Changelog

- **0.6.0** (2026-10-16): Chinese words are candidates too (CJK has no word separators, so runs are split into 2/3-gram tokens and a long trailing run is tried with 1-4 character suffixes), and the quote rule from VS Code was added — a symmetric quote directly after the same quote inserts a single character instead of a pair; deferred caret restores are epoch-guarded, auto-repeat no longer pairs, and `apply` is a singleton so a duplicate mount cannot process every keystroke twice
- **0.5.0** (2026-10-16): context awareness — new "context candidates" (identifiers from the visible conversation text, completed by prefix and labelled "上下文") and "language inference" (`def`/`import`/`.py`, `<div>`, `const`/`await`, then habit); row layout follows VS Code (type icon on the left, bolded matches in the middle, muted type word on the right)
- **0.4.3** (2026-10-16): quote feel — only a single opener is inserted when the character to the right is text; a symmetric quote already to the right is skipped instead of paired again; the caret is positioned immediately after insertion (it used to be deferred, so two fast quotes could miss the existing closer) and the deferred pass re-asserts an absolute position
- **0.4.2** (2026-10-16): the upstream copyright and license header is restored verbatim at the top of `lib/fuzzy.js` (MIT requires keeping the notice) and a compliance check now enforces it; the ranking implementation stays the upstream one (MIT-compliant, no reason to rewrite it)
- **0.4.1** (2026-10-16): new `test/compliance.mjs` licensing gate (added to `npm test`)
- **0.4.0** (2026-10-16): ranking switched to **VS Code's fuzzyScore** (`lib/fuzzy.js`, verbatim from microsoft/vscode, MIT); the list was redrawn VS Code style (bolded matches, one muted type word on the right) and the "seen N times" annotation was removed
- **0.3.0** (2026-10-16): surround fixed (Shift combinations no longer blocked, full-width and IME go through `beforeinput`); new **inline ghost text**; new **language habit**
- **0.2.3** (2026-10-16): full-width/Chinese pairs added; the popup is anchored to the caret (below first, 6px above when there is no room), fixed width, capped height, no repaint when the list is unchanged
- **0.2.2** (2026-10-16): Enter is no longer swallowed by the popup; no reopen after accepting; file candidates match on path-segment prefixes; 20s caches for the file index and the model ids
- **0.2.1** (2026-10-16): Lexical selection fixed (explicit Range) and capture-phase timing fixed (selection adjustment deferred one tick); the selection is restored to the inner text after a surround
- **0.2.0** (2026-10-16): draft-word completion, language word tables (HTML/JS/Python/Java/CSS), auto-open after two characters, fenced-language hint
- **0.1.0** (2026-10-15): first version — auto pairing, surround, type-over, delete-empty-pair, `Ctrl+Space` popup (files and model ids)

## Sources and licenses

- **Interaction design** follows Visual Studio Code (MIT, microsoft/vscode): word-boundary suppression, surround, type-over closers, deleting empty pairs, and the ranking of word based suggestions — with the exception of `lib/fuzzy.js` (copied verbatim, see THIRD-PARTY.md), no source code was copied, only the behaviour
- **Word-table data** is borrowed from monaco-editor, codemirror/lang-html, codemirror/lang-css and MDN browser-compat-data; [THIRD-PARTY.md](THIRD-PARTY.md) records each repository, commit, the files taken and the **full license text**. The extraction is static; nothing depends on those projects at runtime
- The plugin itself: MIT (see [LICENSE](LICENSE))

---

[中文版 README](README.md)
