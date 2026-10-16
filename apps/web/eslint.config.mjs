import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // every drop-down list is searchable by typing (owner's request, 16 October 2026): components/select.tsx is the
    // only place a plain <select> is written
    files: ["src/**/*.tsx"],
    ignores: ["src/components/select.tsx"],
    rules: {
      "react/forbid-elements": ["error", { forbid: [{ element: "select", message: "use <Select> from @/components/select, so the list can be searched by typing" }] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
