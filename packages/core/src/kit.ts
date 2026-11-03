import { all, toWire, type Binding, type Cond, type FindPlan, type Row, type SortKey, type Store, type Value } from "./source"

export { expandAfter, escapeLike } from "./source"
export type { AfterKey, Binding, Cond, Dir, FieldKind, FieldSpec, FindPlan, Row, SortKey, Source, Store, Value } from "./source"

export interface Case {
  readonly name: string
  run(): Promise<void>
}

const day = (d: number) => new Date(Date.UTC(2026, 0, d))

const binding: Binding = {
  model: "item",
  id: "id",
  fields: [
    { name: "id", kind: "number", nullable: false },
    { name: "name", kind: "string", nullable: false },
    { name: "tag", kind: "string", nullable: true },
    { name: "n", kind: "number", nullable: false },
    { name: "at", kind: "date", nullable: false },
    { name: "flag", kind: "boolean", nullable: false },
  ],
}

const seed: readonly Row[] = [
  { id: 1, name: "alpha", tag: "x", n: 1, at: day(1), flag: true },
  { id: 2, name: "beta", tag: null, n: 2, at: day(2), flag: false },
  { id: 3, name: "gamma", tag: "y", n: 2, at: day(1), flag: true },
  { id: 4, name: "delta 100%", tag: "x", n: 3, at: day(3), flag: false },
  { id: 5, name: "eps_ilon", tag: null, n: 1, at: day(2), flag: true },
  { id: 6, name: "zeta\\path", tag: "y", n: 3, at: day(1), flag: true },
  { id: 7, name: "eta", tag: "x", n: 2, at: day(3), flag: false },
  { id: 8, name: "Theta", tag: "z", n: 1, at: day(2), flag: true },
]

const select = binding.fields.map((f) => f.name)
const sortById: readonly [SortKey] = [{ field: "id", dir: "asc" }]

const eq = (field: string, value: Value): Cond => ({ op: "eq", field, value })
const and = (...of: Cond[]): Cond => all(of)!

function wire(row: Row | null | undefined, fields: readonly string[] = select): Row | null {
  if (!row) return null
  const out: Row = {}
  for (const f of binding.fields) if (fields.includes(f.name)) out[f.name] = toWire(f.kind, row[f.name])
  return out
}

