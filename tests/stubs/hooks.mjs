const STUBS = { "gpui-kit": "./gpui-kit.mjs", "gpui-base": "./gpui-base.mjs", herdr: "./herdr.mjs" };

export function resolve(specifier, context, next) {
  const stub = STUBS[specifier];
  return stub ? { url: new URL(stub, import.meta.url).href, shortCircuit: true } : next(specifier, context);
}
