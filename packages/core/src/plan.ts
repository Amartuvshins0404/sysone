import type { z } from "zod"
import { compareValues, matches } from "./memory"
import type { AnyModel } from "./model"
import { all, isoDate, toWire, type Binding, type Cond, type FieldKind, type FieldSpec, type FindPlan, type Row, type SortKey, type Source, type Store, type Value } from "./source"
import type { ErrorCode, WireIssue, WireMeta, WireModelMeta } from "./wire"

export class SysoneError extends Error {
  readonly status: 400 | 403 | 404 | 405 | 422
  readonly code: ErrorCode
  readonly issues: readonly WireIssue[] | undefined
  constructor(status: SysoneError["status"], code: ErrorCode, message: string, issues?: readonly WireIssue[]) {
    super(message)
    this.status = status
    this.code = code
    this.issues = issues
  }
}

const bad = (code: ErrorCode, message: string) => new SysoneError(400, code, message)
export const forbidden = () => new SysoneError(403, "forbidden", "Forbidden")
export const notFound = () => new SysoneError(404, "not_found", "Not found")

export type FilterOp = "eq" | "in" | "null" | "gt" | "gte" | "lt" | "lte"
type Keys = readonly [SortKey, ...SortKey[]]
type RawGrants = { readonly read?: unknown; readonly create?: unknown; readonly update?: unknown; readonly delete?: unknown }

export interface Order {
  readonly keys: Keys
  readonly spec: string
}

export interface Compiled {
  readonly name: string
  readonly id: string
  readonly binding: Binding
  readonly fields: ReadonlyMap<string, FieldSpec>
  readonly shape: { readonly [field: string]: z.ZodType }
  readonly select: readonly string[]
  readonly convert: readonly FieldSpec[]
  readonly search: readonly string[]
  readonly filter: ReadonlyMap<string, ReadonlySet<FilterOp>>
  readonly sort: ReadonlySet<string>
  readonly defaultSort: Order
  readonly idSort: Keys
  readonly limit: number
  readonly maxLimit: number
  readonly relations: ReadonlyMap<string, { readonly target: string; readonly key: string }>
  readonly createSchema: z.ZodType
  readonly patchSchema: z.ZodType
  readonly typedWrites: readonly FieldSpec[]
  readonly meta: WireModelMeta
  readonly wireMeta: WireMeta
  readonly access: (ctx: unknown) => RawGrants | null | undefined
  readonly store: Store
}

export type Scope = { readonly kind: "none" } | { readonly kind: "all" } | { readonly kind: "where"; readonly cond: Cond }
export type Stamp = { readonly kind: "none" } | { readonly kind: "stamp"; readonly values: Readonly<Row> }

export interface ListRequest {
  readonly where: readonly Cond[]
  readonly search: string | null
  readonly sort: Keys
  readonly sortSpec: string
  readonly include: readonly string[]
  readonly limit: number
  readonly after: readonly Value[] | null
}

type Def = { type: string; innerType?: z.ZodType; in?: z.ZodType; entries?: object; values?: readonly unknown[] }
const KINDS: { readonly [type: string]: FieldKind } = { string: "string", number: "number", boolean: "boolean", date: "date", bigint: "bigint" }
const defOf = (t: z.ZodType) => t._zod.def as unknown as Def

function fieldSpec(name: string, t: z.ZodType): FieldSpec {
  let d = defOf(t)
  while (d.innerType || d.type === "pipe") d = defOf(d.innerType ?? d.in!)
  const sample = d.type === "enum" ? Object.values(d.entries!)[0] : d.type === "literal" ? d.values![0] : undefined
  const kind = KINDS[sample === undefined ? d.type : typeof sample] ?? "json"
  const none = t.safeParse(undefined)
  return { name, kind, nullable: t.safeParse(null).success || (none.success && none.data === undefined) }
}

const DENY = () => null
const CONVERT = new Set<FieldKind>(["date", "bigint", "boolean"])
const ordered = (s: FieldSpec) => !s.nullable && s.kind !== "boolean" && s.kind !== "json"

