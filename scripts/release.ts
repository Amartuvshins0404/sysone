import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const dry = process.argv.includes("--dry-run")
const order = ["core", "react", "sql", "drizzle", "prisma", "mongo"]
const dirs = readdirSync(join(root, "packages"))
const unknown = dirs.filter((d) => !order.includes(d))
if (unknown.length) throw new Error(`add ${unknown.join(", ")} to the release order in scripts/release.ts`)

const packages = order.map((dir) => {
  const { name, version } = JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"))
  return { dir, name: name as string, version: version as string }
})

const versions = new Set(packages.map((p) => p.version))
if (versions.size !== 1) throw new Error(`all packages must share one version, found ${[...versions].join(", ")}`)
const version = packages[0]!.version

const published = (name: string) => spawnSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" }).stdout.trim() === version
const pending = packages.filter((p) => !published(p.name))

if (!pending.length) {
  console.log(`${version} is already on npm, nothing to publish`)
  process.exit(0)
}

const out = mkdtempSync(join(tmpdir(), "sysone-release-"))
for (const p of pending) {
  execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd: join(root, "packages", p.dir), stdio: "inherit" })
  const tarball = join(out, `${p.name.replace("@", "").replace("/", "-")}-${version}.tgz`)
  const args = ["publish", tarball, "--access", "public", dry ? "--dry-run" : "--provenance"]
  execFileSync("npm", args, { stdio: "inherit" })
}

console.log(`published ${pending.map((p) => p.name).join(", ")} at ${version}${dry ? " (dry run)" : ""}`)
