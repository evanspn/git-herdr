// Shapes and rules: git output parsing and patch building. No Herdr imports, so `node --test` runs it.

// Text draws a tab as nothing: pad each to the next 4-column stop.
export const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// `git status --porcelain=v1 -b -z --no-renames`: the branch line, then one entry per path.
export function parseStatus(text) {
  const out = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
  for (const entry of text.split("\0")) {
    if (!entry) continue;
    if (entry.startsWith("## ")) {
      const line = entry.slice(3);
      const none = /^No commits yet on (.+)$/.exec(line) ?? /^Initial commit on (.+)$/.exec(line);
      if (none) { out.branch = none[1]; continue; }
      const match = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(line);
      out.branch = match[1].startsWith("HEAD (no branch)") ? null : match[1];
      out.upstream = match[2] ?? null;
      out.ahead = Number(/ahead (\d+)/.exec(match[3] ?? "")?.[1] ?? 0);
      out.behind = Number(/behind (\d+)/.exec(match[3] ?? "")?.[1] ?? 0);
      continue;
    }
    const x = entry[0], y = entry[1], path = entry.slice(3);
    const untracked = x === "?", conflict = x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");
    out.files.push({
      path, x, y, untracked, conflict,
      staged: !untracked && !conflict && x !== " ",
      unstaged: untracked || conflict || y !== " ",
    });
  }
  return out;
}

// The letter a file shows in a list: `staged` picks which side of the status.
export function mark(file, staged) {
  if (file.conflict) return "U";
  if (file.untracked) return "A";
  const code = staged ? file.x : file.y;
  return code === "A" ? "A" : code === "D" ? "D" : "M";
}

// One file's unified diff: its header lines and hunks, each line numbered on both sides.
export function parseDiff(text) {
  const diff = { header: [], hunks: [], whole: false };
  let hunk = null, old = 0, next = 0;
  for (const line of text.replace(/\n$/, "").split("\n")) {
    const at = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (at) {
      old = +at[1]; next = +at[3];
      hunk = { header: line, oldStart: old, newStart: next, lines: [] };
      diff.hunks.push(hunk);
    } else if (!hunk) {
      if (line) diff.header.push(line);
    } else if (line[0] === "+") hunk.lines.push({ kind: "+", text: line.slice(1), new: next++ });
    else if (line[0] === "-") hunk.lines.push({ kind: "-", text: line.slice(1), old: old++ });
    else if (line[0] === "\\") hunk.lines.push({ kind: "\\", text: line });
    else hunk.lines.push({ kind: " ", text: line.slice(1), old: old++, new: next++ });
  }
  // A file that is created or deleted can only be staged or discarded whole.
  diff.whole = diff.header.some((l) => /^(new|deleted) file mode|^Binary files|^GIT binary patch/.test(l));
  return diff;
}

// A file with no diff to ask git for (untracked): every line is an addition.
export function additionDiff(path, text) {
  const lines = text.replace(/\n$/, "").split("\n");
  return {
    header: [`diff --git a/${path} b/${path}`, "new file mode 100644", "--- /dev/null", `+++ b/${path}`], whole: true,
    hunks: [{ header: `@@ -0,0 +1,${lines.length} @@`, oldStart: 0, newStart: 1, lines: lines.map((text, i) => ({ kind: "+", text, new: i + 1 })) }],
  };
}

