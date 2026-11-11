import { element, layout } from "./gpui-kit.mjs";

export const v_flex = () => element("v_flex");
export const h_flex = () => element("h_flex");
// Draws every row, so a test can find any of them.
export const v_virtual_list = (id, count, _height, key, rows) => {
  layout.inRows = true;
  let drawn;
  try { drawn = rows({ start: 0, end: count }); } finally { layout.inRows = false; }
  const list = element("list").id(id).children(drawn);
  list.keys = Array.from({ length: count }, (_, i) => key(i));
  return list;
};
export const Scrollbar = { vertical: () => element("scrollbar") };

class TextState {
  constructor(options = {}) { this.text = options.value ?? ""; this.handlers = {}; }
  value() { return this.text; }
  set_value(text) { this.text = text; }
  on(event, handler) { this.handlers[event] = handler; }
  focus() {}
  // For tests: what the person does.
  type(text, cx) { this.text = text; this.handlers.change?.({}, cx); }
  submit(cx) { this.handlers.submit?.({}, cx); }
}

export class InputState extends TextState { static new(options) { return new InputState(options); } }
export class TextareaState extends TextState { static new(options) { return new TextareaState(options); } }
export const Input = { new: (state) => element("input", state) };
export const Textarea = { new: (state) => element("textarea", state) };
