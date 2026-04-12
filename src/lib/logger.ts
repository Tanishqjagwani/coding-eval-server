const TAG_COLORS: Record<string, string> = {
  system: '\x1b[36m',    // cyan
  assistant: '\x1b[32m', // green
  tool: '\x1b[33m',      // yellow
  result: '\x1b[35m',    // magenta
  error: '\x1b[31m',     // red
  info: '\x1b[34m',      // blue
  timing: '\x1b[90m',    // gray
}
const RESET = '\x1b[0m'

function fmt(tag: string, ...args: unknown[]) {
  const color = TAG_COLORS[tag] || ''
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`${TAG_COLORS.timing}${ts}${RESET} ${color}[${tag}]${RESET}`, ...args)
}

export function createLogger(prefix: string) {
  return {
    system: (...args: unknown[]) => fmt('system', `(${prefix})`, ...args),
    assistant: (...args: unknown[]) => fmt('assistant', `(${prefix})`, ...args),
    tool: (...args: unknown[]) => fmt('tool', `(${prefix})`, ...args),
    result: (...args: unknown[]) => fmt('result', `(${prefix})`, ...args),
    error: (...args: unknown[]) => fmt('error', `(${prefix})`, ...args),
    info: (...args: unknown[]) => fmt('info', `(${prefix})`, ...args),
  }
}

/**
 * Logs all fields from an SDK streaming message.
 * Handles: system, assistant (text + tool_use), result
 */
export function logSdkMessage(log: ReturnType<typeof createLogger>, message: any) {
  if (message.type === 'system') {
    log.system(`subtype=${message.subtype}`, message.session_id ? `session=${message.session_id}` : '')
  }

  if (message.type === 'assistant') {
    const content = message.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text') {
          const preview = block.text.length > 200
            ? block.text.slice(0, 200) + `... (${block.text.length} chars)`
            : block.text
          log.assistant(`text: ${preview}`)
        }
        if (block.type === 'tool_use') {
          const inputPreview = JSON.stringify(block.input).slice(0, 150)
          log.tool(`call: ${block.name} → ${inputPreview}`)
        }
        if (block.type === 'tool_result') {
          const resultPreview = typeof block.content === 'string'
            ? block.content.slice(0, 150)
            : JSON.stringify(block.content).slice(0, 150)
          log.tool(`result: ${resultPreview}`)
        }
      }
    }
  }

  if (message.type === 'result') {
    log.result(`subtype=${(message as any).subtype || 'unknown'}`, `cost_usd=${(message as any).cost_usd || '?'}`)
  }
}
