import { escapeLike, expandAfter, type Binding, type Cond, type Row, type Source, type Store } from "sysonejs/source"

export interface PgPool {
  query(text: string, values: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>
}

export interface MysqlPool {
  query(options: { sql: string; values: unknown[]; supportBigNumbers: boolean }): Promise<[unknown, unknown]>
}

export interface SqlOptions {
  readonly columns?: { readonly [field: string]: string }
}

interface Result {
  readonly rows: Row[]
  readonly affected: number
  readonly insertId?: unknown
}

type Exec = (sql: string, values: unknown[]) => Promise<Result>

interface Dialect {
  readonly name: "pg" | "mysql"
  readonly quote: string
  readonly like: string
  readonly emptyInsert: string
  readonly returning: boolean
  readonly rowCompare: boolean
  param(values: unknown[], value: unknown): string
  in(placeholder: string): string
}

const PG: Dialect = {
  name: "pg",
  quote: '"',
  like: "ILIKE",
  emptyInsert: "DEFAULT VALUES",
  returning: true,
  rowCompare: true,
  param: (values, value) => `$${values.push(value)}`,
  in: (p) => `= ANY(${p})`,
}

const MYSQL: Dialect = {
  name: "mysql",
  quote: "`",
  like: "LIKE",
  emptyInsert: "() VALUES ()",
  returning: false,
  rowCompare: false,
  param: (values, value) => (values.push(value), "?"),
  in: (p) => `IN (${p})`,
}

export function pg(pool: PgPool, table: string, options: SqlOptions = {}): Source<Row> {
  const exec: Exec = async (sql, values) => {
    const r = await pool.query(sql, values)
    return { rows: r.rows, affected: r.rowCount ?? 0 }
  }
  return { name: "pg", bind: (binding) => sqlStore(PG, exec, binding, table, options) }
}

export function mysql(pool: MysqlPool, table: string, options: SqlOptions = {}): Source<Row> {
  const exec: Exec = async (sql, values) => {
    const [r] = await pool.query({ sql, values, supportBigNumbers: true })
    if (Array.isArray(r)) return { rows: r as Row[], affected: 0 }
    const h = r as { affectedRows: number; insertId: unknown }
    return { rows: [], affected: h.affectedRows, insertId: h.insertId }
  }
  return { name: "mysql", bind: (binding) => sqlStore(MYSQL, exec, binding, table, options) }
}

const OPS = { eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const

function where(d: Dialect, col: (field: string) => string, cond: Cond, values: unknown[]): string {
  switch (cond.op) {
    case "and":
    case "or":
      return `(${cond.of.map((c) => where(d, col, c, values)).join(cond.op === "and" ? " AND " : " OR ")})`
    case "eq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return `${col(cond.field)} ${OPS[cond.op]} ${d.param(values, cond.value)}`
    case "in":
      return `${col(cond.field)} ${d.in(d.param(values, cond.values))}`
    case "null":
      return `${col(cond.field)} IS NULL`
    case "contains": {
      const term = `%${escapeLike(cond.term)}%`
      return `(${cond.fields.map((f) => `${col(f)} ${d.like} ${d.param(values, term)}`).join(" OR ")})`
    }
    case "after": {
      const [first, ...rest] = cond.keys
      if (!d.rowCompare || !rest.length || rest.some((k) => k.dir !== first.dir)) return where(d, col, expandAfter(cond), values)
      const keys = cond.keys.map((k) => col(k.field)).join(", ")
      const at = cond.keys.map((k) => d.param(values, k.value)).join(", ")
      return `(${keys}) ${first.dir === "asc" ? ">" : "<"} (${at})`
    }
    default: {
      const unknown: never = cond
      throw new Error(`Unknown condition ${JSON.stringify(unknown)}`)
    }
  }
}

function sqlStore(d: Dialect, exec: Exec, binding: Binding, table: string, options: SqlOptions): Store {
  const ident = (name: string) => name.split(".").map((p) => d.quote + p.replaceAll(d.quote, d.quote + d.quote) + d.quote).join(".")
  const t = ident(table)
  const fields = binding.fields.map((f) => f.name)
  const cols = new Map(fields.map((f) => [f, ident(options.columns?.[f] ?? f)]))
  const exprs = new Map(fields.map((f) => [f, cols.get(f) === ident(f) ? ident(f) : `${cols.get(f)} AS ${ident(f)}`]))
  const col = (field: string) => cols.get(field) ?? ident(field)
  const pick = (select: readonly string[]) => select.map((f) => exprs.get(f) ?? ident(f)).join(", ")
  const all = pick(fields)
  const uuid = binding.fields.find((f) => f.name === binding.id)?.kind === "string"

  const first = async (cond: Cond): Promise<Row | null> => {
    const values: unknown[] = []
    return (await exec(`SELECT ${all} FROM ${t} WHERE ${where(d, col, cond, values)} LIMIT 1`, values)).rows[0] ?? null
  }

  const write = async (sql: string, values: unknown[], readBack: (r: Result) => Cond): Promise<Row | null> =>
    d.returning ? ((await exec(`${sql} RETURNING ${all}`, values)).rows[0] ?? null) : first(readBack(await exec(sql, values)))

  return {
    async find(plan) {
      const values: unknown[] = []
      const w = plan.where ? ` WHERE ${where(d, col, plan.where, values)}` : ""
      const order = plan.sort.map((k) => `${col(k.field)} ${k.dir === "asc" ? "ASC" : "DESC"}`).join(", ")
      return (await exec(`SELECT ${pick(plan.select)} FROM ${t}${w} ORDER BY ${order} LIMIT ${d.param(values, plan.take)}`, values)).rows
    },
    async insert(input) {
      const row = uuid && input[binding.id] === undefined ? { ...input, [binding.id]: crypto.randomUUID() } : input
      const values: unknown[] = []
      const names: string[] = []
      const params: string[] = []
      for (const f of fields)
        if (row[f] !== undefined) {
          names.push(col(f))
          params.push(d.param(values, row[f]))
        }
      const sql = `INSERT INTO ${t} ${names.length ? `(${names.join(", ")}) VALUES (${params.join(", ")})` : d.emptyInsert}`
      const out = await write(sql, values, (r) => ({ op: "eq", field: binding.id, value: (row[binding.id] ?? r.insertId) as string }))
      if (!out) throw new Error(`${d.name}: inserted row not found in ${table}`)
      return out
    },
    async update(cond, patch) {
      const values: unknown[] = []
      const set: string[] = []
      for (const f of fields) if (patch[f] !== undefined) set.push(`${col(f)} = ${d.param(values, patch[f])}`)
      if (!set.length) return first(cond)
      return write(`UPDATE ${t} SET ${set.join(", ")} WHERE ${where(d, col, cond, values)}`, values, () => cond)
    },
    async remove(cond) {
      const values: unknown[] = []
      return (await exec(`DELETE FROM ${t} WHERE ${where(d, col, cond, values)}`, values)).affected > 0
    },
  }
}
