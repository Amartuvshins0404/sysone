import type { Contracts, ContractsOf, HasContract, Item, ListParams, ModelContract, Page, RelationName } from "./contract"
import type { ErrorCode } from "./wire"

export type { Item, ListParams, Page }

export interface ClientOptions {
  readonly url: string
  readonly fetch?: typeof fetch
  readonly headers?: () => HeadersInit | Promise<HeadersInit>
  readonly credentials?: RequestCredentials
}

export class SysoneClientError extends Error {
  readonly status: number
  readonly code: ErrorCode | "http_error" | "network_error"
  readonly issues: { readonly [path: string]: string }
  constructor(status: number, code: SysoneClientError["code"], message: string, issues: SysoneClientError["issues"]) {
    super(message)
    this.status = status
    this.code = code
    this.issues = issues
  }
}

export interface ListSnapshot<T> {
  readonly items: readonly T[]
  readonly loading: boolean
  readonly error: SysoneClientError | undefined
  readonly hasMore: boolean
}

export interface GetSnapshot<T> {
  readonly data: T | null | undefined
  readonly loading: boolean
  readonly error: SysoneClientError | undefined
}

export interface Live<S> {
  getSnapshot(): S
  subscribe(onChange: () => void): () => void
}

export interface LiveList<T> extends Live<ListSnapshot<T>> {
  loadMore(): Promise<void>
  refetch(): Promise<void>
}

export interface LiveGet<T> extends Live<GetSnapshot<T>> {
  refetch(): Promise<void>
}

export interface Ref<Cs extends Contracts, N extends keyof Cs & string> {
  readonly name: N
  list<const I extends readonly RelationName<Cs[N]>[] = readonly []>(params?: ListParams<Cs[N], I>): Promise<Page<Item<Cs, N, I>>>
  get<const I extends readonly RelationName<Cs[N]>[] = readonly []>(
    id: Cs[N]["id"],
    options?: { readonly include?: I },
  ): Promise<Item<Cs, N, I> | null>
  create(data: Cs[N]["create"]): Promise<Cs[N]["row"]>
  update(id: Cs[N]["id"], patch: Cs[N]["patch"]): Promise<Cs[N]["row"]>
  delete(id: Cs[N]["id"]): Promise<void>
  watchList<const I extends readonly RelationName<Cs[N]>[] = readonly []>(params?: ListParams<Cs[N], I>): LiveList<Item<Cs, N, I>>
  watchGet<const I extends readonly RelationName<Cs[N]>[] = readonly []>(
    id: Cs[N]["id"],
    options?: { readonly include?: I },
  ): LiveGet<Item<Cs, N, I>>
}

export type AnyRef = Ref<Contracts, string>

export type ContractOfRef<R> = R extends Ref<infer Cs, infer N> ? Cs[N] : ModelContract

export type Client<A extends HasContract> = {
  readonly [N in keyof ContractsOf<A> & string]: Ref<ContractsOf<A>, N>
}

export function createClient<A extends HasContract>(options: ClientOptions): Client<A> {
  throw new Error("not implemented")
}
