import { ClaudeProvider } from './claude'
import { CodexProvider } from './codex'
import type { Provider } from './types'

// ---------------------------------------------------------------------------
// Provider instances
// ---------------------------------------------------------------------------

const providers: Provider[] = [
  new ClaudeProvider(),
  new CodexProvider(),
]

// ---------------------------------------------------------------------------
// Model prefix → provider routing
// ---------------------------------------------------------------------------

const MODEL_PREFIXES = [
  // OpenAI / Codex family
  { prefix: 'gpt-',    provider: 'codex' },
  { prefix: 'o1',      provider: 'codex' },
  { prefix: 'o3',      provider: 'codex' },
  { prefix: 'o4',      provider: 'codex' },
  { prefix: 'codex',   provider: 'codex' },
  // Claude family (also the default fallback)
  { prefix: 'claude-', provider: 'claude' },
  { prefix: 'sonnet',  provider: 'claude' },
  { prefix: 'opus',    provider: 'claude' },
  { prefix: 'haiku',   provider: 'claude' },
]

function findProvider(name: string): Provider | undefined {
  return providers.find((p) => p.name === name)
}

/**
 * Resolve a model name to a configured Provider.
 * Throws if no prefix matches or if the matched provider has no credentials.
 */
export function resolveProvider(model: string): Provider {
  const lower = model.toLowerCase()

  for (const entry of MODEL_PREFIXES) {
    if (lower.startsWith(entry.prefix)) {
      const provider = findProvider(entry.provider)
      if (!provider) {
        throw new Error(`Provider "${entry.provider}" not registered.`)
      }
      if (!provider.isConfigured()) {
        throw new Error(
          `${provider.name} provider not configured. ` +
          (provider.name === 'codex'
            ? 'Set CODEX_AUTH_JSON (content of ~/.codex/auth.json from `codex login`).'
            : 'Set CLAUDE_CODE_OAUTH_TOKEN.'),
        )
      }
      return provider
    }
  }

  // Default fallback: Claude
  const claude = findProvider('claude')
  if (claude && claude.isConfigured()) return claude

  throw new Error(
    `No provider found for model "${model}". ` +
    'Known prefixes: ' + MODEL_PREFIXES.map((e) => e.prefix).join(', '),
  )
}

/**
 * Returns which providers are configured (have valid credentials).
 * Used by the health endpoint.
 */
export function getConfiguredProviders(): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const p of providers) {
    result[p.name] = p.isConfigured()
  }
  return result
}