export function compile(model: AnyModel, source: Source<unknown>): Compiled {
  const o = model.options as {
    id?: string
    write?: readonly string[]
    search?: readonly string[]
    filter?: readonly string[]
    sort?: readonly string[]
    defaultSort?: readonly string[]
    limit?: number
    maxLimit?: number
    relations?: { readonly [name: string]: { readonly model: string; readonly key: string } }
    access?: Compiled["access"]
  }
  const name = model.name
  const shape = model.schema.shape as { readonly [field: string]: z.ZodType }
  const fields = new Map(Object.entries(shape).map(([f, t]) => [f, fieldSpec(f, t)]))
  const use = (f: string, as: string, ok: (s: FieldSpec) => boolean = () => true) => {
    const s = fields.get(f)
    if (!s || !ok(s)) throw new Error(`sysonejs: model "${name}" cannot use "${f}" as ${as}`)
    return s
  }
  const id = use(o.id ?? "id", "its id", (s) => ordered(s) && s.kind !== "date").name
  const sort = new Set([...(o.sort ?? []).map((f) => use(f, "a sort field", ordered).name), id])
  const write = (o.write ?? []).map((f) => use(f, "a write field").name)
  const search = (o.search ?? []).map((f) => use(f, "a search field", (s) => s.kind === "string").name)
  const filter = new Map(
    (o.filter ?? []).map((f) => {
      const s = use(f, "a filter field", (s) => s.kind !== "json")
      const ops: FilterOp[] = ["eq", "in"]
      if (s.nullable) ops.push("null")
      if (s.kind !== "boolean") ops.push("gt", "gte", "lt", "lte")
      return [f, new Set(ops)] as const
    }),
  )
  const relations = new Map(Object.entries(o.relations ?? {}).map(([r, rel]) => [r, { target: rel.model, key: use(rel.key, `the key of "${r}"`).name }]))
  const defaultSort = order(sort, id, o.defaultSort ?? [])
  if (!defaultSort) throw new Error(`sysonejs: model "${name}" has an invalid defaultSort`)
  const types: { [field: string]: "date" | "bigint" } = {}
  for (const s of fields.values()) if (s.kind === "date" || s.kind === "bigint") types[s.name] = s.kind
  const links: { [relation: string]: readonly [string, string] } = {}
  for (const [r, rel] of relations) links[r] = [rel.target, rel.key]
  const meta: WireModelMeta = { id, ...(Object.keys(types).length ? { types } : {}), ...(relations.size ? { links } : {}) }
  const createSchema = model.schema.pick(Object.fromEntries(write.map((f) => [f, true])) as never)
  const patchSchema = createSchema.extend(
    Object.fromEntries(write.map((f) => [f, (defOf(shape[f]!).type === "default" ? defOf(shape[f]!).innerType! : shape[f]!).optional()])),
  )
  const binding: Binding = { model: name, id, fields: [...fields.values()] }
  return {
    name,
    id,
    binding,
    fields,
    shape,
    select: [...fields.keys()],
    convert: [...fields.values()].filter((s) => CONVERT.has(s.kind)),
    search,
    filter,
    sort,
    defaultSort,
    idSort: [{ field: id, dir: "asc" }],
    limit: o.limit ?? 20,
    maxLimit: o.maxLimit ?? 100,
    relations,
    createSchema,
    patchSchema,
    typedWrites: write.map((f) => fields.get(f)!).filter((s) => s.kind === "date" || s.kind === "bigint"),
    meta,
    wireMeta: { [name]: meta },
    access: o.access ?? DENY,
    store: source.bind(binding),
  }
}

function order(sort: ReadonlySet<string>, id: string, specs: readonly string[]): Order | null {
  if (specs.length > 3) return null
  const keys: SortKey[] = []
  for (const s of specs) {
    const desc = s[0] === "-"
    const field = desc ? s.slice(1) : s
    if (!sort.has(field)) return null
    if (keys.some((k) => k.field === field)) continue
    keys.push({ field, dir: desc ? "desc" : "asc" })
    if (field === id) break
  }
  const last = keys[keys.length - 1]
  if (last?.field !== id) keys.push({ field: id, dir: last?.dir ?? "asc" })
  return { keys: keys as unknown as Keys, spec: keys.map((k) => (k.dir === "desc" ? "-" : "") + k.field).join(",") }
}

