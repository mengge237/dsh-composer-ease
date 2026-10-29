---
description: "VS Code-feel composer for the DeepSeek Harness Web GUI: bracket/quote pairing, wrapping a selection, and a completion popup fed by draft words, language tables, workspace files, model ids and snippets; for DSH users and maintainers of composer plugins."
kind: "package-reference"
---

# dsh-composer-ease

English | [中文](README.zh.md)

## Summary

`dsh-composer-ease` is a DSH bundle plugin that gives the Web composer the editing feel of VS Code: brackets and quotes pair up, typing an opener over a selection wraps it, a closer over an existing closer is skipped, backspace removes an empty pair, and a completion popup opens after two characters. The browser half is plain DOM; the server half exposes two read-only loopback routes and writes nothing.

![overview](docs/banner.svg)

## Table of Contents

- [Install](#install)
- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Boundaries and known limits](docs/boundaries-and-implementation.md)
- [Development and tests](#development-and-tests)
- [Sources and licenses](#sources-and-licenses)
- [Dev note](#dev-note)

## Install

```bash
dsh plugin --profile web add https://github.com/mengge237/dsh-composer-ease
dsh plugin --profile web remove dsh-composer-ease
```

Desktop (Electron) uses its own plugin manager; `dsh plugin --profile desktop` is rejected by the CLI. When developing, the browser half is read from disk on every request (refresh applies), while the server half needs a `dsh web` restart.

## Use this package

| Action | Key / trigger | Behaviour |
|---|---|---|
| Auto pair | `(` `[` `{` `"` `'` backtick, full-width family | caret between the pair; no pairing after a path/identifier character, or when text follows the caret |
| Wrap selection | type any opener over a selection | `text` becomes `(text)`; single-line selections only (see boundaries) |
| Type-over / delete empty pair | closer already to the right / backspace inside `()` | no duplicate; both sides removed |
| Complete | two characters, or `Ctrl+Space` | popup: draft words, language tables, workspace files, model ids, snippets |
| Accept / navigate | `Tab` or click / `↑` `↓` | Enter stays the send key; `←` `→` `Home` `End` dismiss the popup and only move the caret |
| Dismiss | `Esc` | `Shift+Enter` still inserts a newline |

Completion follows the context: a fenced block selects the language table, otherwise the draft and the visible conversation vote, then the language you have been accepting candidates from.

## Understand the implementation

- `lib/index.js` — server half: `/dsh-composer-ease/words` and `/config.json`, both behind a loopback trust fence; ranking uses `lib/fuzzy.js` (VS Code's `fuzzyScore`, copied verbatim).
- `lib/client/*.js` — browser half, nine fragments concatenated into `lib/client.js` by `tools/build-client.mjs` (the host loads exactly one file).
- Chinese candidates come from the dictionary (`lib/cjk-lexicon.js`) only: the prefix is matched against the word list, so word length follows the data instead of a fixed cap.
- The popup is plain DOM anchored to the caret; it never touches the host editor's data model.

## Boundaries and known limits

See [docs/boundaries-and-implementation.md](docs/boundaries-and-implementation.md) for the measured list (multiline wrapping, insertion limits, IME behaviour, squiggle geometry) and the reason behind each.

## Development and tests

```bash
npm run build          # fragments → lib/client.js
npm test               # five offline suites, 185 items, zero network
npm run check:all      # structure, duplicates, refactor budget, docs, privacy, prose, copies
node test/real/matrix.mjs "http://127.0.0.1:3081/?token=…" 3 --verbose   # live matrix, 33 cases per round
```

The host composer is Lexical: it ignores `sel.modify(...)`, ignores `beforeinput`'s `preventDefault`, and does not guarantee an `input` event — selection work uses flattened offsets plus explicit Ranges and cross-frame verification.

## Sources and licenses

- Interaction design follows Visual Studio Code (MIT); no source copied except `lib/fuzzy.js` (verbatim, see [THIRD-PARTY.md](THIRD-PARTY.md)).
- Word-table data comes from monaco-editor, codemirror/lang-html, codemirror/lang-css, MDN browser-compat-data and jieba's dictionary; each entry in THIRD-PARTY.md records repo, commit, files and the full license text.
- This plugin: MIT (see [LICENSE](LICENSE)).

## Dev note

- Change `lib/client/*.js`, then `npm run build`; never edit `lib/client.js`.
- Every convention has a runnable check under `tools/check-*.mjs`; CI only runs them (`.github/workflows/checks.yml`, ubuntu + windows, one run per branch via `concurrency`).
- Release: bump `package.json`, add a CHANGELOG entry with the commit sha, then `npm run check:all`.
