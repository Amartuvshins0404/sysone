# sysone v1, candidate 1: "TS-first, types cross the wire, values don't"

## Problem

sysone turns one model definition into REST endpoints and React hooks, and it sells itself on being tiny, fast and dependency-free. v0 works, but its shape breaks that promise and leaves out the most common real need:

- **The model is a shared runtime value.** The browser imports `defineModel(...)`, and that drags in Zod. "1.78 KB" is really about 15 KB once you count everything the browser downloads.
- **Access is a yes/no check** (`can` returns a boolean). There is no tenant or owner scoping, which every real app needs.
- **Sources are untyped**, with an `exact` escape hatch. Each of the five adapters re-implements keyset paging, null handling and search escaping in its own way.
- **The client cache refetches only page 1 after a write**, and it keys entries by model name.
- **Only one sort field, and no relations**, so a picker can't show "Parent / Child".

Constraints I kept fixed: Zod; Express+Node and Bun; Postgres, MySQL, Mongo, Prisma and Drizzle; React hooks; a wire format other languages can implement; zero runtime deps; HTTP throughput within 5% of a hand-written route; npm names `sysonejs` and `@sysonejs/*`.

**Premise check.** TS-first holds. The grounding's weak spot 1 is a *where-it-runs* bug, not a *source-of-truth* bug. The fix is that the browser imports the model's type, not its value. A language-neutral IDL as the source of truth would add a codegen step for every TS user, which is the majority and the launch audience, and it would lose Zod's checks and inference. The portable artifact is the wire spec plus an optional manifest, both derived from the TS model. That is enough for future ports.

## Usage (caller's view)

See `usage.md`. It has the quickstart and three call sites: a relation picker, a ticket table with range filters, multi-sort and include, and a multi-tenant project list with scoped writes. `sketch/usage-check.ts` holds those call sites in code, and `tsc` passes on it. Negative probes were type errors as intended:
- writing `tenantId` in create
- filtering or sorting on a field not in the allowlist
- sorting on a nullable field
- including a relation that doesn't exist
- `.from()` with a source that is missing a column
- a relation whose target model isn't served
- a `context` function that returns the wrong Ctx

## Shape

### Load-bearing decisions

1. **The browser gets types, not values.** `sysone({ models })` returns an `App` that carries a phantom `"~contract"` type: a zod-free, plain-TS description of each model (row, id, create, patch, filter, sort, search, relations). `createClient<Api>()` is a typed Proxy: `db.category` is a `Ref` built from the property name. The browser bundle contains no schema, no model and no Zod. The `sysonejs` main entry has a `browser` export condition pointing at `browser-guard.ts`, which throws, so a value import of server code fails loudly. The few runtime facts the client needs come in every response as `meta`, per model: `{ id, types: { createdAt: "date" }, links: { parent: ["category", "parentId"] } }`. This follows separate-before-serializing: the server owns the facts and the client caches them.
2. **One condition tree (`Cond`) compiled in core. Sources only translate it.** The core turns these into one small tree (`and/or/eq/in/null/gt/gte/lt/lte/contains/after`) plus a `FindPlan { where, sort (always ends with id), take (= page + 1), select }`:
   - the access scope
   - filters, including ranges
   - search
   - the keyset position for any sort
   
   The source contract shrinks to `bind(binding) → { find, insert, update(where, patch), remove(where) }`. `get` is just `find` with `take: 1`. `update` and `delete` take a `where`, so scoping always happens in the same SQL statement. The `exact` flag is gone: the core always picks model fields once (`pick`), and sources select only `plan.select`. Adapters never see Zod; `Binding.fields` carries the field kinds. That fixes the mysql adapter importing `kind` from core. `expandAfter` is the single keyset implementation. pg can use row comparison instead when all sort directions match. `testSource()` is one conformance suite that all five sources must pass. Per the deep-module and single-source-of-truth principles: correctness lives in ~1 file, not 5.
