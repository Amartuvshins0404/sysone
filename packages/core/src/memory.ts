import type { Binding, Cond, FindPlan, Row, SortKey, Source, Store } from "./source"

export function memory<R extends Row = Row>(rows: R[] = []): Source<R> {
  return { name: "memory", bind: (binding) => memoryStore(binding, rows.map((r) => ({ ...r }))) }
}

function memoryStore(binding: Binding, rows: Row[]): Store {
  const id = binding.id
  const kind = binding.fields.find((f) => f.name === id)?.kind
  let seq = 0
  for (const r of rows) if (typeof r[id] === "number" && (r[id] as number) > seq) seq = r[id] as number
  const project = (select: readonly string[], r: Row) => {
    const out: Row = {}
    for (const f of select) if (r[f] !== undefined) out[f] = r[f]
    return out
  }
  const all = binding.fields.map((f) => f.name)
  const at = (where: Cond) => rows.findIndex((r) => matches(where, r))
  return {
    async find(plan: FindPlan) {
      const where = plan.where
      const out = where ? rows.filter((r) => matches(where, r)) : rows.slice()
      out.sort((a, b) => compareRows(plan.sort, a, b))
      if (out.length > plan.take) out.length = plan.take
      return out.map((r) => project(plan.select, r))
    },
    async insert(row) {
      const r = { ...row }
      if (r[id] === undefined) r[id] = kind === "string" ? crypto.randomUUID() : kind === "bigint" ? BigInt(++seq) : ++seq
      rows.push(r)
      return project(all, r)
    },
    async update(where, patch) {
      const r = rows[at(where)]
      return r ? project(all, Object.assign(r, patch)) : null
    },
    async remove(where) {
      const i = at(where)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    },
  }
}

export function matches(cond: Cond, row: Row): boolean {
  switch (cond.op) {
    case "and":
      return cond.of.every((c) => matches(c, row))
    case "or":
      return cond.of.some((c) => matches(c, row))
    case "null":
      return row[cond.field] == null
    case "in":
      return row[cond.field] != null && cond.values.some((v) => compareValues(row[cond.field], v) === 0)
    case "contains": {
      const term = cond.term.toLowerCase()
      return cond.fields.some((f) => typeof row[f] === "string" && (row[f] as string).toLowerCase().includes(term))
    }
    case "after":
      for (const k of cond.keys) {
        const c = compareValues(row[k.field], k.value)
        if (c !== 0) return k.dir === "asc" ? c > 0 : c < 0
      }
      return false
    default: {
      const v = row[cond.field]
      if (v == null) return false
      const c = compareValues(v, cond.value)
      return cond.op === "eq" ? c === 0 : cond.op === "gt" ? c > 0 : cond.op === "gte" ? c >= 0 : cond.op === "lt" ? c < 0 : c <= 0
    }
  }
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
