import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Deno Edge Functions may import npm: specifiers that the Node type program cannot resolve; such a file may opt
    // out of type checking only with a stated reason.
    files: ["supabase/functions/**/*.ts"],
    rules: { "@typescript-eslint/ban-ts-comment": ["error", { "ts-nocheck": "allow-with-description" }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".open-next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "nightly-gateway/worker-configuration.d.ts",
  ]),
]);

export default eslintConfig;
