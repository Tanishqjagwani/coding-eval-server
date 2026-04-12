import { Hono } from 'hono'
import { getTrace, listTraces } from '../services/trace-store'

const traces = new Hono()

traces.get('/:id', (c) => {
  const trace = getTrace(c.req.param('id'))
  if (!trace) return c.json({ error: 'Trace not found' }, 404)
  return c.json(trace)
})

traces.get('/', (c) => {
  const limit = Number(c.req.query('limit') ?? 20)
  return c.json(listTraces(limit))
})

export { traces }
