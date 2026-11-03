import { build } from "esbuild"
import { brotliCompressSync, constants } from "node:zlib"

const [entry, ...flags] = process.argv.slice(2)
if (!entry) throw new Error("usage: node bench/browser-size.ts <entry.tsx> [--forbid=zod,drizzle-orm]")
const forbid = (flags.find((f) => f.startsWith("--forbid="))?.slice(9) ?? "").split(",").filter(Boolean)

const r = await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  conditions: ["browser"],
  external: ["react", "react-dom", "react/jsx-runtime"],
  write: false,
  metafile: true,
  logLevel: "silent",
  jsx: "automatic",
})

const code = r.outputFiles[0]!.contents
const brotli = brotliCompressSync(code, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const pkgOf = (p: string) => p.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/)?.[1] ?? "(local)"
const byPkg = new Map<string, number>()
for (const [path, input] of Object.entries(r.metafile.outputs[Object.keys(r.metafile.outputs)[0]!]!.inputs))
  byPkg.set(pkgOf(path), (byPkg.get(pkgOf(path)) ?? 0) + input.bytesInOutput)

console.log(`${entry}: ${(code.length / 1024).toFixed(2)} KB min, ${(brotli / 1024).toFixed(2)} KB brotli`)
for (const [pkg, bytes] of [...byPkg].sort((a, b) => b[1] - a[1])) console.log(`  ${pkg.padEnd(28)} ${(bytes / 1024).toFixed(2)} KB min`)
const bad = forbid.filter((p) => byPkg.has(p))
if (bad.length) {
  console.error(`forbidden in browser bundle: ${bad.join(", ")}`)
  process.exit(1)
}