3. **Access is data, not a callback.** `access(ctx)` returns `Grants`. Each of `read`, `update` and `delete` is `true`, `false`, a `Match` (field → value or values), or `Match[]` (OR). `create` is `boolean | Match` and the type forbids arrays, because a stamp must be one value. The core enforces everything:
   - reads AND the scope into the plan
   - create stamps the match values and returns 403 if the body tries to differ
   - update and delete put `id AND scope` into one statement
   - out of scope looks exactly like missing (404, never 403), so other tenants' ids don't leak
   - included relations pass the target model's own `read` rule
   
   Because rules are data, the core can translate them for all five sources, show them in the manifest, and check them at boot. A boolean `can` callback could do none of those. This follows encode-lessons-in-structure.

### Data structures and the dominant access paths

- **Server request.** `fetchHandler` / `expressHandler` call `app.handle` (app.ts). Then `parseList` and `grants(ctx)` (plan.ts) build the plan, `planList` hands it to `store.find`, and the result goes through `pick` + `nextCursor` + `planIncludes` and out as `{ items, next, included, meta }`. That is three files: shell, app, plan. `Compiled` is built once at boot and holds everything precomputed: Sets, FieldSpecs, the create/patch Zod schemas, and meta. The only work per request is query parsing, one `access(ctx)` call, and building the tree.
- **Keyset.**
  - The cursor is `base64url([1, sortSpec, ...values])`. Its length is checked against the sort keys, and every value is coerced by field kind.
  - Sort fields are non-null **by type** (`OrderedField`), so null-ordering differences between pg, mysql and mongo never matter.
  - Sort is up to 3 allowlisted keys, and id is always appended.
- **Client cache** (cache.ts):
  - `entities: model → id → { row, at }`
  - `lists: key → { ids, next, gen, dirty }`
  - `readers: model → entries`
  
  How each access path works:
  - **Render a list:** ids → entities, joined with included rows at read time. The snapshot is memoized on model versions, so `useSyncExternalStore` stays stable.
  - **Update:** the server's row patches the entity, so every view that shows it, including through `include`, re-renders with no refetch. Lists of that model are marked dirty and refetch **every loaded page** (limit = number loaded; the server clamps and the loop follows cursors), then swap in atomically.
  - **Create / delete:** the same refetch. Unmounted lists are dropped.
  - **Selected option:** looked up in the entity map first.
  
  Shared-state rule: every request stamps `at` when it **starts**. An entity is only overwritten by a response whose request started later. So a slow list that started before a write can't revert the write. `gen` throws away superseded refetches, and `dirty` re-runs a refetch if a write landed while one was in flight.
- **Wire key = cache key.** `encodeQuery` is canonical (sorted filter keys, fixed parameter order). The same string is the URL and the cache key, so there is no second serializer to drift.

### What's public, and how deep

| Package / entry | Value exports | Type exports | Hides |
|---|---|---|---|
| `sysonejs` (server only) | 4: `defineModel`, `sysone`, `fetchHandler`, `memory` | 7 | query parsing, coercion, keyset, scoping, includes, validation, errors, manifest |
| `sysonejs/client` | 2: `createClient`, `SysoneClientError` | 7 | fetch, encoding, revive, normalized cache, invalidation, refetch-all-pages |
| `sysonejs/source` (adapter authors) | 3: `expandAfter`, `escapeLike`, `testSource` | 8 | none; this is the adapter contract |
| `@sysonejs/react` | 3: `useList`, `useGet`, `useSelect` | 4 | debounce, missing-selected fetch, snapshot binding |
| `@sysonejs/express` | 1: `expressHandler` | 0 | body reading, routing to `handle` |
| `@sysonejs/sql` | 2: `pg`, `mysql` | 3 | one Cond→SQL compiler, two dialects |
| `@sysonejs/drizzle`, `@sysonejs/prisma`, `@sysonejs/mongo` | 1 each | 1–2 | id↔`_id`, ObjectId, `mode: insensitive`, RETURNING vs re-select |

