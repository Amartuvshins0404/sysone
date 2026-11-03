import { memory } from "../packages/core/dist/index.mjs"
import { testSource } from "../packages/core/dist/kit.mjs"

let failed = 0
for (const c of testSource(async (binding, seed) => memory([...seed]).bind(binding))) {
  try {
    await c.run()
    console.log(`ok    ${c.name}`)
  } catch (e) {
    failed++
    console.log(`FAIL  ${c.name}\n      ${(e as Error).message}`)
  }
}
console.log(failed ? `${failed} failed` : "all passed")
process.exit(failed ? 1 : 0)
