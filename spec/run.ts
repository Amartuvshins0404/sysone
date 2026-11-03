import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

interface Case {
  readonly name: string
  readonly request: { readonly method?: string; readonly path: string; readonly headers?: Record<string, string>; readonly body?: unknown }
  readonly status: number
  readonly body?: unknown
  readonly save?: Record<string, string>
}

const base = process.argv[2]?.replace(/\/+$/, "")
if (!base) {
  console.error("usage: node spec/run.ts <baseUrl> [file-filter]")
  process.exit(2)
}
const only = process.argv[3]
const dir = join(import.meta.dirname, "cases")
const vars: Record<string, unknown> = {}

const fill = (s: string, encode: boolean) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`no saved value "${k}"`)
    return encode ? encodeURIComponent(String(vars[k])) : String(vars[k])
  })

function mismatch(actual: unknown, expected: unknown, at: string): string | null {
  if (expected === "$any") return actual === undefined ? `${at}: missing` : null
  if (expected === "$string") return typeof actual === "string" ? null : `${at}: expected a string, got ${JSON.stringify(actual)}`
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${at}: expected an array, got ${JSON.stringify(actual)}`
    if (actual.length !== expected.length) return `${at}: expected ${expected.length} items, got ${actual.length} ${JSON.stringify(actual)}`
    for (let i = 0; i < expected.length; i++) {
      const m = mismatch(actual[i], expected[i], `${at}[${i}]`)
      if (m) return m
    }
    return null
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return `${at}: expected an object, got ${JSON.stringify(actual)}`
    for (const [k, v] of Object.entries(expected)) {
      const a = (actual as Record<string, unknown>)[k]
      if (v === "$absent") {
        if (k in actual) return `${at}.${k}: expected absent, got ${JSON.stringify(a)}`
        continue
      }
      const m = mismatch(a, v, `${at}.${k}`)
      if (m) return m
    }
    return null
  }
  return actual === expected ? null : `${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
}

const get = (value: unknown, path: string) => path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], value)

async function check(c: Case): Promise<string | null> {
  const body = c.request.body === undefined ? undefined : fill(JSON.stringify(c.request.body), false)
  const res = await fetch(base + fill(c.request.path, true), {
    method: c.request.method ?? "GET",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...c.request.headers },
    body,
  })
  const text = await res.text()
  let json: unknown = text
  if (res.headers.get("content-type")?.includes("json") && text) json = JSON.parse(text)
  if (res.status !== c.status) return `status: expected ${c.status}, got ${res.status} ${text.slice(0, 300)}`
  const m = c.body === undefined ? null : mismatch(json, c.body, "body")
  if (m) return m
  for (const [k, path] of Object.entries(c.save ?? {})) vars[k] = get(json, path)
  return null
}

let passed = 0
let failed = 0
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && (!only || f.includes(only))).sort()) {
  const cases = (JSON.parse(readFileSync(join(dir, file), "utf8")) as { cases: Case[] }).cases
  for (const c of cases) {
    let error: string | null
    try {
      error = await check(c)
    } catch (e) {
      error = (e as Error).message
    }
    if (error) {
      failed++
      console.log(`FAIL  ${file} › ${c.name}\n      ${error}`)
    } else passed++
  }
}
console.log(`${passed} passed, ${failed} failed against ${base}`)
process.exit(failed ? 1 : 0)
