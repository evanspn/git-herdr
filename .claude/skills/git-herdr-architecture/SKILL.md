---
name: git-herdr-architecture
description: How Git Herdr is put together: the mod's modules, how a change reaches git, the review session's files and who writes each, and the steps to add a git action, a tab, a checklist or an agent task. Use before changing anything under mods/git-herdr/, layouts/ or tests/.
---

# Git Herdr: how it is built

A Herdr **mod** (`mods/git-herdr`) that is one tabbed panel, and a **layout** (`layouts/git-herdr.json`) that puts it beside the focused agent's terminal. For Herdr's own rules see `herdr-mod-development`.

## Design rules

- **Git is the source of truth.** Every tab shows a fresh read; nothing about the repository is cached past a snapshot.
- **The mod does not think.** Reviewing, fixing and drawing are tasks handed to a coding agent.
- **Harness agnostic.** The agent is reached only through files in the session folder and one line sent with `hc send` or as a new tab's task. Never add anything that assumes a particular agent.
- **Nothing is lost by one click.** Discard, delete and drop go through `confirm()`.

## Files

| File | Holds |
| --- | --- |
| `main.js` | The `View`: state and every action. `mutate()` wraps every change |
| `views.js` | One function per tab, `codeView`, the dock, `draw` |
| `ui.js` | button, link, chip, tag, input, area, scroller |
| `model.js` | Git output parsing, `buildPatch`, row shapes. No Herdr imports |
| `review.js` | Store and findings coercion, threads, checklists, the three agent tasks. No Herdr imports |
| `git.js` | Every git command, `put()` |
| `store.js` | Session reads and writes, checklist discovery, `renderDiagram` |
| `checklists.js` | The four bundled checklists as skill-file text |

## How a change reaches git

`views.js` calls an action on the view → the action calls `mutate(cx, label, work, done)` → `work(root)` runs functions from `git.js` → `refresh()` re-reads. One mutation at a time (`this.busy`); a refresh asked for meanwhile runs after (`this.stale`).

Partial staging: `parseDiff` → the person picks a hunk or lines (`this.picked`, keys `hunk:index`) → `buildPatch(diff, picks, reverse)` → `applyPatch`. `tests/model.test.mjs` proves each direction against real git; extend it before touching `buildPatch`.

## The review session

`<repo>/.herdr/review-session/`, ignored by its own `.gitignore`:

- `threads.json`, written only by the mod: `{ comments, replies, marks, sentMarks }`. `marks` holds the person's decision on each finding; `sent` flags say what the agent has been told.
- `findings.json`, written only by the agent: `{ findings, replies }`. `toFindings` tolerates anything.
- `review.threads(store, found)` joins them. `pending()` is what the next send carries; `markSent()` records it.
- `README.md` there is the contract shown to agents (`sessionReadme`). Keep it agreeing with `toStore` and `toFindings`.

Checklists: `.herdr/reviews/*.md` in the repository override bundled ones by file name.

## Recipes

**Add a git action.** A function in `git.js`; an action on the view that calls `mutate`; a button in `views.js`; a click in `tests/panel.test.mjs` that checks the repository afterwards.

**Add a tab.** Its name in `TABS` (`main.js`), `TAB_LABEL` and `BODIES` (`views.js`); what it loads in `loadTab`.

**Add a bundled checklist.** An entry in `BUNDLED`; at least five `- [ ]` items (a test checks).

**Add an agent task.** A task builder in `review.js` naming every file by absolute path; an action that calls `dispatch(cx, kind, label, build)`; a button.

**Change a file the agent writes.** `sessionReadme`, the coercion in `review.js`, and the test that feeds it.

## Before committing

1. `npm test`, with a test added or extended for what changed.
2. Where Herdr is installed: copy `mods/git-herdr/` and `layouts/git-herdr.*` into `~/.config/herdr-app/`, run `herdr-app check ~/.config/herdr-app/mods/git-herdr`, and look at every tab.
3. Keep `README.md` and `RECIPE.md` true to the files.