const NONE: Scope & Stamp = { kind: "none" }
const ALL: Scope = { kind: "all" }

function known(c: Compiled, f: string) {
  if (!c.fields.has(f)) throw new Error(`sysonejs: access rule of model "${c.name}" uses unknown field "${f}"`)
}

function unique(vs: readonly unknown[]): Value[] {
  const out: Value[] = []
  for (const v of vs) if (!out.some((x) => compareValues(x, v) === 0)) out.push(v as Value)
  return out
}

function oneOf(field: string, vs: readonly Value[]): Cond {
  return vs.length === 1 ? { op: "eq", field, value: vs[0]! } : { op: "in", field, values: vs as [Value, Value, ...Value[]] }
}

export function toScope(c: Compiled, rule: unknown): Scope {
  if (rule === true) return ALL
  if (!rule || typeof rule !== "object") return NONE
  if (Array.isArray(rule)) {
    const branches: Cond[] = []
    for (const m of rule) {
      const s = toScope(c, m)
      if (s.kind === "all") return ALL
      if (s.kind === "where") branches.push(s.cond)
    }
    return branches.length ? { kind: "where", cond: branches.length === 1 ? branches[0]! : { op: "or", of: branches as [Cond, Cond] } } : NONE
  }
  const conds: Cond[] = []
  for (const [f, v] of Object.entries(rule)) {
    known(c, f)
    if (v === undefined) return NONE
    if (v === null) conds.push({ op: "null", field: f })
    else if (Array.isArray(v)) {
      const vs = unique(v)
      if (!vs.length) return NONE
      conds.push(oneOf(f, vs))
    } else conds.push({ op: "eq", field: f, value: v as Value })
  }
  const cond = all(conds)
  return cond ? { kind: "where", cond } : ALL
}

export function toStamp(c: Compiled, rule: unknown): Stamp {
  if (rule === true) return { kind: "stamp", values: {} }
  if (!rule || typeof rule !== "object") return NONE
  for (const [f, v] of Object.entries(rule)) {
    known(c, f)
    if (Array.isArray(v)) throw new Error(`sysonejs: create rule of model "${c.name}" must stamp one value for "${f}"`)
    if (v === undefined) return NONE
  }
  return { kind: "stamp", values: rule as Row }
}

function coerce(kind: FieldKind, raw: string): unknown {
  if (kind === "number") return raw.trim() === "" ? NaN : Number(raw)
  if (kind === "boolean") return raw === "true" ? true : raw === "false" ? false : raw
  if (kind === "date") return new Date(raw)
  if (kind === "bigint")
    try {
      return BigInt(raw)
    } catch {
      return raw
    }
  return raw
}

function value(c: Compiled, field: string, raw: string, nullable: boolean): Value | null {
  if (nullable && raw === "null" && c.fields.get(field)!.nullable) return null
  const r = c.shape[field]!.safeParse(coerce(c.fields.get(field)!.kind, raw))
  if (!r.success || r.data == null) throw bad("invalid_value", `Invalid value for "${field}"`)
  return r.data as Value
}

export function parseInclude(c: Compiled, raw: string | null): readonly string[] {
  if (!raw) return []
  const names = [...new Set(raw.split(","))]
  for (const n of names) if (!c.relations.has(n)) throw bad("invalid_include", `Cannot include "${n}"`)
  return names
}

