import type { Cond, Row, SortKey, Source, Value } from "./source"

export function memory<R extends Row = Row>(rows?: R[]): Source<R> {
  throw new Error("not implemented")
}

export function matches(cond: Cond, row: Row): boolean {
  throw new Error("not implemented")
}

export function compareRows(sort: readonly SortKey[], a: Row, b: Row): number {
  throw new Error("not implemented")
}

export function compareValues(a: Value, b: Value): number {
  throw new Error("not implemented")
}
