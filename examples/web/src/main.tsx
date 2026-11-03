import { useSelect } from "@sysonejs/react"
import { category } from "../../express/src/model.ts"

export function CategoryPicker() {
  const s = useSelect(category, { label: "name" })
  return s.options.length
}
