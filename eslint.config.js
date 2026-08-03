import plugin from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
    languageOptions: { parser },
    plugins: { "@typescript-eslint": plugin },
    rules: { "@typescript-eslint/no-unused-vars": "error" },
  },
];
