// ---------------------------------------------------------------------------
// Agent Tool Call (inlined from TensorEvalEngine — OpenAI format)
// ---------------------------------------------------------------------------

export interface AgentToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // raw JSON string from OpenAI
  }
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions (standard request/response)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: AgentToolCall[]
  tool_call_id?: string
}

export interface ChatCompletionsRequest {
  model?: string
  messages: ChatMessage[]

}

export interface ChatCompletionsResponse {
  id: string // "chatcmpl-<nanoid>" — doubles as trace_id
  object: 'chat.completion'
  created: number
  model: string
  choices: [
    {
      index: 0
      message: {
        role: 'assistant'
        content: string | null
        tool_calls?: AgentToolCall[]
      }
      finish_reason: 'stop' | 'length' | 'error'
    },
  ]
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

// ---------------------------------------------------------------------------
// Execution trace
// ---------------------------------------------------------------------------

export interface CodingStepToolCall {
  tool_name: string
  tool_input: Record<string, unknown>
  tool_result?: string
}

export interface CodingStep {
  step_number: number
  content: string | null
  tool_calls: CodingStepToolCall[]
  timestamp_ms: number
}

export interface ExecutionTrace {
  trace_id: string
  task: string
  model: string
  steps: CodingStep[]
  total_steps: number
  total_duration_ms: number
  final_output: string | null
  files_created: string[]
  created_at: string
}
