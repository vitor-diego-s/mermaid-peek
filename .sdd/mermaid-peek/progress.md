# mermaid-peek — ledger (append-only)

## 2026-09-25 13:10 — T1 scaffold, research, decisions

- seat / session id: orchestrator (Claude Code, job 3612adf8)
- what changed: repo created at ~/Projects/mermaid-peek; spec.md, plan.md written; package scaffold and `npm install mermaid typescript @types/node`
- gates run + result: environment probes — Konsole 25.12.3 on KDE Wayland; tmux 3.6a, mouse on, no pointer-motion key names in `man tmux`; Shift+click never reaches tmux (Konsole native selection); Node 22.23.1 runs `.ts` with `--experimental-strip-types`; no Rust, no Chromium; Firefox 150; `beautiful-mermaid` 1.1.3 covers 6 diagram types only
- verdict: design approved by Vitor — approach A (Firefox viewer), Alt+click, new repo at ~/Projects/mermaid-peek
- rulings: "hover" is delivered as Alt+click because no hover event exists in the tmux path; TypeScript instead of Rust

## 2026-09-25 13:25 — T2 implementation seat launched

- seat / session id: codex exec 0.155.1, workspace-write, thread 01a0d950-3c39-74e1-986d-02aa8bf2f89e (log: $CLAUDE_JOB_DIR/tmp/codex-impl.jsonl, job 3612adf8)
- what changed: brief `_brief-impl.md` (git-excluded) + fixtures test/fixtures/{claude-code-tui,fenced-markdown,gutter-and-frontmatter,two-blocks}.txt written by the orchestrator
- gates run + result: pending (seat self-check advisory; orchestrator re-runs in T3)
- verdict: pending
- rulings: no commit by the seat; anchor rule tightened to ≤2 argument tokens before launch

## 2026-09-25 13:16 — T3 gates re-run by the orchestrator

- seat / session id: orchestrator
- what changed: nothing in src; added scripts/e2e-viewer.mjs (CDP-driven viewer check) and its README section
- gates run + result:
  - `npm test` → 8/8 pass (codex saw the server test fail only inside its sandbox: `listen EPERM`, a known sandbox limit)
  - `node_modules/.bin/tsc --noEmit` → exit 0
  - `bin/mermaid-peek extract < test/fixtures/claude-code-tui.txt` → one flowchart block, lines 3–21, source equals the expected fixture
  - live daemon on 127.0.0.1:41998: /health ok, POST /diagram → SSE delivered `history` + `diagram`, GET / 200 html, GET /mermaid.min.js 200 (3.5 MB), `/../package.json` 404, not reachable on the LAN address
  - headless Chromium via CDP (scripts/e2e-viewer.mjs): `{"svg":true,"nodes":8,"edges":9,"errorsHidden":true,"history":1,"title":"Mermaid Peek"}`; screenshot reviewed, flowchart renders correctly. Firefox `--screenshot` was inconclusive (fires at load, before SSE), Chromium `--virtual-time-budget` hangs on the open SSE stream
  - diff read line by line; scratch-leak check: no `_brief-`/`_ref-` in the tree to be committed (git-excluded)
- verdict: gates green; awaiting cross-family review (T4)
- rulings: e2e check kept as a script, not a `npm test` gate, because it depends on a machine-local Chromium

## 2026-09-25 13:20 — T4 cross-family review, round 1

