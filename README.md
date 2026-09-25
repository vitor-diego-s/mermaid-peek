# Mermaid Peek

Render Mermaid diagrams from a tmux pane in a separate Firefox window. Alt+click selects a nearby diagram; `prefix g` opens the latest. The local daemon keeps the last 20 diagrams in memory.

Requires Node 22.23.1, tmux and Firefox. Install from this directory:

```sh
npm install
bin/mermaid-peek install-tmux >> ~/.config/tmux/mermaid-peek.conf
```

Enable `set -g mouse on` (required) in your tmux config. Add `source-file ~/.config/tmux/mermaid-peek.conf` to your tmux config (`~/.tmux.conf` on this machine), then run `tmux source-file ~/.tmux.conf`.

Vitor operates the viewer locally. `bin/mermaid-peek status` shows daemon health, connected viewers, port and paths. Logs: `~/.local/state/mermaid-peek/daemon.log`. Triggers report success or failure with a tmux toast. `open` launches the viewer; `serve [--port N]` runs the daemon in the foreground. `MERMAID_PEEK_PORT` changes port 41999; `MERMAID_PEEK_BROWSER` overrides the browser command (space-separated arguments, URL appended).

In the viewer: drag to pan, wheel to zoom, `f` to fit, `0` to reset, `[` / `]` for older/newer diagrams and `c` to copy source. Rendering errors show the raw source.

For KWin placement: System Settings → Window Management → Window Rules → match window title “Mermaid Peek” → force size and position to the right half of the screen. Firefox uses its own profile at `~/.local/share/mermaid-peek/firefox-profile`.

Debug a new TUI format by saving pane output and running:

```sh
bin/mermaid-peek extract < test/fixtures/claude-code-tui.txt
```

Development checks: `npm test` and `node_modules/.bin/tsc --noEmit`.

End-to-end check of the viewer without opening a window (needs a Chromium binary, e.g. Playwright's `chrome-headless-shell`):

```sh
bin/mermaid-peek serve --port 41994 &
bin/mermaid-peek extract < test/fixtures/claude-code-tui.txt | jq '{source: .[0].source, type: .[0].type, paneId: "%test", line: 3}' \
  | curl -s -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:41994/diagram
"$CHROME" --headless --no-sandbox --remote-debugging-port=9333 --user-data-dir=/tmp/mp-chrome about:blank &
node scripts/e2e-viewer.mjs http://127.0.0.1:41994/ /tmp/viewer.png   # prints {"svg":true,"nodes":8,...}
```

The generated click binding takes six arguments, including the line under the pointer to correct scrollback drift:

```tmux
bind -n M-MouseDown1Pane run-shell -b "<absolute-path>/bin/mermaid-peek click '#{pane_id}' '#{mouse_y}' '#{scroll_position}' '#{history_size}' '#{pane_width}' #{?mouse_line,#{q:mouse_line},''}"
bind g run-shell -b "<absolute-path>/bin/mermaid-peek latest '#{pane_id}' '#{pane_width}'"
```
