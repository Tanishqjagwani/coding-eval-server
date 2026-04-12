import { z } from 'zod'

const envSchema = z.object({
  HF_URL: z.string().min(1, 'HF_URL is required'),
  HF_MODEL: z.string().min(1, 'HF_MODEL is required'),
  HF_API_KEY: z.string().optional(),
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
