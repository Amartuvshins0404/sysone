import { defineModel } from "sysonejs"
import { z } from "zod"

export type Ctx = { tenantId: string; userId: string; role: "admin" | "member" | "viewer" } | null

const roles = new Set(["admin", "member", "viewer"])

export function ctxFrom(header: (name: string) => string | null | undefined): Ctx {
  const tenantId = header("x-tenant")
  const role = header("x-role") ?? "member"
  if (!tenantId) return null
  return { tenantId, userId: header("x-user") ?? "", role: roles.has(role) ? (role as "admin" | "member" | "viewer") : "viewer" }
}

export const category = defineModel({
  name: "category",
  schema: z.object({
    id: z.number().int(),
    name: z.string().min(1).max(80),
    parentId: z.number().int().nullable(),
    active: z.boolean(),
    size: z.bigint(),
    createdAt: z.date(),
  }),
  write: ["name", "parentId", "active"],
  search: ["name"],
  filter: ["parentId", "active", "createdAt", "size"],
  sort: ["name", "createdAt"],
  relations: { parent: { model: "category", key: "parentId" } },
  access: (ctx: Ctx) => {
    const admin = ctx?.role === "admin"
    return { read: true, create: admin, update: admin, delete: admin }
  },
})

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

export const task = defineModel({
  name: "task",
  schema: z.object({ id: z.number().int(), projectId: z.string(), title: z.string() }),
  relations: { project: { model: "project", key: "projectId" } },
  access: (ctx: Ctx) => (ctx ? { read: true } : {}),
})

export const secret = defineModel({
  name: "secret",
  schema: z.object({ id: z.number().int(), value: z.string() }),
})
