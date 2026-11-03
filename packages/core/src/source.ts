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

export interface AfterKey extends SortKey {
  readonly value: Value
}

export type Cond =
  | { readonly op: "and" | "or"; readonly of: readonly [Cond, Cond, ...Cond[]] }
  | { readonly op: "eq" | "gt" | "gte" | "lt" | "lte"; readonly field: string; readonly value: Value }
  | { readonly op: "in"; readonly field: string; readonly values: readonly [Value, Value, ...Value[]] }
  | { readonly op: "null"; readonly field: string }
  | { readonly op: "contains"; readonly fields: readonly [string, ...string[]]; readonly term: string }
  | { readonly op: "after"; readonly keys: readonly [AfterKey, ...AfterKey[]] }

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

export function all(conds: readonly Cond[]): Cond | null {
  return conds.length === 0 ? null : conds.length === 1 ? conds[0]! : { op: "and", of: conds as [Cond, Cond, ...Cond[]] }
}

export function expandAfter(node: Extract<Cond, { op: "after" }>): Cond {
  const branches: Cond[] = node.keys.map((k, i) =>
    all([
      ...node.keys.slice(0, i).map((p): Cond => ({ op: "eq", field: p.field, value: p.value })),
      { op: k.dir === "asc" ? "gt" : "lt", field: k.field, value: k.value },
    ])!,
  )
  return branches.length === 1 ? branches[0]! : { op: "or", of: branches as [Cond, Cond, ...Cond[]] }
}

export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&")
}

export function toWire(kind: FieldKind, v: unknown): unknown {
  if (v === null) return v
  if (kind === "date") return v instanceof Date ? v.toISOString() : v
  if (kind === "bigint") return String(v)
  if (kind === "boolean") return typeof v === "number" ? v !== 0 : v
  return v
}