// `git show` or a multi-file diff, split per file.
export function splitDiffs(text) {
  const out = [];
  for (const part of text.split(/^(?=diff --git )/m)) {
    if (!part.startsWith("diff --git ")) continue;
    const diff = parseDiff(part);
    const side = diff.header.find((l) => l.startsWith("+++ b/")) ?? diff.header.find((l) => l.startsWith("--- a/"));
    const path = side ? side.slice(6) : (/^diff --git a\/(.+?) b\//.exec(part)?.[1] ?? "?");
    out.push({ path, diff });
  }
  return out;
}

// The rows a code view draws for a diff: a row per hunk header and per line.
export function diffRows(diff) {
  const rows = [];
  diff.hunks.forEach((hunk, h) => {
    rows.push({ type: "hunk", hunk: h, text: hunk.header });
    hunk.lines.forEach((line, i) => {
      if (line.kind !== "\\") rows.push({ type: "line", hunk: h, index: i, kind: line.kind, old: line.old, new: line.new, text: untab(line.text) || " " });
    });
  });
  return rows;
}

// The rows for a whole file.
export const fileRows = (text) => text.replace(/\n$/, "").split("\n").map((line, i) => ({ type: "line", kind: " ", new: i + 1, text: untab(line) || " " }));

// A row's anchor for a comment: additions and context by their new number, removals by their old.
export const anchor = (row) => row.kind === "-" ? { side: "old", line: row.old } : { side: "new", line: row.new };
export const anchorKey = (file, side, line) => `${file}\n${side}\n${line}`;

// A patch holding only the picked changes. `picks` maps a hunk index to true (the whole hunk) or
// a Set of line indexes. Forward patches (staging) go to `git apply --cached`: an unpicked removal
// stays as context and an unpicked addition is left out. Reverse patches (unstaging, discarding)
// go to `git apply -R`, where the new side must match what is there: an unpicked addition stays
// as context and an unpicked removal is left out. Null when nothing picked changes anything.
export function buildPatch(diff, picks, reverse = false) {
  const out = [...diff.header];
  let changed = false;
  for (const [h, pick] of [...picks].sort((a, b) => a[0] - b[0])) {
    const hunk = diff.hunks[h];
    if (!hunk) continue;
    const body = [];
    let olds = 0, news = 0, kept = true, any = false;
    hunk.lines.forEach((line, i) => {
      if (line.kind === "\\") { if (kept) body.push(line.text); return; }
      const picked = pick === true || pick.has(i);
      let kind = line.kind;
      if (kind !== " " && !picked) kind = (kind === "+") === reverse ? " " : null;
      kept = kind !== null;
      if (!kept) return;
      if (kind !== "+") olds++;
      if (kind !== "-") news++;
      if (kind !== " ") any = true;
      body.push(kind + line.text);
    });
    if (!any) continue;
    changed = true;
    out.push(`@@ -${hunk.oldStart},${olds} +${hunk.newStart},${news} @@`, ...body);
  }
  return changed ? out.join("\n") + "\n" : null;
}

const SEP = "\x1f";
export const LOG_FORMAT = ["%H", "%h", "%an", "%ar", "%D", "%s"].join("%x1f") + "%x1e";
export function parseLog(text) {
  return text.split("\x1e").map((record) => record.replace(/^\n/, "")).filter(Boolean).map((record) => {
    const [hash, short, author, when, refs, subject] = record.split(SEP);
    return { hash, short, author, when, refs: refs ? refs.split(", ") : [], subject: subject ?? "" };
  });
}

export const BRANCH_FORMAT = ["%(refname)", "%(refname:short)", "%(HEAD)", "%(upstream:short)", "%(upstream:track)", "%(subject)"].join("%1f");
export function parseBranches(text) {
  const local = [], remote = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [ref, name, head, upstream, track, subject] = line.split(SEP);
    if (ref.startsWith("refs/heads/")) local.push({ name, current: head === "*", upstream: upstream || null, track: track || "", subject: subject ?? "" });
    else if (ref.startsWith("refs/remotes/") && !ref.endsWith("/HEAD")) remote.push({ name, subject: subject ?? "" });
  }
  // A remote branch that a local one already follows is not offered again.
  const followed = new Set(local.map((b) => b.upstream));
  return { local, remote: remote.filter((b) => !followed.has(b.name)) };
}

export const STASH_FORMAT = "%gd%x1f%gs";
export const parseStashes = (text) => text.split("\n").filter(Boolean).map((line) => { const [ref, subject] = line.split(SEP); return { ref, subject: subject ?? "" }; });

// A branch name git will take: no spaces, no characters refs forbid.
export const branchName = (text) => text.trim().replace(/\s+/g, "-").replace(/[~^:?*\[\\]+/g, "").replace(/\.{2,}/g, ".").replace(/^[-/.]+|[/.]+$/g, "");

// A short stable name for some text (djb2), for cache files.
export function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}
