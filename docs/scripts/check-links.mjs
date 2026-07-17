import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const markdownFiles = readdirSync('.', { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name)

const result = spawnSync(
  process.execPath,
  ['node_modules/markdown-link-check/markdown-link-check', '--config', '.markdown-link-check.json', '--quiet', ...markdownFiles],
  { stdio: 'inherit' }
)

process.exit(result.status ?? 1)