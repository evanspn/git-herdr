// What each tab looks like. Views read the panel's state and call its actions; they touch no files.
import { div, image } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, Scrollbar } from "gpui-base";
import { theme, settings } from "herdr";
import { mark } from "./model.js";
import { SCOPES, isOpen, pending } from "./review.js";
import { button, link, chip, tag, heading, note, row, input, area, scroller } from "./ui.js";

const TAB_LABEL = { changes: "Changes", history: "History", branches: "Branches", files: "Files", review: "Review", diagrams: "Diagrams" };
const ROW = 20;
const markColor = (m, t) => m === "A" ? t.ansi2 : m === "D" || m === "U" ? t.ansi1 : t.blocked;
const severityColor = (s, t) => s === "high" ? t.ansi1 : s === "medium" ? t.blocked : s === "low" ? t.ansi4 : t.muted;
const summary = (thread) => thread.kind === "finding" ? `${thread.title || thread.body}` : thread.body;

// A path as a dim folder and a name.
function pathLabel(path, t) {
  const parts = path.split("/"), name = parts.pop();
  return h_flex().flex_1().min_w(0)
    .child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : ""))
    .child(div().flex_none().max_w(280).truncate().child(name));
}

// ---- the code view: a diff or a file, with inline threads ----
// `mode`: "changes" (hunks and lines can be staged), "read" (a commit) or "file".

function codeRow(view, t, id, row, i, o) {
  if (row.type === "more") {
    return h_flex().id(`${id}-more`).h(ROW).px(12).flex_none().bg(t.raised).text_color(t.accent).cursor_pointer()
      .on_click((_e, cx) => { view.file.from = 0; cx.notify(); }).child(`↑ Show from line 1 (${row.count} lines above)`);
  }
  if (row.type === "thread") {
    const th = row.thread, color = th.kind === "finding" ? severityColor(th.severity, t) : t.accent;
    return h_flex().id(`${id}-t${i}`).h(ROW).flex_none().pl(94).pr(10).gap(8).items_center().cursor_pointer()
      .bg(view.thread === th.id ? t.selected : t.raised).hover((s) => s.bg(t.hover)).on_click((_e, cx) => view.showThread(th.id, cx))
      .child(div().flex_none().font_semibold().text_color(color).child(th.kind === "finding" ? `▸ agent · ${th.severity}` : "▸ you"))
      .child(div().flex_1().min_w(0).truncate().child(summary(th)))
      .when(th.messages.length > 0, (e) => e.child(div().flex_none().text_color(t.dim).child(`${th.messages.length} repl${th.messages.length === 1 ? "y" : "ies"}`)));
  }
  if (row.type === "hunk") {
    const staged = view.open?.staged, can = o.mode === "changes" && !view.diff?.whole && !view.busy;
    return h_flex().h(ROW).flex_none().px(12).gap(8).items_center().bg(t.raised).text_color(t.dim)
      .child(div().flex_1().min_w(0).truncate().child(row.text))
      .when(can, (e) => e.child(link(`${id}-h${row.hunk}`, staged ? "Unstage hunk" : "Stage hunk", (cx) => view.applyPicks(row.hunk, false, cx), t, t.accent)))
      .when(can && !staged, (e) => e.child(link(`${id}-d${row.hunk}`, view.confirming === `discard-hunk-${row.hunk}` ? "Discard: sure?" : "Discard hunk", (cx) => view.discardPicks(row.hunk, cx), t, t.ansi1)));
  }
  const changed = row.kind !== " ", pickable = o.mode === "changes" && changed && !view.diff?.whole;
  const picked = pickable && view.picked.has(`${row.hunk}:${row.index}`);
  const number = (value) => div().w(38).flex_none().text_right().text_color(picked ? t.accent : t.dim).child(value === undefined ? "" : String(value));
  const numbers = h_flex().flex_none().gap(4).child(number(o.mode === "file" ? undefined : row.old)).child(number(row.new));
  return h_flex().h(ROW).flex_none().gap(6).items_center()
    .when(row.kind === "+", (e) => e.bg(t.ansi2 + "18")).when(row.kind === "-", (e) => e.bg(t.ansi1 + "18")).when(picked, (e) => e.bg(t.selected))
    .child(div().id(`${id}-c${i}`).w(18).flex_none().text_center().cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.accent).bg(t.hover))
      .on_click((_e, cx) => view.compose(o.file, row, o.ref, cx)).child("+"))
    .child(pickable ? numbers.id(`${id}-n${i}`).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => view.togglePick(row, cx)) : numbers)
    .child(div().w(8).flex_none().text_color(t.dim).child(changed ? row.kind : ""))
    .child(div().flex_1().min_w(0).truncate().child(row.text));
}

