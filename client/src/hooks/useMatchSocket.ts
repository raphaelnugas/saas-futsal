import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import type { AxiosInstance } from 'axios'

interface StatEvent {
  stat_id: number
  match_id: number
  player_scorer_id: number | null
  player_assist_id: number | null
  team_scored: 'black' | 'orange'
  goal_minute: number | null
  is_own_goal: boolean
  event_type: 'goal' | 'substitution' | 'tie_decider'
}

type QueueGoal = {
  matchId: number
  payload: {
    scorer_id?: number
    assist_id?: number
    team_scored: 'black' | 'orange'
    is_own_goal: boolean
    goal_minute: number
  }
  ts: number
}

interface UseMatchSocketProps {
  currentMatchId: number | null
  matchInProgress: boolean
  onMatchStatsUpdate: (stats: StatEvent[]) => void
  onScoreUpdate: (black: number, orange: number) => void
  onStreakUpdate: (black: number, orange: number) => void
  onFinishRemote: (black: number, orange: number) => void
}

export const useMatchSocket = ({
  currentMatchId,
  matchInProgress,
  onMatchStatsUpdate,
  onScoreUpdate,
  onStreakUpdate,
  onFinishRemote
}: UseMatchSocketProps) => {
  const [connectionStatus, setConnectionStatus] = useState<'online'|'reconnecting'|'offline'>('offline')
  const sseRef = useRef<EventSource | null>(null)
  const sseAttemptsRef = useRef<number>(0)
  const pollIntervalRef = useRef<number | null>(null)
  const sseStatsRef = useRef<{ opens: number; errors: number; reconnects: number; pings: number; inits: number; goals: number; finishes: number; polls: number }>({
    opens: 0, errors: 0, reconnects: 0, pings: 0, inits: 0, goals: 0, finishes: 0, polls: 0
  })

  const readQueue = (): QueueGoal[] => {
    try {
      const raw = localStorage.getItem('matchGoalQueue')
      return raw ? JSON.parse(raw) as QueueGoal[] : []
    } catch {
      return []
    }
  }

  const writeQueue = (q: QueueGoal[]) => {
    try {
      localStorage.setItem('matchGoalQueue', JSON.stringify(q))
    } catch { void 0 }
  }

  const drainGoalQueue = async () => {
    if (!currentMatchId || !matchInProgress) return
    let q = readQueue()
    let changed = false
    for (let i = 0; i < q.length; i++) {
      const item = q[i]
      if (!item || item.matchId !== currentMatchId) continue
      try {
        await api.post(`/api/matches/${currentMatchId}/stats-goal`, item.payload)
        delete q[i]
        changed = true
      } catch (e: unknown) {
        const err = e as { response?: { status?: number } }
        const st = err?.response?.status
        if (st === 403) {
          delete q[i]
          changed = true
          continue
        }
        break
      }
    }
    if (changed) {
      q = q.filter((x) => x && typeof x.matchId === 'number')
      writeQueue(q)
      try {
        const statsResp = await api.get(`/api/matches/${currentMatchId}/stats`)
        const stats = (statsResp.data?.stats || []) as StatEvent[]
        onMatchStatsUpdate(stats)
        const blackGoals = stats.filter(ev => ev.event_type === 'goal' && ev.team_scored === 'black').length
        const orangeGoals = stats.filter(ev => ev.event_type === 'goal' && ev.team_scored === 'orange').length
        onScoreUpdate(blackGoals, orangeGoals)
      } catch { void 0 }
    }
  }

  const startPolling = async () => {
    if (!currentMatchId) return
    try {
      console.info('[sse:poll-tick]', { partida: currentMatchId })
      const statsResp = await api.get(`/api/matches/${currentMatchId}/stats`)
      const stats = (statsResp.data?.stats || []) as StatEvent[]
      onMatchStatsUpdate(stats)
      const blackGoals = stats.filter(ev => ev.event_type === 'goal' && ev.team_scored === 'black').length
      const orangeGoals = stats.filter(ev => ev.event_type === 'goal' && ev.team_scored === 'orange').length
      onScoreUpdate(blackGoals, orangeGoals)

      try {
        const det = await api.get(`/api/matches/${currentMatchId}`)
        const st = det.data?.match?.status as string | undefined
        const b = Number(det.data?.match?.team_black_score || blackGoals || 0)
        const o = Number(det.data?.match?.team_orange_score || orangeGoals || 0)
        const m = det.data?.match as { team_black_win_streak?: number, team_orange_win_streak?: number }
        const pollBlack = Number(m?.team_black_win_streak || 0)
        const pollOrange = Number(m?.team_orange_win_streak || 0)
        onStreakUpdate(pollBlack, pollOrange)
        
        sseStatsRef.current.polls += 1
        console.info('[streak:poll]', { partida: currentMatchId, preto: pollBlack, laranja: pollOrange, polls: sseStatsRef.current.polls })
        if (st === 'finished') {
          onFinishRemote(b, o)
        }
      } catch { void 0 }
    } catch { void 0 }
  }

  useEffect(() => {
    const onlineHandler = () => {
      try {
        const rawQ = localStorage.getItem('matchGoalQueue')
        if (rawQ && JSON.parse(rawQ).length) {
          drainGoalQueue()
        }
      } catch { void 0 }
    }
    window.addEventListener('online', onlineHandler)
    const i = setInterval(() => {
      drainGoalQueue()
    }, 5000)
    return () => {
      window.removeEventListener('online', onlineHandler)
      clearInterval(i)
    }
  }, [currentMatchId, matchInProgress])

  useEffect(() => {
    if (!matchInProgress || !currentMatchId) {
      if (sseRef.current) {
        try { sseRef.current.close() } catch { void 0 }
        sseRef.current = null
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      setConnectionStatus(navigator.onLine ? 'online' : 'offline')
      return
    }
    try {
      const base = ((api as AxiosInstance).defaults.baseURL) || ''
      const token = localStorage.getItem('token') || ''
      const sseUrl = base.endsWith('/api')
        ? `${base}/matches/${currentMatchId}/stream?token=${encodeURIComponent(token)}`
        : `${base}/api/matches/${currentMatchId}/stream?token=${encodeURIComponent(token)}`
      const es = new EventSource(sseUrl)
      sseRef.current = es
      es.onopen = () => {
        sseStatsRef.current.opens += 1
        console.info('[sse:open]', { url: sseUrl, tentativa: sseAttemptsRef.current, aberturas: sseStatsRef.current.opens })
        setConnectionStatus('online')
        sseAttemptsRef.current = 0
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
          console.info('[sse:poll-stop]', { partida: currentMatchId })
        }
      }
      es.onerror = () => {
        setConnectionStatus('reconnecting')
        sseStatsRef.current.errors += 1
        sseStatsRef.current.reconnects += 1
        sseAttemptsRef.current = Math.min(10, sseAttemptsRef.current + 1)
        console.warn('[sse:error]', {
          tentativa: sseAttemptsRef.current,
          online: navigator.onLine,
          readyState: es.readyState,
          errors: sseStatsRef.current.errors,
          reconnects: sseStatsRef.current.reconnects
        })
        if (sseAttemptsRef.current >= 5 && !pollIntervalRef.current) {
          console.info('[sse:poll-start]', { partida: currentMatchId })
          pollIntervalRef.current = window.setInterval(() => {
            startPolling()
          }, 4000)
        }
      }
      es.addEventListener('ping', () => {
        sseStatsRef.current.pings += 1
        console.info('[sse:ping]', { pings: sseStatsRef.current.pings })
        setConnectionStatus('online')
      })
      es.addEventListener('init', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { stats: StatEvent[]; blackGoals: number; orangeGoals: number }
          sseStatsRef.current.inits += 1
          console.info('[sse:init]', { eventos: data.stats?.length || 0, golsPreto: Number(data.blackGoals || 0), golsLaranja: Number(data.orangeGoals || 0), inits: sseStatsRef.current.inits })
          onMatchStatsUpdate(data.stats || [])
          onScoreUpdate(Number(data.blackGoals || 0), Number(data.orangeGoals || 0))
          
          ;(async () => {
            try {
              const det = await api.get(`/api/matches/${currentMatchId}`)
              const m = det.data?.match as { team_black_win_streak?: number, team_orange_win_streak?: number }
              const sseBlack = Number(m?.team_black_win_streak || 0)
              const sseOrange = Number(m?.team_orange_win_streak || 0)
              onStreakUpdate(sseBlack, sseOrange)
              console.info('[streak:sse-init]', { partida: currentMatchId, preto: sseBlack, laranja: sseOrange })
            } catch { void 0 }
          })()
        } catch { void 0 }
      })
      es.addEventListener('goal', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { stat: StatEvent; blackGoals: number; orangeGoals: number }
          sseStatsRef.current.goals += 1
          console.info('[sse:goal]', { golsPreto: Number(data.blackGoals || 0), golsLaranja: Number(data.orangeGoals || 0), goals: sseStatsRef.current.goals })
          // We don't append here directly because onMatchStatsUpdate usually replaces the whole array or appends. 
          // However, for consistency with how useMatchSocket is designed, we might want to let the parent handle the append logic or just re-fetch.
          // But based on original code, it appends. Let's pass the single stat if possible, or refetch.
          // To keep it simple and consistent with the original code structure which used setMatchStats(prev => [...prev, data.stat]),
          // we should probably expose a way to append.
          // BUT, to avoid complexity, we can just rely on the parent refetching or we can assume onMatchStatsUpdate can handle a full list if we maintained it here.
          // Actually, the original code maintained state. 
          // Let's just trigger a callback that says "new goal arrived" with the full updated score.
          
          // IMPORTANT: The original code used setMatchStats(prev => [...prev, data.stat]).
          // Since we don't have the 'prev' state inside this hook easily without making it complex,
          // we will rely on the fact that 'goal' event also sends updated scores.
          // We should ideally fetch the latest stats to be sure, OR pass a callback that handles the append.
          // Let's fetch the latest stats to ensure consistency, although slightly more expensive.
          startPolling() 
          
        } catch { void 0 }
      })
      es.addEventListener('finish', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { match_id: number; blackScore?: number; orangeScore?: number }
          sseStatsRef.current.finishes += 1
          console.info('[sse:finish]', { partida: data.match_id, finishes: sseStatsRef.current.finishes })
          if (data.match_id === currentMatchId) {
            const b = Number(data.blackScore || 0)
            const o = Number(data.orangeScore || 0)
            onFinishRemote(b, o)
            
            // Força um refresh da página após 2 segundos para limpar qualquer estado visual travado
            setTimeout(() => {
              window.location.reload()
            }, 2000)
          }
        } catch { void 0 }
      })
    } catch {
      setConnectionStatus('reconnecting')
    }
    return () => {
      if (sseRef.current) {
        try { sseRef.current.close() } catch { void 0 }
        sseRef.current = null
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [matchInProgress, currentMatchId])

  return { connectionStatus, startPolling }
}
