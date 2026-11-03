import type { Contracts, HasContract } from "./contract"
import type { AnyModel, Bound, ContractOf, CtxOf } from "./model"
import {
  SysoneError,
  compile,
  encodeRow,
  forbidden,
  nextCursor,
  notFound,
  parseId,
  parseInclude,
  parseList,
  planGet,
  planIncludes,
  planList,
  prepareCreate,
  prepareDelete,
  prepareUpdate,
  toScope,
  toStamp,
  type Compiled,
  type Scope,
} from "./plan"
import type { Row } from "./source"

export interface HandlerInput<Ctx> {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  body(): Promise<unknown>
  ctx(): Ctx | Promise<Ctx>
}

export interface HandlerOutput {
  readonly status: number
  readonly body?: unknown
}

export interface App<Cs extends Contracts = Contracts, Ctx = unknown> extends HasContract<Cs> {
  readonly "~ctx"?: (ctx: Ctx) => void
  readonly basePath: string
  handle(input: HandlerInput<Ctx>): Promise<HandlerOutput | null>
}

export type AnyApp = App<Contracts, any>

export type AppCtx<A> = A extends { readonly "~ctx"?: (ctx: infer Ctx) => void } ? Ctx : never

type ModelsOf<B extends readonly Bound[]> = B[number]["model"]
type Names<B extends readonly Bound[]> = ModelsOf<B>["name"]
type Targets<M extends AnyModel> = M["options"] extends { readonly relations: infer R }
  ? R[keyof R] extends { readonly model: infer T } ? T : never
  : never
type CtxSinks<M> = M extends AnyModel ? ([CtxOf<M>] extends [never] ? never : (ctx: CtxOf<M>) => void) : never

export type ContractsFrom<B extends readonly Bound[]> = {
  readonly [M in ModelsOf<B> as M["name"]]: ContractOf<M>
}

export type CtxFrom<B extends readonly Bound[]> = [CtxSinks<ModelsOf<B>>] extends [never]
  ? unknown
  : [CtxSinks<ModelsOf<B>>] extends [(ctx: infer C) => void]
    ? C
    : never

type Unserved<B extends readonly Bound[]> = Exclude<Targets<ModelsOf<B>>, Names<B>>

export interface SysoneConfig<B extends readonly Bound[]> {
  readonly basePath?: string
  readonly models: B
}

export function sysone<const B extends readonly Bound[]>(
  config: SysoneConfig<B> & ([Unserved<B>] extends [never] ? unknown : { readonly "~relation targets not served": Unserved<B> }),
): App<ContractsFrom<B>, CtxFrom<B>> {
  const models = new Map<string, Compiled>()
  for (const b of config.models) {
    if (models.has(b.model.name)) throw new Error(`sysonejs: model "${b.model.name}" is served twice`)
    models.set(b.model.name, compile(b.model, b.source))
  }
  for (const c of models.values())
    for (const [r, rel] of c.relations)
      if (!models.has(rel.target)) throw new Error(`sysonejs: relation "${c.name}.${r}" targets "${rel.target}", which is not served`)
  const rt: Runtime = { basePath: (config.basePath ?? "").replace(/\/+$/, ""), models }
  return { basePath: rt.basePath, handle: (input) => route(rt, input as HandlerInput<unknown>) }
}

export const NOT_FOUND = { error: { code: "not_found", message: "Not found" } } as const

export function fetchHandler<A extends AnyApp>(
  app: A,
  options: { readonly context: (request: Request) => AppCtx<A> | Promise<AppCtx<A>> },
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url)
    const out = await app.handle({
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      body: () => request.json().catch(() => undefined),
      ctx: () => options.context(request),
    })
    if (!out) return Response.json(NOT_FOUND, { status: 404 })
    return out.body === undefined ? new Response(null, { status: out.status }) : Response.json(out.body, { status: out.status })
  }
}

interface Runtime {
  readonly basePath: string
  readonly models: ReadonlyMap<string, Compiled>
}

