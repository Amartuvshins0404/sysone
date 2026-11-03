# Access rules

Every model decides who may read, create, update, and delete which rows. You write that decision as one function, `access(ctx)`, next to the schema. The server applies it to every request, inside the same database statement as the request itself.

## The rule function

`access` receives the request context and returns one rule per action:

<!-- file: model.ts -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"

export type Ctx = { tenantId: string; userId: string; role: "admin" | "member" | "viewer" } | null

export const project = defineModel({
  name: "project",
  schema: z.object({
    id: z.string(),
    tenantId: z.string(),
    ownerId: z.string(),
    name: z.string().min(1).max(120),
    archived: z.boolean().default(false),
    createdAt: z.date(),
  }),
  write: ["name", "archived"],
  search: ["name"],
  filter: ["archived", "ownerId"],
  sort: ["name", "createdAt"],
  access: (ctx: Ctx) =>
    !ctx
      ? {}
      : {
          read: { tenantId: ctx.tenantId },
          create: ctx.role !== "viewer" && { tenantId: ctx.tenantId, ownerId: ctx.userId },
          update: ctx.role === "admin" ? { tenantId: ctx.tenantId } : { tenantId: ctx.tenantId, ownerId: ctx.userId },
          delete: ctx.role === "admin" && { tenantId: ctx.tenantId },
        },
})
```

- `ctx` is whatever your server's `context` function returns for the request. See [Servers](./servers.md#context).
- Always write the type of `ctx`. The type flows to the server handler, which then requires a `context` function that returns it.
- `access` runs once per request for the requested model. With `include`, it also runs once for each included model.
- `access` is synchronous. Load anything that needs a database call in the `context` function, which may be async.

Each action takes one of these rules:

| Rule | Effect |
|---|---|
| missing, `false`, or `undefined` | The action is denied with `403 forbidden`. |
| `true` | The action is allowed on every row. |
| `{ field: value }` | The action is allowed on rows where the field equals the value. Several fields must all match. |
| `{ field: [a, b] }` | The field must equal one of the values. |
| `{ field: null }` | The field must be empty. |
| `[{ ... }, { ... }]` | Read, update, and delete only. A row must match at least one of the objects. |

A few edge cases fail closed, so a missing value in `ctx` never opens every row:

- A match value of `undefined`, such as `{ tenantId: ctx.tenantId }` when `tenantId` is missing, denies the action.
- An empty list of values, `{ tenantId: [] }`, denies the action. The client gets `403`, not an empty page.
- An empty list of matches, `[]`, denies the action.
- An empty match object, `{}`, allows every row, the same as `true`.

## Closed by default

A model with no `access` function denies every action. Each request to it gets `403 forbidden`. Returning `{}` from `access` does the same.

## Reads, updates, and deletes are scoped

For a list, a get, an update, or a delete, the server adds the rule's match to the query's `WHERE` clause. A row outside the match looks the same as a row that does not exist.

With the project model, a member of tenant `t1` gets these results:

| Request | Result |
|---|---|
| `GET /api/project` | Only rows with `tenantId = "t1"`. Filters and search apply inside that set. |
| `GET /api/project/p3`, a project of tenant `t2` | `404 not_found` |
| `PATCH /api/project/p2`, a `t1` project owned by someone else | `404 not_found`, because a member's update rule also matches `ownerId` |
| `DELETE /api/project/p1` | `403 forbidden`, because members have no delete rule |

## Create stamps the scope into the row

For a create, the rule's match values are written into the new row. The create rule must give exactly one value per field. A list such as `{ tenantId: ["a", "b"] }` throws an error when the request runs, even though it compiles.

- If the field is not in `write`, the server drops any value the client sent and uses the rule's value. A member of `t1` who sends `{ "name": "New", "tenantId": "t2" }` creates a project in `t1`.
- If the field is in `write`, the client may send it. A value that differs from the rule's value gets `403 forbidden`.

`create: true` stores the body as sent, with no stamped fields.

## Updates cannot move a row out of scope

An update must find the row inside the update rule's match. The patch also may not move the row outside it:

- If a scoped field is in `write` and the patch sets it to a value outside the rule, the server returns `403 forbidden`. With `update: { tenantId: ["a", "b"] }`, a patch may move a row from `a` to `b` but not to `c`.
- If a scoped field is not in `write`, the server drops it from the patch, so the update cannot change it.

## 404 or 403

| Status | When |
|---|---|
| `403 forbidden` | The action's rule is missing or `false` for this caller, or a create or update body conflicts with the rule. |
| `404 not_found` | The rule allows the action, but no row with this id is inside the match. |

A `404` never tells a caller whether a row exists in another tenant. The client treats a `404` on delete as success, so deleting twice is safe.

## Included rows follow their own rules

When a list or get includes a relation, the server reads the related rows with the target model's `read` rule and the same `ctx`. A related row the caller may not read is left out, and the relation is `null` on the client. If the target model denies reads entirely, every included relation is `null`.

## Recipes

Each recipe is a complete model. The `Ctx` type comes from the first example on this page.

### Public read, admin writes

<!-- file: recipe-public.ts -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"
import type { Ctx } from "./model.ts"

export const category = defineModel({
  name: "category",
  schema: z.object({ id: z.number().int(), name: z.string().min(1) }),
  write: ["name"],
  sort: ["name"],
  access: (ctx: Ctx) => {
    const admin = ctx?.role === "admin"
    return { read: true, create: admin, update: admin, delete: admin }
  },
})
```

