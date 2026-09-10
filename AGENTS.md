# Repository Guidelines

## Project Structure & Module Organization

pnpm monorepo with three workspace roots: `packages/*`, `apps/*`, `examples/*`.

- `packages/protocol` — `Op` / message types and `describeOp`; zero dependencies, shared by both threads.
- `packages/engine` — layered virtual DOM proxy (`src/dom/`: types → op-queue → node → events → host) plus protocol wiring (`src/engine-host.ts`). No app semantics; subset and gaps sit in `packages/engine/README.md`.
- `packages/renderer` — `./dom` and `./terminal` renderers; `packages/bridge` — `createBridge` and the `./web` / `./node` channels.
- `apps/debug-console` (Vite) and `apps/node-demo` (CLI) are the hosts; `examples/*` are hosted apps, with `registry` owning the `HostedApp` contract and catalog.

Tests sit beside their package in `packages/*/tests/`; screenshots live in `docs/`.

## Build, Test, and Development Commands

Node >= 22.18, pnpm 9. Packages are not precompiled (`exports` → `src/*.ts`).

```bash
pnpm install
pnpm dev            # debug console on :5173
pnpm demo -- react  # Node terminal demo; the argument picks an example
pnpm test           # Vitest across workspaces
```

`pnpm typecheck`, `pnpm lint`, `pnpm format` and `pnpm build` mirror CI; scope one package with `pnpm --filter @dom-bridge/engine <script>`.

## Coding Style & Naming Conventions

TypeScript strict, ESM only; relative imports carry the `.ts` extension and type-only imports use `import type`.

- Erasable syntax only (`erasableSyntaxOnly`): no enums, namespaces, parameter properties or JSX — Node strips types at runtime.
- Prettier: single quotes, 100 columns, trailing commas; ESLint must stay clean.
- Files `kebab-case.ts`; functions and variables `camelCase`; classes and types `PascalCase`; packages `@dom-bridge/*`.
- New op kinds extend the `Op` union in `protocol` and must be handled in `describeOp`.

## Testing Guidelines

Vitest; name cases as behaviour sentences in Chinese, and opt DOM tests in with `// @vitest-environment happy-dom`. Cover op changes on both sides — emission in `engine`, application in `renderer` — and run one file with `pnpm vitest run <path>`. The engine ↔ renderer loop has an integration test at `apps/debug-console/tests/event-loop.test.ts`.

## CI & Deployment

`ci.yml` runs `format:check`, `lint`, `typecheck`, `test`, `build` and a browserless `pnpm demo` smoke. `deploy-pages.yml` publishes the debug console to GitHub Pages, taking the base path from `configure-pages`; reproduce locally with `PAGES_BASE=/dom-bridge/ pnpm --filter @dom-bridge/debug-console build`.

Keep the engine worker inline in the host — `new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' })`, handed to `createWebWorkerChannel` — or the bundle emits no worker chunk and Pages serves a blank page.

## Commit & Pull Request Guidelines

History holds a single `first commit`; use Conventional Commits scoped by package, e.g. `feat(engine): add classList`.

PRs state the behaviour change, name the example used to verify it, and pass `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`; add a debug-console screenshot for UI changes. Never silence check output — type-only import mistakes pass the bundler but fail `typecheck`.

## Architecture Notes

The engine thread has no DOM: `dom-host` emits ops, the bridge forwards them, a renderer applies them, and input returns as `{kind:'event'}`. Hosts boot with `bootXEngineWorker({ onAppMessage })` then post `{kind:'start', appId}`; ids, catalogs and lifecycle stay in `apps/*` and `examples/*`.
