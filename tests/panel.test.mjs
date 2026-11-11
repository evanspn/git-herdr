// Drives main.js as the app would: draws it, clicks what it drew, and checks the repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import GitHerdr, { TABS, AGENT_BLOCK } from "../mods/git-herdr/main.js";
import { find, texts } from "./stubs/gpui-kit.mjs";
import { world, sendCommand, forgetCopies } from "./stubs/herdr.mjs";
import { makeRepo, git, write, read, context, LINES } from "./helpers.mjs";

async function start() {
  forgetCopies();
  const root = await makeRepo(), cx = context(), view = new GitHerdr();
  view.init({}, cx);
  await cx.settle();
  const click = async (id) => {
    const node = find(view.render(cx), id);
    assert.ok(node?.click, `nothing to click at ${id}`);
    node.click({}, cx);
    await cx.settle();
  };
  const shows = (text) => texts(view.render(cx)).some((s) => s.includes(text));
  // A click on a row of a virtual list, delivered as Herdr does: the list's on_item_click with the row's key.
  const clickRow = async (list, match) => {
    const node = find(view.render(cx), list);
    assert.ok(node?.itemClick, `${list} takes no row clicks`);
    const rows = view.withThreads(view.tab === "files" ? view.file.rows : view.rows, view.open?.path ?? view.file?.path);
    const index = rows.findIndex(match);
    assert.ok(index >= 0, `no such row in ${list}`);
    node.itemClick(node.keys[index], cx);
    await cx.settle();
  };
  return { root, cx, view, click, clickRow, shows };
}

test("every tab draws, for a repository and for a folder that is not one", async () => {
  const { view, cx, click, shows } = await start();
  for (const tab of TABS) { await click(`tab-${tab}`); assert.equal(view.tab, tab); assert.ok(view.render(cx)); }
  world.cwd = world.home;
  view.render(cx); await cx.settle();
  assert.ok(shows("Not a git repository"));
});

test("stage a file, pick lines, and commit only what is staged", async () => {
  const { root, view, cx, click, clickRow, shows } = await start();
  await write(root, "a.txt", ["one", "TWO", ...LINES.slice(2), "eleven"]);
  await write(root, "new.txt", ["hello"]);
  await click("tab-changes");
  assert.ok(shows("CHANGES · 2"));
  await click("toggle-u-new.txt");
  assert.ok(shows("STAGED · 1"));
  await click("file-u-a.txt");
  // Pick only the added last line, then stage the pick.
  await clickRow("gh-diff", (r) => r.kind === "+" && r.text === "eleven");
  assert.equal(view.picked.size, 1);
  // A hunk header picks every changed line of its hunk, and a second click unpicks them.
  await clickRow("gh-diff", (r) => r.type === "hunk" && r.hunk === 0);
  assert.ok(view.hunkPicked(0));
  await clickRow("gh-diff", (r) => r.type === "hunk" && r.hunk === 0);
  assert.equal(view.hunkPicked(0), false);
  // The other hunk's pick is untouched.
  assert.deepEqual([...view.picked], [...view.hunkLines(1)]);
  await click("pick-apply");
  assert.equal((await git(root, "show", ":a.txt")).trim().split("\n").at(-1), "eleven");
  assert.match(await git(root, "show", ":a.txt"), /^one\ntwo\n/);
  // No summary: the commit button does nothing.
  await click("commit");
  assert.equal((await git(root, "log", "--format=%s")).trim(), "first");
  view.summary.type("Add eleven", cx);
  await click("commit");
  assert.equal((await git(root, "log", "-1", "--format=%s")).trim(), "Add eleven");
  // The unpicked change is still in the working tree, unstaged.
  assert.deepEqual(view.repo.files.map((f) => [f.path, f.staged, f.unstaged]), [["a.txt", false, true]]);
  // Discarding takes two clicks.
  await click("discard-u-a.txt");
  assert.match(await read(root, "a.txt"), /TWO/);
  await click("discard-u-a.txt");
  assert.doesNotMatch(await read(root, "a.txt"), /TWO/);
});

