// The drawing pieces every tab shares. Each takes the theme `t` and returns an element.
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, Textarea } from "gpui-base";

// A button. `kind`: "primary" for a group's main action, "danger" for one that loses work.
// A disabled button draws dim and does nothing.
export function button(id, text, onClick, t, kind = "", enabled = true) {
  const primary = kind === "primary" && enabled;
  return h_flex().id(id).h(26).px(10).flex_none().items_center().rounded(6).text_size(12).font_medium()
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(!enabled ? t.dim : primary ? t.solid_foreground : kind === "danger" ? t.ansi1 : t.foreground)
    .when(enabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)))
    .on_click((_e, cx) => { if (enabled) onClick(cx); }).child(text);
}

// A small text button inside a row.
export function link(id, text, onClick, t, color = t.muted) {
  return div().id(id).px(6).h(20).flex_none().rounded(4).cursor_pointer().text_size(11).text_color(color)
    .hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(cx)).child(text);
}

// A toggle: a tab, a scope, a checklist.
export function chip(id, text, active, onClick, t) {
  return h_flex().id(id).h(24).px(9).flex_none().items_center().rounded(6).cursor_pointer().text_size(11.5)
    .bg(active ? t.selected : t.raised).text_color(active ? t.foreground : t.muted)
    .hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(cx)).child(text);
}

export const tag = (text, t, color = t.muted) => div().px(5).h(16).flex_none().rounded(4).border_1().border_color(t.border).text_size(10).text_color(color).child(text);
export const heading = (text, t) => div().pt(6).text_size(11).font_semibold().text_color(t.muted).child(text.toUpperCase());
export const note = (text, t, color = t.dim) => div().text_size(11.5).text_color(color).child(text);
export const row = () => h_flex().gap(6).flex_wrap().items_center();

// A one-line text field around an InputState.
export function input(state, t) {
  return div().h(28).px(9).flex().items_center().rounded(6).border_1().border_color(t.input).bg(t.background)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(Input.new(state).h_full().text_size(12.5).text_color(t.foreground));
}

// A multi-line text field around a TextareaState.
export function area(state, height, t) {
  return div().h(height).px(9).py(6).rounded(6).border_1().border_color(t.input).bg(t.background)
    .text_size(12.5).text_color(t.foreground).child(Textarea.new(state));
}

// A scrolling column that fills what is left of its parent.
export const scroller = (id) => v_flex().id(id).flex_1().min_h(0).overflow_y_scrollbar();
