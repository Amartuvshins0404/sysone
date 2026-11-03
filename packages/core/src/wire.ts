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
