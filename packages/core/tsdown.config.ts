import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts", "src/kit.ts", "src/browser-guard.ts"],
  format: "esm",
  dts: true,
  minify: false,
})
