// Shows a saved page from the database. The iframe is sandboxed without scripts, so the saved
// page can't run code inside the extension; links open in a new tab.
import { offscreen } from '../shared/rpc'
import './viewer.css'

const url = new URLSearchParams(location.search).get('url') ?? ''
const frame = document.getElementById('frame') as HTMLIFrameElement
const original = document.getElementById('original') as HTMLAnchorElement
const when = document.getElementById('when')!
const empty = document.getElementById('empty')!

original.href = url

const saved = url ? await offscreen({ op: 'archive.get', url }) : null
if (!saved) {
  empty.hidden = false
  frame.hidden = true
} else {
  const date = new Date(saved.archived_at).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })
  when.textContent = `${date} · ${saved.source === 'tab' ? 'da aba aberta' : 'baixada do site'}`
  document.title = `Cópia salva · ${new URL(url).hostname}`
  frame.srcdoc = saved.html.replace(/<head[^>]*>/i, (head) => `${head}<base target="_blank">`)
}
