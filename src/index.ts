import { app } from './app'
import { getConfig } from './config'

let port = 4001
try {
  const config = getConfig()
  port = config.PORT
} catch (e) {
  console.warn('Warning: env validation failed, using defaults.')
  console.warn(e instanceof Error ? e.message : e)
  port = parseInt(process.env.PORT || '4001', 10)
}

const server = Bun.serve({
  port,
  fetch: app.fetch,
})

console.log(`Coding eval orchestrator listening on http://localhost:${server.port}`)
console.log(`  HF_MODEL: ${process.env.HF_MODEL ?? '(not set)'}`)
console.log(`  HF_URL:   ${process.env.HF_URL ?? '(not set)'}`)
