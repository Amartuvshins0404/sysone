import type { z } from "zod"
import type { AnyModel } from "./model"
import type { Binding, Cond, FieldSpec, FindPlan, Row, SortKey, Store, Value } from "./source"
import type { ErrorCode, WireIssue, WireModelMeta } from "./wire"

export class SysoneError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 405 | 422,
    readonly code: ErrorCode,
    message: string,
    readonly issues?: readonly WireIssue[],
  ) {
    super(message)
  }
}

export type FilterOp = "eq" | "in" | "null" | "gt" | "gte" | "lt" | "lte"

export interface Compiled {
  readonly name: string
  readonly binding: Binding
  readonly fields: ReadonlyMap<string, FieldSpec>
  readonly select: readonly string[]
  readonly write: ReadonlySet<string>
  readonly search: readonly string[]
  readonly filter: ReadonlyMap<string, ReadonlySet<FilterOp>>
  readonly sort: ReadonlySet<string>
  readonly defaultSort: readonly [SortKey, ...SortKey[]]
  readonly limit: number
  readonly maxLimit: number
  readonly relations: ReadonlyMap<string, { readonly target: string; readonly key: string }>
  readonly createSchema: z.ZodType
  readonly patchSchema: z.ZodType
  readonly meta: WireModelMeta
  readonly grants: (ctx: unknown) => Grants
  readonly store: Store
}

export type Scope = { readonly kind: "none" } | { readonly kind: "all" } | { readonly kind: "where"; readonly cond: Cond }

export type Stamp = { readonly kind: "none" } | { readonly kind: "stamp"; readonly values: Readonly<Row>; readonly cond: Cond | null }

export interface Grants {
  readonly read: Scope
  readonly create: Stamp
  readonly update: Scope
  readonly delete: Scope
}

export interface ListRequest {
  readonly where: readonly Cond[]
  readonly search: string | null
  readonly sort: readonly [SortKey, ...SortKey[]]
  readonly sortSpec: string
  readonly include: readonly string[]
  readonly limit: number
  readonly after: readonly Value[] | null
}

export function compile(model: AnyModel, store: Store): Compiled {
  throw new Error("not implemented")
}

export function normalizeGrants(compiled: Pick<Compiled, "fields" | "name">, raw: unknown): Grants {
  // TODO scoping, run once per request per model:
  //   raw = model.access(ctx) ?? { read: true }   (no access fn means read-only for everyone)
  //   rule(false | undefined) -> none ; rule(true) -> all
  //   rule(match) -> where AND over keys: value -> eq, array -> in (dedupe; [] -> none; [x] -> eq), null -> null
  //   rule(match[]) -> where OR over each match's cond; drop "none" branches; all branches none -> none
  //   create(true) -> stamp {} ; create(match) -> stamp with values = match, every value must be a single scalar
  //     (arrays in a create match are a type error and a boot-time error)
  //   unknown field in a match -> throw at request time with model + field name (programmer error, 500)
  throw new Error("not implemented")
}

export function parseList(c: Compiled, query: URLSearchParams): ListRequest {
  // TODO
  //   limit: integer >= 1 else invalid_limit; clamp to maxLimit; default c.limit
  //   sort: "a,-b" -> keys; each key in c.sort or id else invalid_sort; max 3 keys; dedupe;
  //         append { id, dir of last key } unless id already present; sortSpec = canonical string
  //   filter[f]=v (repeatable) -> eq/in/null; filter[f][op]=v for op in gt|gte|lt|lte, op allowed by c.filter.get(f)
  //   values coerced by FieldSpec.kind then validated by the field's zod schema -> invalid_value
  //   search: trimmed, empty -> null, present but c.search empty -> invalid_search
  //   include: names in c.relations else invalid_include
  //   cursor: decodeCursor(c, sortSpec, raw) -> after values
  throw new Error("not implemented")
}

export function planList(c: Compiled, req: ListRequest, scope: Scope): FindPlan | null {
  // TODO
  //   scope none -> caller already returned 403; scope where -> push scope.cond first
  //   conds = [scope?, ...req.where, search ? contains(c.search, term) : -, after ? after(sort zip values) : -]
  //   where = conds.length == 0 ? null : conds.length == 1 ? conds[0] : and(conds)
  //   any provably empty cond (in with no values) -> return null (respond with empty page, no source call)
  //   return { where, sort: req.sort, take: req.limit + 1, select: c.select }
  throw new Error("not implemented")
}

export function nextCursor(c: Compiled, req: ListRequest, rows: readonly Row[]): string | null {
  // TODO keyset: rows has up to take = limit + 1 rows
  //   rows.length <= limit -> null
  //   last = rows[limit - 1]; values = req.sort.map(k => last[k.field])
  //   return base64url(JSON.stringify([1, req.sortSpec, ...values.map(toJsonScalar)]))   dates -> ISO, bigint -> string
  throw new Error("not implemented")
}

export function decodeCursor(c: Compiled, sortSpec: string, raw: string): readonly Value[] {
  // TODO base64url -> JSON array; [0] must be 1, [1] must equal sortSpec, length must be 2 + sort keys
  //   coerce each value by the sort field's kind and validate; any failure -> invalid_cursor
  throw new Error("not implemented")
}

export function parseId(c: Compiled, raw: string): Value {
  throw new Error("not implemented")
}

export function planGet(c: Compiled, id: Value, scope: Scope): FindPlan {
  throw new Error("not implemented")
}

export function prepareCreate(c: Compiled, stamp: Extract<Stamp, { kind: "stamp" }>, body: unknown): Row {
  // TODO scoping on create:
  //   data = c.createSchema.safeParse(body) else 422 invalid_body with issues
  //   for each [field, value] of stamp.values:
  //     data[field] === undefined -> data[field] = value
  //     data[field] !== value     -> 403 forbidden (a client tried to write outside its scope)
  //   return data
  throw new Error("not implemented")
}

export function prepareUpdate(c: Compiled, scope: Extract<Scope, { kind: "all" | "where" }>, id: Value, body: unknown): { where: Cond; patch: Row } {
  // TODO scoping on update:
  //   patch = c.patchSchema.safeParse(body) else 422
  //   where = scope all ? eq(id) : and(eq(id), scope.cond)
  //   if patch writes a field named in scope.cond and the new value would fall outside it -> 403
  //     (only possible when that field is in `write`; boot warns when a scoped field is writable)
  //   one statement: source.update(where, patch); null -> 404 (missing and out-of-scope look the same)
  throw new Error("not implemented")
}

export function prepareDelete(c: Compiled, scope: Extract<Scope, { kind: "all" | "where" }>, id: Value): Cond {
  throw new Error("not implemented")
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
  // TODO batched relation loading, one query per (target model, page):
  //   for rel in include: keys = unique non-null rows[*][rel.key]
  //   group by target model; ids = union of keys
  //   scope = target.grants(ctx).read
  //     none -> no plan (relation resolves to null on the client)
  //     all/where -> plan { where: and(scope?, in(target.id, ids)), sort: [id asc], take: ids.length, select: target.select }
  //   invariant: every row that leaves the server passed its own model's read rule
  throw new Error("not implemented")
}

export function pick(c: Compiled, row: Row): Row {
  throw new Error("not implemented")
}
