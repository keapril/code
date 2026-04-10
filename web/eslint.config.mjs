import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  // 使用最基本的 Next.js 規則，避免 v15 模組路徑的相容性問題
  globalIgnores([
    ".next/**",
    ".vercel/**",
    "out/**",
    "build/**",
    "node_modules/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
