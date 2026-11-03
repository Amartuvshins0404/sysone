import { createCache, encodeQuery, text } from "./cache"
import type { Contracts, ContractsOf, HasContract, Item, ListParams, ModelContract, RelationName } from "./contract"
import type { ErrorCode, WireError, WireListParams } from "./wire"

export type { Contracts, Item, ListParams, ModelContract, RelationName }

export interface ClientOptions {
  readonly url: string
  readonly fetch?: typeof fetch
  readonly headers?: () => Record<string, string> | Promise<Record<string, string>>
}

export class SysoneClientError extends Error {
  declare readonly status: number
  declare readonly code: ErrorCode | "http_error"
  declare readonly issues: { readonly [path: string]: string }
  constructor(status: number, code: SysoneClientError["code"], message: string, issues: SysoneClientError["issues"] = {}) {
    super(message)
    Object.assign(this, { status, code, issues })
  }
}

export interface ListSnapshot<T> {
  readonly items: readonly T[]
  readonly ids: readonly string[]
  readonly loading: boolean
  readonly error: SysoneClientError | Error | undefined
  readonly hasMore: boolean
  readonly loadMore: () => Promise<void>
  readonly refetch: () => Promise<void>
}

export interface GetSnapshot<T> {
  readonly data: T | null | undefined
  readonly loading: boolean
  readonly error: SysoneClientError | Error | undefined
  readonly refetch: () => Promise<void>
}

export interface Live<S> {
  getSnapshot(): S
  subscribe(onChange: () => void): () => void
}

export type LiveList<T> = Live<ListSnapshot<T>>

export type LiveGet<T> = Live<GetSnapshot<T>>

type Includes<C extends ModelContract> = readonly RelationName<C>[]

export interface Ref<Cs extends Contracts, N extends keyof Cs & string> {
  readonly "~ref"?: readonly [Cs, N]
  create(data: Cs[N]["create"]): Promise<Cs[N]["row"]>
  update(id: Cs[N]["id"], patch: Cs[N]["patch"]): Promise<Cs[N]["row"]>
  delete(id: Cs[N]["id"]): Promise<void>
  watchList<const I extends Includes<Cs[N]> = readonly []>(params?: ListParams<Cs[N], I>): LiveList<Item<Cs, N, I>>
  watchGet<const I extends Includes<Cs[N]> = readonly []>(id: Cs[N]["id"], options?: { readonly include?: I }): LiveGet<Item<Cs, N, I>>
}

export type Client<A extends HasContract> = {
  readonly [N in keyof ContractsOf<A> & string]: Ref<ContractsOf<A>, N>
}

export { encodeQuery }

export function createClient<A extends HasContract>(options: ClientOptions): Client<A> {
  const cache = createCache(async (method, m, id, query, body) => {
    const send = options.fetch ?? fetch
    const url = `${options.url}/${m}${id === undefined ? "" : "/" + encodeURIComponent(text(id))}${query ? "?" + query : ""}`
    const headers = { "content-type": "application/json", ...(await options.headers?.()) }
    const res = await send(url, { method, headers, body: body && JSON.stringify(body) })
    if (res.status === 204 || (res.status === 404 && !body && id !== undefined)) return null
    const json = await res.json().catch(() => ({}))
    if (res.ok) return json
    const e: Partial<WireError["error"]> = json.error ?? {}
    throw new SysoneClientError(
      res.status,
      e.code ?? "http_error",
      e.message ?? res.statusText,
      Object.fromEntries((e.issues ?? []).map((i) => [i.path.join("."), i.message])),
    )
  })
  return new Proxy({} as Client<A>, {
    get: (_, m: string) => ({
      create: (data: object) => cache.write(m, "POST", undefined, data),
      update: (id: unknown, patch: object) => cache.write(m, "PATCH", id, patch),
      delete: (id: unknown) => cache.write(m, "DELETE", id),
      watchList: (p: WireListParams = {}) => cache.query(m, p),
      watchGet: (id: unknown, o?: { readonly include?: readonly string[] }) => cache.query(m, undefined, id, o?.include),
    }),
  })
}
