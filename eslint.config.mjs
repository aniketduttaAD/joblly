import nextConfig from "eslint-config-next";
import prettierConfig from "eslint-config-prettier/flat";

const config = [
  ...nextConfig,
  prettierConfig,
  {
    ignores: [".next/**", "out/**", "node_modules/**", "*.config.js", "*.config.ts", "data/**"],
  },
];

export default config;
