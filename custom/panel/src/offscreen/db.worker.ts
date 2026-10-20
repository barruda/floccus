// The SQLite database, in the extension's origin-private file system (OPFS). The SAH pool VFS
// needs synchronous file handles, which only a dedicated worker gets, so the offscreen document
// runs this worker and is the database's only client.
import sqlite3InitModule, { type BindingSpec } from '@sqlite.org/sqlite-wasm'

export interface Statement {
  sql: string
  bind?: BindingSpec
}

export interface WorkerRequest {
  id: number
  statements: Statement[]
}

export type WorkerReply =
  | { id: number; rows: Record<string, unknown>[] }
  | { id: number; error: string }

const MIGRATIONS: string[] = [
  `CREATE TABLE pages (
     url TEXT PRIMARY KEY,
     title TEXT,
     description TEXT,
     image TEXT,
     site_name TEXT,
     meta_fetched_at INTEGER,
     meta_error TEXT,
     shot TEXT,
     shot_at INTEGER,
     archived_at INTEGER,
     archive_source TEXT,
     archive_bytes INTEGER
   );
   CREATE TABLE archives (
     url TEXT PRIMARY KEY,
     html_gz BLOB NOT NULL
   );
   CREATE VIRTUAL TABLE archive_fts USING fts5(url UNINDEXED, title, body);`,
]

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule()
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'floccus-panel' })
  const db = new pool.OpfsSAHPoolDb('/floccus-panel.sqlite3')
  const version = Number(db.selectValue('PRAGMA user_version') ?? 0)
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction((tx) => {
      tx.exec(MIGRATIONS[v])
      tx.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
  return db
})()

// Each request is one transaction; the reply carries the rows of its last statement.
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, statements } = event.data
  try {
    const db = await ready
    let rows: Record<string, unknown>[] = []
    db.transaction((tx) => {
      for (const { sql, bind } of statements) {
        rows = tx.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' }) as Record<
          string,
          unknown
        >[]
      }
    })
    self.postMessage({ id, rows } satisfies WorkerReply)
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) } satisfies WorkerReply)
  }
}
