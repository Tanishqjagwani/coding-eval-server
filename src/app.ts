import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getConfiguredProviders } from './providers/registry'
import { completions } from './routes/completions'
import { traces } from './routes/traces'

const app = new Hono()

// CORS for all origins
app.use('*', cors())

// Health check (unauthenticated)
app.get('/health', (c) =>
  c.json({
    status: 'healthy',
    service: 'coding-eval-orchestrator',
    model: process.env.CLAUDE_MODEL ?? 'sonnet',
    providers: getConfiguredProviders(),
  }),
)

// Mount routes
app.route('/v1/chat/completions', completions)
app.route('/v1/traces', traces)

// 404 fallback
app.notFound((c) => c.json({ error: 'Not found' }, 404))

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

export { app }
