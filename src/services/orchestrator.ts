import { query } from '@anthropic-ai/claude-agent-sdk'
import { nanoid } from 'nanoid'
import { getConfig } from '../config'
import { createLogger, logSdkMessage } from '../lib/logger'
import { buildOrchestratorPrompt } from './prompt-builder'
import { saveTrace } from './trace-store'
import type {
  AgentToolCall,
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  ChatMessage,
  CodingStep,
  CodingStepToolCall,
} from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (block: unknown): block is { type: 'text'; text: string } =>
          typeof block === 'object' &&
          block !== null &&
          (block as Record<string, unknown>).type === 'text' &&
          typeof (block as Record<string, unknown>).text === 'string',
      )
      .map((block) => block.text)
      .join('\n')
  }
  return ''
}

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

function extractToolUseBlocks(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) return []
  return content.filter(
    (block: unknown): block is ToolUseBlock =>
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).type === 'tool_use',
  )
}

interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: unknown
}

function extractToolResultBlocks(content: unknown): ToolResultBlock[] {
  if (!Array.isArray(content)) return []
  return content.filter(
    (block: unknown): block is ToolResultBlock =>
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).type === 'tool_result',
  )
}

function toolResultContent(result: ToolResultBlock): string {
  if (typeof result.content === 'string') return result.content.slice(0, 2000)
  return JSON.stringify(result.content).slice(0, 2000)
}

function findResult(results: ToolResultBlock[], toolUseId: string): string | undefined {
  const r = results.find((tr) => tr.tool_use_id === toolUseId)
  return r ? toolResultContent(r) : undefined
}

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

/** Collect file paths from Write/Bash tool calls. */
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
// Main orchestration
// ---------------------------------------------------------------------------

export async function runOrchestration(
  request: ChatCompletionsRequest,
): Promise<ChatCompletionsResponse> {
  const { HF_URL, HF_MODEL, HF_API_KEY } = getConfig()

  const traceId = nanoid()
  const log = createLogger(`orch:${traceId.slice(0, 6)}`)
  const steps: CodingStep[] = []
  const allToolCalls: AgentToolCall[] = []
  let stepNumber = 0
  let finalText = ''
  let finishReason: 'stop' | 'length' | 'error' = 'stop'
  const startTime = Date.now()
  const runtimeEnv = typeof Bun !== 'undefined' ? Bun.env : process.env

  const systemPrompt = extractSystemPrompt(request.messages)
  const userTask = extractUserTask(request.messages)
  const prompt = buildOrchestratorPrompt(userTask, HF_URL, HF_MODEL, HF_API_KEY)

  log.info(`Starting orchestration for task: "${userTask.slice(0, 80)}..."`)
  log.info(`HF model: ${HF_MODEL} | URL: ${HF_URL}`)

  try {
    for await (const message of query({
      prompt,
      options: {
        model: 'sonnet',
        systemPrompt,
        maxTurns: request.max_turns ?? 30,
        permissionMode: 'bypassPermissions',
        cwd: process.cwd(),
        env: { ...runtimeEnv },
        stderr: (data: string) => {
          if (data.trim()) log.error('stderr:', data.trim())
        },
      },
    })) {
      logSdkMessage(log, message)

      if (message.type === 'assistant') {
        stepNumber++
        const content = (message as any).message?.content

        const textContent = extractText(content)
        const toolUseBlocks = extractToolUseBlocks(content)
        const toolResultBlocks = extractToolResultBlocks(content)

        const stepToolCalls: CodingStepToolCall[] = toolUseBlocks.map((tc) => ({
          tool_name: tc.name,
          tool_input: tc.input,
          tool_result: findResult(toolResultBlocks, tc.id),
        }))

        steps.push({
          step_number: stepNumber,
          content: textContent || null,
          tool_calls: stepToolCalls,
          timestamp_ms: Date.now() - startTime,
        })

        // Flatten tool_use blocks into OpenAI AgentToolCall format
        for (const tc of toolUseBlocks) {
          allToolCalls.push({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          })
        }

        if (textContent) finalText = textContent
      }

      if (message.type === 'result') {
        if ((message as any).subtype === 'success') {
          const resultText = (message as any).result
          if (resultText) finalText = resultText
        } else if ((message as any).subtype === 'error') {
          finishReason = 'error'
        }
      }
    }
  } catch (err) {
    log.error('Orchestration error:', err)
    finishReason = 'error'
    if (!finalText) {
      finalText = `Orchestration error: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const totalDuration = Date.now() - startTime
  log.info(`Completed in ${totalDuration}ms | ${stepNumber} steps | ${allToolCalls.length} tool calls`)

  // Save trace
  saveTrace({
    trace_id: traceId,
    task: userTask,
    hf_model: HF_MODEL,
    hf_url: HF_URL,
    steps,
    total_steps: stepNumber,
    total_duration_ms: totalDuration,
    final_output: finalText || null,
    files_created: collectFilePaths(steps),
    created_at: new Date().toISOString(),
  })

  return {
    id: `chatcmpl-${traceId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: HF_MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: finalText || null,
          tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
        },
        finish_reason: finishReason,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}
