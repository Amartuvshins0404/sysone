import type { Binding, Cond, FindPlan, Row, Source, Store } from "./source"

export interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>
}

export interface MysqlPool {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
}

export interface SqlOptions {
  readonly columns?: { readonly [field: string]: string }
}

export function pg(pool: PgPool, table: string, options?: SqlOptions): Source<Row> {
  throw new Error("not implemented")
}

export function mysql(pool: MysqlPool, table: string, options?: SqlOptions): Source<Row> {
  throw new Error("not implemented")
}

interface Dialect {
  readonly name: "pg" | "mysql"
  quote(identifier: string): string
  param(index: number): string
  readonly contains: "ILIKE" | "LIKE"
  readonly returning: boolean
  readonly rowCompare: boolean
  exec(sql: string, values: unknown[]): Promise<{ rows: Row[]; affected: number; insertId: unknown }>
}

interface Columns {
  readonly table: string
  readonly select: string
  col(field: string): string
}

function sqlStore(dialect: Dialect, binding: Binding, table: string, options: SqlOptions): Store {
  throw new Error("not implemented")
}

function where(dialect: Dialect, columns: Columns, cond: Cond, values: unknown[]): string {
  // TODO Cond -> SQL fragment, values pushed in order:
  //   and/or -> "(a AND b)" ; eq -> "c = $n" ; in -> pg "c = ANY($n)" / mysql "c IN (?, ?)" ; null -> "c IS NULL"
  //   contains -> "(c1 ILIKE $n OR c2 ILIKE $n)" with "%" + escapeLike(term) + "%"
  //   after -> dialect.rowCompare && all keys share one dir ? "(k1, k2) > ($a, $b)" : where(expandAfter(node))
  throw new Error("not implemented")
}

function select(dialect: Dialect, columns: Columns, plan: FindPlan, values: unknown[]): string {
  throw new Error("not implemented")
}