### Multi-tenant

Scope every action to the caller's tenant and leave `tenantId` out of `write`. The project model at the top of this page is the full version, with per-role write rules.

<!-- file: recipe-tenant.ts -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"
import type { Ctx } from "./model.ts"

export const invoice = defineModel({
  name: "invoice",
  schema: z.object({ id: z.string(), tenantId: z.string(), total: z.number() }),
  write: ["total"],
  access: (ctx: Ctx) => {
    if (!ctx) return {}
    const mine = { tenantId: ctx.tenantId }
    return { read: mine, create: mine, update: mine, delete: mine }
  },
})
```

### Owner only

Each user sees and changes only their own rows. The create rule stamps the owner.

<!-- file: recipe-owner.ts -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"
import type { Ctx } from "./model.ts"

export const note = defineModel({
  name: "note",
  schema: z.object({ id: z.string(), ownerId: z.string(), text: z.string() }),
  write: ["text"],
  access: (ctx: Ctx) => {
    if (!ctx) return {}
    const own = { ownerId: ctx.userId }
    return { read: own, create: own, update: own, delete: own }
  },
})
```

### Roles

Return a different rule for each role. Anything you leave out is denied.

<!-- file: recipe-roles.ts -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"
import type { Ctx } from "./model.ts"

export const article = defineModel({
  name: "article",
  schema: z.object({ id: z.number().int(), tenantId: z.string(), authorId: z.string(), title: z.string() }),
  write: ["title"],
  access: (ctx: Ctx) => {
    if (!ctx) return {}
    const tenant = { tenantId: ctx.tenantId }
    const own = { tenantId: ctx.tenantId, authorId: ctx.userId }
    switch (ctx.role) {
      case "admin":
        return { read: tenant, create: own, update: tenant, delete: tenant }
      case "member":
        return { read: tenant, create: own, update: own, delete: own }
      case "viewer":
        return { read: tenant }
    }
  },
})
```

### Published, or mine

A list of matches is an OR. Anyone can read published posts, and authors can also read their drafts.

<!-- file: recipe-published.ts -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"
import type { Ctx } from "./model.ts"

export const post = defineModel({
  name: "post",
  schema: z.object({ id: z.number().int(), authorId: z.string(), published: z.boolean(), title: z.string() }),
  write: ["title", "published"],
  access: (ctx: Ctx) => ({
    read: ctx ? [{ published: true }, { authorId: ctx.userId }] : { published: true },
    create: ctx ? { authorId: ctx.userId } : false,
    update: ctx ? { authorId: ctx.userId } : false,
  }),
})
```

### Membership from a lookup

Rules compare fields to values, so they cannot join another table. Load the ids the caller may see in the `context` function, then match on them. A caller with no memberships gets `403`, because an empty list denies the action.

<!-- file: recipe-members.ts -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"

export type MemberCtx = { userId: string; projectIds: string[] } | null

export const task = defineModel({
  name: "task",
  schema: z.object({ id: z.number().int(), projectId: z.string(), title: z.string() }),
  write: ["projectId", "title"],
  access: (ctx: MemberCtx) => {
    if (!ctx) return {}
    const member = { projectId: ctx.projectIds }
    return { read: member, update: member, delete: member }
  },
})
```

`projectId` is in `write`, so an update can move a task to another project the caller belongs to, but not to any other. There is no create rule, because a create rule takes one value per field and cannot accept "any of my projects". Create tasks in your own route for this case.

## Limits

- Rules compare fields for equality, any-of, and empty. There are no ranges, no "not equal", and no rules on related models.
- A rule cannot hide single fields. Every model field is sent to anyone who may read the row. To hide a field from some callers, define a second model with a smaller schema over the same table, with its own name.
- The create rule takes one value per field.

[Limitations](./limitations.md) lists what v0.1 does not do yet.
