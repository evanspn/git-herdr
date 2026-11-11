// Every git command the mod runs. Reads take no locks and refresh no index, so the folder watch
// does not see them and start the next refresh.
import { exec, readTextFile, writeTextFile, appHome } from "herdr";
import {
  parseStatus, parseDiff, additionDiff, splitDiffs, parseLog, parseBranches, parseStashes,
  LOG_FORMAT, BRANCH_FORMAT, STASH_FORMAT,
} from "./model.js";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const DIFF = ["--no-color", "--no-ext-diff", "--no-textconv"];
const SLOW = 180000; // fetch, pull and push talk to a remote

// Replaces a file with `text` whatever it holds: writeTextFile needs the current text.
export async function put(path, text) {
  const current = await readTextFile(path);
  if (current !== text) await writeTextFile(path, text, current);
}

// Runs git and returns its output; a failure throws what git said.
export async function git(root, args, timeout) {
  const r = await exec("git", args, { cwd: root, timeout });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `git ${args[0]} failed`);
  return r.stdout;
}
export const read = (root, args) => git(root, [...READ, ...args]);
const quiet = async (root, args) => { try { return (await read(root, args)).trim(); } catch { return null; } };

export async function findRoot(cwd) {
  try {
    const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
    return r.code === 0 ? r.stdout.trim() : null;
  } catch { return null; }
}

export async function loadRepo(root) {
  const status = parseStatus(await read(root, ["status", "--porcelain=v1", "-b", "-z", "--no-renames", "--untracked-files=all"]));
  const hasHead = (await quiet(root, ["rev-parse", "--verify", "-q", "HEAD"])) !== null;
  return { root, name: root.split(/[\\/]/).pop(), hasHead, ...status, limited: status.files.length > 2000, files: status.files.slice(0, 2000) };
}

// One file's diff: the staged side, or what the working tree adds to it.
export async function loadDiff(root, file, staged) {
  if (!staged && file.untracked) {
    const text = await readTextFile(`${root}/${file.path}`).catch(() => null);
    if (text === null) return { message: "Cannot preview this file (binary, too large, or unreadable)" };
    if (text.includes("\0")) return { message: "Binary file" };
    return { diff: additionDiff(file.path, text.slice(0, 400000)) };
  }
  const out = await read(root, ["diff", ...(staged ? ["--cached"] : []), ...DIFF, "--", file.path]);
  const diff = parseDiff(out);
  return diff.hunks.length ? { diff } : { message: diff.whole ? "Binary file changed" : "No text changes to show" };
}

// Applies a patch built by model.buildPatch. Staging and unstaging touch the index only.
export async function applyPatch(root, patch, { cached, reverse }) {
  const path = `${appHome()}/git-herdr/patch.diff`;
  await put(path, patch);
  await git(root, ["apply", ...(cached ? ["--cached"] : []), ...(reverse ? ["-R"] : []), "--whitespace=nowarn", path]);
}

export const stage = (root, paths) => git(root, ["add", "-A", "--", ...paths]);
export const unstage = (root, paths, hasHead) => git(root, hasHead ? ["reset", "-q", "HEAD", "--", ...paths] : ["rm", "--cached", "-q", "-r", "--", ...paths]);
export const discard = (root, file) => git(root, file.untracked ? ["clean", "-f", "-q", "--", file.path] : ["checkout", "-q", "--", file.path]);
export function commit(root, { summary, body, amend }) {
  const args = ["commit", ...(amend ? ["--amend"] : [])];
  if (summary) args.push("-m", summary); else args.push("--no-edit");
  if (summary && body) args.push("-m", body);
  return git(root, args);
}

export const fetch = (root) => git(root, ["fetch", "--prune"], SLOW);
export const pull = (root) => git(root, ["pull", "--ff-only"], SLOW);
export const push = (root, repo) => git(root, repo.upstream ? ["push"] : ["push", "-u", "origin", repo.branch], SLOW);

export const loadLog = async (root) => parseLog(await read(root, ["log", "-n", "200", `--format=${LOG_FORMAT}`]));
export const loadCommit = async (root, hash) => splitDiffs(await read(root, ["show", ...DIFF, "--format=", hash]));
export const loadBranches = async (root) => parseBranches(await read(root, ["for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads", "refs/remotes"]));
export const loadStashes = async (root) => parseStashes(await read(root, ["stash", "list", `--format=${STASH_FORMAT}`]));
export const listFiles = async (root, args) => (await read(root, ["ls-files", "-z", ...args])).split("\0").filter(Boolean);
export const loadTree = (root) => listFiles(root, ["--cached", "--others", "--exclude-standard"]);

export const switchTo = (root, name) => git(root, ["switch", name]);
export const createBranch = (root, name) => git(root, ["switch", "-c", name]);
export const track = (root, remote) => git(root, ["switch", "--track", remote]);
export const deleteBranch = (root, name) => git(root, ["branch", "-d", name]);
export const stash = (root, message) => git(root, ["stash", "push", "-u", ...(message ? ["-m", message] : [])]);
export const stashDo = (root, verb, ref) => git(root, ["stash", verb, ref]);

// The branch a review of "this branch" compares against: the remote's default, else main or master.
export async function baseBranch(root) {
  const remote = await quiet(root, ["rev-parse", "--abbrev-ref", "origin/HEAD"]);
  if (remote) return remote;
  for (const name of ["main", "master"]) if ((await quiet(root, ["rev-parse", "--verify", "-q", name])) !== null) return name;
  return "HEAD~1";
}
