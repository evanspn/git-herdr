import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatus, parseDiff, buildPatch, diffRows, splitDiffs, parseLog, parseBranches, LOG_FORMAT, BRANCH_FORMAT, branchName, mark, anchor } from "../mods/git-herdr/model.js";
import * as review from "../mods/git-herdr/review.js";
import { BUNDLED } from "../mods/git-herdr/checklists.js";
import { applyPatch } from "../mods/git-herdr/git.js";
import { makeRepo, git, write, read, LINES } from "./helpers.mjs";

// a.txt with line two changed, a line added after five, and line nine removed: two hunks.
const EDITED = ["one", "TWO", "three", "four", "five", "five-and-a-half", "six", "seven", "eight", "ten"];
const index = (root) => git(root, "show", ":a.txt");
const lineOf = (diff, kind, text) => { for (const [h, hunk] of diff.hunks.entries()) { const i = hunk.lines.findIndex((l) => l.kind === kind && l.text === text); if (i >= 0) return [h, i]; } throw new Error(`no ${kind}${text}`); };

test("status: branch, upstream, and which side each file is on", () => {
  const s = parseStatus("## main...origin/main [ahead 2, behind 1]\0M  staged.js\0 M work.js\0MM both.js\0?? new.js\0UU clash.js\0");
  assert.deepEqual([s.branch, s.upstream, s.ahead, s.behind], ["main", "origin/main", 2, 1]);
  const by = Object.fromEntries(s.files.map((f) => [f.path, f]));
  assert.deepEqual([by["staged.js"].staged, by["staged.js"].unstaged], [true, false]);
  assert.deepEqual([by["work.js"].staged, by["work.js"].unstaged], [false, true]);
  assert.deepEqual([by["both.js"].staged, by["both.js"].unstaged], [true, true]);
  assert.deepEqual([by["new.js"].staged, by["new.js"].unstaged, mark(by["new.js"], false)], [false, true, "A"]);
  assert.equal(mark(by["clash.js"], false), "U");
  assert.equal(parseStatus("## No commits yet on trunk\0").branch, "trunk");
  assert.equal(parseStatus("## HEAD (no branch)\0").branch, null);
});

test("a diff is numbered on both sides and its rows anchor comments", async () => {
  const root = await makeRepo();
  await write(root, "a.txt", EDITED);
  const diff = parseDiff(await git(root, "diff", "--", "a.txt"));
  const rows = diffRows(diff).filter((r) => r.type === "line");
  assert.deepEqual(anchor(rows.find((r) => r.text === "TWO")), { side: "new", line: 2 });
  assert.deepEqual(anchor(rows.find((r) => r.kind === "-" && r.text === "nine")), { side: "old", line: 9 });
  assert.deepEqual(anchor(rows.find((r) => r.text === "ten")), { side: "new", line: 10 });
});

test("staging one hunk leaves the others in the working tree", async () => {
  const root = await makeRepo();
  await write(root, "a.txt", EDITED);
  const diff = parseDiff(await git(root, "diff", "-U1", "--", "a.txt"));
  assert.equal(diff.hunks.length, 3);
  await applyPatch(root, buildPatch(diff, new Map([[1, true]])), { cached: true, reverse: false });
  assert.deepEqual((await index(root)).trim().split("\n"), ["one", "two", "three", "four", "five", "five-and-a-half", "six", "seven", "eight", "nine", "ten"]);
});

test("staging picked lines: an unpicked removal stays, an unpicked addition is left out", async () => {
  const root = await makeRepo();
  await write(root, "a.txt", EDITED);
  const diff = parseDiff(await git(root, "diff", "--", "a.txt"));
  const [h, i] = lineOf(diff, "+", "TWO");
  await applyPatch(root, buildPatch(diff, new Map([[h, new Set([i])]])), { cached: true, reverse: false });
  // Only the addition was picked: "two" is still there, and nothing else moved.
  assert.deepEqual((await index(root)).trim().split("\n"), ["one", "two", "TWO", "three", ...LINES.slice(3)]);
  assert.equal(buildPatch(diff, new Map([[h, new Set()]])), null);
});

