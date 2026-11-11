// The review session's rules: comments, findings, threads, checklists and the tasks handed to an
// agent. No Herdr imports. The session is plain files, so any agent harness can take part.
import { anchorKey } from "./model.js";

export const CHECKLIST_DIR = ".herdr/reviews";          // committed with the repository
export const SESSION_DIR = ".herdr/review-session";     // local, ignored by git
export const SEVERITIES = ["high", "medium", "low", "note"];
export const SCOPES = [
  { id: "uncommitted", label: "Uncommitted", about: "every uncommitted change", command: "git diff HEAD (and the untracked files in git status)" },
  { id: "staged", label: "Staged", about: "the staged changes only", command: "git diff --cached" },
  { id: "branch", label: "Branch", about: "everything on this branch that its base lacks", command: null },
  { id: "commit", label: "Last commit", about: "the last commit", command: "git show HEAD" },
];

const text = (value) => typeof value === "string" ? value : value == null ? "" : String(value);
const list = (value) => Array.isArray(value) ? value : [];
export function parseJson(raw, fallback) { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }

// threads.json, owned by the mod: the person's comments, their replies, and what they decided
// about each finding. Anything malformed reads as empty.
export function toStore(raw) {
  const data = parseJson(raw, {}) ?? {};
  return {
    comments: list(data.comments).filter((c) => c && c.id && c.file).map((c) => ({
      id: text(c.id), file: text(c.file), side: c.side === "old" ? "old" : "new", line: Number(c.line) || 1,
      text: text(c.text), ref: c.ref ? text(c.ref) : null, body: text(c.body), at: Number(c.at) || 0,
      status: ["open", "resolved"].includes(c.status) ? c.status : "open", sent: Boolean(c.sent),
    })),
    replies: list(data.replies).filter((r) => r && r.thread).map((r) => ({ thread: text(r.thread), body: text(r.body), at: Number(r.at) || 0, sent: Boolean(r.sent) })),
    marks: data.marks && typeof data.marks === "object" ? { ...data.marks } : {},
    sentMarks: data.sentMarks && typeof data.sentMarks === "object" ? { ...data.sentMarks } : {},
  };
}
export const storeText = (store) => JSON.stringify(store, null, 2) + "\n";

