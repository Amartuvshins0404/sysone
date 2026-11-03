export type ErrorCode =
  | "invalid_limit"
  | "invalid_sort"
  | "invalid_filter"
  | "invalid_search"
  | "invalid_include"
  | "invalid_cursor"
  | "invalid_value"
  | "invalid_body"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"

export type WireRow = { readonly [field: string]: unknown }

export interface WireModelMeta {
  readonly id: string
  readonly types?: { readonly [field: string]: "date" | "bigint" }
  readonly links?: { readonly [relation: string]: readonly [model: string, key: string] }
}

export type WireMeta = { readonly [model: string]: WireModelMeta }

export interface WireIssue {
  readonly path: readonly (string | number)[]
  readonly message: string
}

export interface WireError {
  readonly error: { readonly code: ErrorCode; readonly message: string; readonly issues?: readonly WireIssue[] }
}

export interface WireList {
  readonly items: readonly WireRow[]
  readonly next: string | null
  readonly included?: { readonly [model: string]: readonly WireRow[] }
  readonly meta: WireMeta
}

export interface WireOne {
  readonly item: WireRow
  readonly included?: { readonly [model: string]: readonly WireRow[] }
  readonly meta: WireMeta
}

export type WireFilter = { readonly [field: string]: unknown }

export interface WireListParams {
  readonly search?: string
  readonly filter?: WireFilter
  readonly sort?: readonly string[]
  readonly include?: readonly string[]
  readonly limit?: number
  readonly cursor?: string | null
}

export interface ManifestModel {
  readonly id: string
  readonly fields: object
  readonly write: readonly string[]
  readonly search: readonly string[]
  readonly filter: { readonly [field: string]: readonly ("eq" | "in" | "null" | "gt" | "gte" | "lt" | "lte")[] }
  readonly sort: readonly string[]
  readonly defaultSort: readonly string[]
  readonly relations: { readonly [name: string]: { readonly model: string; readonly key: string } }
  readonly limit: number
  readonly maxLimit: number
}

export interface Manifest {
  readonly sysone: 1
  readonly models: { readonly [name: string]: ManifestModel }
}

export function encodeQuery(params: WireListParams): string {
  throw new Error("not implemented")
}

export function encodeValue(value: unknown): string {
  throw new Error("not implemented")
}
