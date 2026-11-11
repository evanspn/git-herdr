// Every read and write of the review session (<repo>/.herdr/review-session), the repository's
// checklists (<repo>/.herdr/reviews) and the rendered diagrams (kept under the app's folder).
import { exec, readTextFile, appHome } from "herdr";
import * as fs from "fs/promises";
import { put, listFiles } from "./git.js";
import { hash } from "./model.js";
import { CHECKLIST_DIR, SESSION_DIR, toStore, storeText, toFindings, parseChecklist, sessionReadme } from "./review.js";
import { BUNDLED } from "./checklists.js";

export const sessionDir = (root) => `${root}/${SESSION_DIR}`;

// Creates the session folder: ignored by git, and self-describing for any agent.
export async function ensureSession(root) {
  const dir = sessionDir(root);
  await put(`${dir}/.gitignore`, "*\n");
  await put(`${dir}/README.md`, sessionReadme(dir));
  return dir;
}

// A snapshot of the session. Nothing here creates a file, and anything missing reads as empty.
export async function loadSession(root) {
  const dir = sessionDir(root);
  const [threads, findings] = await Promise.all([readTextFile(`${dir}/threads.json`), readTextFile(`${dir}/findings.json`)]);
  // Without exclude flags ls-files lists ignored files too, which the session's are.
  const files = await listFiles(root, ["--cached", "--others", "--", CHECKLIST_DIR, `${SESSION_DIR}/diagrams`]).catch(() => []);
  const checklists = new Map(), diagrams = [];
  for (const [file, text] of Object.entries(BUNDLED)) { const c = parseChecklist(file, text, "bundled"); checklists.set(c.id, { ...c, path: `${dir}/checklists/${file}` }); }
  for (const file of files.sort()) {
    const text = await readTextFile(`${root}/${file}`).catch(() => null);
    if (text === null) continue;
    if (file.startsWith(`${CHECKLIST_DIR}/`) && /\.md$/i.test(file)) { const c = parseChecklist(file, text, "repo"); checklists.set(c.id, { ...c, path: `${root}/${file}` }); }
    else if (file.endsWith(".mmd")) diagrams.push({ name: file.split("/").pop(), path: `${root}/${file}`, source: text });
  }
  return { store: toStore(threads), found: toFindings(findings), checklists: [...checklists.values()], diagrams };
}

export async function saveStore(root, store) {
  await ensureSession(root);
  await put(`${sessionDir(root)}/threads.json`, storeText(store));
}

// Writes a task for an agent into the session and returns its path. The bundled checklists it
// names are written beside it, so the agent can read them by path.
export async function writeRequest(root, kind, text, checklists = []) {
  const dir = await ensureSession(root);
  for (const c of checklists) if (c.source === "bundled") await put(c.path, c.text);
  const path = `${dir}/requests/${Date.now()}-${kind}.md`;
  await put(path, text);
  return path;
}

// Copies the bundled checklists into the repository, where a team can edit and commit them.
export async function copyChecklists(root) {
  for (const [file, text] of Object.entries(BUNDLED)) {
    const path = `${root}/${CHECKLIST_DIR}/${file}`;
    if ((await readTextFile(path)) === null) await put(path, text);
  }
}

export const MERMAID_KEY = "git-herdr.mermaid";
const RENDERERS = [["mmdc"], ["npx", "-y", "@mermaid-js/mermaid-cli"]];

// Renders a diagram with Mermaid's own renderer into a PNG under the app's folder and returns
// the path `image()` takes. Rendered once per source and appearance. Throws Mermaid's error for
// a diagram it cannot draw, and `no-renderer` when no renderer could be started.
export async function renderDiagram(diagram, dark, command) {
  const folder = "git-herdr/diagrams", name = `${hash(`${dark}\n${diagram.source}`)}.png`;
  const dir = `${appHome()}/${folder}`;
  await fs.mkdir(dir, { recursive: true });
  if ((await fs.readdir(dir).catch(() => [])).includes(name)) return `${folder}/${name}`;
  const args = ["-i", diagram.path, "-o", `${dir}/${name}`, "-b", "transparent", "-t", dark ? "dark" : "default", "-s", "2", "-q"];
  for (const [program, ...first] of command ? [command] : RENDERERS) {
    let r;
    try { r = await exec(program, [...first, ...args], { timeout: 180000 }); } catch { continue; }
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").slice(0, 12).join("\n") || "Mermaid could not draw this diagram");
    return `${folder}/${name}`;
  }
  throw new Error("no-renderer");
}
