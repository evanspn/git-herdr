// Points the mod's host imports (gpui-kit, gpui-base, herdr) at the stubs in this folder.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
