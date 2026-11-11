---
name: herdr-mod-development
description: How to write and check a mod or layout for the Herdr desktop app (herdr.dev): where files live, the View/render model, the UI builders, the `herdr` host module, and the traps. Use when adding or changing anything under mods/ or layouts/, writing a keys.json entry, or debugging a mod that does not load or draw.
---

# Developing a Herdr mod

Herdr is a desktop app for terminals and coding agents. Its whole interface is files under `~/.config/herdr-app/`: layouts (JSON), keys, settings, and **mods**, which are small JavaScript programs that draw panels. This is not Claude Code's plugin system and shares nothing with it.

## Read the real reference first

The app writes its own guide and type files on every start, matching the installed version:

- `~/.config/herdr-app/AGENTS.md`: the guide. Layouts, keys, commands, mods, the `herdr` module.
- `gpui-kit.d.ts` and `herdr.d.ts` beside it: every UI builder and every host function. These are the truth; this skill is a map.
- The shipped mods in `~/.config/herdr-app/mods/` (`spaces`, `agents`, `files`, `changes`, `prompt`, `worktree`) are the best examples.

Without Herdr installed, the same guide is `defaults/AGENTS.md` in `github.com/herdrdev/herdr-app`, with `defaults/herdr.d.ts` and `defaults/mods/` beside it. `gpui-kit.d.ts` is generated at run time and is not in that repository.

## A mod's files

```
~/.config/herdr-app/mods/<name>/
  mod.json   { "place": "right" | "left" | "top" | "bottom" | "none", "size": 320, "title": "...",
               "overlay": { "width": 560, "height": 760 }, "focusable": true }
  main.js    default-exports a class extending View
  *.js       more modules, imported as "./file.js" (with the extension)
  *.svg      its own icons
```

- **Write `mod.json` before `main.js`.** The first time Herdr sees a folder it docks a copy per `mod.json`; with no file it docks into the shown layout, and the block stays after the folder is deleted. Use `"place": "none"` for anything opened only by a key or another mod.
- Saving any file hot-reloads every copy. A broken save keeps the old version running and writes the error where `herdr-app status` shows it.
- Shipped mods and layouts are read-only and replaced on start. Clone first: `herdr-app do mod.clone '{"name":"files","as":"my-files"}'`.

## The model

```js
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, run, exec } from "herdr";

export default class Panel extends View {
  init(_props, cx) { /* once: state, timers, first load */ }
  render(cx) { const t = theme(); return v_flex().size_full().bg(t.surface).child("Hello"); }
  async close(cx) { /* optional, about 250 ms of cleanup */ }
}
```

- `render` runs again after `cx.notify()` and whenever Herdr's live data changes (spaces, agents, terminals, focus, theme, shared state). Never poll those.
- **Never keep a `cx`.** Every callback gets its own: `on_click((e, cx) => ...)`, `cx.spawn(async (cx) => ...)`, `cx.timer.every(ms, (cx) => ...)`.
- No `setTimeout`, no top-level `await`, no DOM, HTML, CSS or Node APIs. Async work goes in `cx.spawn`; delays in `cx.timer`.
- Module-level code runs once per source version and is shared by every copy. Keep state on the instance.
- Animate with `.frames(...)`, `svg(...).spin(ms)`, `.loop(...)`, `.transition(...)`. A timer that calls `cx.notify()` to animate redraws the whole window.

## UI

Chained builders with GPUI's snake_case names. There is no component library: `Button`, `Input` and the rest are unstyled, so mods style `div`s.

- Layout: `div()`, `h_flex()`, `v_flex()`, `.size_full()`, `.flex_1()`, `.flex_none()`, `.flex_wrap()`, `.gap(n)`, `.p(n)` `.px(n)` `.py(n)`, `.w(n)` `.h(n)`, `.min_h(0)` `.min_w(0)`, `.items_center()`, `.justify_between()`, `.overflow_y_scrollbar()`.
- Look: `.bg(c)`, `.text_color(c)`, `.text_size(n)`, `.font_semibold()`, `.truncate()`, `.border_1()`, `.border_b(1)`, `.border_color(c)`, `.rounded(n)`, `.cursor_pointer()`, `.hover((s) => s.bg(c))`.
- Colors come from `theme()` by name so the mod follows light and dark: `surface`, `background`, `raised`, `hover`, `selected`, `border`, `input`, `foreground`, `muted`, `dim`, `accent`, `solid`, `solid_foreground`, `working`, `blocked`, `done`, `ansi0..15`.
- Anything clickable needs a unique `.id("...")` before `.on_click(...)`.
- Conditional and repeated children: `.when(cond, (el) => el.child(...))`, `.children(list.map(...))`.
- Text field: `this.input = InputState.new({ value, placeholder })` **in `init`, not in `render`**; `this.input.on("submit" | "change" | "focus" | "blur", (e, cx) => ...)`; `.value()`, `.set_value(text)`, `.focus()`; draw with `Input.new(this.input)` inside a styled `div`.
- Multi-line: `TextareaState.new({ value, placeholder, rows })` and `Textarea.new(state)`. Give it a Save button; do not rely on Enter.
- Markdown: `TextView.markdown(id, text).selectable(true).scrollable(false)`.
- A scroll area needs `.flex_1().min_h(0)` on itself and `.min_h(0)` on its flex parents, or it gets no height.