async function route(rt: Runtime, input: HandlerInput<unknown>): Promise<HandlerOutput | null> {
  const path = input.path
  const base = rt.basePath.length
  if (path.charCodeAt(base) !== 47 || !path.startsWith(rt.basePath)) return null
  const slash = path.indexOf("/", base + 1)
  const c = rt.models.get(slash < 0 ? path.slice(base + 1) : path.slice(base + 1, slash))
  const rawId = slash < 0 ? undefined : path.slice(slash + 1)
  if (!c || rawId === "" || rawId?.includes("/")) return null
  try {
    return await run(rt, c, input, rawId)
  } catch (e) {
    if (!(e instanceof SysoneError)) throw e
    return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.issues ? { issues: e.issues } : {}) } } }
  }
}

function granted(scope: Scope): Exclude<Scope, { kind: "none" }> {
  if (scope.kind === "none") throw forbidden()
  return scope
}

async function run(rt: Runtime, c: Compiled, input: HandlerInput<unknown>, rawId: string | undefined): Promise<HandlerOutput> {
  const m = input.method
  if (rawId === undefined ? m !== "GET" && m !== "POST" : m !== "GET" && m !== "PATCH" && m !== "DELETE")
    throw new SysoneError(405, "method_not_allowed", "Method not allowed")
  const ctx = await input.ctx()
  const rules = c.access(ctx) ?? {}
  if (rawId === undefined) {
    if (m === "GET") {
      const scope = granted(toScope(c, rules.read))
      const req = parseList(c, input.query)
      const rows = await c.store.find(planList(c, req, scope))
      const page = rows.length > req.limit ? rows.slice(0, req.limit) : rows
      return { status: 200, body: await attach(rt, c, page, req.include, ctx, { items: page.map((r) => encodeRow(c, r)), next: nextCursor(req, rows) }) }
    }
    const stamp = toStamp(c, rules.create)
    if (stamp.kind === "none") throw forbidden()
    const row = await c.store.insert(prepareCreate(c, stamp, await input.body()))
    return { status: 201, body: { item: encodeRow(c, row), meta: c.wireMeta } }
  }
  if (m === "GET") {
    const scope = granted(toScope(c, rules.read))
    const include = parseInclude(c, input.query.get("include"))
    const row = (await c.store.find(planGet(c, parseId(c, rawId), scope)))[0]
    if (!row) throw notFound()
    return { status: 200, body: await attach(rt, c, [row], include, ctx, { item: encodeRow(c, row) }) }
  }
  if (m === "PATCH") {
    const scope = granted(toScope(c, rules.update))
    const { where, patch } = prepareUpdate(c, scope, parseId(c, rawId), await input.body())
    const row = Object.keys(patch).length
      ? await c.store.update(where, patch)
      : (await c.store.find({ where, sort: c.idSort, take: 1, select: c.select }))[0]
    if (!row) throw notFound()
    return { status: 200, body: { item: encodeRow(c, row), meta: c.wireMeta } }
  }
  const scope = granted(toScope(c, rules.delete))
  if (!(await c.store.remove(prepareDelete(c, scope, parseId(c, rawId))))) throw notFound()
  return { status: 204 }
}

async function attach(rt: Runtime, c: Compiled, rows: readonly Row[], include: readonly string[], ctx: unknown, body: Row): Promise<Row> {
  if (!include.length) {
    body.meta = c.wireMeta
    return body
  }
  const meta: { [model: string]: unknown } = { ...c.wireMeta }
  for (const r of include) {
    const target = rt.models.get(c.relations.get(r)!.target)!
    meta[target.name] = target.meta
  }
  const included: { [model: string]: Row[] } = {}
  await Promise.all(
    planIncludes(c, rows, include, rt.models, ctx).map(async ({ target, plan }) => {
      included[target.name] = (await target.store.find(plan)).map((r) => encodeRow(target, r))
    }),
  )
  body.included = included
  body.meta = meta
  return body
}
