# Contributing

Thanks for helping. This page shows how to set up the repository and which checks to run before you open a pull request.

## Set up

You need Node 24, pnpm 10, and Docker for the database checks.

```sh
pnpm install
pnpm build
```

The repository is a pnpm workspace:

| Folder | Contents |
|---|---|
| `packages/core` | `sysonejs`: models, the server, the client, and the memory source |
| `packages/react` | `@sysonejs/react` |
| `packages/sql`, `drizzle`, `prisma`, `mongo` | The database sources |
| `examples/express` | The example server that the wire spec runs against. It can run on every source. |
| `examples/web` | A React entry, used to measure the browser bundle |
| `spec` | The wire spec cases and the source test runners |
| `docs` | The documentation. `docs/examples` checks its code samples. |
| `docs/design` | Design history. It may be out of date, so check the code before you rely on it. |

## Start the databases

`examples/express/compose.yml` starts Postgres, MySQL, and MongoDB on local ports. None of them has a password, and each listens on `127.0.0.1` only.

```sh
cd examples/express
docker compose up -d
```

| Database | URL |
|---|---|
| Postgres | `postgres://postgres@localhost:54329/sysone` |
| MySQL | `mysql://root@localhost:33069/sysone` |
| MongoDB | `mongodb://localhost:27029/sysone` |

The checks below drop and recreate their tables, so do not point them at a database you care about.

## Run the checks

CI runs the first group on every push. Run all of them before you open a pull request that touches the matching code.

| Check | Command | What it proves |
|---|---|---|
| Build | `pnpm build` | Every package builds. |
| Types | `pnpm typecheck` | Every package typechecks, including the compile-error probes in `docs/design/probes*.ts`. |
| Size | `pnpm size` | The client, the hooks, and the server core stay inside their size budgets. |
| Browser bundle | `pnpm --filter example-web size` | A real React entry stays under 2.75 KB brotli and contains no Zod or database driver. |
| Memory source | `node spec/source.ts` | The memory source passes `testSource`. |
| Wire spec | see below | The example server passes all 91 cases in `spec/cases`. |
| Docs | `pnpm --filter docs-examples check` | Every TypeScript block in the docs compiles, the blocks marked to fail still fail, and every relative link resolves. |

To run the wire spec, start the example server in one terminal and run the cases in another:

```sh
cd examples/express && node src/server.ts
node spec/run.ts http://localhost:3000
```

The server uses the memory source unless you set `SOURCE`. To run the spec on a database, set `SOURCE` to `pg`, `mysql`, `drizzle-pg`, `drizzle-mysql`, `prisma`, or `mongo`, with `PG_URL`, `MYSQL_URL`, or `MONGO_URL`:

```sh
cd examples/express && SOURCE=pg PG_URL=postgres://postgres@localhost:54329/sysone node src/server.ts
```

These checks need the databases or extra setup:

| Check | Command |
|---|---|
| SQL sources | `PG_URL=postgres://postgres@localhost:54329/sysone MYSQL_URL=mysql://root@localhost:33069/sysone node spec/source-sql.ts` |
| ORM and MongoDB sources | `PG_URL=postgres://postgres@localhost:54329/sysone MYSQL_URL=mysql://root@localhost:33069/sysone node spec/source-orm.ts drizzle-pg drizzle-mysql prisma mongo` |
| React hooks | `pnpm --filter @sysonejs/react check` |

The Prisma source needs a generated client and the tables. Run these once in `examples/express` with `PG_URL` set:

```sh
pnpm prisma:generate
npx prisma db push
```

If `db push` warns about data loss because another check created the tables, add `--accept-data-loss`. The checks reset the data anyway.

## Docs

Pages live in `docs/*.md`. The docs check extracts each `ts` and `tsx` block and compiles it against the workspace packages. An HTML comment on the line before a block changes how it is checked:

| Comment | Effect |
|---|---|
| `<!-- file: name.ts -->` | Saves the block under that name, so later blocks on the same page can import it. Also works for `.prisma` and `.sql` blocks. |
| `<!-- fails: text -->` | The block must fail to compile with an error that contains `text`. Use it for compile-error examples. |
| `<!-- skip -->` | Skips the block. Avoid it. |

`packages/core/README.md` is the npm page for `sysonejs`. It must equal the root `README.md` with `./` links made absolute. After you edit the root README, run `pnpm --filter docs-examples check --write-core-readme`.

## Pull requests

- Keep each pull request to one change, with a short imperative title.
- Add or update a spec case in `spec/cases` when you change wire behavior, and update `SPEC.md` with it.
- Update the docs page that describes the behavior you changed.
- Code has no comments. Name things so the code reads on its own.

## Releasing

Every merge to `main` runs CI. If CI passes, the `release` job publishes any package version that is not on npm yet, then creates the git tag and a GitHub release with the matching `CHANGELOG.md` section. A merge that does not change the version publishes nothing.

To release:

1. In a pull request, run `pnpm release:version patch` (or `minor`, `major`). All packages share one version.
2. Rename `## Unreleased` in `CHANGELOG.md` to `## <version> (<date>)`.
3. Merge. CI publishes to npm with provenance through npm trusted publishing. No npm token is stored in GitHub.

One-time setup, already done for the current packages: an npm owner runs `bash scripts/trust.sh`, which links each package to this repo's `ci.yml`. A new package needs the same step before its first release, and a place in the order list in `scripts/release.ts`.
