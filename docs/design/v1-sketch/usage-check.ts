import { z } from "zod"
import { defineModel, fetchHandler, memory, sysone } from "./pkg-sysonejs"
import { createClient } from "./pkg-sysonejs-client"
import { useGet, useList, useSelect } from "./react"
import { expressHandler } from "./express"
import { pg } from "./sql"

type Ctx = { tenantId: string; userId: string; role: "admin" | "member" | "viewer" } | null

export const category = defineModel({
  name: "category",
  schema: z.object({
    id: z.number().int(),
    name: z.string().min(1).max(80),
    parentId: z.number().int().nullable(),
    createdAt: z.date(),
  }),
  write: ["name", "parentId"],
  search: ["name"],
  filter: ["parentId"],
  sort: ["name", "createdAt"],
  relations: { parent: { model: "category", key: "parentId" } },
  access: (ctx: Ctx) => ({ read: true, create: ctx?.role === "admin", update: ctx?.role === "admin" }),
})

const user = defineModel({
  name: "user",
  schema: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  search: ["name"],
  sort: ["name"],
})

const ticket = defineModel({
  name: "ticket",
  schema: z.object({
    id: z.uuid(),
    title: z.string().min(1),
    status: z.enum(["open", "pending", "closed"]),
    priority: z.number().int().min(0).max(3),
    assigneeId: z.uuid().nullable(),
    createdAt: z.date(),
  }),
  write: ["title", "status", "priority", "assigneeId"],
  search: ["title"],
  filter: ["status", "priority", "assigneeId", "createdAt"],
  sort: ["priority", "createdAt"],
  defaultSort: ["-createdAt"],
  relations: { assignee: { model: "user", key: "assigneeId" } },
  access: (ctx: Ctx) => (ctx ? { read: true, update: true } : {}),
})

export const project = defineModel({
  name: "project",
  schema: z.object({
    id: z.uuid(),
    tenantId: z.uuid(),
    ownerId: z.uuid(),
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

declare const pool: Parameters<typeof pg>[0]

export const api = sysone({
  basePath: "/api",
  models: [
    category.from(memory()),
    user.from(pg(pool, "users")),
    ticket.from(pg(pool, "tickets", { columns: { assigneeId: "assignee_id", createdAt: "created_at" } })),
    project.from(pg(pool, "projects")),
  ],
})
export type Api = typeof api

export const bun = fetchHandler(api, { context: (req) => (req.headers.get("x-tenant") ? null : null) })
export const mw = expressHandler(api, { context: () => null })

const db = createClient<Api>({ url: "/api" })

export function categoryPicker(value: number | null) {
  const s = useSelect(db.category, {
    value,
    include: ["parent"],
    label: (c) => (c.parent ? `${c.parent.name} / ${c.name}` : c.name),
    sort: ["name"],
  })
  const id: number | undefined = s.selected?.item.id
  return id
}

export function ticketTable(f: { search: string; status: ("open" | "pending" | "closed")[]; me?: string; since?: Date }) {
  const t = useList(
    db.ticket,
    {
      search: f.search,
      filter: {
        status: f.status,
        assigneeId: f.me,
        createdAt: f.since ? { gte: f.since } : undefined,
      },
      sort: ["-priority", "createdAt"],
      include: ["assignee"],
      limit: 50,
    },
    { debounce: 250 },
  )
  return t.items.map((row) => {
    const name: string | undefined = row.assignee?.name
    const day: string = row.createdAt.toLocaleDateString()
    void db.ticket.update(row.id, { status: "closed" })
    return [row.title, name, day]
  })
}

export async function projects(showArchived: boolean) {
  const list = useList(db.project, { filter: { archived: showArchived }, sort: ["-createdAt"] })
  const created = await db.project.create({ name: "Roadmap" })
  const tenant: string = created.tenantId
  await db.project.update(created.id, { archived: true })
  await db.project.delete(created.id)
  const one = useGet(db.project, created.id)
  return [list.items.length, tenant, one.data?.name]
}
