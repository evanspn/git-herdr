// The review checklists that ship with the mod. Each is a skill file: frontmatter, then items.
// A repository adds its own, or replaces one by name, under .herdr/reviews/.
const skill = (name, description, title, intro, items) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${title}\n\n${intro}\n\n${items.map((i) => `- [ ] ${i}`).join("\n")}\n`;

export const BUNDLED = {
  "correctness.md": skill("correctness", "Does the change do what it means to, on every path.", "Correctness",
    "Check the changed code against what it is meant to do. Trace each changed branch by hand.", [
      "Each changed function does what its name, comment and callers expect, including for empty, zero, null and very large inputs.",
      "Every error a call can return or throw is handled or deliberately passed on; none is swallowed.",
      "Conditions are right at their edges: off-by-one, inclusive against exclusive, negated tests.",
      "Async work is awaited, cannot run twice at once where that would break state, and cleans up when it fails.",
      "State changed in one place is still valid everywhere it is read; no caller relied on the old behaviour.",
      "Nothing left behind: debug output, commented-out code, TODOs that the change was meant to finish.",
    ]),
  "security.md": skill("security", "Could the change be abused, or leak something.", "Security",
    "Assume every input can come from someone hostile.", [
      "Input from users, files, the network or the environment is validated before it reaches a shell, a query, a path, HTML or an eval.",
      "No secret, token, key or personal data is added to the code, logs, error messages or test fixtures.",
      "Every new endpoint, command or file access checks who is asking and what they may do.",
      "Paths cannot escape their folder; programs are run with argument arrays, not built shell strings.",
      "New dependencies are needed, maintained and pinned.",
    ]),
  "tests.md": skill("tests", "Is the change proven by tests that would fail without it.", "Tests",
    "Read the tests as carefully as the code.", [
      "Each new behaviour and each fixed bug has a test that fails without the change.",
      "Tests assert results, not just that the code ran; no assertion was weakened or removed to pass.",
      "Edge cases and the failure path are tested, not only the expected input.",
      "Tests do not depend on time, order, the network or each other.",
      "No test was skipped or disabled.",
    ]),
  "readability.md": skill("readability", "Will the next person understand and safely change this.", "Readability",
    "Judge the change as someone who has never seen it.", [
      "Names say what things are; nothing is named for how it used to work.",
      "Each function does one thing at one level; long or deeply nested ones are split.",
      "No duplicated logic that an existing helper already covers.",
      "Comments explain why, and are true; public behaviour that changed is documented.",
      "The change is no bigger than its purpose: no unrelated edits or reformatting.",
    ]),
};
