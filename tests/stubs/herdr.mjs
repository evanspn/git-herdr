// A stand-in for the `herdr` module over a real temporary folder: `exec` runs the real program
// (git), files are real files. Tests set `world` first.
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname } from "node:path";

export const world = { home: "", cwd: null, shared: {}, ran: [], sent: [], running: [], known: [], renderer: null };

export const home = () => world.home;
export const appHome = () => `${world.home}/.config/herdr-app`;
export const shared = (key) => world.shared[key];
export const setShared = (key, value) => { world.shared[key] = value; return null; };
export const run = (name, args) => { world.ran.push({ name, args }); return null; };
export const theme = () => new Proxy({}, { get: (_t, name) => `#${String(name)}` });
export const settings = () => ({ zoom: 1, font_family: "JetBrains Mono", dark: true });
export const spaces = () => [{ id: "s1", active: true, folder: world.cwd, machine: null }];
export const panes = () => [];
export const focused = () => ({ space: "s1", tab: "t1", pane: "p1", terminal: "t1", cwd: world.cwd });
export const agents = () => world.running;
export const knownAgents = async () => world.known;
export const nextCommand = () => new Promise(() => {});
export const watchFolder = () => new Promise(() => {});
export const hc = async (args) => { world.sent.push(args); return { code: 0, stdout: "", stderr: "" }; };

export function exec(command, args = [], options = {}) {
  if (command !== "git") {
    if (!world.renderer) return Promise.reject(new Error(`cannot start ${command}`));
    return world.renderer(command, args);
  }
  return new Promise((resolve) => {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };
    execFile("git", args, { cwd: options.cwd, env, maxBuffer: 8 << 20 }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, stdout, stderr }));
  });
}

export async function readTextFile(path) {
  try { return await fs.readFile(path, "utf8"); } catch (e) { if (e.code === "ENOENT" || e.code === "EISDIR") return null; throw e; }
}

// As the app's: a file is replaced only when `expected` is what it holds now; null creates.
export async function writeTextFile(path, text, expected) {
  const current = await readTextFile(path);
  if (current !== (expected ?? null)) throw new Error("stale snapshot");
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, text);
  return null;
}
