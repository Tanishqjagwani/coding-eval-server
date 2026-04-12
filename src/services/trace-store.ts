import type { ExecutionTrace } from '../types'

const MAX_TRACES = 100
const traces = new Map<string, ExecutionTrace>()

export function saveTrace(trace: ExecutionTrace): void {
  // FIFO eviction
  if (traces.size >= MAX_TRACES) {
    const oldest = traces.keys().next().value!
    traces.delete(oldest)
  }
  traces.set(trace.trace_id, trace)
}

export function getTrace(id: string): ExecutionTrace | null {
  return traces.get(id) ?? null
}

export function listTraces(limit = 20): ExecutionTrace[] {
  const all = Array.from(traces.values())
  all.reverse() // newest first
  return all.slice(0, limit)
}
