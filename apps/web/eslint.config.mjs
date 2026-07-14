import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // The React Compiler rules shipped by eslint-config-next surface as hard
    // errors. They flag intentional, behavior-correct patterns here (resetting
    // state on a dependency change, a loading flag, seeding a draft from a prop,
    // a stable ref handler). Keep them as warnings so they stay visible without
    // breaking `pnpm lint` / CI. Revisit when refactoring the affected hooks.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);

export default eslintConfig;
