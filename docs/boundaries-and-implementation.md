# Boundaries and known limits

Every entry records what was measured and why the current behaviour was chosen. README stays short on purpose; this page is the place for detail.

## Wrapping

- **Single-line selections** wrap in one action and undo in one press.
- **Multi-line selections** (two paragraphs, a whole fenced block) wrap in two steps: the opener plus content is pasted after ~80ms, the closer is inserted after ~400ms. The closer lands a beat later and undo takes two presses. The host's paste channel drops a trailing quote on multi-line payloads, which is why the closer is inserted separately.
- **Selections the plugin cannot measure** (chips, mentions) are left untouched: inserting anything there would replace the selection.

## Candidate insertion

- `execCommand('insertText')` silently drops text containing spaces (`a{}` and `a(b)` land, `a b` does not), and the paste channel lands asynchronously. The accept path therefore verifies the whole draft after inserting and rolls that one edit back when the result differs, so a failed accept never eats the original text.

## Chinese candidates

- Served from the dictionary (`lib/cjk-lexicon.js`, 30k words, 2–4 characters each). A prefix is matched against the word list, so word length follows the data; there is no length cap in code.
- A prefix that matches no dictionary word is treated as a fragment: the server answers `wordGate: false` and the popup stays closed.
- The client no longer slices CJK runs into n-grams; that produced sentence-length candidates and needed an arbitrary cap.

## Quotes

- Quotes pair by default. Typing the same quote directly after a closed pair opens a new pair (parity decides whether the previous quote is an opener or a closer).
- The red squiggle is drawn under the unmatched quote character only, with no text hint.
- Inside an empty pair the same quote is skipped, so three presses still give one pair; the triple-backtick fence works because backticks are not in the quote family.

## IME

- A composition start replaces the current selection with the composition text (measured with a real CDP composition, before any key). Text lost at that moment cannot be restored by the plugin.

## Host behaviour

- Lexical ignores `sel.modify(...)` and `beforeinput`'s `preventDefault`, and does not always dispatch `input`; selection writes need cross-frame verification.
- The empty composer always contains `<p><br>`, so emptiness is `textContent === ''`, not `innerText`.
- Server-half edits need a `dsh web` restart; the browser half applies on refresh.
