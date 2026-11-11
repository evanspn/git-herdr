# Git Herdr

A mod for the [Herdr](https://herdr.dev) desktop app: commits and local code review in one panel, beside the agents doing the work. It does what you would open GitHub Desktop for (stage files, hunks or lines, commit, branches, stashes, history, fetch, pull, push), and adds a review loop with whichever coding agent you run: comment on lines, have the agent review against checklists, and see its change maps as Mermaid diagrams.

It works on the repository of the focused terminal, on this computer.

## Install

Copy the folders into Herdr's home and merge the key:

```sh
cp -r mods/git-herdr ~/.config/herdr-app/mods/
cp layouts/git-herdr.json layouts/git-herdr.svg ~/.config/herdr-app/layouts/
herdr-app check ~/.config/herdr-app/mods/git-herdr
```

Add `"ctrl-shift-g": "layout.switch:git-herdr"` to the `global` section of `~/.config/herdr-app/keys.json`.

Three ways to open it:

- **As a layout:** Ctrl+Shift+G. The panel on the left, the focused agent's terminal on the right. Ctrl+Shift+L goes back to your own layout.
- **As a pane beside a terminal:** `herdr-app do pane.split --direction right --mod git-herdr`
- **As a window over any layout:** `herdr-app do mod.open --name git-herdr`

## The tabs

| Tab | What it does |
| --- | --- |
| Changes | Staged and unstaged files. `+` stages a file, `−` unstages it, `×` discards it (click twice). The diff has Stage hunk, Unstage hunk and Discard hunk on each hunk; click line numbers to pick single lines, then stage, unstage or discard just those. Summary, description, Amend, Commit. Only what is staged is committed. |
| History | The last 200 commits. Click one for its files and diff. |
| Branches | Create, switch and delete local branches; check out a remote branch; stash, pop, apply and drop. |
| Files | Every file in the repository, filtered as you type, to read and comment on. |
| Review | Choose what to review, which checklists and which agent. Run review, send your comments, ask for a change map. Lists every thread. |
| Diagrams | The Mermaid diagrams the agent wrote, drawn as images. |

Fetch, Pull and Push are in the header on every tab. Push publishes the branch when it has no upstream.

## Reviewing with an agent

1. **Comment.** In Changes, History or Files, click `+` beside a line and write. The comment appears under the line and in Review.
2. **Send.** In Review, pick an agent: one running in this space, or an installed one to start in a new tab. *Send to agent* hands over every comment, reply and accepted finding it has not seen. The agent makes the change or answers, and its reply shows in the thread.
3. **Run review.** The agent works through the chosen checklists against the chosen changes and writes findings. Each appears on its line. Accept one (the agent is asked to fix it on the next send), dismiss it, or reply.
4. **Draw change map.** The agent writes Mermaid diagrams of the change; the Diagrams tab draws them.

### It works with any agent

Nothing here is specific to one harness. A review is plain files in `<repo>/.herdr/review-session/`, which git ignores:

```
README.md        tells an agent what the files are and their shapes
threads.json     your comments, replies and decisions (written by the panel)
findings.json    the agent's findings and replies (written by the agent)
diagrams/*.mmd   Mermaid diagrams (written by the agent)
checklists/      the bundled checklists a review used
requests/        each task handed over
```

The panel writes the task to a file and sends the agent one line, `Read <path> and do what it asks`, through herdr-core (`hc send`), or as the first message of a new agent tab.

### Checklists

A checklist is a skill file: optional frontmatter (`name`, `description`) and markdown with `- [ ]` items. Four ship with the mod: correctness, security, tests and readability. A repository adds its own in `.herdr/reviews/*.md`, and one with the same file name replaces the bundled one. *Copy these into .herdr/reviews* puts the bundled four there to edit and commit.

### Diagrams

Diagrams are drawn by Mermaid's own renderer, so what you see is real Mermaid, and a diagram that does not parse shows Mermaid's error and its source. Install it once:

```sh
npm install -g @mermaid-js/mermaid-cli
```

Without it the mod tries `npx -y @mermaid-js/mermaid-cli`. If the renderer is somewhere else, the Diagrams tab takes the command to run. Each diagram is rendered once and kept under `~/.config/herdr-app/git-herdr/diagrams/`.

## What it runs, reads and reaches

Herdr mods are trusted code. This one:

- runs `git` in the focused folder's repository, including `fetch`, `pull` and `push` when you click them;
- runs `hc send` to message the agent you chose, and starts an agent in a new tab when you chose an installed one;
- runs `mmdc` (or `npx -y @mermaid-js/mermaid-cli`, which downloads it from npm) to draw diagrams;
- reads files in the repository, and writes `.herdr/review-session/` there, `.herdr/reviews/` when you copy the checklists, and `~/.config/herdr-app/git-herdr/`;
- makes no network requests of its own.

## Not done yet

- Repositories on another machine: the panel says so and does nothing there.
- Renames show as a delete and an add. Conflicted files show, but there is no merge tool.
- A file that is new or deleted can only be staged or discarded whole.
- No syntax highlighting in the diff and file views.
- This build has not been run through `herdr-app check` or seen in the app: Herdr could not be installed where it was written. The tests below cover the logic, not the drawing.

## Developing

```sh
npm test
```

Fifteen tests: the git parsing and patch building run against real git in a temporary repository, and the panel is driven through stand-ins for Herdr's modules (`tests/stubs/`). They cannot catch a misspelt UI builder; only `herdr-app check` can. See `.claude/skills/` for how the mod is built.
