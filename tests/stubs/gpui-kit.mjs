// A stand-in for gpui-kit's builders: every styling call chains and is forgotten; ids, clicks,
// text and children are kept, so a test can find an element, read it and click it.
// It accepts any method name, so it cannot catch a misspelt one: only `herdr-app check` can.
export class Node {
  constructor(kind) { this.kind = kind; this.children_ = []; this.id_ = null; this.click = null; this.state = null; }
}

// Herdr draws a virtual list's rows inside layout, where handlers and ids throw; so does this stand-in.
export const layout = { inRows: false };
const noHandlers = (name) => { if (layout.inRows) throw new Error(`${name}() inside a virtual list's row renderer: use on_item_click on the list`); };

const KEPT = {
  id(node, value) { noHandlers("id"); node.id_ = value; },
  on_click(node, handler) { noHandlers("on_click"); node.click = handler; },
  on_item_click(node, handler) { node.itemClick = handler; },
  hover(_node) { noHandlers("hover"); },
  on_mouse_down(_node) { noHandlers("on_mouse_down"); },
  on_size_change(node, handler) { node.resize = handler; },
  child(node, child) { node.children_.push(child); },
  children(node, list) { node.children_.push(...list); },
  when(node, condition, build, proxy) { if (condition) build(proxy); },
};

export function element(kind, state = null) {
  const node = new Node(kind);
  node.state = state;
  const proxy = new Proxy(node, {
    get(target, name) {
      if (name in target || typeof name === "symbol") return target[name];
      return (...args) => { KEPT[name]?.(target, ...args, proxy); return proxy; };
    },
  });
  return proxy;
}

export const div = () => element("div");
export const svg = () => element("svg");
export const image = () => element("image");

export class View {}

// Every element under `root`, depth first.
export function walk(root, visit) {
  if (!(root instanceof Node)) return;
  visit(root);
  for (const child of root.children_) walk(child, visit);
}

export function find(root, id) {
  let found = null;
  walk(root, (node) => { if (node.id_ === id) found = node; });
  return found;
}

export function texts(root) {
  const out = [];
  const collect = (node) => {
    if (typeof node === "string") out.push(node);
    else if (node instanceof Node) node.children_.forEach(collect);
  };
  collect(root);
  return out;
}