function same(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`)
}

const ids = (rows: readonly Row[]) => rows.map((r) => Number(r.id))
const find = (store: Store, where: Cond | null, sort: FindPlan["sort"] = sortById, take = 100) => store.find({ where, sort, take, select })
const key = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number))

function expected(sort: readonly SortKey[], where: (r: Row) => boolean = () => true): number[] {
  return seed
    .filter(where)
    .sort((a, b) => {
      for (const k of sort) {
        const d = key(a[k.field]) - key(b[k.field])
        if (d) return k.dir === "asc" ? d : -d
      }
      return 0
    })
    .map((r) => r.id as number)
}

async function pages(store: Store, sort: readonly [SortKey, ...SortKey[]], base: Cond | null): Promise<number[]> {
  const out: number[] = []
  for (let after: Row | undefined; ; ) {
    const cursor: Cond | null = after
      ? { op: "after", keys: sort.map((k) => ({ ...k, value: after![k.field] as Value })) as [never] }
      : null
    const rows = await find(store, all([base, cursor].filter((c): c is Cond => c !== null)), sort, 3)
    out.push(...ids(rows))
    if (rows.length < 3 || out.length > seed.length) return out
    after = seed.find((r) => r.id === Number(rows[2]!.id))
  }
}

export function testSource(open: (binding: Binding, seed: readonly Row[]) => Promise<Store>): readonly Case[] {
  const fresh = () => open(binding, seed.map((r) => ({ ...r })))
  const keyset = (name: string, sort: readonly [SortKey, ...SortKey[]], base: Cond | null = null, where?: (r: Row) => boolean): Case => ({
    name: `keyset pages ${name}`,
    async run() {
      same(await pages(await fresh(), sort, base), expected(sort, where), `pages sorted ${JSON.stringify(sort)}`)
    },
  })
  return [
    {
      name: "find returns only plan.select fields, sorted and limited by take",
      async run() {
        const store = await fresh()
        const rows = await store.find({ where: null, sort: sortById, take: 2, select: ["id", "name"] })
        same(rows.map((r) => wire(r, ["id", "name"])), [{ id: 1, name: "alpha" }, { id: 2, name: "beta" }], "select id,name take 2")
        same(rows.map((r) => Object.keys(r).sort()), [["id", "name"], ["id", "name"]], "selected keys")
        same(wire((await find(store, eq("id", 4)))[0]), wire(seed[3]), "row 4 round-trips every field kind")
      },
    },
    keyset("ascending", [{ field: "n", dir: "asc" }, { field: "id", dir: "asc" }]),
    keyset("descending", [{ field: "at", dir: "desc" }, { field: "id", dir: "desc" }]),
    keyset("with mixed directions", [{ field: "n", dir: "desc" }, { field: "at", dir: "asc" }, { field: "id", dir: "asc" }]),
    keyset("combined with a filter", [{ field: "at", dir: "asc" }, { field: "id", dir: "desc" }], eq("flag", true), (r) => r.flag === true),
    {
      name: "contains is case-insensitive, ORs fields and treats % _ \\ literally",
      async run() {
        const store = await fresh()
        const search = async (term: string, fields: [string, ...string[]] = ["name"]) => ids(await find(store, { op: "contains", fields, term }))
        same(await search("%"), [4], "term %")
        same(await search("_"), [5], "term _")
        same(await search("\\"), [6], "term backslash")
        same(await search("a 1"), [4], "term with a space")
        same(await search("THETA"), [8], "upper-case term")
        same(await search("z", ["name", "tag"]), [6, 8], "two fields")
      },
    },
    {
      name: "eq, in, null and their OR",
      async run() {
        const store = await fresh()
        same(ids(await find(store, { op: "in", field: "n", values: [1, 3] })), [1, 4, 5, 6, 8], "n in (1, 3)")
        same(ids(await find(store, { op: "null", field: "tag" })), [2, 5], "tag is null")
        same(ids(await find(store, { op: "or", of: [{ op: "null", field: "tag" }, eq("tag", "z")] })), [2, 5, 8], "tag null or z")
        same(ids(await find(store, eq("flag", false))), [2, 4, 7], "flag false")
        same(ids(await find(store, and(eq("tag", "x"), eq("n", 2)))), [7], "tag x and n 2")
      },
    },
    {
      name: "ranges on numbers and dates",
      async run() {
        const store = await fresh()
        same(ids(await find(store, and({ op: "gte", field: "at", value: day(2) }, { op: "lt", field: "at", value: day(3) }))), [2, 5, 8], "day 2")
        same(ids(await find(store, { op: "gt", field: "n", value: 2 })), [4, 6], "n > 2")
        same(ids(await find(store, { op: "lte", field: "n", value: 1 })), [1, 5, 8], "n <= 1")
      },
    },
    {
      name: "insert returns the stored row with its generated id",
      async run() {
        const store = await fresh()
        const data = { name: "iota", tag: null, n: 4, at: day(4), flag: true }
        const row = await store.insert(data)
        if (row.id == null) throw new Error("insert: returned row has no id")
        same(wire(row), wire({ ...data, id: row.id }), "inserted row")
        same(wire((await find(store, eq("id", Number(row.id))))[0]), wire(row), "inserted row read back")
      },
    },
    {
      name: "update only touches a row inside the where",
      async run() {
        const store = await fresh()
        same(await store.update(and(eq("id", 1), eq("tag", "y")), { name: "no" }), null, "update out of scope")
        same(wire((await find(store, eq("id", 1)))[0]), wire(seed[0]), "row 1 after out-of-scope update")
        same(wire(await store.update(and(eq("id", 1), eq("tag", "x")), { name: "one", n: 9 })), wire({ ...seed[0], name: "one", n: 9 }), "update in scope")
        same(wire((await find(store, eq("id", 1)))[0]), wire({ ...seed[0], name: "one", n: 9 }), "row 1 read back")
        same(ids(await find(store, eq("name", "one"))), [1], "only row 1 changed")
      },
    },
    {
      name: "remove only deletes a row inside the where",
      async run() {
        const store = await fresh()
        same(await store.remove(and(eq("id", 2), eq("tag", "x"))), false, "remove out of scope")
        same(ids(await find(store, eq("id", 2))), [2], "row 2 still there")
        same(await store.remove(and(eq("id", 2), { op: "null", field: "tag" })), true, "remove in scope")
        same(ids(await find(store, eq("id", 2))), [], "row 2 gone")
        same(await store.remove(eq("id", 2)), false, "remove again")
        same(ids(await find(store, null)), [1, 3, 4, 5, 6, 7, 8], "other rows untouched")
      },
    },
  ]
}
