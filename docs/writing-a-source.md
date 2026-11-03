# Writing a source

A source connects models to a database that sysone does not support yet. The core parses the request, applies access rules, plans keyset paging, and encodes the response. A source receives a small condition tree and runs it, so a new source is about 60 to 120 lines.

Everything on this page comes from `sysonejs/source`.

## The contract

A source is an object with a name and a `bind` function. `sysone()` calls `bind` once per model, and `bind` returns a store for that model.

| Type | Shape |
|---|---|
| `Source<R>` | `{ name: string; bind(binding: Binding): Store }`. `R` is the row type that `.from()` checks columns against. |
| `Binding` | `{ model: string; id: string; fields: FieldSpec[] }`: the model's name, its id field, and all its fields. |
| `FieldSpec` | `{ name: string; kind: FieldKind; nullable: boolean }` |
| `FieldKind` | `"string"`, `"number"`, `"boolean"`, `"date"`, `"bigint"`, or `"json"` |
| `Store` | The four methods below. |

| Method | Must do |
|---|---|
| `find(plan)` | Return rows that match `plan.where`, ordered by `plan.sort`, at most `plan.take` of them. Each row needs at least the fields in `plan.select`. |
| `insert(row)` | Store the row and return it as stored, with its id. If `row` has no id, the source or the database creates one. |
| `update(where, patch)` | Apply `patch` to the one row that matches `where` and return the updated row, or `null` if no row matches. |
| `remove(where)` | Delete the one row that matches `where`. Return `true` if a row was deleted. |

`where` in `update` and `remove` always includes the id, plus the access rule's match. Running it as one statement is what keeps a caller from changing a row outside their scope.

| `FindPlan` field | Meaning |
|---|---|
| `where` | A `Cond`, or `null` for every row. |
| `sort` | One or more `{ field, dir }` keys, `dir` being `"asc"` or `"desc"`. The last key is always the id. |
| `take` | The most rows to return. |
| `select` | The fields to return. |

Return values as your driver gives them, within these limits:

- Dates may be `Date` objects or ISO strings.
- Bigints may be `bigint`, number, or string values.
- Booleans may be `true` and `false`, or `1` and `0`.
- Extra fields are fine. The core removes fields that are not in the model.

## The condition tree

`Cond` is a tree of these nodes. Values are `string`, `number`, `boolean`, `bigint`, or `Date`.

| Node | Matches rows where |
|---|---|
| `{ op: "and", of: [a, b, ...] }` | every child matches. Always 2 or more children. |
| `{ op: "or", of: [a, b, ...] }` | any child matches. Always 2 or more children. |
| `{ op: "eq", field, value }` | the field equals the value |
| `{ op: "gt" \| "gte" \| "lt" \| "lte", field, value }` | the field compares to the value as named |
| `{ op: "in", field, values: [a, b, ...] }` | the field equals one of the values. Always 2 or more values. |
| `{ op: "null", field }` | the field is empty |
| `{ op: "contains", fields: [f, ...], term }` | any of the fields contains `term`, ignoring case. `term` is literal text. |
| `{ op: "after", keys: [{ field, dir, value }, ...] }` | the row comes after this position in the sort order. Used for keyset paging. |

Two helpers cover the harder nodes:

- `expandAfter(node)` rewrites an `after` node into `or`, `and`, `eq`, `gt`, and `lt` nodes. Call it and translate the result. A database with row comparison, such as Postgres, can translate `after` directly when all keys share one direction, which is what `@sysonejs/sql` does.
- `escapeLike(term)` puts a backslash before `\`, `%`, and `_`, so that the term matches itself inside a SQL `LIKE` pattern.

## A complete source

This source keeps rows in an array. It is short, and it passes every test in `testSource`.

<!-- file: array-source.ts -->
```ts
import { expandAfter, type Binding, type Cond, type Row, type Source, type Store } from "sysonejs/source"

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : a
  const y = b instanceof Date ? b.getTime() : b
  return x === y ? 0 : (x as number) < (y as number) ? -1 : 1
}