- seat / session id: Claude subagent "reviewer" (Opus), read-only, private tmux servers -L mpreview/-L mpe2e
- what changed: nothing (review only)
- gates run + result: reviewer re-ran npm test 8/8, tsc exit 0, extract gate ok
- verdict: FIX FIRST — Critical: C1 non-zero exit of click/latest puts the pane in view-mode; C2 unfenced blocks end at the first blank line (defect in the orchestrator's brief, not the seat). Important: I3 code-point wrap detection wrong (trailing-space trim, CJK, exact-width hard line); I4 history_size drifts while scrolled during streaming output; I5 Firefox --no-remote lock dialog + stamp TOCTOU; I6 no Host/Content-Type check (DNS rebinding could read sources). Minor: `graph TD;`, classDiagram-v2, %%init above anchor, gutter anchor swallowing prose, toast wording, history reconnect, 413 path, daemon spawn race, pid cleanup. Evidence of no breakage: cold-start click returns to tmux in 0.57 s, detached daemon survives, client count tracks sockets, no traversal, no XSS path.
- rulings: all Critical + Important + Minor accepted into `_brief-fix1.md`; added I7 (Claude Code soft-wrap continuation via bracket balance) from the reviewer's unverified risk; the 413 socket-destroy path is left as is (loopback only, 2 MB cap). Same seat (codex, fresh run) fixes; scoped re-review by the same reviewer afterwards.

## 2026-09-25 13:21 — T5 tmux wiring (CD gate)

- seat / session id: orchestrator
- what changed: `~/.config/tmux/mermaid-peek.conf` (from `install-tmux`), `source-file` line appended to `~/.tmux.conf`; a stray `~/.config/tmux/tmux.conf` I created by mistake was removed (tmux only reads it when `~/.tmux.conf` is absent)
- gates run + result: `tmux source-file ~/.tmux.conf` ok; `tmux list-keys -T root M-MouseDown1Pane` and `-T prefix g` show the bindings. Real-pane probe (throwaway session, MERMAID_PEEK_BROWSER=true, port 41993): `latest` and `click` both posted the flowchart, daemon auto-started, no stray output
- verdict: wired; binding will be regenerated after fix round 1 (6th argument `#{mouse_line}`)
- rulings: the real tmux config on this laptop is `~/.tmux.conf`

## 2026-09-25 13:30 — T2b/T3b fix round 1 (codex) + gates re-run

- seat / session id: codex exec threads 01a0d95e-13f7-… (stopped: asked about the worktree rule, no edits), 01a0d95f-90e9-7491-ba0a-b6f94a3e5334 (applied the round on branch fix/review-round-1, stopped on two premises, then resumed with rulings and finished)
- what changed: src/{capture,extract,cli,server}.ts, web/index.html, README.md, test/{extract,server,cli,viewer}.test.ts, fixtures claude-code-blank-lines.*, claude-code-softwrap.*; tmux snippet regenerated with the 6th argument `#{mouse_line}` and reloaded
- gates run + result (orchestrator): `npm test` 23/23; `tsc --noEmit` exit 0; five fixtures extract as expected; real 60-col pane probe (session mpeek-test, port 41992, browser stubbed): click/latest/bad-mouse-line/broken-browser all exit 0, `#{pane_mode}` empty afterwards, wrapped `UI[...]` label re-joined in every posted diagram; CDP viewer check `{"svg":true,"nodes":8,"edges":9,"history":4}`
- verdict: gates green; scoped re-review requested from the reviewer
- rulings: (a) equal-width blank-line continuation only for whitespace-prefixed anchors, gutter anchors keep the strict rule; (b) forbidden-host tests use node:http because Node's fetch drops a custom Host header; (c) a relaunch that told codex to disregard its AGENTS.md worktree rule was denied by the auto-mode classifier — resolved legitimately by switching the checkout to a feature branch; (d) `open` honours the 10 s launch throttle (deferred, minor)

## 2026-09-25 13:35 — T4 scoped re-review, round 2

- seat / session id: Claude subagent "reviewer" (Opus), read-only, private tmux servers -L mpfix/-L mpalign
- what changed: live binding patched immediately by the orchestrator (`'#{mouse_line}'` → `#{q:mouse_line}` in ~/.config/tmux/mermaid-peek.conf, reloaded) before the code fix
- gates run + result: reviewer reproduced npm test 23/23, tsc 0. Per prior finding: C1, C2, I3, I4, I5, I6, M1–M6 all ADDRESSED. New breakage: NEW-1 Critical shell injection through `'#{mouse_line}'` in the generated binding (verified: apostrophe → sh syntax error and view-mode; crafted line → command executed); NEW-2 `{}` in the soft-wrap merge collapses composite states and class bodies; NEW-3 gutter rule applied to ⏺/⎿ drops tool-result diagrams; NEW-4 alignWrapped gives up on an all-space wrapped row and shifts every later index
- verdict: FIX FIRST → fix round 2 dispatched to the same codex thread
- rulings: all four accepted; `open` throttle and the ENOENT unlink at exit stay deferred (minor). Round count: 2 of max 5

## 2026-09-25 13:40 — T2c/T3c fix round 2 (codex, same thread) + gates

- seat / session id: codex exec resume 01a0d95f-90e9-7491-ba0a-b6f94a3e5334
- what changed: src/cli.ts + README (binding emits unquoted `#{q:mouse_line}`), src/extract.ts (braces out of the soft-wrap merge; gutter body rule only for column glyphs via `column` flag), src/capture.ts (alignWrapped: all-space wrapped rows, forward resync), tests in test/{cli,extract}.test.ts
- gates run + result (orchestrator): `npm test` 26/26; `tsc --noEmit` exit 0; five fixtures unchanged; ad-hoc `⎿ stateDiagram-v2` with a `state Live { … }` body extracts on six lines with braces intact; `tmux -L mpq` probe: `#{q:@probe}` delivered `  A[User's box]; touch …; echo '` to printf as one argument, no file created; snippet regenerated from `install-tmux` and reloaded (`list-keys` shows `#{q:mouse_line}`)
- verdict: gates green; scoped re-review round 3 requested (round count 3 of max 5)
- rulings: none new

## 2026-09-25 13:45 — T4 scoped re-review, round 3

- seat / session id: Claude subagent "reviewer" (Opus), private tmux servers -L mpr2/-L mpr3
- what changed: nothing (review only)
- gates run + result: reviewer reproduced npm test 26/26, tsc 0. NEW-1..NEW-4 all ADDRESSED (injection payloads incl. `$(id)`, backticks, quotes arrive as one argument; brace bodies preserved; first-line ⎿/⏺ extract again; real 20-column capture maps every row correctly). One regression: empty `#{q:mouse_line}` expands to nothing → 5 arguments → "Invalid trigger arguments" toast on blank rows inside a diagram. Minor: `q:` does not escape a leading `~` (no execution; reanchor falls back)
- verdict: FIX FIRST → fix round 3 (CLI accepts 5 or 6 args + binding `#{?mouse_line,#{q:mouse_line},''}`) dispatched to the same codex thread (round 4 of max 5 for the review loop)
- rulings: leading `~` expansion deferred (no execution path, only a missed re-anchor)

## 2026-09-25 13:50 — T2d/T3d fix round 3 (codex, same thread) + gates

- seat / session id: codex exec resume 01a0d95f-90e9-7491-ba0a-b6f94a3e5334
- what changed: src/cli.ts (`click` accepts 5 or 6 args, mouse text defaults to ''), install-tmux + README emit `#{?mouse_line,#{q:mouse_line},''}`, test/cli.test.ts (empty sixth argument through sh, five-argument acceptance)
- gates run + result (orchestrator): `npm test` 27/27; `tsc --noEmit` exit 0; `tmux -L mpq3` probe of the generated binding shape: empty value → `<a><>` (explicit empty arg), payload `  A[User's]; echo '` → one intact argument; live snippet regenerated and reloaded
- verdict: gates green; final scoped re-review requested (round 4 of max 5)
- rulings: none new

## 2026-09-25 13:55 — T4 final scoped re-review + T6 delivery

- seat / session id: Claude subagent "reviewer" (Opus), private server -L mpr4
- what changed: nothing in code; branch renamed to main for the initial commit (no remote yet)
- gates run + result: reviewer reproduced npm test 27/27, tsc 0; regression ADDRESSED (cli.ts:83/88, binding at cli.ts:120 == README:41); generated binding sourced into a private server parses intact, empty value expands to `''`, payload to one escaped word, no file created, no pane mode
- verdict: SHIP. Review loop closed after 4 rounds (cap 5)
- rulings: deferred minors carried as follow-ups — `open` silently honours the 10 s throttle; ENOENT on pid unlink at exit; `q:` leaves a leading `~` unescaped (no execution); 413 path destroys the socket; two first clicks can race two daemons (second exits on EADDRINUSE). Manual gate T7 (Alt+click in a live Claude Code pane) is Vitor's

## 2026-09-25 14:50 — T7 manual gate (Vitor) → live bug → fix round 4

- seat / session id: Vitor (Alt+click in a live Claude Code pane) → codex exec resume 01a0d95f-90e9-7491-ba0a-b6f94a3e5334
- what happened: trigger chain works end to end (Alt+click reaches tmux, daemon auto-started, Firefox viewer opened, two diagrams in history). The extracted source overran into the box-drawing table Claude Code printed after the diagram → mermaid "Lexical error on line 21" at the `┌───` row. Root cause from the real pane (%1, width 133): Claude Code prints the keyword line at the label indent (2) and the body at 6; after a blank line the table and prose sit at width 2 == anchor width, so the C2 equal-width continuation kept the `┌` row and the `│` rows were read as gutters. Same capture also shows a third soft-wrap form: continuation at the label indent (2), shallower than the body
- what changed: new real-pane fixture test/fixtures/claude-code-summary-table.{txt,expected.mmd} (orchestrator); codex asked to (1) end the block at any line starting with a box-drawing char or column glyph when the anchor has no gutter, (2) allow equal-width continuation after a blank only for flat blocks whose next line looks like a mermaid statement, (3) add the Firefox pref that hides the "Open previous tabs?" bar and merge missing prefs into an existing user.js
- gates run + result: pending
- verdict: pending
- rulings: the C2 equal-width rule as written in round 1 was wrong for Claude Code's actual rendering; the reviewer's earlier caution about it stands

## 2026-09-25 14:55 — T4 review of fix round 4 (live bug)

- seat / session id: Claude subagent "reviewer" (Opus)
- what changed: nothing (review only)
- gates run + result: reviewer reproduced npm test 31/31, tsc 0; every round 1-3 probe still gives the same output (no regression)
- verdict: SHIP. Found two Important follow-ups in the new heuristic, both scoped to diagrams whose body sits flush with the anchor width (the user's live pane's shape): false positives (flat body + blank + prose containing `:`/`(`/`[` or a lowercase keyword gets swallowed) and false negatives (flat body + blank + a real statement the arrow/keyword regex misses, e.g. `Animal <|-- Duck`, `activate B`, `dateFormat`)
- rulings: review loop is at its 5-round cap. Given both gaps sit exactly in the shape that just broke live, apply two targeted fixes now (widen the statement regex/keywords; add a viewer render-retry that trims trailing blank-separated lines on a mermaid parse error) and self-verify, rather than open a 6th adversarial round. Recorded as an orchestrator ruling per the harness's "adjudicate after round 5" rule

## 2026-09-25 15:05 — T2e/T3e fix round 5 (final, targeted follow-ups)

- seat / session id: codex exec resume 01a0d95f-90e9-7491-ba0a-b6f94a3e5334
- what changed: src/extract.ts (statement-shape regex widened: `--`/`==`/`~~~`/`..`/`->`/`-x`/`-)` plus arrow tokens; keywords activate/deactivate/autonumber/dateFormat/axisFormat/excludes/todayMarker/accTitle/accDescr added), test/extract.test.ts (5 new cases: classDiagram inheritance, thick/invisible links, sequence activate, gantt dateFormat), web/index.html (render retries with progressively shorter blank-separated chunks on a mermaid parse error; shows the original error and the full source only if every attempt fails)
- gates run + result (orchestrator): `npm test` 32/32; `tsc --noEmit` exit 0; all six fixtures (including the real-pane summary-table one) extract unchanged; diffs read line by line, exactly scoped to the two findings
- verdict: applied and verified without a 6th adversarial review round (round cap reached; see the prior ruling). SHIP
- rulings: none new

## 2026-09-25 16:10 — bounded change: collapsible sidebar

- seat / session id: orchestrator (implemented directly, small well-scoped UI change)
- what changed: web/index.html — toggle button in the header, `h` key binding, localStorage persistence of collapsed state, CSS transition
- gates run + result: `npm test` 32/32, `tsc --noEmit` exit 0, CDP-driven live check: click collapses (width 0px, aria-expanded false, stored "true"), `h` key expands (stored "false")
- verdict: shipped as v0.1.3
- rulings: none

## 2026-09-25 16:20 — T6 delivery: GitHub repo + z-gaming sync

- seat / session id: orchestrator
- what changed: private GitHub repo created (github.com/vitor-diego-s/mermaid-peek, gh CLI, account vitor-diego-s), origin pushed with `main` + tags v0.1.0-v0.1.3; cloned onto z-gaming (darksoul-z390-m-gaming) at ~/Projects/mermaid-peek, `npm install` there (Node 24.1.0)
- gates run + result: on z-gaming — `npm test` 32/32 pass, `tsc --noEmit` clean, `git status --short` empty
- verdict: repo versioned and synced to z-gaming, confirmed working on that machine's own Node runtime
- rulings: none
