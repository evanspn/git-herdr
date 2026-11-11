// Git Herdr: commits and local code review beside the agents doing the work. One panel with six
// tabs over the repository of the focused terminal:
//
//   changes   staged and unstaged files, a diff with hunk and line staging, the commit box
//   history   the log, each commit's files and diff, fetch, pull and push
//   branches  switch, create and delete branches; stash, pop, apply and drop
//   files     any file in the repository, to read and comment on
//   review    checklists, scope and agent; runs a review, sends comments, lists every thread
//   diagrams  Mermaid change maps the agent wrote, drawn by Mermaid's own renderer
//
// A review is plain files in <repo>/.herdr/review-session, so any agent harness can take part.
// This file holds the state and the actions; views.js draws.
import { View } from "gpui-kit";
import { InputState, TextareaState } from "gpui-base";
import {
  spaces, panes, focused, agents, knownAgents, hc, run, shared, setShared, watchFolder, settings,
  nextCommand, readTextFile,
} from "herdr";
import { diffRows, fileRows, buildPatch, anchor, anchorKey, branchName } from "./model.js";
import * as g from "./git.js";
import * as review from "./review.js";
import { sessionDir, loadSession, saveStore, writeRequest, copyChecklists, renderDiagram, MERMAID_KEY } from "./store.js";
import { draw } from "./views.js";

export const TABS = ["changes", "history", "branches", "files", "review", "diagrams"];
export const AGENT_KEY = "git-herdr.agent";
// The node of layouts/git-herdr.json that shows the agent.
export const AGENT_BLOCK = "gh-agent";

const remembered = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* not kept */ } };
const message = (e) => String(e?.message ?? e);

// The folder of the focused terminal, as the shipped Changes panel finds it.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const remote = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, remote, space: space?.id ?? null };
}

