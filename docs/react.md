# React hooks

`@sysonejs/react` has three hooks over the [client](./client.md): `useList` for lists, `useGet` for one row, and `useSelect` for pickers. They read from the client's shared cache, so a row changed in one component updates in every other one. The package needs React 18 or later.

```sh
npm install sysonejs @sysonejs/react
```

The recipes on this page use this API and client:

<!-- file: api.ts -->
```ts
import { defineModel, memory, sysone } from "sysonejs"
import { z } from "zod"

const user = defineModel({
  name: "user",
  schema: z.object({ id: z.uuid(), name: z.string() }),
  search: ["name"],
  sort: ["name"],
  access: () => ({ read: true }),
})

const ticket = defineModel({
  name: "ticket",
  schema: z.object({
    id: z.uuid(),
    title: z.string().min(1).max(200),
    status: z.enum(["open", "pending", "closed"]),
    priority: z.number().int().min(0).max(3),
    assigneeId: z.uuid().nullable(),
    createdAt: z.date().default(() => new Date()),
  }),
  write: ["title", "status", "priority", "assigneeId", "createdAt"],
  search: ["title"],
  filter: ["status", "priority", "assigneeId", "createdAt"],
  sort: ["priority", "createdAt"],
  defaultSort: ["-createdAt"],
  relations: { assignee: { model: "user", key: "assigneeId" } },
  access: () => ({ read: true, create: true, update: true }),
})

export const api = sysone({ basePath: "/api", models: [ticket.from(memory()), user.from(memory())] })
export type Api = typeof api
```

`createdAt` is in `write` with a default, because `memory()` does not fill fields on its own. With a database source, leave it out of `write` and give the column a default.

<!-- file: db.ts -->
```ts
import { createClient } from "sysonejs/client"
import type { Api } from "./api.ts"

export const db = createClient<Api>({ url: "/api" })
```

## useList

`useList(ref, params?, options?)` loads a list and keeps it current.

<!-- file: open-tickets.tsx -->
```tsx
import { useList } from "@sysonejs/react"
import { db } from "./db.ts"

export function OpenTickets() {
  const list = useList(db.ticket, { filter: { status: "open" }, sort: ["-priority"], include: ["assignee"] })
  if (list.error) return <p>{list.error.message}</p>
  return (
    <ul>
      {list.items.map((t) => (
        <li key={t.id}>
          {t.title}, {t.assignee?.name ?? "unassigned"}
        </li>
      ))}
    </ul>
  )
}
```

