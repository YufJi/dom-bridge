# Repository Guidelines

## Project Structure & Module Organization

pnpm monorepo with three workspace roots: `packages/*`, `apps/*`, `examples/*`.

- `packages/protocol` — `Op` / message types and `describeOp`; zero dependencies, shared by both threads.
- `packages/engine` — layered virtual DOM proxy (`src/dom/`: types → op-queue → node → events → host) and protocol wiring (`src/engine-host.ts`); no app or lifecycle semantics. Supported subset and gaps are listed in `packages/engine/README.md`.
- `packages/renderer` — `./dom` (real DOM) and `./terminal` (text snapshot) renderers.
- `packages/bridge` — `createBridge` plus `./web` and `./node` channels.
- `apps/debug-console` (Vite) and `apps/node-demo` (CLI) — the two hosts.
- `examples/*` — hosted apps plus `registry`, which owns the `HostedApp` contract, catalog and `startHostedApp`.

Tests live in `packages/*/tests/*.test.ts`; screenshots in `docs/`.

## Build, Test, and Development Commands

Requires Node >= 22.18 and pnpm 9. Packages are not precompiled (`exports` → `src/*.ts`).

```bash
pnpm install
pnpm dev              # Vite debug console, http://localhost:5173/
pnpm demo -- react    # Node terminal demo (arg selects an example)
pnpm test             # Vitest across workspaces
pnpm typecheck        # tsc --noEmit per package
pnpm lint             # ESLint flat config
pnpm format           # Prettier write
pnpm build            # recursive build
```

CI (`.github/workflows/ci.yml`) runs the same scripts plus a `pnpm demo` smoke; Pages deploys the debug console via `.github/workflows/deploy-pages.yml` (source: GitHub Actions).

Scope one package with `pnpm --filter @dom-bridge/engine <script>`.

## Coding Style & Naming Conventions

TypeScript strict, ESM only. Relative imports include the `.ts` extension; type-only imports use `import type`.

- Keep syntax erasable (`erasableSyntaxOnly`): no enums, namespaces, parameter properties, or JSX — Node strips types at runtime.
- Prettier: single quotes, 100 columns, trailing commas. ESLint flat config must stay clean.
- Files `kebab-case.ts`; functions and variables `camelCase`; classes and types `PascalCase`; packages `@dom-bridge/*`.
- New op kinds are variants of the `Op` union in `protocol` and must be handled in `describeOp`.

## Testing Guidelines

Vitest, with tests beside the package they cover (`packages/<pkg>/tests/<name>.test.ts`). Name cases as behaviour sentences in Chinese; DOM tests opt in via `// @vitest-environment happy-dom`. Cover op changes on both sides — proxy emission (`engine`) and op application (`renderer`). Run one file with `pnpm vitest run <path>`.

## Commit & Pull Request Guidelines

No Git history exists yet; use Conventional Commits scoped by package, e.g. `feat(engine): add deleteProperty to style proxy`.

PRs state the behaviour change, name the example used to verify it, and pass `pnpm lint && pnpm typecheck && pnpm test`. Add a debug-console screenshot for renderer or example UI changes, and link related issues.

## Architecture Notes

The engine thread has no DOM: `dom-host` emits ops, the bridge forwards them, a renderer applies them; user input returns as `{kind:'event'}`. Keep `packages/*` free of app semantics: `bootXEngineWorker({ onAppMessage })` handles only `event` / `eval` / `shutdown` and forwards everything else to the app layer, which owns ids, catalogs and the `start` → `ready` / `host-error` handshake. To add a hosted app, create `examples/<name>` exporting a `mount(document)` function and register it in `examples/registry/src/index.ts`.
