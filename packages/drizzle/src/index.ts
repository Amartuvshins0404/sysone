import { and, asc, desc, eq, getTableColumns, gt, gte, ilike, inArray, is, isNull, like, lt, lte, or, sql, type Column, type InferSelectModel, type SQL, type Table } from "drizzle-orm"
import type { MySqlDatabase, MySqlTable } from "drizzle-orm/mysql-core"
import { PgTable, type PgColumn, type PgDatabase } from "drizzle-orm/pg-core"
import { escapeLike, expandAfter, type Binding, type Cond, type FindPlan, type Row, type Source, type Store } from "sysonejs/source"

export type DrizzleDb = PgDatabase<any, any, any> | MySqlDatabase<any, any, any, any>

type Columns = { readonly [field: string]: PgColumn }

const COMPARE = { eq, gt, gte, lt, lte }

export function drizzle<T extends Table>(db: DrizzleDb, table: T): Source<InferSelectModel<T>> {
  return { name: "drizzle", bind: (binding) => drizzleStore(db, table, binding) }
}

function drizzleStore(db: DrizzleDb, source: Table, binding: Binding): Store {
  const pg = is(source, PgTable)
  const table = source as PgTable
  const myTable = source as unknown as MySqlTable
  const all = getTableColumns(source) as Columns
  const col = (field: string) => all[field]!
  for (const f of binding.fields)
    if (!all[f.name]) throw new Error(`@sysonejs/drizzle: model "${binding.model}" has no column for field "${f.name}"`)
  const idCol = col(binding.id)
  const columns = (select: readonly string[]): Columns => Object.fromEntries(select.map((f) => [f, col(f)]))
  const every = columns(binding.fields.map((f) => f.name))
  const where = (cond: Cond) => toSql(cond, col, pg)
  const q = db as PgDatabase<any, any, any>
  const my = db as MySqlDatabase<any, any, any, any>
  const first = async (w: SQL): Promise<Row | null> => (await q.select(every).from(table).where(w).limit(1))[0] ?? null

  return {
    async find(plan: FindPlan) {
      return q
        .select(plan.select.length === binding.fields.length ? every : columns(plan.select))
        .from(table)
        .where(plan.where ? where(plan.where) : undefined)
        .orderBy(...plan.sort.map((k) => (k.dir === "asc" ? asc : desc)(col(k.field))))
        .limit(plan.take)
    },
    async insert(row) {
      if (pg) return (await q.insert(table).values(row).returning(every))[0]!
      const [made] = await my.insert(myTable).values(row).$returningId()
      return (await first(eq(idCol, (made as Row | undefined)?.[binding.id] ?? row[binding.id])))!
    },
    async update(cond, patch) {
      const w = where(cond)
      if (!Object.keys(patch).length) return first(w)
      if (pg) return (await q.update(table).set(patch).where(w).returning(every))[0] ?? null
      await my.update(myTable).set(patch).where(w)
      return first(w)
    },
    async remove(cond) {
      const w = where(cond)
      if (pg) return (await q.delete(table).where(w).returning({ id: idCol })).length > 0
      const r = (await my.delete(myTable).where(w)) as unknown as [{ affectedRows?: number }?] & { rowsAffected?: number }
      return (r[0]?.affectedRows ?? r.rowsAffected ?? 0) > 0
    },
  }
}

function toSql(cond: Cond, col: (field: string) => Column, pg: boolean): SQL {
  switch (cond.op) {
    case "and":
      return and(...cond.of.map((c) => toSql(c, col, pg)))!
    case "or":
      return or(...cond.of.map((c) => toSql(c, col, pg)))!
    case "eq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return COMPARE[cond.op](col(cond.field), cond.value)
    case "in":
      return inArray(col(cond.field), [...cond.values])
    case "null":
      return isNull(col(cond.field))
    case "contains": {
      const pattern = `%${escapeLike(cond.term)}%`
      const match = pg ? ilike : like
      return or(...cond.fields.map((f) => match(col(f), pattern)))!
    }
    case "after": {
      const dir = cond.keys[0].dir
      if (!pg || cond.keys.some((k) => k.dir !== dir)) return toSql(expandAfter(cond), col, pg)
      const cols = cond.keys.map((k) => col(k.field))
      const values = cond.keys.map((k, i) => sql.param(k.value, cols[i]))
      return sql`(${sql.join(cols, sql`, `)}) ${dir === "asc" ? sql`>` : sql`<`} (${sql.join(values, sql`, `)})`
    }
    default:
      return cond satisfies never
  }
}
