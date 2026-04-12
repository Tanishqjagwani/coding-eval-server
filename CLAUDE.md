---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` for HTTP. Don't use `express`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile

## Project Structure

This is the coding-eval-server — a standalone orchestrator that proxies coding tasks
to a HuggingFace-hosted model via an OpenAI-compatible API, then uses Claude Agent SDK
to execute the model's tool calls (file I/O, shell commands).

```
src/
├── index.ts          # Entry point — Bun.serve()
├── app.ts            # Hono app wiring (routes, CORS, error handling)
├── config.ts         # Env validation via zod
├── lib/              # Shared utilities
│   └── logger.ts     # Coloured console logger
├── routes/           # HTTP route handlers
│   ├── completions.ts
│   └── traces.ts
├── services/         # Business logic
│   ├── orchestrator.ts
│   ├── prompt-builder.ts
│   └── trace-store.ts
└── types/            # TypeScript interfaces
    └── index.ts
```