function test(cond: Cond, row: Row): boolean {
  switch (cond.op) {
    case "and":
      return cond.of.every((c) => test(c, row))
    case "or":
      return cond.of.some((c) => test(c, row))
    case "null":
      return row[cond.field] == null
    case "in":
      return row[cond.field] != null && cond.values.some((v) => compare(row[cond.field], v) === 0)
    case "contains": {
      const term = cond.term.toLowerCase()
      return cond.fields.some((f) => String(row[f] ?? "").toLowerCase().includes(term))
    }
    case "after":
      return test(expandAfter(cond), row)
    default: {
      if (row[cond.field] == null) return false
      const c = compare(row[cond.field], cond.value)
      if (cond.op === "eq") return c === 0
      if (cond.op === "gt") return c > 0
      if (cond.op === "gte") return c >= 0
      if (cond.op === "lt") return c < 0
      return c <= 0
    }
  }
}

export function arraySource(rows: Row[]): Source {
  return {
    name: "array",
    bind(binding: Binding): Store {
      let lastId = rows.reduce((n, r) => Math.max(n, Number(r[binding.id]) || 0), 0)
      const pick = (row: Row, fields: readonly string[]) => Object.fromEntries(fields.map((f) => [f, row[f] ?? null]))
      return {
        async find(plan) {
          const found = rows.filter((r) => !plan.where || test(plan.where, r))
          found.sort((a, b) => {
            for (const k of plan.sort) {
              const c = compare(a[k.field], b[k.field])
              if (c) return k.dir === "asc" ? c : -c
            }
            return 0
          })
          return found.slice(0, plan.take).map((r) => pick(r, plan.select))
        },
        async insert(row) {
          const stored = { ...row, [binding.id]: row[binding.id] ?? ++lastId }
          rows.push(stored)
          return { ...stored }
        },
        async update(where, patch) {
          const row = rows.find((r) => test(where, r))
          return row ? { ...Object.assign(row, patch) } : null
        },
        async remove(where) {
          const i = rows.findIndex((r) => test(where, r))
          if (i < 0) return false
          rows.splice(i, 1)
          return true
        },
      }
    },
  }
}
```

A SQL source translates the same nodes into a `WHERE` clause. This is how a `contains` node becomes a Postgres condition with `escapeLike`:

<!-- file: contains-sql.ts -->
```ts
import { escapeLike, type Cond } from "sysonejs/source"

export function containsSql(cond: Extract<Cond, { op: "contains" }>, values: unknown[]): string {
  const pattern = `%${escapeLike(cond.term)}%`
  return "(" + cond.fields.map((f) => `"${f}" ILIKE $${values.push(pattern)}`).join(" OR ") + ")"
}
```

Field names in a `Cond` come from the model, never from the request, but values do come from the request. Always pass values as query parameters.

## Test it

`testSource(open)` returns a list of test cases. `open(binding, seed)` must return a fresh store for an `item` model that holds the seed rows. The seed has a number id, two strings, one of them nullable, a number, a date, and a boolean, and it includes names with `%`, `_`, and `\` to test search escaping.

<!-- file: test-array-source.ts -->
```ts
import { testSource } from "sysonejs/source"
import { arraySource } from "./array-source.ts"

let failed = 0
for (const c of testSource(async (binding, seed) => arraySource(seed.map((r) => ({ ...r }))).bind(binding))) {
  try {
    await c.run()
    console.log(`ok    ${c.name}`)
  } catch (e) {
    failed++
    console.log(`FAIL  ${c.name}\n      ${(e as Error).message}`)
  }
}
process.exit(failed ? 1 : 0)
```

Run it:

```sh
node test-array-source.ts
```

Each case prints `ok` or `FAIL` with what differed:

```text
ok    find returns only plan.select fields, sorted and limited by take
ok    keyset pages ascending
ok    keyset pages descending
ok    keyset pages with mixed directions
ok    keyset pages combined with a filter
ok    contains is case-insensitive, ORs fields and treats % _ \ literally
ok    eq, in, null and their OR
ok    ranges on numbers and dates
ok    insert returns the stored row with its generated id
ok    update only touches a row inside the where
ok    remove only deletes a row inside the where
```

For a database source, let `open` create the table, insert the seed with your store's `insert`, and return the store. `spec/source-sql.ts` in this repository does that for Postgres and MySQL.

The cases test the store directly. To test the whole API, run your server with your source and point the wire spec at it: `node spec/run.ts http://localhost:3000`. That runner expects the example models and seed data in `examples/express`.
