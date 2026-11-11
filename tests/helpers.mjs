// A temporary repository, and a stand-in for the `cx` every mod callback gets.
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec, world } from "./stubs/herdr.mjs";

export async function git(root, ...args) {
  const r = await exec("git", args, { cwd: root });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

// A repository with one commit: a.txt holding lines one to ten.
export async function makeRepo() {
  const home = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "git-herdr-")));
  const root = join(home, "repo");
  await fs.mkdir(root);
  await git(root, "init", "-q", "-b", "main");
  await fs.writeFile(join(root, "a.txt"), LINES.join("\n") + "\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "first");
  Object.assign(world, { home, cwd: root, shared: {}, ran: [], sent: [], running: [], known: [], renderer: null });
  return root;
}
export const LINES = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const write = (root, file, lines) => fs.writeFile(join(root, file), lines.join("\n") + "\n");
export const read = (root, file) => fs.readFile(join(root, file), "utf8");

// Tracks the work a view starts, so a test can wait for it to finish.
export function context() {
  const pending = new Set();
  const cx = {
    notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }), timer: { every() {} },
    spawn(work) { const p = Promise.resolve().then(() => work(cx)).finally(() => pending.delete(p)); pending.add(p); },
    // Waits until nothing the view started is still running (endless listeners aside).
    async settle() {
      for (let quiet = 0; quiet < 3;) {
        await new Promise((r) => setTimeout(r, 15));
        const before = pending.size;
        await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 400))]);
        quiet = pending.size === before ? quiet + 1 : 0;
      }
    },
  };
  return cx;
}
