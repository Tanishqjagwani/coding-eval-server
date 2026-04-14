import { query } from '@anthropic-ai/claude-agent-sdk'
import { createLogger, logSdkMessage } from '../lib/logger'
import type { CodingStep, CodingStepToolCall } from '../types'
import type { Provider, ProviderExecuteOptions, ProviderResult } from './types'

// ---------------------------------------------------------------------------
// Claude-specific message helpers (moved from orchestrator.ts)
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

// ---------------------------------------------------------------------------
// ClaudeProvider
// ---------------------------------------------------------------------------

export class ClaudeProvider implements Provider {
  readonly name = 'claude'

  isConfigured(): boolean {
    const env = typeof Bun !== 'undefined' ? Bun.env : process.env
    return !!env.CLAUDE_CODE_OAUTH_TOKEN
  }

  async execute(options: ProviderExecuteOptions): Promise<ProviderResult> {
    const log = createLogger('claude')
    const steps: CodingStep[] = []
    let stepNumber = 0
    let finalText = ''
    let finishReason: 'stop' | 'length' | 'error' = 'stop'
    const startTime = Date.now()
    const runtimeEnv = typeof Bun !== 'undefined' ? Bun.env : process.env

    log.info(`Model: ${options.model}`)

    try {
      for await (const message of query({
        prompt: options.userTask,
        options: {
          model: options.model,
          systemPrompt: options.systemPrompt,
          maxTurns: 50,
          permissionMode: 'bypassPermissions',
          cwd: options.cwd,
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
      log.error('Claude execution error:', err)
      finishReason = 'error'
      if (!finalText) {
        finalText = `Claude execution error: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    return {
      finalText: finalText || null,
      steps,
      finishReason,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  }
}
