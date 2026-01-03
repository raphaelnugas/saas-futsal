export function logInfo(message: string, context?: Record<string, unknown>) {
  send('info', message, context)
}

export function logWarn(message: string, context?: Record<string, unknown>) {
  send('warn', message, context)
}

export function logError(message: string, context?: Record<string, unknown>) {
  send('error', message, context)
}

async function send(level: 'info'|'warn'|'error', message: string, context?: Record<string, unknown>) {
  if (context && typeof context.status === 'number' && context.status === 429) {
    console.warn(`[client:429] ${message}`, context)
    return
  }
  try {
    const envBase = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL
    let base = envBase && envBase.trim().length > 0 ? envBase : 'http://localhost:3001'
    if (typeof window !== 'undefined') {
      const host = window.location.hostname
      if (host && host !== 'localhost' && host !== '127.0.0.1' && (!envBase || envBase.trim().length === 0)) {
        base = ''
      }
    }
    await fetch(`${base}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, context })
    })
  } catch (e: unknown) {
    const msg = typeof e === 'object' && e && 'message' in e ? String((e as { message?: unknown }).message || '') : ''
    if (msg.includes('ERR_ABORTED')) {
      return
    }
    console[level](`[client] ${message}`, context)
  }
}
