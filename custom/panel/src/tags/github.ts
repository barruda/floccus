// Reads and writes tags.json through GitHub's REST API (no git client needed). The file lives on
// its own branch of the bookmarks repository because floccus owns the main branch: "sync from
// scratch" force-pushes it with only floccus's files, which would delete anything of ours.
import { parse, serialize, type TagFile } from './model'

export interface RepoConfig {
  owner: string
  repo: string
  token: string
  branch: string
  apiBase: string
  source: 'floccus' | 'manual'
}

export const TAGS_PATH = 'tags.json'
export const DEFAULT_BRANCH = 'panel'
export const DEFAULT_API = 'https://api.github.com'

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// The file changed on GitHub since we read it; read, merge and write again.
export class ConflictError extends GitHubError {}

const BRANCH_README = `# Branch \`panel\`: dados do painel de favoritos

Este branch NÃO é do floccus. O floccus usa o branch \`main\` (bookmarks.xbel) e pode
reescrevê-lo do zero com force push; por isso os dados do painel ficam aqui, separados.

Quem escreve aqui: o painel lateral do fork barruda/floccus (branch \`custom\`,
diretório \`custom/panel\`). Veja \`custom/README.md\`, seção "Tags", naquele repositório.

## tags.json

Tags de cada favorito, por URL da página:

\`\`\`json
{
  "version": 1,
  "entries": {
    "https://exemplo.com/pagina": { "tags": ["receitas"], "updatedAt": 1760982000000 }
  }
}
\`\`\`

- \`updatedAt\` (ms): na mescla entre navegadores, vence a entrada mais nova de cada URL.
- \`tags: []\` marca uma remoção, para ela chegar aos outros navegadores; some depois de 180 dias.
- Pode editar à mão: mantenha o formato e aumente o \`updatedAt\` da entrada alterada.
`

function utf8ToBase64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

async function api<T>(cfg: RepoConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${cfg.apiBase}/repos/${cfg.owner}/${cfg.repo}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (res.ok) return res.json() as Promise<T>
  const message = (await res.json().catch(() => null))?.message ?? res.statusText
  const conflict = res.status === 409 || (res.status === 422 && /sha/i.test(message))
  throw new (conflict ? ConflictError : GitHubError)(res.status, `GitHub ${res.status}: ${message}`)
}

export interface RemoteTags {
  file: TagFile
  sha: string
}

// null: the branch or the file doesn't exist yet.
export async function readTags(cfg: RepoConfig): Promise<RemoteTags | null> {
  try {
    const data = await api<{ content: string; sha: string }>(
      cfg,
      `/contents/${TAGS_PATH}?ref=${encodeURIComponent(cfg.branch)}`,
    )
    return { file: parse(base64ToUtf8(data.content)), sha: data.sha }
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null
    throw err
  }
}

async function branchExists(cfg: RepoConfig): Promise<boolean> {
  try {
    await api(cfg, `/branches/${encodeURIComponent(cfg.branch)}`)
    return true
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return false
    throw err
  }
}

// A branch with no history in common with floccus's: README.md explaining it, and tags.json.
async function createBranch(cfg: RepoConfig, content: string): Promise<string> {
  const blob = (text: string) =>
    api<{ sha: string }>(cfg, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: text, encoding: 'utf-8' }) })
  const [readme, tags] = await Promise.all([blob(BRANCH_README), blob(content)])
  const tree = await api<{ sha: string }>(cfg, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      tree: [
        { path: 'README.md', mode: '100644', type: 'blob', sha: readme.sha },
        { path: TAGS_PATH, mode: '100644', type: 'blob', sha: tags.sha },
      ],
    }),
  })
  const commit = await api<{ sha: string }>(cfg, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message: 'Painel: cria o branch de dados do painel (tags)', tree: tree.sha, parents: [] }),
  })
  await api(cfg, '/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${cfg.branch}`, sha: commit.sha }),
  })
  return tags.sha
}

// Writes the file and returns its new sha. `sha` is the version we merged with (null when the
// file didn't exist); GitHub refuses the write with a ConflictError if it changed since.
export async function writeTags(cfg: RepoConfig, file: TagFile, sha: string | null): Promise<string> {
  const content = serialize(file)
  if (!sha && !(await branchExists(cfg))) return createBranch(cfg, content)
  const result = await api<{ content: { sha: string } }>(cfg, `/contents/${TAGS_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'Painel: atualiza tags',
      content: utf8ToBase64(content),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  })
  return result.content.sha
}

export function branchUrl(cfg: RepoConfig): string {
  return `https://github.com/${cfg.owner}/${cfg.repo}/tree/${encodeURIComponent(cfg.branch)}`
}
