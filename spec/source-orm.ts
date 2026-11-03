import { testSource } from "../packages/core/dist/kit.mjs"
import type { Binding, Row, Store } from "../packages/core/dist/kit.mjs"

type Open = (binding: Binding, seed: readonly Row[]) => Promise<Store>

const sources: { readonly [name: string]: () => Promise<Open> } = {
  "drizzle-pg": async () => (await import("../examples/express/src/sources/drizzle.ts")).pgItem,
  "drizzle-mysql": async () => (await import("../examples/express/src/sources/drizzle.ts")).mysqlItem,
}

const names = process.argv.slice(2)
if (!names.length || names.some((n) => !sources[n])) {
  console.error(`usage: tsx spec/source-orm.ts <${Object.keys(sources).join("|")}>...`)
  process.exit(2)
}

let failed = 0
for (const name of names) {
  const open = await sources[name]!()
  let passed = 0
  for (const c of testSource(open)) {
    try {
      await c.run()
      passed++
      console.log(`ok    ${name} › ${c.name}`)
    } catch (e) {
      failed++
      console.log(`FAIL  ${name} › ${c.name}\n      ${(e as Error).message}`)
    }
  }
  console.log(`${name}: ${passed} passed`)
}
console.log(failed ? `${failed} failed` : "all passed")
process.exit(failed ? 1 : 0)