That is **18 value exports, against 25 in v0**, while v1 adds scoping, relations, ranges, multi-sort and a normalized cache. There is no Provider and no `useClient`, because a `Ref` carries its client. There is no `useMutation`: writes are promises, and React's own `useActionState` / `useTransition` handle pending state (reuse what exists). `Ref.watchList` / `watchGet` are the framework-neutral live queries. The React hooks are thin `useSyncExternalStore` wrappers over them, so a Vue or Svelte binding later is about 40 lines. Wire types (`wire.ts`) and `plan.ts` are internal. The package `exports` map makes them impossible to import. `pg` and `mysql` are merged into `@sysonejs/sql` because they shared about 90% of their code.

Two server entry styles (weak spot 6) is **not** a red flag. There is one core `handle(input)`. `fetchHandler` and `expressHandler` each adapt a different request object, and each runtime has exactly one way to mount. Express keeps a native shell because converting Node requests to `Request` would cost more than the 5% throughput budget.

### Wire spec v1 (changes from v0)

| Area | v1 |
|---|---|
| list | `200 { items, next, included?, meta }` |
| get / create / update | `{ item, included?, meta }`, now in an envelope (v0 sent the bare item) |
| delete | `204`; clients treat `404` as done (idempotent) |
| filter | `filter[f]=v` (repeat = any of; `null` = empty); `filter[f][gte]=v` and `gt`/`lt`/`lte` for string, number, date and bigint fields |
| sort | `sort=-priority,createdAt`, at most 3 keys, non-null fields only, id tiebreak |
| include | `include=parent,owner`, belongs-to only, batched, filtered by the target's read rule |
| cursor | opaque `base64url`, tied to the sort |
| errors | v0 codes plus `invalid_include`; `issues: [{ path, message }]` (the client maps these to `{ "a.b": message }`) |
| access | `403` = action not granted; `404` = missing **or out of scope** |
| manifest | opt-in `GET {basePath}` → `{ sysone: 1, models: { name: { id, fields (JSON Schema), write, search, filter ops, sort, relations, limits } } }` |
| conformance | `spec/cases/*.json`: request → expected response pairs that any server port must pass; the TS server and client are tested against them |

### Efficiency spec v1 (public, CI-enforced)

| Metric | Budget | Estimate |
|---|---|---|
| Browser total: client + hooks, **all deps shipped**, from a real frontend entry, only `react` external | ≤ 2.6 KB brotli | ~2.4 KB (client ~1.7: fetch, canonical encoder, Proxy refs, meta revive/join, entity store, list refetch loop; hooks ~0.7) |
| Zod / model / driver bytes in the browser bundle | 0 (CI fails if any `zod` module is in the metafile) | 0 |
| Server core (`sysonejs`), Zod excluded as a server peer | ≤ 3.5 KB brotli | ~3 KB |
| Runtime deps, every package | 0 (zod, react, express and drivers are peers) | 0 |
| Handler overhead, list of 20, 1 filter, scoped, memory source | ≤ 3 µs p50 on the reference machine | ~1.5–2.5 µs (v0: 0.8–2) |
| HTTP throughput vs a hand-written route, Express and Bun.serve | within 5% | same as v0 |

Honest comparison: v0's *real* browser cost was about 1.8 KB + ~13 KB classic Zod ≈ 15 KB. v1 is about 2.4 KB with nothing hidden. Client-side form validation is opt-in: if an app imports its own Zod schema into the browser, it pays for Zod, and sysone doesn't make that choice for it.

### Grounding weak spots: verdicts

