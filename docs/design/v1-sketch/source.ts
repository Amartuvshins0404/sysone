import type { Value } from "./contract"

export type { Value }

export type Row = Record<string, unknown>

export type FieldKind = "string" | "number" | "boolean" | "date" | "bigint" | "json"

export interface FieldSpec {
  readonly name: string
  readonly kind: FieldKind
  readonly nullable: boolean
}

export interface Binding {
  readonly model: string
  readonly id: string
  readonly fields: readonly FieldSpec[]
}

export type Dir = "asc" | "desc"

export interface SortKey {
  readonly field: string
  readonly dir: Dir
}

export type Cond =
  | { readonly op: "and" | "or"; readonly of: readonly [Cond, Cond, ...Cond[]] }
  | { readonly op: "eq" | "gt" | "gte" | "lt" | "lte"; readonly field: string; readonly value: Value }
  | { readonly op: "in"; readonly field: string; readonly values: readonly [Value, Value, ...Value[]] }
  | { readonly op: "null"; readonly field: string }
  | { readonly op: "contains"; readonly fields: readonly [string, ...string[]]; readonly term: string }
  | { readonly op: "after"; readonly keys: readonly [AfterKey, ...AfterKey[]] }

export interface AfterKey extends SortKey {
  readonly value: Value
}

export interface FindPlan {
  readonly where: Cond | null
  readonly sort: readonly [SortKey, ...SortKey[]]
  readonly take: number
  readonly select: readonly string[]
}

export interface Store {
  find(plan: FindPlan): Promise<Row[]>
  insert(row: Row): Promise<Row>
  update(where: Cond, patch: Row): Promise<Row | null>
  remove(where: Cond): Promise<boolean>
}

export interface Source<R = Row> {
  readonly "~row"?: R
  readonly name: string
  bind(binding: Binding): Store
}

export function expandAfter(node: Extract<Cond, { op: "after" }>): Cond {
  // TODO keyset expansion, keys = [k1..kn] where kn is always the id:
  //   for i in 1..n: branch_i = AND( k1 = v1, ..., k(i-1) = v(i-1), ki (dir_i == asc ? gt : lt) vi )
  //   return branches.length == 1 ? branch_1 : OR(branch_1..branch_n)
  //   no null handling needed: sort fields are non-null by type (OrderedField) and checked at boot
  throw new Error("not implemented")
}

export function escapeLike(term: string): string {
  throw new Error("not implemented")
}

export interface Case {
  readonly name: string
  run(): Promise<void>
}

export function testSource(open: (binding: Binding, seed: readonly Row[]) => Promise<Store>): readonly Case[] {
  throw new Error("not implemented")
}
