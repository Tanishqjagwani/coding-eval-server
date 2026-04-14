import { z } from 'zod'

const envSchema = z.object({
  CLAUDE_MODEL: z.string().default('sonnet'),
  PORT: z.coerce.number().default(4001),
})

export type EnvConfig = z.infer<typeof envSchema>

let _config: EnvConfig | null = null

export function getConfig(): EnvConfig {
  if (!_config) {
    _config = envSchema.parse(process.env)
  }
  return _config
}

export const config = new Proxy({} as EnvConfig, {
  get(_, prop: string) {
    return getConfig()[prop as keyof EnvConfig]
  },
})