1. Zod in the browser: **confirmed**. Fixed by type-only imports plus `meta`.
2. Boolean access: **confirmed**. Fixed by `Grants` with matches.
3. Untyped sources: **confirmed**. Fixed by `Source<R>` and the `.from()` column check; `exact` removed.
4. One sort field, no relations: **confirmed**. Fixed by multi-sort and `include`.
5. Page-1-only refetch: **confirmed**. Fixed by refetching all loaded pages plus the entity patch.
6. Two server entry styles: **refuted** (see above).
7. Mongo / Prisma flags: **partly**. Mongo ObjectIds become strings automatically on read; `objectIds` is still needed for writes, now typed. Prisma `provider` is typed and defaults to postgresql.
8. Multi-language: the model stays TS-only by design. The portable layer is the spec, the conformance cases and the manifest.
9. Surface: see the table above.

## Synthesis decision

filled by arena

## Tradeoffs accepted

- We accept that client types require the frontend to resolve server types (monorepo, or a shared types package) in exchange for zero schema bytes and no codegen. Separate repos need the manifest plus a future `sysone types` CLI.
- We accept ~60 bytes of `meta` in every response in exchange for a stateless client that never needs a schema fetch or a bundled model.
- We accept expanding the keyset into OR branches for mysql, mongo and prisma (index-friendly but verbose) in exchange for one keyset implementation in core.
- We accept non-null-only sort fields in exchange for keyset paging that is identical on every database.
- We accept classic `z.ZodObject` as the schema type (`.pick` / `.partial` / `.safeParse` methods) in exchange for no runtime Zod import in core. Zod Mini support waits until someone asks, since Zod is server-only now and its size no longer matters.
- We accept refetching all loaded pages after a write (N requests, background) in exchange for lists that never jump back to page 1 or show stale membership.
- We accept that rows a client writes are only as fresh as the server's response; there are no optimistic updates in v1.
- We accept equality-only scopes (match / OR of matches) in exchange for rules that translate to all five sources and show up in the manifest. "Shared with me through a join table" needs a v1.x extension.

## Alternatives considered

- **Split model: a zod-free `defineContract` for the browser plus `implement(contract, zod)` on the server.** This gives runtime metadata in the browser with no `meta` on the wire. But there are two definitions per model to keep in sync (a hand-synced list), and the browser still ships allowlists it doesn't need. It loses on depth.
- **Bundler plugin or codegen that strips Zod from the shared model.** This keeps v0's call sites. But it adds a build dependency for every bundler (Vite, Next, Bun, esbuild), and it is invisible magic that a contributor copying the nearest example won't understand.
- **Keep `can` as a callback and add a `scope(ctx)` callback.** This is close to v0. But it means two hooks per action that have to agree, the core can't prove writes stay in scope, and the manifest can't describe it. It loses on encoding the invariant.
- **Each source implements list semantics natively (v0 style), with typed inputs.** That is the least core work, but five copies of keyset, null and escape logic. It is rejected for split ownership.

## Open questions and risks

- Should a model with no `access` be read-only for everyone (v0 behaviour, kept here), or denied by default so that a forgotten rule on a multi-tenant model fails closed? Recommendation: deny by default and require `access: () => ({ read: true })` explicitly.
- Is `include` worth putting in v1, or should it wait for v1.1? It costs about 0.4 KB on the server and about 0.15 KB in the browser. Recommendation: keep it, because the relation picker is the headline demo.
- Prisma `update` / `delete` with a scope use `updateMany` / `deleteMany` plus `findFirst` (two statements, not atomic with the read-back). Is that acceptable, or should Prisma require `extendedWhereUnique` with Prisma ≥ 5?
- Server-side rendering and hydration (a per-request client, seeding the cache) are not designed here. Do we need them in v1?
- On MySQL and Mongo, case-insensitive `contains` depends on collation or uses a regex that can't use an index. Should the efficiency spec state that, or should we offer a `search: { mode: "prefix" }` that can use an index?
- Tables usually show a total count. Keyset has none. Should we add an opt-in `count=1` (an expensive extra query) in v1, or leave it out?

## Next implementation step

Write `plan.ts` (`compile`, `normalizeGrants`, `parseList`, `planList`, cursor) and `memory.ts` against `source.ts`, then `testSource` cases that pin keyset paging, scoping and include behaviour, before touching any SQL adapter.