function codeView(view, t, id, rows, o) {
  const all = view.withThreads(rows, o.file);
  let longest = 0;
  for (const r of all) if (r.text && r.text.length > longest) longest = r.text.length;
  return div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11.5)
    .child(div().id(`${id}-x`).size_full().overflow_x_scrollbar()
      .child(div().w_full().min_w(Math.max(300, Math.min(longest, 4000) * 7 + 130)).h_full()
        .child(v_virtual_list(id, all.length, ROW, (i) => String(i),
          (range) => all.slice(range.start, range.end).map((r, k) => codeRow(view, t, id, r, range.start + k, o))).size_full())))
    .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0());
}

const empty = (text, t) => div().flex_1().p(16).text_color(t.dim).child(text);
const paneTitle = (t) => h_flex().h(34).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border);

// Two regions: side by side when wide, stacked when narrow.
function split(view, t, side, main, width = 320) {
  const wide = view.width === 0 || view.width >= 820;
  return (wide ? h_flex() : v_flex()).flex_1().min_h(0)
    .child(wide ? side.w(width).flex_none().h_full().border_r(1).border_color(t.border) : side.w_full().h(260).flex_none().border_b(1).border_color(t.border))
    .child(main.flex_1().min_w(0).min_h(0));
}

// ---- changes ----

function fileRow(view, t, file, staged) {
  const open = view.open?.path === file.path && view.open.staged === staged, m = mark(file, staged);
  const id = `${staged ? "s" : "u"}-${file.path}`, sure = view.confirming === `discard-${file.path}`;
  return h_flex().h(26).flex_none().px(6).gap(4).items_center().rounded(6).when(open, (e) => e.bg(t.selected))
    .child(h_flex().id(`file-${id}`).flex_1().min_w(0).h_full().gap(8).items_center().cursor_pointer().on_click((_e, cx) => view.pick(file.path, staged, cx))
      .child(div().w(12).flex_none().text_size(11).text_color(markColor(m, t)).child(m)).child(pathLabel(file.path, t)))
    .when(!staged && !file.conflict, (e) => e.child(link(`discard-${id}`, sure ? "Sure?" : "×", (cx) => view.discardFile(file, cx), t, t.ansi1)))
    .child(link(`toggle-${id}`, staged ? "−" : "+", (cx) => view.setStaged(file, !staged, cx), t, t.accent));
}

function fileSection(view, t, title, files, staged) {
  return v_flex().gap(1)
    .child(h_flex().h(26).px(6).gap(6).items_center().child(heading(`${title} · ${files.length}`, t).pt(0)).child(div().flex_1())
      .when(files.length > 0, (e) => e.child(link(`all-${staged}`, staged ? "Unstage all" : "Stage all", (cx) => view.setAllStaged(!staged, cx), t))))
    .children(files.map((f) => fileRow(view, t, f, staged)));
}