## The `herdr` module

- **Act:** `run(command, args)`. Commands are the one way to change the app; `herdr-app commands` lists them. `run` returns null, so to find what it made, compare `panes()` before and after.
- **Start an agent:** `run("tab.new", { name, folder, argv: agent.run, task })`, where `agent` is an installed entry of `await knownAgents()`. `task` is its first message. To message a running agent: `hc(["send", address, text])`.
- **Programs:** `exec(cmd, args, { cwd, on, timeout })` resolves `{ code, stdout, stderr }` and rejects when the program cannot start. Always pass args as an array.
- **Files:** `readTextFile(path)` resolves the text or null. `writeTextFile(path, text, expected)` replaces a file only when `expected` is exactly its current text (null to create), creates parent folders, and rejects on a stale snapshot: read, then write, one edit at a time. `watchFolder(dir)` resolves when something under `dir` changes; loop on it inside `cx.spawn`. `import * as fs from "fs/promises"` works for `readdir` and `mkdir`, reading only inside the home folder and writing only under `~/.config/herdr-app`.
- **State:** `shared(key)` / `setShared(key, value)` is persisted and seen by every mod and copy, and setting it re-renders them. `localStorage` is per copy. `props()` is what the layout or overlay gave this copy.
- **Overlays:** `openOverlay({ mod, props, kind: "dialog" | "popup" | "window", width, height })`; the mod closes itself with `closeOverlay(props().overlay)`. `notify({ title, body, level })` posts a toast.
- **Keys:** `keys.json` binds `"<mod>.<command>"` to a mod, delivered through `await nextCommand()`. `"mod.open:<name>"` opens a mod.
- Mods are trusted code with no sandbox. Say in the README what a mod runs, reads and reaches.

## Checking

```sh
herdr-app check ~/.config/herdr-app/mods/<name>   # loads and renders once; nonzero with the error
herdr-app status                                  # errors from files and mods, what is on screen
herdr-app shot out.png                            # the window as a PNG
```

- Never call a mod done without a passing check, and then look at it in the app: the check does not lay out, run deferred rows, or reach later async states.
- Check the installed copy, not the repository folder: the check writes `gpui-kit.d.ts` and `jsconfig.json` into the folder it checks.
- The app reads only the installed copy, so copy changed files to `~/.config/herdr-app/mods/` after each edit.
- `ctrl-alt-shift-escape` resets to the default layout if an edit breaks the window.

## Testing without Herdr

Keep rules and data shapes in modules with no Herdr imports and test them with `node --test`. This repo also drives `main.js` through stand-ins for `gpui-kit`, `gpui-base` and `herdr` (`tests/stubs/`), wired in with a Node loader (`npm test`). That proves the mod's logic. It cannot catch a misspelt builder or a wrong host signature, because the stub accepts any method: only `herdr-app check` can.

When a builder or host function is new to the repo, grep the shipped mods for it before using it.

## Traps others have hit

Reported by community mod authors; confirm against the installed version.

- A `popup` overlay is as tall as its content: `height` does not size it, so a `flex_1` list inside gets 0 px.
- Esc closes a dialog or popup before the mod's `on_key_down` sees it, except while a text field has the keyboard.
- `spaces()[i].folder` is where a space was made. Where it works now is its panes' `cwd`.
- `<mod>.<command>` reaches only copies currently on screen.
- On Windows a bare `find` is `find.exe` and hangs; run shell tools through `sh -c`.
- `herdr-app do` takes flags (`--id x --confirmed true`).

## Sharing

A shared mod is a folder laid out like the app home: `mods/<name>/`, an optional `keys.json`, a `RECIPE.md` (the brief to rebuild it: what you see, how it behaves, built from, watch out, done when) and a `preview.png` (16:10). Put it in a public GitHub repo with the topic `herdr-mod` and it is listed at herdr.dev/mods.