test("branches and stashes", async () => {
  const { root, view, cx, click } = await start();
  await click("tab-branches");
  view.branchInput.type("try this", cx); view.branchInput.submit(cx); await cx.settle();
  assert.equal((await git(root, "branch", "--show-current")).trim(), "try-this");
  await click("switch-main");
  assert.equal(view.repo.branch, "main");
  await write(root, "a.txt", ["changed"]);
  await cx.settle(); view.refresh(cx); await cx.settle();
  await click("stash");
  assert.equal(view.stashes.length, 1);
  assert.match(await read(root, "a.txt"), /^one\n/);
  await click("pop-stash@{0}");
  assert.equal((await read(root, "a.txt")).trim(), "changed");
});

test("a review: comment inline, hand over, findings and replies come back as threads", async () => {
  const { root, view, cx, click, clickRow, shows } = await start();
  world.running = [{ address: "t7", space: "s1", tab_name: "work", program: { name: "Claude Code" } }];
  world.shared.layout = "git-herdr";
  await write(root, "a.txt", ["one", "TWO", ...LINES.slice(2)]);
  await click("tab-changes");
  await clickRow("gh-diff", (r) => r.kind === "+" && r.text === "TWO");
  await click("line-comment");
  assert.deepEqual([view.composer.file, view.composer.side, view.composer.line], ["a.txt", "new", 2]);
  view.commentInput.type("Why upper case?", cx); view.commentInput.submit(cx); await cx.settle();
  const session = join(root, ".herdr/review-session");
  assert.equal(JSON.parse(await fs.readFile(join(session, "threads.json"), "utf8")).comments[0].body, "Why upper case?");
  // The session is ignored by git: it is not a change.
  assert.deepEqual(view.repo.files.map((f) => f.path), ["a.txt"]);
  assert.ok(view.rows.length < view.withThreads(view.rows, "a.txt").length);

  await click("tab-review");
  await click("review-send");
  const [verb, address, line] = world.sent.at(-1);
  assert.deepEqual([verb, address], ["send", "t7"]);
  const request = await fs.readFile(/Read (\S+) and/.exec(line)[1], "utf8");
  assert.match(request, /Comment c1 on a\.txt:2/);
  assert.match(request, /Why upper case\?/);
  assert.deepEqual(world.ran.map((r) => r.name), ["agent.focus", "layout.show"]);
  assert.equal(world.ran[1].args.id, AGENT_BLOCK);
  assert.ok(shows("Nothing to send"));

  await click("review-run");
  const task = await fs.readFile(/Read (\S+) and/.exec(world.sent.at(-1)[2])[1], "utf8");
  assert.match(task, /checklists\/correctness\.md/);
  assert.ok((await fs.readFile(join(session, "checklists/correctness.md"), "utf8")).includes("- [ ]"));

  // The agent answers.
  await fs.writeFile(join(session, "findings.json"), JSON.stringify({
    findings: [{ id: "f1", file: "a.txt", line: 3, severity: "high", title: "Three is wrong", body: "It should be 3.", checklist: "correctness" }],
    replies: [{ thread: "c1", body: "It was a typo; reverted." }],
  }));
  view.reloadSession(cx); await cx.settle();
  assert.ok(shows("Three is wrong"));
  await click("thread-f1");
  await click("thread-accept");
  assert.ok(shows("Send 1 to agent"));
  await click("thread-c1");
  assert.ok(shows("It was a typo; reverted."));
  await click("thread-resolve");
  assert.equal(view.threads.find((t) => t.id === "c1").status, "resolved");
  // The finding's file opens at its line.
  await click("thread-f1");
  await click("thread-open");
  assert.equal(view.tab, "files");
  assert.equal(view.file.path, "a.txt");
  assert.ok(view.withThreads(view.file.rows, "a.txt").some((r) => r.type === "thread" && r.thread.id === "f1"));
});

