import { useList, useSelect } from "@sysonejs/react"
import { useState } from "react"
import { createClient } from "sysonejs/client"
import type { Api } from "../../express/src/api.ts"

const db = createClient<Api>({ url: "/api", headers: () => ({ "x-tenant": "t1", "x-role": "admin" }) })

export function CategoryPicker(p: { value: number | null; onChange: (id: number) => void }) {
  const s = useSelect(db.category, {
    value: p.value,
    include: ["parent"],
    label: (c) => (c.parent ? `${c.parent.name} / ${c.name}` : c.name),
    sort: ["name"],
  })
  return (
    <div>
      <input value={s.search} onChange={(e) => s.onSearch(e.target.value)} placeholder={s.selected?.label} />
      {s.options.map((o) => (
        <button key={o.value} onClick={() => p.onChange(o.item.id)}>
          {o.label}
        </button>
      ))}
      {s.hasMore && <button onClick={s.loadMore}>More</button>}
    </div>
  )
}

export function Categories() {
  const [search, setSearch] = useState("")
  const [parentId, setParentId] = useState<number | null>(12)
  const list = useList(db.category, { search, filter: { active: true, parentId }, sort: ["-createdAt"], limit: 5 }, { debounce: 250 })
  return (
    <main>
      <input value={search} onChange={(e) => setSearch(e.target.value)} />
      <CategoryPicker value={parentId} onChange={setParentId} />
      {list.error?.message}
      {list.items.map((c) => (
        <p key={c.id} onClick={() => db.category.update(c.id, { name: c.name + "!" })}>
          {c.name} {c.createdAt.toLocaleDateString()}
        </p>
      ))}
      {list.hasMore && <button onClick={list.loadMore}>More</button>}
    </main>
  )
}