function changes(view, t) {
  const repo = view.repo, staged = repo.files.filter((f) => f.staged), unstaged = repo.files.filter((f) => f.unstaged);
  const ready = !view.busy && (view.amend || (Boolean(view.summary.value().trim()) && staged.length > 0));
  const side = v_flex()
    .child(scroller("gh-files").p(6).gap(8)
      .child(fileSection(view, t, "Staged", staged, true)).child(fileSection(view, t, "Changes", unstaged, false))
      .when(!repo.files.length, (e) => e.child(note("No uncommitted changes", t).p(8)))
      .when(repo.limited, (e) => e.child(note("Showing the first 2,000 changed files", t).p(8))))
    .child(v_flex().flex_none().p(10).gap(6).border_t(1).border_color(t.border)
      .child(input(view.summary, t)).child(area(view.body, 62, t))
      .child(h_flex().gap(6).items_center()
        .when(repo.hasHead, (e) => e.child(chip("amend", "Amend last commit", view.amend, (cx) => { view.amend = !view.amend; cx.notify(); }, t)))
        .child(div().flex_1())
        .child(button("commit", view.busy === "Committing" ? "Committing…" : view.amend ? "Amend" : `Commit to ${repo.branch ?? "HEAD"}`, (cx) => view.commitNow(cx), t, "primary", ready))));
  const n = view.picked.size, isStaged = view.open?.staged;
  const main = v_flex()
    .child(paneTitle(t)
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(view.open ? `${view.open.path}${isStaged ? "  (staged)" : ""}` : "Select a file"))
      .when(n > 0, (e) => e
        .child(button("pick-apply", `${isStaged ? "Unstage" : "Stage"} ${n} line${n === 1 ? "" : "s"}`, (cx) => view.applyPicks(null, false, cx), t, "primary", !view.busy))
        .when(!isStaged, (e) => e.child(button("pick-discard", view.confirming === "discard-hunk-null" ? "Discard: sure?" : "Discard lines", (cx) => view.discardPicks(null, cx), t, "danger")))
        .child(link("pick-clear", "Clear", (cx) => { view.picked = new Set(); cx.notify(); }, t)))
      .when(n === 0 && Boolean(view.diff) && !view.diff.whole, (e) => e.child(note("Click line numbers to pick lines", t))))
    .child(view.diff ? codeView(view, t, "gh-diff", view.rows, { file: view.open.path, mode: "changes" }) : empty(view.message ?? (view.open ? "Loading…" : "Nothing to show"), t));
  return split(view, t, side, main);
}

// ---- history ----

function history(view, t) {
  const side = scroller("gh-log").p(6).gap(1).children(view.log.map((c) =>
    v_flex().id(`commit-${c.short}`).flex_none().px(8).py(5).gap(2).rounded(6).cursor_pointer().when(view.commit?.hash === c.hash, (e) => e.bg(t.selected))
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => view.showCommit(c.hash, cx))
      .child(div().truncate().child(c.subject))
      .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
        .child(div().flex_none().text_color(t.muted).child(c.short)).child(div().min_w(0).truncate().child(`${c.author} · ${c.when}`))
        .children(c.refs.slice(0, 3).map((r) => tag(r.replace("HEAD -> ", ""), t, t.accent))))))
    .when(!view.log.length, (e) => e.child(note(view.repo.hasHead ? "Loading…" : "No commits yet", t).p(8)));
  const c = view.commit, file = c?.files[c.at];
  const main = v_flex()
    .when(Boolean(c), (e) => e.child(row().flex_none().p(8).border_b(1).border_color(t.border).max_h(84).overflow_hidden()
      .children(c.files.slice(0, 40).map((f, i) => chip(`cfile-${i}`, f.path.split("/").pop(), c.at === i, (cx) => { c.at = i; cx.notify(); }, t)))
      .when(c.files.length > 40, (e) => e.child(note(`and ${c.files.length - 40} more`, t)))))
    .child(file ? (file.diff.hunks.length ? codeView(view, t, "gh-commit", view.commitRows(), { file: file.path, ref: c.hash.slice(0, 7), mode: "read" }) : empty("No text changes to show", t))
      : empty(c ? "This commit changes no files" : "Select a commit to see what it changed", t));
  return split(view, t, side, main, 360);
}

