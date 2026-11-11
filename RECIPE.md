# Git Herdr

One panel for commits and local code review: a tabbed git client (stage files, hunks or lines; commit; branches; stashes; history; fetch, pull, push) with inline review threads shared with a coding agent, checklist reviews, and Mermaid change maps drawn as images.

## What you see

- **Header**, 44px, `surface`: the repository's name, its branch as a tag, six tab chips (Changes, History, Branches, Files, Review, Diagrams; Changes, Review and Diagrams carry a count), then on the right `↑ahead ↓behind` and Fetch, Pull, Push (Publish branch when there is no upstream).
- **Note line** under it when something succeeded (`ansi2`) or failed (`ansi1`), with Dismiss.
- **Changes:** left column 320px: Staged and Changes sections, each row a status letter (A `ansi2`, D and U `ansi1`, M `blocked`), a dim folder and the name, `×` and `+` or `−`; under it the commit box (summary, description, Amend chip, primary Commit button). Right: the diff, 20px rows in the terminal font: a `+` cell, old and new line numbers, the sign, the text; additions tinted `ansi2`, removals `ansi1`; hunk headers on `raised` with Stage hunk and Discard hunk.
- **History:** left 360px list of commits (subject; short hash, author, age, ref tags). Right: the commit's files as chips and the chosen file's diff.
- **Branches:** one scrolling column: New branch field, Local, Remote, Stashes.
- **Files:** left a filter field and the file list, right the file with line numbers.
- **Review:** scope chips, checklist chips, agent chips, three buttons (Run review, Send N to agent, Draw change map), then the thread list.
- **Diagrams:** diagram chips, Source toggle, Draw change map; the diagram as an image filling the rest.
- **Dock** at the bottom when a comment is being written or a thread is selected: the thread's messages, a reply field and its buttons.
- Threads show inline in every code view as a 20px row under their line.
- Narrower than 820px, each two-column tab stacks.

## How it behaves

- It follows the focused terminal's folder; a folder that is not a repository says so. It refreshes on folder changes and every 10 seconds; the Review and Diagrams tabs re-read the session every 4 seconds.
- Clicking a line's numbers picks it (accent numbers, `selected` row); the title bar then offers Stage N lines and Discard lines. Discards and deletes take a second click on the same button.
- Commit needs a summary and something staged; Amend needs neither.
- `+` beside any line opens the comment field in the dock; Enter adds it.
- Run review, Send and Draw change map write a task file and send the agent one line pointing at it. A running agent is messaged and focused; an installed one is started in a new tab in the repository. In the `git-herdr` layout the agent block is shown.
- Agent findings carry a severity tag: high `ansi1`, medium `blocked`, low `ansi4`, note `muted`. Accept marks a finding to be fixed on the next send.
- A diagram renders once per source and light or dark appearance. A failed render shows Mermaid's error and the source; a missing renderer shows a field for its command.
- Agent statuses are not drawn by this mod; the layout's agent block and status bar show them.

## Built from

- `layouts/git-herdr.json`: column `root` > row `gh-body` (block `gh-panel` `{ mod: "git-herdr" }`, block `gh-agent` `{ agent: "focused" }` 560px) > block `gh-status` `{ mod: "workspace-status" }` 28px.
- `mods/git-herdr`: `main.js` (state, actions), `views.js` (tabs), `ui.js` (button, chip, input), `model.js` (git parsing, `buildPatch`), `git.js` (every git command), `review.js` (threads, checklists, agent tasks), `store.js` (session files, `renderDiagram`), `checklists.js` (the four bundled skill files). `mod.json`: `place: none`, overlay 1180×800.
- `herdr`: `exec`, `hc`, `run` (`tab.new`, `agent.focus`, `layout.show`), `agents`, `knownAgents`, `spaces`, `panes`, `focused`, `readTextFile`, `writeTextFile`, `watchFolder`, `shared`, `setShared`, `settings`, `theme`, `appHome`, `nextCommand`; `fs/promises` `mkdir` and `readdir` under the app home.
- `gpui-base`: `v_virtual_list` and `Scrollbar` for code views (as the shipped `changes` mod), `InputState`, `TextareaState`; `image()` for diagrams.
- Programs: `git`; `hc send`; `mmdc` or `npx -y @mermaid-js/mermaid-cli` with `-i <file> -o <png> -b transparent -t dark|default -s 2 -q`.
- Staging part of a file: a patch built from the parsed diff, written to `~/.config/herdr-app/git-herdr/patch.diff` and given to `git apply --cached` (`-R` to unstage, `-R` without `--cached` to discard).

## Watch out

- `exec` has no stdin, so patches go through a file.
- Git reads must not touch the index (`--no-optional-locks`, `core.fsmonitor=false`), or the folder watch refreshes forever.
- On Linux `watchFolder` skips git-ignored folders, and the session is ignored: poll it.
- `git ls-files --cached --others` with no exclude flags lists ignored files; that is how the session's diagrams are found without a shell.
- In a partial patch, an unpicked removal becomes context when staging and is dropped when reversing; an unpicked addition is the opposite. Get it backwards and `git apply` rejects the patch.
- The virtual list has one row height, so a thread is one line in the code and opens in the dock.
- Never send an agent a multi-line message: write a file and send its path.
- Mermaid's SVG uses HTML labels that a native SVG renderer drops, so render PNG.
- Not checked with `herdr-app check`; the first build on a machine with Herdr should run it and look at every tab.

## Done when

- `npm test` passes.
- `herdr-app check ~/.config/herdr-app/mods/git-herdr` passes and all six tabs draw.
- Picking one added line and pressing Stage 1 line stages only that line (`git diff --cached`).
- A comment on a line appears under it, and Send delivers a request file to the chosen agent.
- A `findings.json` written by hand into the session shows as threads on their lines.
- A `.mmd` file in the session's `diagrams/` shows as an image in Diagrams.