test("unstaging and discarding picked lines reverse only those lines", async () => {
  const root = await makeRepo();
  await write(root, "a.txt", EDITED);
  await git(root, "add", "-A");
  const staged = parseDiff(await git(root, "diff", "--cached", "--", "a.txt"));
  const [h, i] = lineOf(staged, "+", "five-and-a-half");
  await applyPatch(root, buildPatch(staged, new Map([[h, new Set([i])]]), true), { cached: true, reverse: true });
  assert.deepEqual((await index(root)).trim().split("\n"), EDITED.filter((l) => l !== "five-and-a-half"));
  // Discard the removal of "nine" from the working tree: the line comes back.
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "second");
  await write(root, "a.txt", EDITED.filter((l) => l !== "eight"));
  const work = parseDiff(await git(root, "diff", "--", "a.txt"));
  const [h2, i2] = lineOf(work, "-", "eight");
  await applyPatch(root, buildPatch(work, new Map([[h2, new Set([i2])]]), true), { cached: false, reverse: true });
  assert.deepEqual((await read(root, "a.txt")).trim().split("\n"), EDITED);
});

test("log, branches and a commit's files parse from git's own output", async () => {
  const root = await makeRepo();
  await write(root, "b.txt", ["b"]);
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "add b");
  await git(root, "branch", "side");
  const log = parseLog(await git(root, "log", `--format=${LOG_FORMAT}`));
  assert.deepEqual(log.map((c) => c.subject), ["add b", "first"]);
  assert.ok(log[0].refs.some((r) => r.includes("main")));
  const { local } = parseBranches(await git(root, "for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads"));
  assert.deepEqual(local.map((b) => [b.name, b.current]), [["main", true], ["side", false]]);
  const files = splitDiffs(await git(root, "show", "--format=", log[0].hash));
  assert.deepEqual(files.map((f) => f.path), ["b.txt"]);
  assert.equal(files[0].diff.whole, true);
  assert.equal(branchName("  fix the login bug "), "fix-the-login-bug");
});

test("threads join the person's comments with the agent's findings and replies", () => {
  let store = review.toStore(null);
  store = review.addComment(store, { file: "a.js", side: "new", line: 3, text: "x()", ref: null, body: "Why?" }, 1);
  const found = review.toFindings(JSON.stringify({ findings: [{ file: "./b.js", line: 9, severity: "high", title: "Leak", body: "..." }, { nope: 1 }], replies: [{ thread: "c1", body: "Because." }] }));
  let all = review.threads(store, found);
  assert.deepEqual(all.map((t) => [t.id, t.kind, t.file, t.status]), [["c1", "comment", "a.js", "open"], ["f1", "finding", "b.js", "open"]]);
  assert.deepEqual(all[0].messages.map((m) => m.from), ["agent"]);
  assert.deepEqual(review.pending(all).map((t) => t.id), ["c1"]);
  store = review.markSent(store, review.pending(all));
  store = review.setStatus(store, all[1], "accepted");
  all = review.threads(store, found);
  assert.deepEqual(review.pending(all).map((t) => t.id), ["f1"]);
  store = review.addReply(review.markSent(store, review.pending(all)), "c1", "Still unclear", 2);
  assert.deepEqual(review.pending(review.threads(store, found)).map((t) => t.id), ["c1"]);
  assert.equal(review.byAnchor(review.threads(review.setStatus(store, all[0], "resolved"), found)).size, 1);
  assert.deepEqual(review.toFindings("not json"), { findings: [], replies: [] });
});

test("checklists are skill files; tasks name every file by path", () => {
  for (const [file, text] of Object.entries(BUNDLED)) {
    const c = review.parseChecklist(file, text, "bundled");
    assert.ok(c.name && c.description && c.items >= 5, file);
  }
  assert.equal(review.parseChecklist(".herdr/reviews/api.md", "# API rules\n- [ ] one\n", "repo").name, "API rules");
  const task = review.reviewTask({ root: "/r", dir: "/r/.herdr/review-session", scope: "branch", base: "origin/main", checklists: [{ name: "tests", path: "/r/x/tests.md" }] });
  assert.match(task, /git diff origin\/main\.\.\.HEAD/);
  assert.match(task, /\/r\/x\/tests\.md/);
  assert.match(task, /\/r\/\.herdr\/review-session\/findings\.json/);
  assert.equal(review.diagramTitle("change-map.mmd", "%% title: What moved\nflowchart TD"), "What moved");
});
