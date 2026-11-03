import { z } from "zod"
import type { ContractsOf, ListParams, SortSpec } from "../../packages/core/src/contract"
import { defineModel, fetchHandler, memory, sysone } from "../../packages/core/src/index"

type Ctx = { tenantId: string; userId: string; role: "admin" | "member" | "viewer" } | null

const category = defineModel({
  name: "category",
  schema: z.object({ id: z.number().int(), name: z.string(), parentId: z.number().int().nullable(), createdAt: z.date() }),
  write: ["name", "parentId"],
  search: ["name"],
  filter: ["parentId"],
  sort: ["name", "createdAt"],
  relations: { parent: { model: "category", key: "parentId" } },
  access: (ctx: Ctx) => ({ read: true, create: ctx?.role === "admin" }),
})

const user = defineModel({
  name: "user",
  schema: z.object({ id: z.uuid(), name: z.string() }),
  sort: ["name"],
  access: () => ({ read: true }),
})

const ticket = defineModel({
  name: "ticket",
  schema: z.object({
    id: z.uuid(),
    title: z.string(),
    status: z.enum(["open", "pending", "closed"]),
    priority: z.number().int(),
    assigneeId: z.uuid().nullable(),
    createdAt: z.date(),
  }),
  write: ["title", "status", "priority", "assigneeId"],
  filter: ["status", "priority", "assigneeId", "createdAt"],
  sort: ["priority", "createdAt"],
  relations: { assignee: { model: "user", key: "assigneeId" } },
  access: (ctx: Ctx) => (ctx ? { read: true, update: true } : {}),
})

const project = defineModel({
  name: "project",
  schema: z.object({ id: z.uuid(), tenantId: z.uuid(), name: z.string(), archived: z.boolean().default(false) }),
  write: ["name", "archived"],
  sort: ["name"],
  access: (ctx: Ctx) => (ctx ? { read: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId } } : {}),
})

const api = sysone({ models: [category.from(memory()), user.from(memory()), ticket.from(memory()), project.from(memory())] })
type Cs = ContractsOf<typeof api>

export const valid = {
  create: { name: "Roadmap", archived: true } satisfies Cs["project"]["create"],
  patch: { archived: false } satisfies Cs["project"]["patch"],
  filter: { status: ["open", "pending"], assigneeId: null, createdAt: { gte: new Date() } } satisfies Cs["ticket"]["filter"],
  sort: ["-priority", "createdAt", "id"] satisfies SortSpec<Cs["ticket"]["sort"]>[],
  include: { include: ["parent"] } satisfies ListParams<Cs["category"], readonly ["parent"]>,
  handler: fetchHandler(api, { context: () => ({ tenantId: "t", userId: "u", role: "admin" as const }) }),
}

export const writeOutsideWrite: Cs["project"]["create"] = {
  name: "x",
  // @ts-expect-error tenantId is stamped by the access rule, not writable
  tenantId: "t",
}

export const patchOutsideWrite: Cs["project"]["patch"] = {
  // @ts-expect-error tenantId is not in write, so it is not patchable either
  tenantId: "t",
}

export const filterOutsideAllowlist: Cs["ticket"]["filter"] = {
  // @ts-expect-error title is not in the filter allowlist
  title: "x",
}

// @ts-expect-error title is not in the sort allowlist
export const sortOutsideAllowlist: SortSpec<Cs["ticket"]["sort"]> = "-title"

export const rangeOnEnumListOnly: Cs["ticket"]["filter"] = {
  // @ts-expect-error a value outside the enum
  status: "archived",
}

defineModel({
  name: "bad",
  schema: z.object({ id: z.number(), name: z.string(), parentId: z.number().nullable() }),
  // @ts-expect-error parentId is nullable, so keyset paging on it is not allowed
  sort: ["parentId"],
})

defineModel({
  name: "bad",
  schema: z.object({ id: z.number(), name: z.string() }),
  // @ts-expect-error nope is not a field
  filter: ["nope"],
})

defineModel({
  name: "bad",
  schema: z.object({ id: z.number(), name: z.string() }),
  // @ts-expect-error nope is not a field
  write: ["nope"],
})

defineModel({
  name: "bad",
  schema: z.object({ id: z.number(), name: z.string() }),
  // @ts-expect-error a create rule stamps one value per field
  access: () => ({ create: { name: ["a", "b"] } }),
})

// @ts-expect-error category has no relation named nope
export type UnknownInclude = ListParams<Cs["category"], readonly ["nope"]>

// @ts-expect-error the source has no parentId or createdAt column
category.from(memory<{ id: number; name: string }>())

// @ts-expect-error ticket.assignee targets user, which is not served
sysone({ models: [ticket.from(memory())] })

// @ts-expect-error context must return the models' Ctx
fetchHandler(api, { context: () => 42 })
