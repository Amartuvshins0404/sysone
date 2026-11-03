import { z } from "zod"
import { createClient } from "../../packages/core/src/client"
import { defineModel, memory, sysone } from "../../packages/core/src/index"
import { useGet, useList, useSelect } from "../../packages/react/src/index"

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
  search: ["title"],
  filter: ["status", "priority", "assigneeId", "createdAt"],
  sort: ["priority", "createdAt"],
  relations: { assignee: { model: "user", key: "assigneeId" } },
  access: () => ({ read: true, update: true }),
})

const api = sysone({ models: [ticket.from(memory()), user.from(memory())] })
const db = createClient<typeof api>({ url: "/api" })

export function valid() {
  const list = useList(db.ticket, { search: "x", filter: { status: ["open", "pending"], createdAt: { gte: new Date() } }, sort: ["-priority"], include: ["assignee"] })
  const assignee: string | undefined = list.items[0]?.assignee?.name
  const created: Date | undefined = list.items[0]?.createdAt
  const picked = useSelect(db.ticket, { label: (t) => t.assignee?.name ?? t.title, include: ["assignee"], value: "id" }).selected?.item.assignee
  const byField = useSelect(db.user, { label: "name" }).options[0]?.item.name
  const one = useGet(db.ticket, "id", { include: ["assignee"] }).data?.assignee
  const live = db.ticket.watchList({ filter: { assigneeId: null } }).getSnapshot().items
  const written: Promise<{ status: "open" | "pending" | "closed" }> = db.ticket.update("id", { status: "closed" })
  return { assignee, created, picked, byField, one, live, written }
}

export function invalid() {
  const plain = useList(db.ticket)
  return [
    // @ts-expect-error title is not in the filter allowlist
    useList(db.ticket, { filter: { title: "x" } }),
    // @ts-expect-error title is not in the filter allowlist, through the client
    db.ticket.watchList({ filter: { title: "x" } }),
    // @ts-expect-error a status filter only takes the enum values
    useList(db.ticket, { filter: { status: "archived" } }),
    // @ts-expect-error title is not in the sort allowlist
    useList(db.ticket, { sort: ["-title"] }),
    // @ts-expect-error user has no search fields
    useList(db.user, { search: "x" }),
    // @ts-expect-error createdAt is not a write field
    db.ticket.update("id", { createdAt: new Date() }),
    // @ts-expect-error id is not a write field
    db.ticket.create({ id: "x", title: "x", status: "open", priority: 1, assigneeId: null }),
    // @ts-expect-error owner is not a relation of ticket
    useList(db.ticket, { include: ["owner"] }),
    // @ts-expect-error owner is not a relation of ticket
    useGet(db.ticket, "id", { include: ["owner"] }),
    // @ts-expect-error owner is not a relation of ticket, through the client
    db.ticket.watchGet("id", { include: ["owner"] }),
    // @ts-expect-error owner is not a relation of ticket, through the select hook
    useSelect(db.ticket, { label: "title", include: ["owner"] }),
    // @ts-expect-error nope is not a field to label by
    useSelect(db.ticket, { label: "nope" }),
    // @ts-expect-error a relation that was not included is not on the item
    plain.items[0]?.assignee,
    // @ts-expect-error project is not a served model
    db.project,
  ]
}
