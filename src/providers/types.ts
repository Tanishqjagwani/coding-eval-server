import type { ChatMessage, CodingStep } from '../types'

export interface ProviderResult {
  finalText: string | null
  steps: CodingStep[]
  finishReason: 'stop' | 'length' | 'error'
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export interface ProviderExecuteOptions {
  model: string
  messages: ChatMessage[]
  systemPrompt?: string
  userTask: string
  cwd: string
}

export interface Provider {
  readonly name: string
  /** Check if this provider has valid credentials configured. */
  isConfigured(): boolean
  /** Run the agent and return normalized results. */
  execute(options: ProviderExecuteOptions): Promise<ProviderResult>
}