// ---- branches ----

function branches(view, t) {
  const { local, remote } = view.branches;
  const line = (id, name, about, actions, current = false) => h_flex().id(`line-${id}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6).hover((s) => s.bg(t.hover))
    .child(div().flex_none().max_w(320).truncate().when(current, (e) => e.font_semibold()).child(name))
    .when(current, (e) => e.child(tag("current", t, t.accent)))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(about)).children(actions);
  return scroller("gh-branches").p(12).gap(4)
    .child(heading("New branch", t)).child(h_flex().gap(6).child(div().flex_1().child(input(view.branchInput, t))).child(button("branch-create", "Create and switch", (cx) => view.createBranch(cx), t)))
    .child(heading("Local", t))
    .children(local.map((b) => line(`l-${b.name}`, b.name, [b.track, b.subject].filter(Boolean).join(" "), b.current ? [] : [
      link(`switch-${b.name}`, "Switch", (cx) => view.switchBranch(b.name, false, cx), t, t.accent),
      link(`delete-${b.name}`, view.confirming === `delete-${b.name}` ? "Delete: sure?" : "Delete", (cx) => view.deleteBranch(b.name, cx), t, t.ansi1)], b.current)))
    .when(remote.length > 0, (e) => e.child(heading("Remote", t))
      .children(remote.slice(0, 200).map((b) => line(`r-${b.name}`, b.name, b.subject, [link(`track-${b.name}`, "Check out", (cx) => view.switchBranch(b.name, true, cx), t, t.accent)]))))
    .child(heading("Stashes", t))
    .child(h_flex().gap(6).child(div().flex_1().child(input(view.stashInput, t))).child(button("stash", "Stash all changes", (cx) => view.stashNow(cx), t, "", view.repo.files.length > 0)))
    .children(view.stashes.map((s) => line(`st-${s.ref}`, s.ref, s.subject, [
      link(`pop-${s.ref}`, "Pop", (cx) => view.stashDo("pop", s.ref, cx), t, t.accent),
      link(`apply-${s.ref}`, "Apply", (cx) => view.stashDo("apply", s.ref, cx), t),
      link(`drop-${s.ref}`, view.confirming === `drop-${s.ref}` ? "Drop: sure?" : "Drop", (cx) => view.stashDo("drop", s.ref, cx), t, t.ansi1)])))
    .when(!view.stashes.length, (e) => e.child(note("No stashes", t)));
}

// ---- files ----

function files(view, t) {
  const query = view.filter.value().trim().toLowerCase();
  const found = query ? view.tree.filter((p) => p.toLowerCase().includes(query)) : view.tree;
  const marks = new Map(view.repo.files.map((f) => [f.path, mark(f, !f.unstaged)]));
  const side = v_flex()
    .child(div().flex_none().p(6).child(input(view.filter, t)))
    .child(scroller("gh-tree").px(6).pb(6).gap(1)
      .children(found.slice(0, 400).map((p) => h_flex().id(`tree-${p}`).h(24).flex_none().px(6).gap(6).items_center().rounded(6).cursor_pointer()
        .when(view.file?.path === p, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => view.openFile(p, 1, cx))
        .child(pathLabel(p, t)).when(marks.has(p), (e) => e.child(div().flex_none().text_size(11).text_color(markColor(marks.get(p), t)).child(marks.get(p))))))
      .when(found.length > 400, (e) => e.child(note(`${found.length - 400} more: filter to narrow`, t).p(6)))
      .when(!found.length, (e) => e.child(note(view.tree.length ? "No file matches" : "Loading…", t).p(6))));
  const f = view.file;
  const rows = f?.rows ? (f.from > 0 ? [{ type: "more", count: f.from }, ...f.rows.slice(f.from)] : f.rows) : null;
  const main = v_flex()
    .child(paneTitle(t).child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(f?.path ?? "Select a file"))
      .when(Boolean(rows), (e) => e.child(note("Click + beside a line to comment", t))))
    .child(rows ? codeView(view, t, "gh-file", rows, { file: f.path, mode: "file" }) : empty(f?.message ?? "Open any file to read it and leave comments for the agent", t));
  return split(view, t, side, main);
}

// ---- review ----

function threadRow(view, t, th) {
  const color = th.kind === "finding" ? severityColor(th.severity, t) : t.accent;
  return h_flex().id(`thread-${th.id}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
    .when(view.thread === th.id, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => view.showThread(th.id, cx))
    .child(tag(th.kind === "finding" ? th.severity : "you", t, color))
    .child(div().flex_none().max_w(260).truncate().text_size(11.5).text_color(t.muted).child(`${th.file}:${th.line}`))
    .child(div().flex_1().min_w(0).truncate().when(!isOpen(th), (e) => e.text_color(t.dim)).child(summary(th)))
    .when(th.status !== "open", (e) => e.child(tag(th.status, t, th.status === "accepted" ? t.ansi2 : t.dim)));
}

function reviewTab(view, t) {
  const lists = view.session?.checklists ?? [], agent = view.agentChoice(), waiting = pending(view.threads).length;
  const shown = view.showAll ? view.threads : view.threads.filter(isOpen);
  const scope = SCOPES.find((s) => s.id === view.scope) ?? SCOPES[0];
  return scroller("gh-review").p(12).gap(6)
    .child(heading("What to review", t))
    .child(row().children(SCOPES.map((s) => chip(`scope-${s.id}`, s.label, view.scope === s.id, (cx) => view.setScope(s.id, cx), t))))
    .child(note(`${scope.about[0].toUpperCase()}${scope.about.slice(1)}${scope.id === "branch" ? ` (${view.base})` : ""}`, t))
    .child(heading("Checklists", t))
    .child(row().children(lists.map((c) => chip(`list-${c.id}`, `${c.name} · ${c.items}${c.source === "repo" ? " · repo" : ""}`, view.chosen.has(c.id), (cx) => view.toggleChecklist(c.id, cx), t)))
      .when(!lists.some((c) => c.source === "repo"), (e) => e.child(link("lists-copy", "Copy these into .herdr/reviews to edit", (cx) => view.copyChecklists(cx), t))))
    .child(heading("Agent", t))
    .child(row().children(view.agentChoices().map((a) => chip(`agent-${a.id}`, a.label, agent?.id === a.id, (cx) => view.chooseAgent(a.id, cx), t)))
      .when(!agent, (e) => e.child(note("No coding agent is running in this space and none is installed", t, t.ansi1))))
    .child(row().pt(6)
      .child(button("review-run", "Run review", (cx) => view.runReview(cx), t, "primary", Boolean(agent) && !view.busy))
      .child(button("review-send", waiting ? `Send ${waiting} to agent` : "Nothing to send", (cx) => view.sendComments(cx), t, "", waiting > 0 && Boolean(agent) && !view.busy))
      .child(button("review-draw", "Draw change map", (cx) => view.drawChanges(cx), t, "", Boolean(agent) && !view.busy)))
    .child(h_flex().pt(8).gap(8).items_center().child(heading(`Threads · ${shown.length}`, t).pt(0)).child(div().flex_1())
      .child(chip("threads-open", "Open", !view.showAll, (cx) => { view.showAll = false; cx.notify(); }, t))
      .child(chip("threads-all", "All", view.showAll, (cx) => { view.showAll = true; cx.notify(); }, t)))
    .children(shown.map((th) => threadRow(view, t, th)))
    .when(!shown.length, (e) => e.child(note("No threads yet. Comment on a line in Changes, History or Files, or run a review.", t)));
}

// ---- diagrams ----

function diagrams(view, t, cx) {
  const all = view.session?.diagrams ?? [], d = view.rendering(cx);
  const top = row().flex_none().p(8).border_b(1).border_color(t.border)
    .children(all.map((x) => chip(`diagram-${x.name}`, x.name.replace(/\.mmd$/, ""), view.diagram === x.name, (cx) => { view.diagram = x.name; cx.notify(); }, t)))
    .child(div().flex_1())
    .when(Boolean(d), (e) => e.child(chip("diagram-source", "Source", view.source, (cx) => { view.source = !view.source; cx.notify(); }, t)))
    .child(button("diagram-draw", "Draw change map", (cx) => view.drawChanges(cx), t, "", Boolean(view.agentChoice()) && !view.busy));
  if (!d) return v_flex().flex_1().min_h(0).child(top).child(empty("No diagrams yet. Draw change map asks the agent to map the current changes as Mermaid diagrams, shown here.", t));
  const source = () => scroller("gh-mmd").p(12).font_family(settings().font_family ?? "JetBrains Mono").text_size(11.5).children(d.source.split("\n").map((l) => div().child(l || " ")));
  const missing = d.error === "no-renderer";
  return v_flex().flex_1().min_h(0).child(top)
    .child(div().flex_none().px(12).pt(8).font_semibold().child(d.title))
    .when(d.busy, (e) => e.child(empty("Rendering…", t)))
    .when(Boolean(d.error), (e) => e.child(v_flex().flex_none().p(12).gap(6)
      .child(note(missing ? "Mermaid's renderer was not found. Install it (npm install -g @mermaid-js/mermaid-cli) or give the command that runs it:" : "Mermaid could not draw this diagram:", t, t.ansi1))
      .when(!missing, (e) => e.child(div().font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.muted).child(d.error)))
      .child(h_flex().gap(6).child(div().flex_1().child(input(view.mermaidInput, t))).child(button("mermaid-set", "Use this renderer", (cx) => view.setRenderer(cx), t)))))
    .when(Boolean(d.error) || view.source, (e) => e.child(source()))
    .when(Boolean(d.image) && !view.source, (e) => e.child(div().flex_1().min_h(0).p(12).child(image(d.image).size_full())));
}

