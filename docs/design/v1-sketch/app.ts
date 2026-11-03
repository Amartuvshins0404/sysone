import type { Contracts, HasContract } from "./contract"
import type { AnyModel, Bound, ContractOf, CtxOf } from "./model"
import type { Compiled } from "./plan"

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
  readonly manifest?: boolean
}

export function sysone<const B extends readonly Bound[]>(
  config: SysoneConfig<B> & ([Unserved<B>] extends [never] ? unknown : { readonly "~relation targets not served": Unserved<B> }),
): App<ContractsFrom<B>, CtxFrom<B>> {
  throw new Error("not implemented")
}

export function fetchHandler<A extends AnyApp>(
  app: A,
  options: { readonly context: (request: Request) => AppCtx<A> | Promise<AppCtx<A>> },
): (request: Request) => Promise<Response> {
  throw new Error("not implemented")
}

interface Runtime {
  readonly basePath: string
  readonly models: ReadonlyMap<string, Compiled>
  readonly manifest: unknown | null
}

function route(rt: Runtime, input: HandlerInput<unknown>): Promise<HandlerOutput | null> {
  throw new Error("not implemented")
}

function run(rt: Runtime, c: Compiled, input: HandlerInput<unknown>, rawId: string | undefined): Promise<HandlerOutput> {
  throw new Error("not implemented")
}
