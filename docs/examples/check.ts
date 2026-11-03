import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"

const here = import.meta.dirname
const root = resolve(here, "../..")
const out = join(here, "out")
const require = createRequire(import.meta.url)
const REPO = "https://github.com/Amartuvshins0404/sysone/blob/main/"
const problems: string[] = []

const mirrored = readFileSync(join(root, "README.md"), "utf8").replace(/\]\(\.\/([^)]*)\)/g, `](${REPO}$1)`)
const coreReadme = join(root, "packages/core/README.md")
if (process.argv.includes("--write-core-readme")) writeFileSync(coreReadme, mirrored)
if (readFileSync(coreReadme, "utf8") !== mirrored)
  problems.push("packages/core/README.md must equal README.md with ./ links made absolute. Run: pnpm --filter docs-examples check --write-core-readme")

const pages = [
  "README.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`),
  ...readdirSync(join(root, "packages"))
    .filter((p) => p !== "core")
    .map((p) => `packages/${p}/README.md`),
].filter((p) => existsSync(join(root, p)))

interface Block {
  readonly page: string
  readonly line: number
  readonly file: string
  readonly fails: string | null
}

const blocks = new Map<string, Block>()
const schemas: string[] = []

rmSync(out, { recursive: true, force: true })

for (const page of pages) {
  const lines = readFileSync(join(root, page), "utf8").split("\n")
  const dir = join(out, page.replace(/\.md$/, "").replaceAll("/", "_"))
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(\w+)/.exec(lines[i]!)
    if (!open) continue
    const lang = open[1]!
    const start = i + 1
    while (i + 1 < lines.length && !lines[i + 1]!.startsWith("```")) i++
    const code = lines.slice(start, i + 1).join("\n")
    i++
    let m = start - 2
    while (m >= 0 && !lines[m]!.trim()) m--
    const marker = /^<!-- (file|fails|skip)(?:: (.+?))? -->$/.exec(lines[m]?.trim() ?? "")
    if (marker?.[1] === "skip") continue
    if (lang !== "ts" && lang !== "tsx" && marker?.[1] !== "file") continue
    const name = marker?.[1] === "file" ? marker[2]! : `block-${++n}.${lang}`
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    if (lang !== "ts" && lang !== "tsx") {
      writeFileSync(path, code + "\n")
      if (name.endsWith(".prisma")) schemas.push(path)
      continue
    }
    writeFileSync(path, code + "\n\nexport {}\n")
    blocks.set(path, { page, line: start + 1, file: name, fails: marker?.[1] === "fails" ? (marker[2] ?? "") : null })
  }
}

for (const schema of schemas) {
  const r = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "generate", "--schema", schema], { cwd: dirname(schema), encoding: "utf8" })
  if (r.status !== 0) problems.push(`prisma generate failed for ${relative(root, schema)}\n${r.stdout}${r.stderr}`)
}

const tsc = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", join(here, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8" })
const errors = new Map<string, { line: number; text: string }[]>()
let last: { text: string } | undefined
for (const l of tsc.stdout.split("\n")) {
  const e = /^(.+?)\((\d+),\d+\): error (TS\d+: .*)$/.exec(l)
  if (e) {
    const file = resolve(here, e[1]!)
    const list = errors.get(file) ?? errors.set(file, []).get(file)!
    list.push((last = { line: Number(e[2]), text: e[3]! }) as { line: number; text: string })
  } else if (l.startsWith(" ") && last) last.text += "\n" + l.trim()
  else if (l.trim()) problems.push(`tsc: ${l}`)
}

for (const [file, list] of errors) {
  const b = blocks.get(file)
  if (!b) {
    problems.push(`${relative(root, file)} has errors outside any docs block:\n  ${list.map((e) => e.text).join("\n  ")}`)
    continue
  }
  if (b.fails !== null) continue
  for (const e of list) problems.push(`${b.page}:${b.line + e.line - 1} (${b.file}) ${e.text}`)
}

for (const [file, b] of blocks) {
  if (b.fails === null) continue
  const list = errors.get(file) ?? []
  if (!list.length) problems.push(`${b.page}:${b.line} (${b.file}) is marked "fails" but compiles`)
  else if (!list.some((e) => e.text.includes(b.fails!)))
    problems.push(`${b.page}:${b.line} (${b.file}) fails, but no error mentions "${b.fails}":\n  ${list.map((e) => e.text).join("\n  ")}`)
}

const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-")

const anchors = (page: string) => {
  const text = readFileSync(page, "utf8").replace(/```[\s\S]*?```/g, "")
  return new Set([...text.matchAll(/^#+ (.+)$/gm)].map((h) => slug(h[1]!)))
}

for (const page of pages) {
  const text = readFileSync(join(root, page), "utf8").replace(/```[\s\S]*?```/g, "")
  for (const [, link] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const inRepo = link!.startsWith(REPO)
    if (!inRepo && /^(https?:|mailto:)/.test(link!)) continue
    const target = inRepo ? link!.slice(REPO.length) : link!
    const [path, hash] = target.split("#")
    const file = !path ? join(root, page) : inRepo ? join(root, path) : resolve(dirname(join(root, page)), path)
    if (!existsSync(file)) problems.push(`${page}: broken link ${target}`)
    else if (hash && file.endsWith(".md") && !anchors(file).has(hash)) problems.push(`${page}: no heading for ${target}`)
  }
}

console.log(`checked ${blocks.size} code blocks in ${pages.length} pages, ${schemas.length} prisma schema(s)`)
if (problems.length) {
  console.log(problems.map((p) => `FAIL ${p}`).join("\n"))
  process.exit(1)
}
console.log("docs check passed")
