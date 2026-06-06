import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ['lib/**/*', 'dist/**/*', '.coverage/**/*', '.tmp-compat/**/*'],
  },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // CommonJS require-hook helper legitimately uses require().
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