export default class GitHerdr extends View {
  init(_props, cx) {
    this.tab = TABS.includes(remembered("tab")) ? remembered("tab") : "changes";
    this.repo = null; this.cwd = undefined; this.error = null; this.note = null; this.busy = null; this.width = 0;
    this.open = null;     // { path, staged }: the file whose diff shows
    this.diff = null; this.rows = []; this.message = null; this.picked = new Set(); this.cursor = null; // "hunk:index" of picked lines; the last clicked line
    this.amend = false; this.confirming = null;
    this.log = []; this.commit = null;                 // { hash, files: [{ path, diff }], at }
    this.branches = { local: [], remote: [] }; this.stashes = [];
    this.tree = []; this.file = null;                  // { path, rows, from } | { path, message }
    this.session = null; this.threads = []; this.anchors = new Map();
    this.thread = null; this.composer = null;          // the thread shown in the dock; a comment being written
    this.scope = remembered("scope") ?? "uncommitted"; this.base = "main"; this.showAll = false;
    this.chosen = new Set((remembered("checklists") ?? "correctness,tests").split(",").filter(Boolean));
    this.known = []; this.diagram = null; this.rendered = new Map(); this.source = false;
    const field = (placeholder, submit) => { const s = InputState.new({ placeholder }); if (submit) s.on("submit", (_e, cx) => submit(cx)); return s; };
    this.summary = field("Summary (required)", (cx) => this.commitNow(cx));
    this.summary.on("change", (_e, cx) => cx.notify());
    this.body = TextareaState.new({ placeholder: "Description", rows: 3 });
    this.branchInput = field("New branch name, then Enter", (cx) => this.createBranch(cx));
    this.stashInput = field("Stash message (optional), then Enter", (cx) => this.stashNow(cx));
    this.filter = field("Filter files");
    this.filter.on("change", (_e, cx) => cx.notify());
    this.commentInput = field("Comment on this line, then Enter", (cx) => this.addComment(cx));
    this.replyInput = field("Reply, then Enter", (cx) => this.reply(cx));
    this.mermaidInput = field("Renderer command, e.g. mmdc", (cx) => this.setRenderer(cx));
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
    cx.timer.every(4000, (cx) => { if (this.tab === "review" || this.tab === "diagrams") this.reloadSession(cx); });
    cx.spawn(async (cx) => {
      try { this.known = (await knownAgents()).filter((a) => a.installed); } catch { this.known = []; }
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refresh(cx);
        else if (command.startsWith("tab-")) this.setTab(command.slice(4), cx);
        // The Review tab's buttons, for keys.json ("mod:git-herdr") or a script.
        else if (command === "review-run" && this.repo) this.runReview(cx);
        else if (command === "review-send" && this.repo) this.sendComments(cx);
        else if (command === "review-draw" && this.repo) this.drawChanges(cx);
        cx.notify();
      }
    });
  }

  // ---- loading ----

  watch(root, cx) {
    if (this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try { while (this.watched === root) { await watchFolder(root); if (this.watched === root) this.refresh(cx); } }
      catch { if (this.watched === root) this.watched = null; }
    });
  }

  // Reads the repository of the focused folder and whatever the shown tab needs.
  refresh(cx) {
    const { cwd, remote } = location();
    if (cwd !== this.cwd) { this.cwd = cwd; this.reset(); }
    if (this.loading || this.busy) { this.stale = true; return; }
    if (!cwd || remote) { this.repo = null; this.error = remote ? "Git Herdr works on this computer's folders; this space is on another machine." : "No folder"; return; }
    this.loading = true; this.stale = false;
    cx.spawn(async (cx) => {
      try {
        const root = await g.findRoot(cwd);
        if (cwd !== this.cwd) return;
        if (!root) { this.repo = null; this.error = "Not a git repository"; return; }
        const repo = await g.loadRepo(root);
        if (cwd !== this.cwd) return;
        this.repo = repo; this.error = null;
        this.watch(root, cx);
        await this.loadTab(root);
        await this.loadSessionInto(root);
      } catch (e) { if (cwd === this.cwd) this.error = message(e); }
      finally { this.loading = false; cx.notify(); if (this.stale) this.refresh(cx); }
    });
  }

  reset() {
    this.repo = null; this.open = null; this.setDiff(null, null); this.log = []; this.commit = null; this.tree = []; this.file = null;
    this.session = null; this.threads = []; this.anchors = new Map(); this.thread = null; this.composer = null;
    this.note = null; this.error = null; this.watched = null; this.diagram = null; this.confirming = null;
  }

  async loadTab(root) {
    const repo = this.repo;
    if (this.tab === "changes") {
      const still = this.open && repo.files.find((f) => f.path === this.open.path && (this.open.staged ? f.staged : f.unstaged));
      if (!still) { const first = repo.files.find((f) => f.unstaged) ?? repo.files[0]; this.open = first ? { path: first.path, staged: !first.unstaged } : null; }
      await this.loadDiff(root);
    } else if (this.tab === "history") {
      this.log = repo.hasHead ? await g.loadLog(root) : [];
      if (this.commit && !this.log.some((c) => c.hash === this.commit.hash)) this.commit = null;
    } else if (this.tab === "branches") {
      [this.branches, this.stashes] = await Promise.all([g.loadBranches(root), g.loadStashes(root).catch(() => [])]);
    } else if (this.tab === "files") {
      this.tree = (await g.loadTree(root)).slice(0, 20000);
      if (this.file) await this.loadFile(root, this.file.path, this.file.from);
    } else if (this.tab === "review") this.base = await g.baseBranch(root);
  }

  async loadDiff(root) {
    const file = this.open && this.repo.files.find((f) => f.path === this.open.path);
    if (!file) return this.setDiff(null, null);
    const key = `${this.open.path}\n${this.open.staged}`;
    try { const r = await g.loadDiff(root, file, this.open.staged); this.setDiff(r.diff ?? null, r.message ?? null, key); }
    catch (e) { this.setDiff(null, `Cannot show this diff: ${message(e)}`, key); }
  }

  // Line picks survive a reload of the same file only while its diff is unchanged.
  setDiff(diff, text, key = null) {
    const print = diff ? JSON.stringify(diff.hunks) : null;
    if (key !== this.diffKey || print !== this.diffPrint) { this.picked = new Set(); this.cursor = null; }
    this.diffKey = key; this.diffPrint = print; this.diff = diff; this.message = text;
    this.rows = diff ? diffRows(diff).slice(0, 4000) : [];
  }

  async loadFile(root, path, from = 0) {
    const text = await readTextFile(`${root}/${path}`).catch(() => null);
    if (text === null) this.file = { path, message: "Cannot show this file (missing, binary or too large)" };
    else if (text.includes("\0")) this.file = { path, message: "Binary file" };
    else this.file = { path, rows: fileRows(text.slice(0, 600000)).slice(0, 20000), from };
  }

  async loadSessionInto(root) {
    const session = await loadSession(root);
    if (root !== this.repo?.root) return;
    this.session = session;
    this.threads = review.threads(session.store, session.found);
    this.anchors = review.byAnchor(this.threads);
    if (this.thread && !this.threads.some((t) => t.id === this.thread)) this.thread = null;
    if (!session.diagrams.some((d) => d.name === this.diagram)) this.diagram = session.diagrams[0]?.name ?? null;
  }

  reloadSession(cx) {
    const root = this.repo?.root;
    if (!root || this.loading || this.busy) return;
    cx.spawn(async (cx) => { try { await this.loadSessionInto(root); } catch { /* the next refresh reports it */ } cx.notify(); });
  }

  // ---- shared plumbing ----

  // Every change goes through here: one at a time, then a fresh read.
  mutate(cx, label, work, done) {
    const root = this.repo?.root;
    if (!root || this.busy) return;
    this.busy = label; this.note = null; this.confirming = null;
    cx.spawn(async (cx) => {
      try { await work(root); if (done) this.note = { text: done }; }
      catch (e) { this.note = { text: message(e), error: true }; }
      finally { this.busy = null; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  // A destructive action runs on its second click.
  confirm(id, cx, action) {
    if (this.confirming === id) { this.confirming = null; action(); }
    else { this.confirming = id; cx.notify(); }
  }

  setTab(tab, cx) {
    if (!TABS.includes(tab)) return;
    this.tab = tab; remember("tab", tab); this.confirming = null;
    this.refresh(cx); cx.notify();
  }

  // The rows of a code view with each line's open threads after it.
  withThreads(rows, file) {
    if (!this.anchors.size) return rows;
    const out = [];
    for (const row of rows) {
      out.push(row);
      if (row.type !== "line") continue;
      const { side, line } = anchor(row);
      for (const t of this.anchors.get(anchorKey(file, side, line)) ?? []) out.push({ type: "thread", thread: t });
    }
    return out;
  }

  // ---- changes ----

  pick(path, staged, cx) {
    this.open = { path, staged }; this.confirming = null; this.cursor = null;
    const root = this.repo.root;
    cx.spawn(async (cx) => { await this.loadDiff(root); cx.notify(); });
    cx.notify();
  }
  // A click on a row of a code view (the list's on_item_click; rows themselves carry no handlers).
  rowClicked(row, o, cx) {
    if (row.type === "more") { if (this.file) this.file.from = 0; cx.notify(); return; }
    if (row.type === "thread") { this.showThread(row.thread.id, cx); return; }
    if (row.type === "hunk") { if (o.mode === "changes" && !this.diff?.whole) this.toggleHunk(row.hunk, cx); return; }
    if (o.mode !== "changes") { this.compose(o.file, row, o.ref, cx); return; }
    this.cursor = { file: o.file, row, ...anchor(row) };
    if (row.kind !== " " && !this.diff?.whole) this.togglePick(row, cx); else cx.notify();
  }
  isCursor(file, row) {
    const c = this.cursor ?? (this.composer ? { file: this.composer.file, side: this.composer.side, line: this.composer.line } : null);
    if (!c || c.file !== file) return false;
    const a = anchor(row);
    return a.side === c.side && a.line === c.line;
  }
  composeAtCursor(cx) { if (this.cursor) this.compose(this.cursor.file, this.cursor.row, null, cx); }
  hunkLines(hunk) { return this.rows.filter((r) => r.type === "line" && r.hunk === hunk && r.kind !== " ").map((r) => `${hunk}:${r.index}`); }
  hunkPicked(hunk) { const keys = this.hunkLines(hunk); return keys.length > 0 && keys.every((k) => this.picked.has(k)); }
  toggleHunk(hunk, cx) {
    const keys = this.hunkLines(hunk), all = this.hunkPicked(hunk);
    for (const k of keys) { if (all) this.picked.delete(k); else this.picked.add(k); }
    cx.notify();
  }
  togglePick(row, cx) {
    const key = `${row.hunk}:${row.index}`;
    if (!this.picked.delete(key)) this.picked.add(key);
    cx.notify();
  }
  setStaged(file, staged, cx) {
    this.mutate(cx, staged ? "Staging" : "Unstaging", (root) => staged ? g.stage(root, [file.path]) : g.unstage(root, [file.path], this.repo.hasHead));
  }
  setAllStaged(staged, cx) {
    const paths = this.repo.files.filter((f) => staged ? f.unstaged : f.staged).map((f) => f.path);
    if (paths.length) this.mutate(cx, staged ? "Staging" : "Unstaging", (root) => staged ? g.stage(root, paths) : g.unstage(root, paths, this.repo.hasHead));
  }
  discardFile(file, cx) {
    this.confirm(`discard-${file.path}`, cx, () => this.mutate(cx, "Discarding", (root) => g.discard(root, file)));
  }
  // Stages or unstages (per the shown side) or discards: one hunk, or the picked lines.
  applyPicks(hunk, discard, cx) {
    const picks = new Map();
    if (hunk !== null) picks.set(hunk, true);
    else for (const key of this.picked) { const [h, i] = key.split(":").map(Number); picks.set(h, (picks.get(h) ?? new Set()).add(i)); }
    const staged = this.open.staged, reverse = staged || discard;
    const patch = buildPatch(this.diff, picks, reverse);
    if (!patch) return;
    this.mutate(cx, discard ? "Discarding" : staged ? "Unstaging" : "Staging", (root) => g.applyPatch(root, patch, { cached: !discard, reverse }));
  }
  discardPicks(hunk, cx) {
    this.confirm(`discard-hunk-${hunk}`, cx, () => this.applyPicks(hunk, true, cx));
  }
  commitNow(cx) {
    const summary = this.summary.value().trim(), body = this.body.value().trim(), amend = this.amend;
    if (!summary && !amend) return;
    if (!amend && !this.repo?.files.some((f) => f.staged)) { this.note = { text: "Nothing is staged. Stage files, hunks or lines first.", error: true }; cx.notify(); return; }
    this.mutate(cx, "Committing", async (root) => {
      await g.commit(root, { summary, body, amend });
      this.summary.set_value(""); this.body.set_value(""); this.amend = false;
    }, amend ? "Amended the last commit" : `Committed: ${summary}`);
  }
  sync(verb, cx) {
    const work = { fetch: (root) => g.fetch(root), pull: (root) => g.pull(root), push: (root) => g.push(root, this.repo) }[verb];
    this.mutate(cx, { fetch: "Fetching", pull: "Pulling", push: "Pushing" }[verb], work, { fetch: "Fetched", pull: "Pulled", push: "Pushed" }[verb]);
  }

  // ---- history, branches, files ----

  showCommit(hash, cx) {
    if (this.commit?.hash === hash) { this.commit = null; cx.notify(); return; }
    const root = this.repo.root;
    cx.spawn(async (cx) => {
      try { this.commit = { hash, files: await g.loadCommit(root, hash), at: 0 }; }
      catch (e) { this.note = { text: message(e), error: true }; }
      cx.notify();
    });
  }
  commitRows() { const f = this.commit.files[this.commit.at]; return f.rows ??= diffRows(f.diff).slice(0, 4000); }
  createBranch(cx) {
    const name = branchName(this.branchInput.value());
    if (name) this.mutate(cx, "Creating branch", async (root) => { await g.createBranch(root, name); this.branchInput.set_value(""); }, `Switched to new branch ${name}`);
  }
  switchBranch(name, remote, cx) {
    this.mutate(cx, "Switching", (root) => remote ? g.track(root, name) : g.switchTo(root, name), `Switched to ${remote ? name.split("/").slice(1).join("/") : name}`);
  }
  deleteBranch(name, cx) {
    this.confirm(`delete-${name}`, cx, () => this.mutate(cx, "Deleting branch", (root) => g.deleteBranch(root, name), `Deleted ${name}`));
  }
  stashNow(cx) {
    const text = this.stashInput.value().trim();
    this.mutate(cx, "Stashing", async (root) => { await g.stash(root, text); this.stashInput.set_value(""); }, "Stashed");
  }
  stashDo(verb, ref, cx) {
    const go = () => this.mutate(cx, "Working", (root) => g.stashDo(root, verb, ref));
    if (verb === "drop") this.confirm(`drop-${ref}`, cx, go); else go();
  }
  openFile(path, line, cx) {
    this.tab = "files"; remember("tab", "files");
    this.file = { path, rows: [], from: Math.max(0, (line ?? 1) - 6) };
    this.refresh(cx); cx.notify();
  }

  // ---- comments and threads ----

  saveStore(cx, change) {
    this.mutate(cx, "Saving", async (root) => { await saveStore(root, change((await loadSession(root)).store)); });
  }
  compose(file, row, ref, cx) {
    this.composer = { file, ...anchor(row), text: row.text, ref: ref ?? null }; this.thread = null; this.cursor = null;
    this.commentInput.set_value(""); this.commentInput.focus(); cx.notify();
  }
  addComment(cx) {
    const body = this.commentInput.value().trim(), c = this.composer;
    if (!body || !c) return;
    this.composer = null; this.commentInput.set_value("");
    this.saveStore(cx, (store) => review.addComment(store, { ...c, body }, Date.now()));
  }
  showThread(id, cx) { this.thread = this.thread === id ? null : id; this.composer = null; this.replyInput.set_value(""); cx.notify(); }
  reply(cx) {
    const body = this.replyInput.value().trim(), id = this.thread;
    if (!body || !id) return;
    this.replyInput.set_value("");
    this.saveStore(cx, (store) => review.addReply(store, id, body, Date.now()));
  }
  setStatus(thread, status, cx) { this.saveStore(cx, (store) => review.setStatus(store, thread, status)); }
  removeComment(thread, cx) { this.confirm(`remove-${thread.id}`, cx, () => this.saveStore(cx, (store) => review.removeComment(store, thread.id))); }

  // ---- the agent ----

  // The agents to hand work to: those running in this space, then those that can be started.
  agentChoices() {
    const here = location().space;
    return [
      ...agents().filter((a) => a.space === here).map((a) => ({ id: `run:${a.address}`, label: `${a.program?.name ?? a.app ?? "Agent"} · ${a.tab_name}`, address: a.address })),
      ...this.known.map((a) => ({ id: `new:${a.key}`, label: `New ${a.name}`, run: a.run, name: a.name })),
    ];
  }
  agentChoice() { const all = this.agentChoices(); return all.find((a) => a.id === shared(AGENT_KEY)) ?? all[0] ?? null; }
  chooseAgent(id, cx) { setShared(AGENT_KEY, id); cx.notify(); }

  // Writes the task into the session and points the chosen agent at it.
  dispatch(cx, kind, label, build, after) {
    const agent = this.agentChoice();
    if (!agent) { this.note = { text: "No coding agent is running in this space and none is installed.", error: true }; cx.notify(); return; }
    this.mutate(cx, "Handing over", async (root) => {
      const { text, checklists } = build(root, sessionDir(root));
      const line = review.pointer(await writeRequest(root, kind, text, checklists));
      if (agent.address) {
        const r = await hc(["send", agent.address, line]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "Could not reach the agent");
        run("agent.focus", { terminal: agent.address });
      } else run("tab.new", { name: label, folder: root, argv: agent.run, task: line });
      if (shared("layout") === "git-herdr") run("layout.show", { id: AGENT_BLOCK });
      if (after) await after(root);
    }, `${label}: handed to ${agent.label}`);
  }
  runReview(cx) {
    const checklists = (this.session?.checklists ?? []).filter((c) => this.chosen.has(c.id));
    if (!checklists.length) { this.note = { text: "Choose at least one checklist.", error: true }; cx.notify(); return; }
    this.dispatch(cx, "review", "Review", (root, dir) => ({ checklists, text: review.reviewTask({ root, dir, scope: this.scope, base: this.base, checklists }) }));
  }
  sendComments(cx) {
    const items = review.pending(this.threads);
    if (!items.length) return;
    this.dispatch(cx, "comments", "Review comments", (root, dir) => ({ text: review.commentsTask({ root, dir, items }) }),
      async (root) => saveStore(root, review.markSent((await loadSession(root)).store, items)));
  }
  drawChanges(cx) {
    this.dispatch(cx, "diagram", "Change map", (root, dir) => ({ text: review.diagramTask({ root, dir, scope: this.scope, base: this.base }) }));
  }
  setScope(scope, cx) { this.scope = scope; remember("scope", scope); cx.notify(); }
  toggleChecklist(id, cx) {
    if (!this.chosen.delete(id)) this.chosen.add(id);
    remember("checklists", [...this.chosen].join(",")); cx.notify();
  }
  copyChecklists(cx) { this.mutate(cx, "Copying", (root) => copyChecklists(root), `Checklists copied to ${review.CHECKLIST_DIR}`); }

  // ---- diagrams ----

  // The drawn form of the shown diagram: started here, kept per source and appearance.
  rendering(cx) {
    const d = this.session?.diagrams.find((x) => x.name === this.diagram);
    if (!d) return null;
    const dark = settings().dark !== false, key = `${dark}\n${shared(MERMAID_KEY) ?? ""}\n${d.source}`;
    let entry = this.rendered.get(d.name);
    if (entry?.key !== key) {
      entry = { key, busy: true }; this.rendered.set(d.name, entry);
      const command = String(shared(MERMAID_KEY) ?? "").split(/\s+/).filter(Boolean);
      cx.spawn(async (cx) => {
        try { entry.image = await renderDiagram(d, dark, command.length ? command : null); }
        catch (e) { entry.error = message(e); }
        entry.busy = false; cx.notify();
      });
    }
    return { ...d, ...entry, title: review.diagramTitle(d.name, d.source) };
  }
  setRenderer(cx) { setShared(MERMAID_KEY, this.mermaidInput.value().trim()); this.rendered = new Map(); cx.notify(); }

  render(cx) {
    if (location().cwd !== this.cwd) this.refresh(cx);
    return draw(this, cx);
  }
}
