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
  try {
    const base = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL || 'http://localhost:3001'
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
