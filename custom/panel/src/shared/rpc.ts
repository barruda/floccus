import { CHANNEL, type OffscreenRequest, type OffscreenResults, type Reply } from './protocol'

let offscreenReady: Promise<void> | null = null

// Only the service worker may create the offscreen document, so pages ask it first. The
// document lives until the browser closes it, so one successful call per page is enough.
function ensureOffscreen(): Promise<void> {
  offscreenReady ??= chrome.runtime
    .sendMessage({ channel: CHANNEL, target: 'background', op: 'ensureOffscreen' })
    .then((reply: Reply<null>) => {
      if ('error' in reply) throw new Error(reply.error)
    })
    .catch((err) => {
      offscreenReady = null
      throw err
    })
  return offscreenReady
}

export async function offscreen<R extends OffscreenRequest>(
  req: R,
): Promise<OffscreenResults[R['op']]> {
  await ensureOffscreen()
  const reply: Reply<OffscreenResults[R['op']]> | undefined = await chrome.runtime.sendMessage({
    channel: CHANNEL,
    target: 'offscreen',
    ...req,
  })
  if (!reply) throw new Error(`No answer to ${req.op}`)
  if ('error' in reply) throw new Error(reply.error)
  return reply.result
}