test("with no agent running, a task starts an installed one in a new tab", async () => {
  const { root, view, click } = await start();
  world.known = [{ key: "codex", name: "Codex", run: ["codex"], installed: true }];
  view.known = world.known;
  await click("tab-review");
  await click("review-draw");
  const made = world.ran.find((r) => r.name === "tab.new");
  assert.deepEqual([made.args.folder, made.args.argv], [root, ["codex"]]);
  assert.match(await fs.readFile(/Read (\S+) and/.exec(made.args.task)[1], "utf8"), /diagrams\//);
});

test("diagrams are drawn by the renderer, and its errors are shown", async () => {
  const { root, view, cx, click, clickRow, shows } = await start();
  const dir = join(root, ".herdr/review-session/diagrams");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(root, ".herdr/review-session/.gitignore"), "*\n");
  await fs.writeFile(join(dir, "map.mmd"), "%% title: The change\nflowchart TD\n  A --> B\n");
  await click("tab-diagrams");
  assert.ok(shows("The change"));
  await cx.settle();
  assert.ok(shows("renderer was not found"));
  const calls = [];
  world.renderer = async (command, args) => { calls.push([command, ...args]); await fs.writeFile(args[args.indexOf("-o") + 1], "png"); return { code: 0, stdout: "", stderr: "" }; };
  view.mermaidInput.type("mmdc", cx); view.mermaidInput.submit(cx);
  view.render(cx); await cx.settle();
  assert.equal(calls[0][0], "mmdc");
  assert.equal(calls[0][calls[0].indexOf("-i") + 1], join(dir, "map.mmd"));
  let image = null;
  const walk = (n) => { if (n?.kind === "image") image = n; n?.children_?.forEach(walk); };
  walk(view.render(cx));
  assert.ok(image, "the rendered diagram is drawn as an image");
  // Drawn once: the same source is not rendered again.
  view.rendered = new Map(); view.render(cx); await cx.settle();
  assert.equal(calls.length, 1);
  world.renderer = async () => ({ code: 1, stdout: "", stderr: "Parse error on line 3" });
  await fs.writeFile(join(dir, "map.mmd"), "flowchart TD\n  A --> \n");
  view.reloadSession(cx); await cx.settle(); view.render(cx); await cx.settle();
  assert.ok(shows("Parse error on line 3"));
});

test("the layout places the mod and the agent block the mod drives", async () => {
  const layout = JSON.parse(await fs.readFile(new URL("../layouts/git-herdr.json", import.meta.url), "utf8"));
  const blocks = [];
  const walk = (n) => { blocks.push(n); (n.children ?? []).forEach(walk); };
  walk(layout);
  assert.ok(blocks.some((b) => b.content?.mod === "git-herdr"));
  assert.deepEqual(blocks.find((b) => b.id === AGENT_BLOCK)?.content, { agent: "focused" });
  const keys = JSON.parse(await fs.readFile(new URL("../keys.json", import.meta.url), "utf8"));
  assert.equal(keys.global["ctrl-shift-g"], "layout.switch:git-herdr");
});

test("the Review buttons also run from commands (keys.json or a script)", async () => {
  const { root, view, cx } = await start();
  world.running = [{ address: "t7", space: "s1", tab_name: "work", program: { name: "Claude Code" } }];
  await write(root, "a.txt", ["one", "TWO", ...LINES.slice(2)]);
  view.render(cx); await cx.settle();
  sendCommand("review-run"); await cx.settle();
  assert.match(await fs.readFile(/Read (\S+) and/.exec(world.sent.at(-1)[2])[1], "utf8"), /checklists\/correctness\.md/);
  sendCommand("review-draw"); await cx.settle();
  assert.match(await fs.readFile(/Read (\S+) and/.exec(world.sent.at(-1)[2])[1], "utf8"), /diagrams/);
  assert.equal(world.sent.length, 2);
});
