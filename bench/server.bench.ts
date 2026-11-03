import { bench, boxplot, run, summary } from "mitata"
import { z } from "zod"
import { defineModel, memory, sysone } from "../packages/core/dist/index.mjs"
import type { Source, Store } from "../packages/core/dist/kit.mjs"

const rows = Array.from({ length: 21 }, (_, i) => ({
  id: i + 1,
  name: `Category ${i}`,
  parentId: i % 3 ? 1 : null,
  active: i % 2 === 0,
  createdAt: new Date(2026, 0, i + 1),
}))

const store: Store = {
  find: async () => rows,
  insert: async (r) => r,
  update: async (_, r) => r,
  remove: async () => true,
}
const fixed: Source<(typeof rows)[number]> = { name: "fixed", bind: () => store }

const category = defineModel({
  name: "category",
  schema: z.object({ id: z.number().int(), name: z.string(), parentId: z.number().int().nullable(), active: z.boolean(), createdAt: z.date() }),
  search: ["name"],
  filter: ["parentId", "active"],
  sort: ["name", "createdAt"],
  access: () => ({ read: true }),
})

const project = defineModel({
  name: "project",
  schema: z.object({ id: z.number().int(), tenantId: z.string(), name: z.string(), archived: z.boolean() }),
  filter: ["archived"],
  sort: ["name"],
  access: (ctx: { tenantId: string }) => ({ read: { tenantId: ctx.tenantId } }),
})

const projects = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, tenantId: i % 2 ? "t1" : "t2", name: `Project ${i}`, archived: i % 5 === 0 }))

const app = sysone({ models: [category.from(fixed), project.from(memory(projects))] })
const tenant = { tenantId: "t1" }

async function handWritten(url: string) {
  const q = new URLSearchParams(url.slice(url.indexOf("?") + 1))
  const limit = Math.min(Number(q.get("limit") ?? 20), 100)
  const out = await store.find({ where: null, sort: [{ field: "id", dir: "asc" }], take: limit + 1, select: [] })
  const items = out.slice(0, limit).map(({ id, name, parentId, active, createdAt }) => ({ id, name, parentId, active, createdAt }))
  return { status: 200, body: { items, next: out.length > limit ? String(items.at(-1)!.id) : null } }
}

const req = (url: string) => {
  const i = url.indexOf("?")
  return {
    method: "GET",
    path: url.slice(0, i),
    query: new URLSearchParams(url.slice(i + 1)),
    body: async () => undefined,
    ctx: () => tenant,
  }
}

const simple = "/category?limit=20"
const full = "/category?search=cat&filter[parentId]=1&filter[parentId]=null&filter[active]=true&sort=-createdAt&limit=20"
const scoped = "/project?filter[archived]=false&limit=20"

const check = await app.handle(req(scoped))
const body = check?.body as { items: unknown[]; next: string | null } | undefined
if (check?.status !== 200 || body?.items.length !== 20 || !body.next) throw new Error(`scoped list did not return a full page: ${JSON.stringify(check)}`)

boxplot(() => {
  summary(() => {
    bench("hand-written list endpoint", () => handWritten(simple))
    bench("sysonejs list (no params)", () => app.handle(req(simple)))
    bench("sysonejs list (search + 3 filters + sort)", () => app.handle(req(full)))
    bench("sysonejs list (20 rows, 1 filter, scoped, memory)", () => app.handle(req(scoped)))
  })
})

const { benchmarks } = await run()
for (const b of benchmarks) for (const r of b.runs) if (r.stats) console.log(`p50 ${(r.stats.p50 / 1000).toFixed(2).padStart(6)} µs  ${r.name}`)