| Param | Meaning |
|---|---|
| `search` | Search text. See [Search](./querying.md#search). |
| `filter` | Filters by field. See [Filters](./querying.md#filters). |
| `sort` | Up to 3 sort fields. See [Sort](./querying.md#sort). |
| `include` | Relations to join into each item. |
| `limit` | Rows per page. |

| Option | Default | Meaning |
|---|---|---|
| `debounce` | none | Milliseconds to wait after `search` changes before sending it. Other params apply at once. |
| `enabled` | `true` | With `false`, the hook sends no request and returns an empty, idle result. |

Pass params inline. The hook compares them by value, so a new object with the same content on each render does not send a request.

| Result | Meaning |
|---|---|
| `items` | The rows. Each included relation is the related row or `null`. |
| `ids` | The ids as strings, in the same order. |
| `loading` | `true` while any request for this list runs: the first load, `loadMore`, or a reload after a write. |
| `error` | The last error, or `undefined`. Rows from before the error stay in `items`. |
| `hasMore` | `true` when another page exists. |
| `loadMore()` | Loads the next page and appends it. |
| `refetch()` | Reloads every loaded page. |

`loading` is also `true` during background reloads. To show a placeholder only on the first load, check `list.loading && !list.items.length`.

## useGet

`useGet(ref, id, options?)` loads one row.

| Option | Meaning |
|---|---|
| `include` | Relations to join into the row. |
| `enabled` | With `false`, the hook sends no request. |

| Result | Meaning |
|---|---|
| `data` | The row. `undefined` before the first response or when `id` is `null` or `undefined`. `null` when the row does not exist, the caller may not read it, or it was deleted. |
| `loading` | `true` while a request runs. |
| `error` | The last error, or `undefined`. |
| `refetch()` | Reloads the row. |

When the row and its includes are already in the cache, for example because a list loaded them, `useGet` shows them without a request.

## useSelect

`useSelect(ref, options)` is a list with search state and a selected value, for selects, comboboxes, and relation pickers.

| Option | Default | Meaning |
|---|---|---|
| `label` | required | A field name such as `"name"`, or a function from item to text. |
| `value` | none | The selected id, or `null`. |
| `debounce` | `250` | Milliseconds to wait after typing before searching. |
| `enabled` | `true` | With `false`, the hook sends no request. |
| `filter`, `sort`, `include`, `limit` | | The same as in `useList`. |

| Result | Meaning |
|---|---|
| `options` | `{ value, label, item }` for each loaded row. `value` is the id as a string. `item` is the typed row. |
| `selected` | The option for `value`, or `undefined`. |
| `search` | The current search text. |
| `onSearch(text)` | Sets the search text. Connect it to the input. |
| `loading`, `error`, `hasMore`, `loadMore()` | The same as in `useList`. |

The selected value shows even when it is not on the loaded page. If the list has finished loading and `value` is not in it, the hook loads that row by id, with the same `include`. If the row is on the page, it makes no extra request.

## Recipes

### Combobox

A search box with a list of matches, built from plain elements. Swap in your design system's combobox and pass the same fields.

<!-- file: user-combobox.tsx -->
```tsx
import { useSelect } from "@sysonejs/react"
import { db } from "./db.ts"

export function UserCombobox(props: { value: string | null; onChange: (id: string) => void }) {
  const s = useSelect(db.user, { value: props.value, label: "name", sort: ["name"] })
  return (
    <div>
      <input value={s.search} onChange={(e) => s.onSearch(e.target.value)} placeholder={s.selected?.label ?? "Search users"} />
      <ul>
        {s.options.map((o) => (
          <li key={o.value}>
            <button type="button" onClick={() => props.onChange(o.item.id)}>
              {o.label}
            </button>
          </li>
        ))}
      </ul>
      {s.hasMore && (
        <button type="button" onClick={s.loadMore}>
          More
        </button>
      )}
    </div>
  )
}
```

### Relation picker

A native select that sets a ticket's assignee. It saves on change, and every list that shows the ticket updates.

<!-- file: assignee-picker.tsx -->
```tsx
import { useSelect } from "@sysonejs/react"
import { db } from "./db.ts"

export function AssigneePicker(props: { ticketId: string; assigneeId: string | null }) {
  const s = useSelect(db.user, { value: props.assigneeId, label: "name", sort: ["name"], limit: 100 })
  return (
    <select
      value={props.assigneeId ?? ""}
      onChange={(e) => db.ticket.update(props.ticketId, { assigneeId: e.target.value || null })}
    >
      <option value="">Unassigned</option>
      {s.selected && !s.options.includes(s.selected) && <option value={s.selected.value}>{s.selected.label}</option>}
      {s.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
```

### Table with filters and sort

Keep the filter and sort in state and pass them to `useList`. The hook loads again when they change.

<!-- file: ticket-table.tsx -->
```tsx
import { useList } from "@sysonejs/react"
import { useState } from "react"
import { db } from "./db.ts"

type Status = "open" | "pending" | "closed"
type Sort = "priority" | "-priority" | "createdAt" | "-createdAt"

export function TicketTable() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<Status[]>(["open", "pending"])
  const [sort, setSort] = useState<Sort>("-createdAt")
  const list = useList(
    db.ticket,
    { search, filter: { status }, sort: [sort], include: ["assignee"], limit: 50 },
    { debounce: 250, enabled: status.length > 0 },
  )

  const toggle = (s: Status) => setStatus(status.includes(s) ? status.filter((x) => x !== s) : [...status, s])
  const sortBy = (field: "priority" | "createdAt") => setSort(sort === `-${field}` ? field : `-${field}`)

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
      {(["open", "pending", "closed"] as const).map((s) => (
        <label key={s}>
          <input type="checkbox" checked={status.includes(s)} onChange={() => toggle(s)} /> {s}
        </label>
      ))}
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Assignee</th>
            <th onClick={() => sortBy("priority")}>Priority</th>
            <th onClick={() => sortBy("createdAt")}>Created</th>
          </tr>
        </thead>
        <tbody>
          {list.items.map((t) => (
            <tr key={t.id}>
              <td>{t.title}</td>
              <td>{t.assignee?.name ?? ""}</td>
              <td>{t.priority}</td>
              <td>{t.createdAt.toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.hasMore && <button onClick={list.loadMore}>More</button>}
    </div>
  )
}
```

`enabled: status.length > 0` matters here. An empty status list sends no filter, which would show every ticket instead of none.

### Infinite scroll

Call `loadMore` when a marker at the end of the list scrolls into view. `loadMore` does nothing while a load runs, so repeated calls are safe.

<!-- file: infinite.tsx -->
```tsx
import { useList } from "@sysonejs/react"
import { useEffect, useRef } from "react"
import { db } from "./db.ts"

export function TicketFeed() {
  const list = useList(db.ticket, { sort: ["-createdAt"], limit: 30 })
  const end = useRef<HTMLDivElement>(null)
  const { hasMore, loadMore } = list

  useEffect(() => {
    if (!hasMore || !end.current) return
    const seen = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore()
    })
    seen.observe(end.current)
    return () => seen.disconnect()
  }, [hasMore, loadMore])

  return (
    <div>
      {list.items.map((t) => (
        <article key={t.id}>{t.title}</article>
      ))}
      <div ref={end} />
    </div>
  )
}
```

### Detail page

`useGet` with an include. Check `undefined` for loading and `null` for not found.

<!-- file: ticket-page.tsx -->
```tsx
import { useGet } from "@sysonejs/react"
import { db } from "./db.ts"

export function TicketPage(props: { id: string }) {
  const { data: ticket, error } = useGet(db.ticket, props.id, { include: ["assignee"] })
  if (error) return <p>{error.message}</p>
  if (ticket === undefined) return <p>Loading</p>
  if (ticket === null) return <p>Ticket not found</p>
  return (
    <article>
      <h1>{ticket.title}</h1>
      <p>
        {ticket.status}, assigned to {ticket.assignee?.name ?? "nobody"}
      </p>
    </article>
  )
}
```

### Form with useActionState

Writes are promises, so React 19's `useActionState` gives you the pending state. Show the server's validation messages by field from `SysoneClientError.issues`.

<!-- file: new-ticket.tsx -->
```tsx
import { SysoneClientError } from "sysonejs/client"
import { useActionState } from "react"
import { db } from "./db.ts"

type Issues = { readonly [field: string]: string }

export function NewTicket() {
  const [issues, submit, pending] = useActionState(async (_: Issues, form: FormData): Promise<Issues> => {
    try {
      await db.ticket.create({ title: String(form.get("title")), status: "open", priority: 1, assigneeId: null })
      return {}
    } catch (e) {
      if (e instanceof SysoneClientError && e.code === "invalid_body") return e.issues
      throw e
    }
  }, {})

  return (
    <form action={submit}>
      <input name="title" />
      {issues.title && <p>{issues.title}</p>}
      <button disabled={pending}>Create</button>
    </form>
  )
}
```

After the create succeeds, every list of tickets on the page reloads and shows the new row.

## Server rendering

The hooks do not support server rendering in 0.1.0. They use `useSyncExternalStore` without a server snapshot, so rendering them on the server throws `Missing getServerSnapshot`. In frameworks that pre-render client components, such as Next.js, render components that use these hooks only in the browser.