// ---- the dock: a comment being written, or the selected thread ----

function dock(view, t) {
  const c = view.composer, bar = v_flex().flex_none().p(10).gap(6).border_t(1).border_color(t.border).bg(t.surface);
  if (c) {
    return bar
      .child(h_flex().gap(8).child(div().flex_none().font_semibold().child(`Comment on ${c.file}:${c.line}`)).child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(c.text.trim())))
      .child(h_flex().gap(6).child(div().flex_1().child(input(view.commentInput, t)))
        .child(button("comment-add", "Add comment", (cx) => view.addComment(cx), t, "primary"))
        .child(button("comment-cancel", "Cancel", (cx) => { view.composer = null; cx.notify(); }, t)));
  }
  const th = view.threads.find((x) => x.id === view.thread);
  if (!th) return null;
  const finding = th.kind === "finding", says = (who, body, color) => h_flex().gap(8).items_start()
    .child(div().w(44).flex_none().text_size(11).text_color(color).child(who)).child(div().flex_1().min_w(0).child(body));
  return bar.max_h(300)
    .child(h_flex().gap(8).items_center()
      .child(tag(finding ? `agent · ${th.severity}` : "you", t, finding ? severityColor(th.severity, t) : t.accent))
      .child(link("thread-open", `${th.file}:${th.line}`, (cx) => view.openFile(th.file, th.line, cx), t, t.accent))
      .when(Boolean(th.checklist), (e) => e.child(tag(th.checklist, t)))
      .child(tag(th.status, t)).child(div().flex_1())
      .when(finding && th.status === "open", (e) => e.child(button("thread-accept", "Accept: fix it", (cx) => view.setStatus(th, "accepted", cx), t, "primary")))
      .when(finding && isOpen(th), (e) => e.child(button("thread-dismiss", "Dismiss", (cx) => view.setStatus(th, "dismissed", cx), t)))
      .when(isOpen(th), (e) => e.child(button("thread-resolve", "Resolve", (cx) => view.setStatus(th, "resolved", cx), t)))
      .when(!isOpen(th), (e) => e.child(button("thread-reopen", "Reopen", (cx) => view.setStatus(th, "open", cx), t)))
      .when(!finding, (e) => e.child(button("thread-remove", view.confirming === `remove-${th.id}` ? "Delete: sure?" : "Delete", (cx) => view.removeComment(th, cx), t, "danger")))
      .child(link("thread-close", "Close", (cx) => view.showThread(th.id, cx), t)))
    .child(scroller("gh-thread").gap(6)
      .when(Boolean(th.title), (e) => e.child(div().font_semibold().child(th.title)))
      .child(says(finding ? "agent" : "you", th.body, finding ? t.muted : t.accent))
      .when(Boolean(th.suggestion), (e) => e.child(says("fix", th.suggestion, t.ansi2)))
      .children(th.messages.map((m) => says(m.from, m.body, m.from === "you" ? t.accent : t.muted))))
    .when(isOpen(th), (e) => e.child(h_flex().gap(6).child(div().flex_1().child(input(view.replyInput, t))).child(button("thread-reply", "Reply", (cx) => view.reply(cx), t))));
}