// findings.json, owned by the agent: what it found, and its answers to the person's threads.
export function toFindings(raw) {
  const data = parseJson(raw, {}) ?? {};
  const findings = list(Array.isArray(data) ? data : data.findings).filter((f) => f && f.file).map((f, i) => ({
    id: text(f.id) || `f${i + 1}`, file: text(f.file).replace(/^\.\//, ""), line: Math.max(1, Number(f.line) || 1),
    severity: SEVERITIES.includes(f.severity) ? f.severity : "note", title: text(f.title), body: text(f.body),
    checklist: text(f.checklist), suggestion: text(f.suggestion),
  }));
  const replies = list(data.replies).filter((r) => r && r.thread && r.body).map((r) => ({ thread: text(r.thread), body: text(r.body) }));
  return { findings, replies };
}

export function nextId(store) {
  const used = store.comments.map((c) => Number(/^c(\d+)$/.exec(c.id)?.[1] ?? 0));
  return `c${Math.max(0, ...used) + 1}`;
}
export const addComment = (store, comment, now) => ({ ...store, comments: [...store.comments, { ...comment, id: nextId(store), at: now, status: "open", sent: false }] });
export const addReply = (store, thread, body, now) => ({ ...store, replies: [...store.replies, { thread, body, at: now, sent: false }] });
export const removeComment = (store, id) => ({ ...store, comments: store.comments.filter((c) => c.id !== id), replies: store.replies.filter((r) => r.thread !== id) });
// open, accepted (the agent is asked to fix it), resolved, dismissed.
export function setStatus(store, thread, status) {
  if (thread.kind === "comment") return { ...store, comments: store.comments.map((c) => c.id === thread.id ? { ...c, status } : c) };
  return { ...store, marks: { ...store.marks, [thread.id]: status } };
}

// Every thread, the person's and the agent's, with its messages in order.
export function threads(store, found) {
  const messages = (id) => [
    ...store.replies.filter((r) => r.thread === id).map((r) => ({ from: "you", body: r.body, at: r.at, sent: r.sent })),
    ...found.replies.filter((r) => r.thread === id).map((r) => ({ from: "agent", body: r.body, at: null, sent: true })),
  ];
  const mine = store.comments.map((c) => ({
    kind: "comment", id: c.id, file: c.file, side: c.side, line: c.line, text: c.text, ref: c.ref, from: "you",
    title: "", body: c.body, status: c.status, sent: c.sent, messages: messages(c.id),
  }));
  const theirs = found.findings.map((f) => ({
    kind: "finding", id: f.id, file: f.file, side: "new", line: f.line, text: "", ref: null, from: "agent",
    title: f.title, body: f.body, severity: f.severity, checklist: f.checklist, suggestion: f.suggestion,
    status: store.marks[f.id] ?? "open", sent: store.sentMarks[f.id] === "accepted", messages: messages(f.id),
  }));
  return [...mine, ...theirs];
}
export const isOpen = (thread) => thread.status === "open" || thread.status === "accepted";

// What the agent has not been told yet: a new comment, a new reply, a finding just accepted.
export const pending = (all) => all.filter((t) => isOpen(t) && (
  (t.kind === "comment" && !t.sent) || (t.kind === "finding" && t.status === "accepted" && !t.sent) || t.messages.some((m) => m.from === "you" && !m.sent)));

// The store once everything pending has been handed over.
export function markSent(store, sent) {
  const ids = new Set(sent.map((t) => t.id)), marks = { ...store.sentMarks };
  for (const t of sent) if (t.kind === "finding" && t.status === "accepted") marks[t.id] = "accepted";
  return {
    ...store, sentMarks: marks,
    comments: store.comments.map((c) => ids.has(c.id) ? { ...c, sent: true } : c),
    replies: store.replies.map((r) => ids.has(r.thread) ? { ...r, sent: true } : r),
  };
}

// Open threads by where they sit, for the code views.
export function byAnchor(all) {
  const map = new Map();
  for (const t of all) {
    if (!isOpen(t)) continue;
    const key = anchorKey(t.file, t.side, t.line);
    map.set(key, [...(map.get(key) ?? []), t]);
  }
  return map;
}

// A checklist is a skill file: optional frontmatter (name, description), then markdown with
// `- [ ]` items.
export function parseChecklist(file, raw, source) {
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const meta = {};
  for (const line of (front?.[1] ?? "").split("\n")) { const m = /^(\w[\w-]*):\s*(.*)$/.exec(line); if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
  const body = front ? raw.slice(front[0].length) : raw;
  const id = file.replace(/\.md$/i, "").split("/").pop();
  return {
    id, source, file, name: meta.name || /^#\s+(.+)$/m.exec(body)?.[1] || id, description: meta.description || "",
    items: (body.match(/^\s*[-*] \[[ xX]\] /gm) ?? []).length, text: raw,
  };
}

// A diagram file: Mermaid source, titled by a first-line `%% title: ...` comment.
export const diagramTitle = (name, source) => /^\s*%%\s*title:\s*(.+)$/m.exec(source)?.[1].trim() || name.replace(/\.mmd$/, "").replace(/[-_]/g, " ");

const scopeLine = (scope, base) => {
  const s = SCOPES.find((x) => x.id === scope) ?? SCOPES[0];
  return `${s.about}. See it with: ${s.command ?? `git diff ${base}...HEAD`}`;
};
const FINDINGS_SHAPE = `{
  "findings": [
    { "id": "f1", "file": "path/from/repo/root.js", "line": 42, "severity": "high | medium | low | note",
      "title": "one line", "body": "what is wrong and why it matters", "checklist": "the checklist's name",
      "suggestion": "optional: the fix, in words or code" }
  ],
  "replies": [ { "thread": "c1", "body": "your answer to that thread" } ]
}`;

// What the session folder tells any agent that opens it.
export const sessionReadme = (dir) => `# Review session

This folder is a local code review between a person and a coding agent, kept by the Git Herdr
panel. It is ignored by git. Paths inside the files are relative to the repository root.

- \`threads.json\`: the person's inline comments, replies and decisions. Read it; never write it.
- \`findings.json\`: yours. Your findings and your replies to the person's threads, in this shape:

\`\`\`json
${FINDINGS_SHAPE}
\`\`\`

  Keep what is already there: read the file, add to its arrays, write it back as valid JSON.
  \`line\` is a line number in the file as it is now. Give each finding a new id.
- \`diagrams/<name>.mmd\`: Mermaid diagrams of a change, one per file, with a first line
  \`%% title: <what it shows>\`. The panel renders them.
- \`checklists/\`, and \`${CHECKLIST_DIR}/\` in the repository: review checklists.
- \`requests/\`: the tasks the panel has handed over, newest last.

Folder: ${dir}
`;

export function reviewTask({ root, dir, scope, base, checklists }) {
  return `# Review request

Review the changes in the repository at ${root}: ${scopeLine(scope, base)}

Work through each of these checklists, item by item, against the changed code. Read the
surrounding code where an item needs it.

${checklists.map((c) => `- ${c.name}: ${c.path}`).join("\n")}

Write what you find to ${dir}/findings.json, as described in ${dir}/README.md: one finding per
problem, on the exact file and line, naming the checklist it came from. Report only real problems
in the changed code, most serious first; an item that passes needs no finding. Do not change any
code in this task. When done, say how many findings you wrote and stop.
`;
}

export function commentsTask({ root, dir, items }) {
  const block = (t) => {
    const where = `${t.file}:${t.line}${t.side === "old" ? " (removed line)" : ""}${t.ref ? ` in commit ${t.ref}` : ""}`;
    const head = t.kind === "comment" ? `Comment ${t.id} on ${where}` : `Finding ${t.id} on ${where}, accepted: fix it`;
    const first = t.kind === "comment" ? `Person: ${t.body}` : `Finding: ${t.title}${t.body ? `\n${t.body}` : ""}${t.suggestion ? `\nSuggested: ${t.suggestion}` : ""}`;
    return [`## ${head}`, t.text ? `Line: \`${t.text.trim()}\`` : "", first, ...t.messages.map((m) => `${m.from === "you" ? "Person" : "You"}: ${m.body}`)].filter(Boolean).join("\n");
  };
  return `# Review comments

The person reviewed code in the repository at ${root} and left the threads below. For each one:
make the change it asks for, or answer the question. Keep each change to what the thread asks.
Then add a reply for every thread to "replies" in ${dir}/findings.json (shape in
${dir}/README.md), using the thread's id, saying what you changed or answering. Do not commit.

${items.map(block).join("\n\n")}
`;
}

export function diagramTask({ root, dir, scope, base }) {
  return `# Change map request

Draw the changes in the repository at ${root} as Mermaid diagrams: ${scopeLine(scope, base)}

Read the changed code first. Write one to three diagrams, each to its own file in
${dir}/diagrams/ named <short-name>.mmd, replacing files there that no longer describe the change:

- an overview: the files or modules touched and how they depend on each other, with what changed
  in each as its label;
- where it helps, the main flow the change alters (flowchart or sequenceDiagram), showing what
  is new or different.

Each file is Mermaid source only, no markdown fences, starting with \`%% title: <what it shows>\`.
Mark added parts with \`classDef added fill:#1f6f43,color:#fff\`, changed parts with
\`classDef changed fill:#8a6d1a,color:#fff\` and removed parts with
\`classDef removed fill:#8b2f2f,color:#fff\`. Use only names that exist in the code. Quote any
label holding punctuation: A["render(cx)"]. Keep each diagram under about 25 nodes. Do not
change any code.
`;
}

// The one line sent to the agent: the full task is in a file, so no harness has to take a
// multi-line paste.
export const pointer = (path) => `Read ${path} and do what it asks.`;
