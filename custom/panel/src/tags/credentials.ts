// Where the tags sync to. By default the panel reuses floccus's Git profile (the bookmarks
// repository and its token), reading floccus's storage without ever writing to it. A manual
// setting in the panel overrides it, e.g. when floccus's profiles are locked with a password.
import { DEFAULT_API, DEFAULT_BRANCH, type RepoConfig } from './github'

const MANUAL_KEY = 'floccus-panel.tagsRepo'

export interface ManualRepo {
  owner: string
  repo: string
  token: string
  branch?: string
  apiBase?: string // only the smoke test changes this
}

export type ConfigResult = { config: RepoConfig } | { error: string }

export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  return match ? { owner: match[1], repo: match[2] } : null
}

// floccus stores entries as JSON strings, sometimes stringified more than once.
function unwrap(value: unknown): unknown {
  while (typeof value === 'string') value = JSON.parse(value)
  return value
}

interface FloccusAccount {
  type?: string
  url?: string
  password?: string
}

export async function loadConfig(): Promise<ConfigResult> {
  const stored = await chrome.storage.local.get([MANUAL_KEY, 'accounts', 'accountsLocked'])
  const manual = stored[MANUAL_KEY] as ManualRepo | undefined
  if (manual?.owner && manual.repo && manual.token) {
    return {
      config: {
        owner: manual.owner,
        repo: manual.repo,
        token: manual.token,
        branch: manual.branch || DEFAULT_BRANCH,
        apiBase: manual.apiBase || DEFAULT_API,
        source: 'manual',
      },
    }
  }

  let accounts: Record<string, FloccusAccount> = {}
  try {
    accounts = (unwrap(stored.accounts) as Record<string, FloccusAccount>) ?? {}
  } catch {
    /* unreadable: treated as no profile */
  }
  const git = Object.values(accounts).find((a) => a?.type === 'git' && a.url && parseGitHubRepo(a.url))
  if (!git) return { error: 'Nenhum perfil Git do GitHub no floccus. Configure o repositório aqui.' }
  if (stored.accountsLocked) {
    return { error: 'Os perfis do floccus estão protegidos por senha. Informe o repositório e o token aqui.' }
  }
  const repo = parseGitHubRepo(git.url!)!
  return {
    config: { ...repo, token: git.password ?? '', branch: DEFAULT_BRANCH, apiBase: DEFAULT_API, source: 'floccus' },
  }
}

export async function saveManualRepo(repo: ManualRepo | null) {
  if (repo) await chrome.storage.local.set({ [MANUAL_KEY]: repo })
  else await chrome.storage.local.remove(MANUAL_KEY)
}
