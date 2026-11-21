import { registerHooks } from "node:module";

// Next supplies the `server-only` marker at build time; Node tests resolve it to a module with no runtime behavior.
// Import this first, then load server-only modules with `await import(...)`: static imports resolve before it registers.
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "server-only") {
            return nextResolve("node:assert", context);
        }
        return nextResolve(specifier, context);
    },
});
