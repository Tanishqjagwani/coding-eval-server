import { Hono } from 'hono'
import { z } from 'zod'
import { runOrchestration } from '../services/orchestrator'
import type { ChatCompletionsRequest } from '../types'

const completions = new Hono()

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable(),
  tool_calls: z.array(z.any()).optional(),
  tool_call_id: z.string().optional(),
})

const completionsRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(messageSchema).min(1),

})

completions.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = completionsRequestSchema.parse(body)

    const request: ChatCompletionsRequest = {
      model: parsed.model,
      messages: parsed.messages.map((m) => ({
        role: m.role,
        content: m.content ?? null,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
      })),
    }

    const response = await runOrchestration(request)
    return c.json(response)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.issues }, 400)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('Completions error:', message)
    return c.json({ error: message }, 500)
  }
})

export { completions }
