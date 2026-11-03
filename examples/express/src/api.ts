import { memory, sysone } from "sysonejs"
import { category, project, secret, task } from "./model.ts"

const day = (d: number) => new Date(Date.UTC(2026, 0, d))

const categories = [
  { id: 1, name: "Apple", parentId: null, active: true, size: 10n, createdAt: day(1) },
  { id: 2, name: "Banana", parentId: 1, active: true, size: 20n, createdAt: day(2) },
  { id: 3, name: "Cherry", parentId: 1, active: false, size: 30n, createdAt: day(1) },
  { id: 4, name: "Date 100%", parentId: 2, active: true, size: 40n, createdAt: day(3) },
  { id: 5, name: "Elder_berry", parentId: null, active: true, size: 9007199254740993n, createdAt: day(2) },
  { id: 6, name: "Fig", parentId: 3, active: false, size: 60n, createdAt: day(3) },
  { id: 7, name: "Grape", parentId: null, active: true, size: 70n, createdAt: day(1) },
  { id: 8, name: "Honeydew", parentId: 2, active: true, size: 80n, createdAt: day(2) },
  { id: 9, name: "Kiwi", parentId: 4, active: false, size: 90n, createdAt: day(3) },
  { id: 10, name: "Lemon", parentId: null, active: true, size: 100n, createdAt: day(1) },
  { id: 11, name: "Mango", parentId: 1, active: true, size: 110n, createdAt: day(2) },
  { id: 12, name: "Nectarine", parentId: 5, active: true, size: 120n, createdAt: day(3) },
]

const projects = [
  { id: "p1", tenantId: "t1", ownerId: "u1", name: "Alpha", archived: false, createdAt: day(1) },
  { id: "p2", tenantId: "t1", ownerId: "u2", name: "Beta", archived: false, createdAt: day(2) },
  { id: "p3", tenantId: "t2", ownerId: "u3", name: "Gamma", archived: false, createdAt: day(1) },
  { id: "p4", tenantId: "t1", ownerId: "u1", name: "Delta", archived: true, createdAt: day(3) },
]

const tasks = [
  { id: 1, projectId: "p1", title: "Write spec" },
  { id: 2, projectId: "p3", title: "Ship it" },
  { id: 3, projectId: "p2", title: "Review" },
  { id: 4, projectId: "p1", title: "Plan" },
]

export const api = sysone({
  basePath: "/api",
  models: [
    category.from(memory(categories)),
    project.from(memory(projects)),
    task.from(memory(tasks)),
    secret.from(memory([{ id: 1, value: "hidden" }])),
  ],
})

export type Api = typeof api
