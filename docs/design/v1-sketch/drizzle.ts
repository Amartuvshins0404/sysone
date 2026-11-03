import type { InferSelectModel, SQL, Table } from "drizzle-orm"
import type { MySqlDatabase } from "drizzle-orm/mysql-core"
import type { PgDatabase } from "drizzle-orm/pg-core"
import type { Cond, Source } from "./source"

export type DrizzleDb = PgDatabase<any, any, any> | MySqlDatabase<any, any, any, any>

export function drizzle<T extends Table>(db: DrizzleDb, table: T): Source<InferSelectModel<T>> {
  throw new Error("not implemented")
}

function toSql(table: Table, cond: Cond): SQL {
  throw new Error("not implemented")
}