export function parseList(c: Compiled, query: URLSearchParams): ListRequest {
  let limit = c.limit
  let sort = c.defaultSort
  let search: string | null = null
  let include: readonly string[] = []
  let cursor: string | null = null
  const where: Cond[] = []
  const eqs = new Map<string, (Value | null)[]>()
  for (const [k, v] of query) {
    if (k === "limit") {
      const n = Number(v)
      if (!Number.isInteger(n) || n < 1) throw bad("invalid_limit", "Invalid limit")
      limit = Math.min(n, c.maxLimit)
    } else if (k === "sort") {
      if (v) sort = order(c.sort, c.id, v.split(",")) ?? fail("invalid_sort", `Cannot sort by "${v}"`)
    } else if (k === "search") {
      const t = v.trim()
      if (t && !c.search.length) throw bad("invalid_search", "Search is not enabled")
      search = t || null
    } else if (k === "include") include = parseInclude(c, v)
    else if (k === "cursor") cursor = v || null
    else if (k.startsWith("filter[")) {
      const end = k.indexOf("]")
      const field = k.slice(7, end)
      const ops = c.filter.get(field)
      if (!ops || end < 0) throw bad("invalid_filter", `Cannot filter by "${field}"`)
      const rest = k.slice(end + 1)
      if (!rest) {
        let vs = eqs.get(field)
        if (!vs) eqs.set(field, (vs = []))
        vs.push(value(c, field, v, true))
        continue
      }
      const op = rest.slice(1, -1) as FilterOp
      if (rest !== `[${op}]` || op === "eq" || op === "in" || op === "null" || !ops.has(op)) throw bad("invalid_filter", `Cannot filter "${field}" by "${op}"`)
      where.push({ op, field, value: value(c, field, v, false)! })
    }
  }
  for (const [field, vs] of eqs) {
    const values = unique(vs.filter((v) => v !== null))
    const isNull: Cond | null = values.length < vs.length ? { op: "null", field } : null
    where.push(!values.length ? isNull! : isNull ? { op: "or", of: [isNull, oneOf(field, values)] } : oneOf(field, values))
  }
  return { where, search, sort: sort.keys, sortSpec: sort.spec, include, limit, after: cursor ? decodeCursor(c, sort, cursor) : null }
}

function fail(code: ErrorCode, message: string): never {
  throw bad(code, message)
}

