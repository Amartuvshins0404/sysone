import type { Binding, Cond, FindPlan, Row, SortKey, Source, Store } from "./source"

export function memory<R extends Row = Row>(rows: R[] = []): Source<R> {
  return { name: "memory", bind: (binding) => memoryStore(binding, rows) }
}

function project(select: readonly string[], r: Row): Row {
  const out: Row = {}
  for (const f of select) if (r[f] !== undefined) out[f] = r[f]
  return out
}

function memoryStore(binding: Binding, seed: readonly Row[]): Store {
  const id = binding.id
  const kind = binding.fields.find((f) => f.name === id)?.kind
  const all = binding.fields.map((f) => f.name)
  const rows = seed.map((r) => project(all, r))
  let seq = 0
  for (const r of rows) if (typeof r[id] === "number" && (r[id] as number) > seq) seq = r[id] as number
  const at = (where: Cond) => rows.findIndex(predicate(where))
  return {
    async find(plan: FindPlan) {
      const out = plan.where ? rows.filter(predicate(plan.where)) : rows.slice()
      out.sort((a, b) => compareRows(plan.sort, a, b))
      if (out.length > plan.take) out.length = plan.take
      return plan.select.length === all.length ? out.map((r) => ({ ...r })) : out.map((r) => project(plan.select, r))
    },
    async insert(row) {
      const r = project(all, row)
      if (r[id] === undefined) r[id] = kind === "string" ? crypto.randomUUID() : kind === "bigint" ? BigInt(++seq) : ++seq
      rows.push(r)
      return { ...r }
    },
    async update(where, patch) {
      const r = rows[at(where)]
      return r ? { ...Object.assign(r, project(all, patch)) } : null
    },
    async remove(where) {
      const i = at(where)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    },
  }
}

type Test = (row: Row) => boolean

export function predicate(cond: Cond): Test {
  switch (cond.op) {
    case "and":
    case "or": {
      const tests = cond.of.map(predicate)
      const and = cond.op === "and"
      return (r) => {
        for (const t of tests) if (t(r) !== and) return !and
        return and
      }
    }
    case "null":
      return (r) => r[cond.field] == null
    case "in":
      return (r) => r[cond.field] != null && cond.values.some((v) => compareValues(r[cond.field], v) === 0)
    case "contains": {
      const term = cond.term.toLowerCase()
      return (r) => cond.fields.some((f) => typeof r[f] === "string" && (r[f] as string).toLowerCase().includes(term))
    }
    case "after":
      return (r) => {
        for (const k of cond.keys) {
          const c = compareValues(r[k.field], k.value)
          if (c !== 0) return k.dir === "asc" ? c > 0 : c < 0
        }
        return false
      }
    default: {
      const { field, value, op } = cond
      if (op === "eq" && !(value instanceof Date)) return (r) => r[field] === value
      const ok = op === "eq" ? (c: number) => c === 0 : op === "gt" ? (c: number) => c > 0 : op === "gte" ? (c: number) => c >= 0 : op === "lt" ? (c: number) => c < 0 : (c: number) => c <= 0
      return (r) => r[field] != null && ok(compareValues(r[field], value))
    }
  }
}

export function matches(cond: Cond, row: Row): boolean {
  return predicate(cond)(row)
}

export function compareRows(sort: readonly SortKey[], a: Row, b: Row): number {
  for (const k of sort) {
    const c = compareValues(a[k.field], b[k.field])
    if (c !== 0) return k.dir === "asc" ? c : -c
  }
  return 0
}

export function compareValues(a: unknown, b: unknown): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : -1) : 1
  const x = a instanceof Date ? a.getTime() : a
  const y = b instanceof Date ? b.getTime() : b
  return x === y ? 0 : (x as number) < (y as number) ? -1 : 1
}
