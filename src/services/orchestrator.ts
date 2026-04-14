import { nanoid } from 'nanoid'
import { getConfig } from '../config'
import { createLogger } from '../lib/logger'
import { resolveProvider } from '../providers/registry'
import { saveTrace } from './trace-store'
import type {
  AgentToolCall,
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  ChatMessage,
  CodingStep,
} from '../types'

// ---------------------------------------------------------------------------
// Provider-agnostic helpers
// ---------------------------------------------------------------------------

/** Extract the system prompt from messages array (if any). */
function extractSystemPrompt(messages: ChatMessage[]): string | undefined {
  const sys = messages.find((m) => m.role === 'system')
  return sys?.content ?? undefined
}

/** Extract the user task: last user message content. */
function extractUserTask(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].content) {
      return messages[i].content as string
    }
  }
  return ''
}

/** Collect file paths from Write tool calls. */
function collectFilePaths(steps: CodingStep[]): string[] {
  const files = new Set<string>()
  for (const step of steps) {
    for (const tc of step.tool_calls) {
      if (tc.tool_name === 'Write' && typeof tc.tool_input.file_path === 'string') {
        files.add(tc.tool_input.file_path)
      }
    }
  }
  return Array.from(files)
}

// ---------------------------------------------------------------------------
// Main orchestration — provider-agnostic router
// ---------------------------------------------------------------------------

export async function runOrchestration(
  request: ChatCompletionsRequest,
): Promise<ChatCompletionsResponse> {
  const { CLAUDE_MODEL } = getConfig()
  const model = request.model || CLAUDE_MODEL

  const traceId = nanoid()
  const log = createLogger(`orch:${traceId.slice(0, 6)}`)

  const systemPrompt = extractSystemPrompt(request.messages)
  const userTask = extractUserTask(request.messages)

  log.info(`Starting orchestration for task: "${userTask.slice(0, 80)}..."`)
  log.info(`Model: ${model}`)

  // Resolve provider from model name — throws if not configured
  const provider = resolveProvider(model)
  log.info(`Provider: ${provider.name}`)

  const startTime = Date.now()
  const result = await provider.execute({
    model,
    messages: request.messages,
    systemPrompt,
    userTask,
    cwd: process.cwd(),
  })
  const totalDuration = Date.now() - startTime

  log.info(
    `Completed in ${totalDuration}ms | ${result.steps.length} steps | provider=${provider.name}`,
  )

  // Flatten tool_use blocks into OpenAI AgentToolCall format
  const allToolCalls: AgentToolCall[] = []
  for (const step of result.steps) {
    for (const tc of step.tool_calls) {
      allToolCalls.push({
        id: `call_${nanoid(8)}`,
        type: 'function',
        function: {
          name: tc.tool_name,
          arguments: JSON.stringify(tc.tool_input),
        },
      })
    }
  }

  // Save trace
  saveTrace({
    trace_id: traceId,
    task: userTask,
    model,
    provider: provider.name,
    steps: result.steps,
    total_steps: result.steps.length,
    total_duration_ms: totalDuration,
    final_output: result.finalText,
    files_created: collectFilePaths(result.steps),
    created_at: new Date().toISOString(),
  })

  return {
    id: `chatcmpl-${traceId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: result.finalText,
          tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
        },
        finish_reason: result.finishReason,
      },
    ],
    usage: result.usage,
  }
}