// ---- the panel ----

const BODIES = { changes, history, branches, files, review: reviewTab, diagrams };

export function draw(view, cx) {
  const t = theme(), repo = view.repo, open = view.threads.filter(isOpen).length;
  const count = { changes: repo?.files.length, review: open, diagrams: view.session?.diagrams.length };
  const header = h_flex().flex_none().min_h(44).px(12).py(6).gap(8).items_center().flex_wrap().border_b(1).border_color(t.border).bg(t.surface)
    .child(div().font_semibold().child(repo?.name ?? "Git Herdr"))
    .when(Boolean(repo), (e) => e.child(tag(repo.branch ?? "detached", t, t.accent)))
    .children(Object.keys(BODIES).map((tab) => chip(`tab-${tab}`, count[tab] ? `${TAB_LABEL[tab]} ${count[tab]}` : TAB_LABEL[tab], view.tab === tab, (cx) => view.setTab(tab, cx), t)))
    .child(div().flex_1())
    .when(Boolean(view.busy), (e) => e.child(note(`${view.busy}…`, t, t.working)))
    .when(Boolean(repo), (e) => e
      .when(repo.ahead + repo.behind > 0, (e) => e.child(note(`↑${repo.ahead} ↓${repo.behind}`, t, t.muted)))
      .child(button("sync-fetch", "Fetch", (cx) => view.sync("fetch", cx), t, "", !view.busy))
      .child(button("sync-pull", "Pull", (cx) => view.sync("pull", cx), t, "", !view.busy && Boolean(repo.upstream)))
      .child(button("sync-push", repo.upstream ? "Push" : "Publish branch", (cx) => view.sync("push", cx), t, "", !view.busy && Boolean(repo.branch) && repo.hasHead)));
  const below = repo ? dock(view, t) : null;
  return v_flex().id("git-herdr").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
    .on_size_change((size, cx) => { if (size.width !== view.width) { view.width = size.width; cx.notify(); } })
    .child(header)
    .when(Boolean(view.note), (e) => e.child(h_flex().flex_none().px(12).py(5).gap(8).border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(view.note.error ? t.ansi1 : t.ansi2).child(view.note.text))
      .child(link("note-close", "Dismiss", (cx) => { view.note = null; cx.notify(); }, t))))
    .child(repo ? BODIES[view.tab](view, t, cx) : empty(view.error ?? "Loading…", t))
    .when(Boolean(below), (e) => e.child(below));
}
