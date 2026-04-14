import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from '../lib/logger'
import type { CodingStep, CodingStepToolCall } from '../types'
import type { Provider, ProviderExecuteOptions, ProviderResult } from './types'

// ---------------------------------------------------------------------------
// CodexProvider — spawns `codex exec` CLI with OAuth auth via auth.json
// ---------------------------------------------------------------------------

export class CodexProvider implements Provider {
  readonly name = 'codex'

  isConfigured(): boolean {
    const env = typeof Bun !== 'undefined' ? Bun.env : process.env
    return !!env.CODEX_AUTH_JSON
  }

  /**
   * Write CODEX_AUTH_JSON env var to ~/.codex/auth.json so the Codex CLI
   * can authenticate via ChatGPT OAuth. Idempotent — safe to call every time.
   */
  private ensureAuthFile(): void {
    const env = typeof Bun !== 'undefined' ? Bun.env : process.env
    const authJson = env.CODEX_AUTH_JSON
    if (!authJson) throw new Error('CODEX_AUTH_JSON not set')

    const codexHome = env.CODEX_HOME || join(homedir(), '.codex')
    if (!existsSync(codexHome)) mkdirSync(codexHome, { recursive: true })

    const authPath = join(codexHome, 'auth.json')
    writeFileSync(authPath, authJson, { mode: 0o600 })
  }

  async execute(options: ProviderExecuteOptions): Promise<ProviderResult> {
    this.ensureAuthFile()

    const log = createLogger('codex')
    const steps: CodingStep[] = []
    let stepNumber = 0
    let finalText = ''
    let finishReason: 'stop' | 'length' | 'error' = 'stop'
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    const startTime = Date.now()

    log.info(`Model: ${options.model}`)

    // Build the prompt: combine system prompt + user task
    const prompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${options.userTask}`
      : options.userTask

    const args = [
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--ephemeral',
      '-C', options.cwd,
    ]

    // Only pass -m if the model isn't the generic "codex" alias
    if (options.model && options.model !== 'codex') {
      args.push('-m', options.model)
    }

    args.push(prompt)

    log.info(`Spawning: codex ${args.slice(0, 3).join(' ')} ...`)

    try {
      const proc = Bun.spawn(['codex', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      })

      // Read stderr in background for logging
      const stderrReader = (async () => {
        const decoder = new TextDecoder()
        for await (const chunk of proc.stderr as AsyncIterable<Uint8Array>) {
          const text = decoder.decode(chunk).trim()
          if (text) log.error('stderr:', text)
        }
      })()

      // Parse JSONL events from stdout
      const decoder = new TextDecoder()
      let buffer = ''

      for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()! // Keep incomplete last line in buffer

        for (const line of lines) {
          if (!line.trim()) continue
          let event: any
          try {
            event = JSON.parse(line)
          } catch {
            log.error('Failed to parse JSONL:', line.slice(0, 200))
            continue
          }

          this.processEvent(event, log, steps, startTime, {
            stepNumber: () => stepNumber,
            incrStep: () => ++stepNumber,
            setFinalText: (t: string) => { finalText = t },
            setFinishReason: (r: 'stop' | 'length' | 'error') => { finishReason = r },
            setUsage: (u: typeof totalUsage) => { totalUsage = u },
          })
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer)
          this.processEvent(event, log, steps, startTime, {
            stepNumber: () => stepNumber,
            incrStep: () => ++stepNumber,
            setFinalText: (t: string) => { finalText = t },
            setFinishReason: (r: 'stop' | 'length' | 'error') => { finishReason = r },
            setUsage: (u: typeof totalUsage) => { totalUsage = u },
          })
        } catch { /* ignore trailing incomplete data */ }
      }

      await stderrReader
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        log.error(`Codex exited with code ${exitCode}`)
        finishReason = 'error'
        if (!finalText) finalText = `Codex process exited with code ${exitCode}`
      }
    } catch (err) {
      log.error('Codex execution error:', err)
      finishReason = 'error'
      if (!finalText) {
        finalText = `Codex execution error: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    const totalDuration = Date.now() - startTime
    log.info(`Completed in ${totalDuration}ms | ${stepNumber} steps`)

    return {
      finalText: finalText || null,
      steps,
      finishReason,
      usage: totalUsage,
    }
  }

  private processEvent(
    event: any,
    log: ReturnType<typeof createLogger>,
    steps: CodingStep[],
    startTime: number,
    state: {
      stepNumber: () => number
      incrStep: () => number
      setFinalText: (t: string) => void
      setFinishReason: (r: 'stop' | 'length' | 'error') => void
      setUsage: (u: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void
    },
  ): void {
    const type = event.type as string

    if (type === 'thread.started') {
      log.info(`Thread: ${event.thread_id}`)
    }

    if (type === 'item.completed' && event.item) {
      const item = event.item
      const stepNum = state.incrStep()

      if (item.type === 'agent_message' && item.text) {
        log.assistant(`text: ${item.text.slice(0, 200)}`)
        state.setFinalText(item.text)
        steps.push({
          step_number: stepNum,
          content: item.text,
          tool_calls: [],
          timestamp_ms: Date.now() - startTime,
        })
      }

      if (item.type === 'command_execution') {
        const toolCall: CodingStepToolCall = {
          tool_name: 'Bash',
          tool_input: { command: item.command || '' },
          tool_result: (item.aggregated_output || '').slice(0, 2000),
        }
        log.tool(`exec: ${(item.command || '').slice(0, 150)}`)
        steps.push({
          step_number: stepNum,
          content: null,
          tool_calls: [toolCall],
          timestamp_ms: Date.now() - startTime,
        })
      }

      if (item.type === 'file_change' && Array.isArray(item.changes)) {
        const toolCalls: CodingStepToolCall[] = item.changes.map((change: any) => {
          const filePath = change.path || ''
          // Codex CLI doesn't include file content in events — read it from disk
          let content = ''
          if (filePath && (change.kind === 'add' || change.kind === 'modify')) {
            try {
              content = readFileSync(filePath, 'utf-8')
            } catch { /* file may have been deleted or is unreadable */ }
          }
          return {
            tool_name: 'Write',
            tool_input: { file_path: filePath, content },
            tool_result: item.status || 'completed',
          }
        })
        const filePaths = item.changes.map((c: any) => c.path || 'unknown').join(', ')
        log.tool(`file: ${filePaths}`)
        steps.push({
          step_number: stepNum,
          content: null,
          tool_calls: toolCalls,
          timestamp_ms: Date.now() - startTime,
        })
      }
    }

    if (type === 'turn.completed' && event.usage) {
      const u = event.usage
      state.setUsage({
        prompt_tokens: u.input_tokens || 0,
        completion_tokens: u.output_tokens || 0,
        total_tokens: (u.input_tokens || 0) + (u.output_tokens || 0),
      })
    }

    if (type === 'turn.failed') {
      log.error('Turn failed:', JSON.stringify(event).slice(0, 300))
      state.setFinishReason('error')
    }

    if (type === 'error') {
      log.error('Error event:', event.message || JSON.stringify(event).slice(0, 300))
      state.setFinishReason('error')
    }
  }
}