export function planList(c: Compiled, req: ListRequest, scope: Scope): FindPlan {
  const conds: Cond[] = scope.kind === "where" ? [scope.cond, ...req.where] : [...req.where]
  if (req.search !== null) conds.push({ op: "contains", fields: c.search as [string, ...string[]], term: req.search })
  if (req.after) conds.push({ op: "after", keys: req.sort.map((k, i) => ({ ...k, value: req.after![i]! })) as [never] })
  return { where: all(conds), sort: req.sort, take: req.limit + 1, select: c.select }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const jsonScalar = (v: unknown) => (v instanceof Date ? isoDate(v) : typeof v === "bigint" ? String(v) : v)

export function nextCursor(req: ListRequest, rows: readonly Row[]): string | null {
  if (rows.length <= req.limit) return null
  const last = rows[req.limit - 1]!
  const json = JSON.stringify([1, req.sortSpec, ...req.sort.map((k) => jsonScalar(last[k.field]))])
  return btoa(/^[\x00-\x7f]*$/.test(json) ? json : String.fromCharCode(...encoder.encode(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function decodeCursor(c: Compiled, sort: Order, raw: string): readonly Value[] {
  try {
    const t: unknown = JSON.parse(decoder.decode(Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0))))
    if (!Array.isArray(t) || t[0] !== 1 || t[1] !== sort.spec || t.length !== sort.keys.length + 2) throw 0
    return sort.keys.map((k, i) => {
      const v: unknown = t[i + 2]
      const kind = c.fields.get(k.field)!.kind
      const out = kind === "date" && typeof v === "string" ? new Date(v) : kind === "bigint" && typeof v === "string" ? BigInt(v) : v
      if (kind === "date" ? !(out instanceof Date) || isNaN(out.getTime()) : typeof out !== kind) throw 0
      return out as Value
    })
  } catch {
    throw bad("invalid_cursor", "Invalid cursor")
  }
}

export function parseId(c: Compiled, raw: string): Value {
  let s: string
  try {
    s = decodeURIComponent(raw)
  } catch {
    throw bad("invalid_value", `Invalid value for "${c.id}"`)
  }
  return value(c, c.id, s, false)!
}

const byId = (c: Compiled, id: Value, scope: Scope): Cond =>
  all(scope.kind === "where" ? [{ op: "eq", field: c.id, value: id }, scope.cond] : [{ op: "eq", field: c.id, value: id }])!

export function planGet(c: Compiled, id: Value, scope: Scope): FindPlan {
  return { where: byId(c, id, scope), sort: c.idSort, take: 1, select: c.select }
}

function decodeBody(c: Compiled, body: unknown): unknown {
  if (!c.typedWrites.length || typeof body !== "object" || body === null) return body
  const out: Row = { ...(body as Row) }
  for (const s of c.typedWrites) {
    const v = out[s.name]
    if (typeof v !== "string") continue
    if (s.kind === "date") out[s.name] = new Date(v)
    else if (/^-?\d+$/.test(v)) out[s.name] = BigInt(v)
  }
  return out
}

function invalidBody(error: z.ZodError): SysoneError {
  return new SysoneError(
    422,
    "invalid_body",
    "Invalid body",
    error.issues.map((i) => ({ path: i.path.filter((p): p is string | number => typeof p !== "symbol"), message: i.message })),
  )
}

export function prepareCreate(c: Compiled, stamp: Extract<Stamp, { kind: "stamp" }>, body: unknown): Row {
  const r = c.createSchema.safeParse(decodeBody(c, body))
  if (!r.success) throw invalidBody(r.error)
  const data = r.data as Row
  for (const [f, v] of Object.entries(stamp.values)) {
    if (data[f] === undefined) data[f] = v
    else if (compareValues(data[f], v) !== 0) throw forbidden()
  }
  return data
}

function residual(cond: Cond, patch: Row): Cond | boolean {
  if (cond.op === "and" || cond.op === "or") {
    const short = cond.op === "or"
    const rest: Cond[] = []
    let changed = false
    for (const child of cond.of) {
      const r = residual(child, patch)
      if (r === short) return short
      if (r !== child) changed = true
      if (typeof r !== "boolean") rest.push(r)
    }
    if (!changed) return cond
    return rest.length === 0 ? !short : rest.length === 1 ? rest[0]! : { op: cond.op, of: rest as [Cond, Cond] }
  }
  return "field" in cond && cond.field in patch ? matches(cond, patch) : cond
}

export function prepareUpdate(c: Compiled, scope: Extract<Scope, { kind: "all" | "where" }>, id: Value, body: unknown): { where: Cond; patch: Row } {
  const r = c.patchSchema.safeParse(decodeBody(c, body))
  if (!r.success) throw invalidBody(r.error)
  const patch = r.data as Row
  const where = byId(c, id, scope)
  if (scope.kind === "all") return { where, patch }
  const rest = residual(scope.cond, patch)
  if (rest === false) throw forbidden()
  return { where: rest === true || rest === scope.cond ? where : { op: "and", of: [where, rest] }, patch }
}

export function prepareDelete(c: Compiled, scope: Extract<Scope, { kind: "all" | "where" }>, id: Value): Cond {
  return byId(c, id, scope)
}

export interface IncludePlan {
  readonly target: Compiled
  readonly plan: FindPlan
}

export function planIncludes(
  c: Compiled,
  rows: readonly Row[],
  include: readonly string[],
  models: ReadonlyMap<string, Compiled>,
  ctx: unknown,
): readonly IncludePlan[] {
  const keys = new Map<string, Set<Value>>()
  for (const name of include) {
    const rel = c.relations.get(name)!
    let ids = keys.get(rel.target)
    if (!ids) keys.set(rel.target, (ids = new Set()))
    for (const r of rows) if (r[rel.key] != null) ids.add(r[rel.key] as Value)
  }
  const plans: IncludePlan[] = []
  for (const [name, ids] of keys) {
    const target = models.get(name)!
    const scope = ids.size ? toScope(target, target.access(ctx)?.read) : NONE
    if (scope.kind === "none") continue
    const match = oneOf(target.id, [...ids])
    plans.push({
      target,
      plan: { where: scope.kind === "where" ? { op: "and", of: [scope.cond, match] } : match, sort: target.idSort, take: ids.size, select: target.select },
    })
  }
  return plans
}

export function encodeRow(c: Compiled, row: Row): Row {
  const out = { ...row }
  let n = 0
  for (const f of c.select) if (f in out) n++
  if (n !== Object.keys(out).length) for (const k of Object.keys(out)) if (!c.fields.has(k)) delete out[k]
  for (const f of c.convert) if (out[f.name] != null) out[f.name] = toWire(f.kind, out[f.name])
  return out
}
