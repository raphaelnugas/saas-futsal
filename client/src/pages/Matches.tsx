import React, { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Plus, Play, RotateCcw, Trophy, Clock, Trash2 } from 'lucide-react'
import api from '../services/api'
import { logError } from '../services/logger'
import type { AxiosInstance } from 'axios'

interface Player {
  id: number
  name: string
  position: string
  total_goals_scored: number
  total_matches_played: number
  win_rate: number
  attr_ofe?: number
  attr_def?: number
  attr_vel?: number
  attr_tec?: number
  attr_for?: number
  attr_pot?: number
  overall?: number
}

interface Match {
  id: number
  match_date: string
  team_blue_score: number
  team_orange_score: number
  winning_team: string
  duration_minutes: number
  blue_players: number[]
  orange_players: number[]
  orange_win_streak: number
}

interface StatEvent {
  stat_id: number
  match_id: number
  player_scorer_id: number | null
  player_assist_id: number | null
  team_scored: 'black' | 'orange'
  goal_minute: number | null
  is_own_goal: boolean
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

type WebAudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }

const Matches: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedPlayers, setSelectedPlayers] = useState<number[]>([])
  const [teams, setTeams] = useState<{ black: Player[]; orange: Player[] }>({ black: [], orange: [] })
  const [matchInProgress, setMatchInProgress] = useState(false)
  const [currentMatch, setCurrentMatch] = useState<{
    blackScore: number
    orangeScore: number
    startTime: Date
    duration: number
  } | null>(null)
  const [currentMatchId, setCurrentMatchId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [goalModal, setGoalModal] = useState<{ open: boolean; team: 'black'|'orange' } | null>(null)
  const [goalForm, setGoalForm] = useState<{ scorer_id: number | 'own' | null; assist_id: number | null; is_own_goal: boolean }>({ scorer_id: null, assist_id: null, is_own_goal: false })
  const [tick, setTick] = useState(0)
  const restoredRef = useRef(false)
  const [gkModal, setGkModal] = useState<{ open: boolean; candidates: Player[] } | null>(null)
  const [gkAsFieldId, setGkAsFieldId] = useState<number | null>(null)
  const [liveStats, setLiveStats] = useState<Record<number, { goals: number; assists: number; ownGoals: number }>>({})
  const [bench, setBench] = useState<Player[]>([])
  const [matchStats, setMatchStats] = useState<StatEvent[]>([])
  const [matchDurationMin, setMatchDurationMin] = useState<number>(10)
  const beepIntervalRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [submittingGoal, setSubmittingGoal] = useState<boolean>(false)
  const [alarmMuted, setAlarmMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('matchAlarmMuted') === '1'
    } catch {
      return false
    }
  })
  const [detailsModal, setDetailsModal] = useState<{
    open: boolean
    matchId: number | null
    loading: boolean
    stats: StatEvent[]
    black_ids: number[]
    orange_ids: number[]
    match_date?: string
    black_score?: number
    orange_score?: number
  }>({ open: false, matchId: null, loading: false, stats: [], black_ids: [], orange_ids: [] })
  const [connectionStatus, setConnectionStatus] = useState<'online'|'reconnecting'|'offline'>('offline')
  const sseRef = useRef<EventSource | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/api/auth/config')
        const md = Number(res.data?.matchDuration || 10)
        if (!Number.isNaN(md) && md > 0) setMatchDurationMin(md)
      } catch { void 0 }
    })()
  }, [])

  const fetchData = async () => {
    try {
      const [playersResponse, matchesResponse] = await Promise.all([
        api.get('/api/players'),
        api.get('/api/matches')
      ])
      type PlayerApi = {
        player_id: number
        name: string
        is_goalkeeper: boolean
        total_goals_scored?: number
        total_games_played?: number
        attr_ofe?: number
        attr_def?: number
        attr_vel?: number
        attr_tec?: number
        attr_for?: number
        attr_pot?: number
      }
      const playersList = ((playersResponse.data?.players || []) as PlayerApi[]).map((p) => ({
        id: p.player_id,
        name: p.name,
        position: p.is_goalkeeper ? 'Goleiro' : 'Jogador',
        total_goals_scored: Number(p.total_goals_scored || 0),
        total_matches_played: Number(p.total_games_played || 0),
        win_rate: 0,
        attr_ofe: typeof p.attr_ofe === 'number' ? p.attr_ofe : 50,
        attr_def: typeof p.attr_def === 'number' ? p.attr_def : 50,
        attr_vel: typeof p.attr_vel === 'number' ? p.attr_vel : 50,
        attr_tec: typeof p.attr_tec === 'number' ? p.attr_tec : 50,
        attr_for: typeof p.attr_for === 'number' ? p.attr_for : 50,
        attr_pot: typeof p.attr_pot === 'number' ? p.attr_pot : 50,
        overall: Math.round((
          (typeof p.attr_ofe === 'number' ? p.attr_ofe : 50) +
          (typeof p.attr_def === 'number' ? p.attr_def : 50) +
          (typeof p.attr_vel === 'number' ? p.attr_vel : 50) +
          (typeof p.attr_tec === 'number' ? p.attr_tec : 50) +
          (typeof p.attr_for === 'number' ? p.attr_for : 50) +
          (typeof p.attr_pot === 'number' ? p.attr_pot : 50)
        ) / 6)
      }))
      type MatchApi = {
        match_id: number
        sunday_date: string
        team_orange_score: number
        team_black_score: number
        winner_team: string
        team_orange_win_streak?: number
      }
      const matchesList = ((matchesResponse.data?.matches || []) as MatchApi[]).map((m) => ({
        id: m.match_id,
        match_date: m.sunday_date,
        team_blue_score: m.team_black_score,
        team_orange_score: m.team_orange_score,
        winning_team: m.winner_team,
        duration_minutes: 0,
        blue_players: [],
        orange_players: [],
        orange_win_streak: Number(m.team_orange_win_streak || 0)
      }))
      setPlayers(playersList)
      setMatches(matchesList)
    } catch (error: unknown) {
      toast.error('Erro ao carregar dados')
      const err = error as { response?: { status?: number }, message?: string }
      logError('matches_load_error', { status: err?.response?.status, message: err?.message })
    } finally {
      setLoading(false)
    }
  }

  const playerOverall = (p: Player): number => {
    const ofe = typeof p.attr_ofe === 'number' ? p.attr_ofe : 50
    const def = typeof p.attr_def === 'number' ? p.attr_def : 50
    const vel = typeof p.attr_vel === 'number' ? p.attr_vel : 50
    const tec = typeof p.attr_tec === 'number' ? p.attr_tec : 50
    const forca = typeof p.attr_for === 'number' ? p.attr_for : 50
    const pot = typeof p.attr_pot === 'number' ? p.attr_pot : 50
    return Math.round((ofe + def + vel + tec + forca + pot) / 6)
  }
  const teamOverallAvg = (list: Player[]): number => {
    if (!list || list.length === 0) return 0
    let sum = 0
    let count = 0
    for (const p of list) {
      sum += typeof p.overall === 'number' ? p.overall : playerOverall(p)
      count++
    }
    return Math.round(sum / count)
  }

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
      } catch {
        break
      }
    }
    if (changed) {
      q = q.filter((x) => x && typeof x.matchId === 'number')
      writeQueue(q)
      try {
        const statsResp = await api.get(`/api/matches/${currentMatchId}/stats`)
        const stats = (statsResp.data?.stats || []) as StatEvent[]
        setMatchStats(stats)
        const blackGoals = stats.filter(ev => ev.team_scored === 'black').length
        const orangeGoals = stats.filter(ev => ev.team_scored === 'orange').length
        setCurrentMatch(prev => prev ? { ...prev, blackScore: blackGoals, orangeScore: orangeGoals } : prev)
        const rawTicker = localStorage.getItem('matchTicker')
        if (rawTicker) {
          try {
            const t = JSON.parse(rawTicker) as { startTime: string; blackScore: number; orangeScore: number }
            t.blackScore = blackGoals
            t.orangeScore = orangeGoals
            localStorage.setItem('matchTicker', JSON.stringify(t))
          } catch { void 0 }
        }
      } catch { void 0 }
    }
  }

  const handlePlayerSelection = (playerId: number) => {
    setSelectedPlayers(prev => {
      if (prev.includes(playerId)) {
        return prev.filter(id => id !== playerId)
      } else if (prev.length < 10) {
        return [...prev, playerId]
      }
      return prev
    })
  }

  const sortTeamsLocal = (list: Player[], overrideKeeperId?: number) => {
    const maxPerTeam = 5
    const goalkeepers = list.filter(p => p.position === 'Goleiro' && p.id !== overrideKeeperId)
    const fieldPlayers = list.filter(p => p.position !== 'Goleiro' || p.id === overrideKeeperId)
    const orange: Player[] = []
    const black: Player[] = []
    if (goalkeepers.length >= 1) {
      orange.push(goalkeepers[0])
      if (goalkeepers.length >= 2) black.push(goalkeepers[1])
    }
    const remaining = fieldPlayers.slice(0, (maxPerTeam * 2) - orange.length - black.length)
    for (let i = 0; i < remaining.length; i++) {
      if (i % 2 === 0 && orange.length < maxPerTeam) {
        orange.push(remaining[i])
      } else if (black.length < maxPerTeam) {
        black.push(remaining[i])
      } else {
        orange.push(remaining[i])
      }
    }
    return { black, orange }
  }

  const sortTeams = async () => {
    if (selectedPlayers.length < 6) {
      toast.error('Selecione pelo menos 6 jogadores')
      return
    }

    const selected = players.filter(p => selectedPlayers.includes(p.id))
    const gkCandidates = selected.filter(p => p.position === 'Goleiro')
    if (gkCandidates.length >= 3) {
      setGkModal({ open: true, candidates: gkCandidates })
      setGkAsFieldId(null)
      return
    }

    try {
      const response = await api.post('/api/matches/sort-teams', {
        player_ids: selectedPlayers
      })
      const { black_team, orange_team, orange_win_streak } = response.data
      const blackPlayers = players.filter(p => black_team.includes(p.id))
      const orangePlayers = players.filter(p => orange_team.includes(p.id))
      setTeams({ black: blackPlayers, orange: orangePlayers })
      // calcular banco (aguardando fora)
      const teamIds = new Set<number>([...black_team, ...orange_team])
      const benchIds = selectedPlayers.filter(id => !teamIds.has(id))
      const benchPlayers = players.filter(p => benchIds.includes(p.id))
      setBench(benchPlayers)
      try {
        localStorage.setItem('matchBench', JSON.stringify(benchIds))
      } catch { void 0 }
      toast.success(`Times sorteados! Sequência de vitórias laranja: ${orange_win_streak}`)
    } catch (error: unknown) {
      toast.error('Erro ao sortear times')
    }
  }

  const startMatch = async () => {
    if (teams.black.length === 0 || teams.orange.length === 0) {
      toast.error('Sorteie os times primeiro')
      return
    }

    try {
      const sundaysResp = await api.get('/api/sundays')
      const sundays = sundaysResp.data?.sundays || []
      if (!sundays.length) {
        toast.error('Nenhum domingo encontrado para criar a partida')
        return
      }
      const latestSundayId = sundays[0].sunday_id
      const matchesResp = await api.get(`/api/matches?sunday_id=${latestSundayId}`)
      const existingMatches = matchesResp.data?.matches || []
      const nextMatchNumber = (existingMatches.length || 0) + 1

      const createResp = await api.post('/api/matches', {
        sunday_id: latestSundayId,
        match_number: nextMatchNumber
      })
      const newMatchId = createResp.data?.match?.match_id
      if (!newMatchId) {
        toast.error('Falha ao criar partida')
        return
      }

      await api.post(`/api/matches/${newMatchId}/participants`, {
        black_team: teams.black.map(p => p.id),
        orange_team: teams.orange.map(p => p.id)
      })

      setCurrentMatchId(newMatchId)
      setMatchInProgress(true)
      setTick(0)
      setCurrentMatch({
        blackScore: 0,
        orangeScore: 0,
        startTime: new Date(),
        duration: 0
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      setAlarmMuted(false)
      try {
        localStorage.removeItem('matchAlarmMuted')
      } catch { void 0 }
      setLiveStats({})
      try {
        localStorage.setItem('matchLiveStats', JSON.stringify({}))
      } catch { void 0 }
      localStorage.setItem('matchTicker', JSON.stringify({
        startTime: new Date().toISOString(),
        blackScore: 0,
        orangeScore: 0
      }))
      localStorage.setItem('matchTeams', JSON.stringify({
        black: teams.black.map(p => p.id),
        orange: teams.orange.map(p => p.id),
      }))
      try {
        localStorage.setItem('matchBench', JSON.stringify(bench.map(p => p.id)))
      } catch { void 0 }
      localStorage.setItem('currentMatchId', String(newMatchId))
      localStorage.setItem('matchInProgress', '1')
      
      toast.success(`Partida ${nextMatchNumber} iniciada!`)
      try {
        const statsResp = await api.get(`/api/matches/${newMatchId}/stats`)
        setMatchStats((statsResp.data?.stats || []) as StatEvent[])
      } catch { void 0 }
    } catch (e: unknown) {
      toast.error('Erro ao iniciar partida')
      const err = e as { response?: { status?: number }, message?: string }
      logError('start_match_error', { status: err?.response?.status, message: err?.message })
    }
  }

  const updateScore = (team: 'black' | 'orange', increment: boolean) => {
    if (!currentMatch) return

    if (increment) {
      if (!currentMatchId) {
        setCurrentMatch(prev => ({
          ...prev!,
          [team === 'black' ? 'blackScore' : 'orangeScore']: (prev![team === 'black' ? 'blackScore' : 'orangeScore'] || 0) + 1
        }))
        const raw = localStorage.getItem('matchTicker')
        try {
          const t = raw ? JSON.parse(raw) as { startTime: string; blackScore: number; orangeScore: number } : null
          const updated = {
            startTime: t?.startTime || new Date().toISOString(),
            blackScore: team === 'black' ? (t?.blackScore || 0) + 1 : (t?.blackScore || 0),
            orangeScore: team === 'orange' ? (t?.orangeScore || 0) + 1 : (t?.orangeScore || 0)
          }
          localStorage.setItem('matchTicker', JSON.stringify(updated))
        } catch { void 0 }
        toast.success('Gol computado (local)')
      } else {
        setGoalForm({ scorer_id: null, assist_id: null, is_own_goal: false })
        setGoalModal({ open: true, team })
      }
    } else {
      setCurrentMatch(prev => ({
        ...prev!,
        [team === 'black' ? 'blackScore' : 'orangeScore']: Math.max(0, 
          prev![team === 'black' ? 'blackScore' : 'orangeScore'] - 1
        )
      }))
      const raw = localStorage.getItem('matchTicker')
      if (raw) {
        try {
          const t = JSON.parse(raw) as { startTime: string; blackScore: number; orangeScore: number }
          const updated = {
            ...t,
            [team === 'black' ? 'blackScore' : 'orangeScore']: Math.max(0, (team === 'black' ? t.blackScore : t.orangeScore) - 1)
          }
          localStorage.setItem('matchTicker', JSON.stringify(updated))
        } catch { void 0 }
      }
    }
  }

  const finishMatch = async () => {
    if (!currentMatch) return
    const cleanup = (message = 'Partida finalizada com sucesso!') => {
      toast.success(message)
      setMatchInProgress(false)
      setCurrentMatch(null)
      setCurrentMatchId(null)
      setAlarmMuted(false)
      setLiveStats({})
      localStorage.removeItem('matchTicker')
      localStorage.removeItem('matchTeams')
      localStorage.removeItem('currentMatchId')
      localStorage.removeItem('matchInProgress')
      localStorage.removeItem('matchLiveStats')
      localStorage.removeItem('matchAlarmMuted')
      localStorage.removeItem('matchGoalQueue')
      fetchData()
    }
 
    try {
      if (!currentMatchId) {
        // Sem ID (por exemplo, a partida foi excluída): encerrar localmente
        cleanup('Partida finalizada localmente')
        // preparar próxima partida com rotação de perdedor
        prepareNextTeamsRotation(currentMatch.blackScore, currentMatch.orangeScore)
        return
      }
 
      await api.post(`/api/matches/${currentMatchId}/finish`, {
        black_score: currentMatch.blackScore,
        orange_score: currentMatch.orangeScore
      })
 
      cleanup('Partida finalizada com sucesso!')
      prepareNextTeamsRotation(currentMatch.blackScore, currentMatch.orangeScore)
    } catch (error: unknown) {
      const err = error as { response?: { status?: number } }
      const code = err?.response?.status
      if (code) {
        logError('finish_match_error', { status: code })
      }
      cleanup('Partida finalizada localmente (erro ao sincronizar com o servidor)')
      prepareNextTeamsRotation(currentMatch.blackScore, currentMatch.orangeScore)
    }
  }

  const openMatchDetails = async (match: Match) => {
    setDetailsModal({
      open: true,
      matchId: match.id,
      loading: true,
      stats: [],
      black_ids: [],
      orange_ids: [],
      match_date: match.match_date,
      black_score: match.team_blue_score,
      orange_score: match.team_orange_score
    })
    try {
      const [statsResp, participantsResp] = await Promise.all([
        api.get(`/api/matches/${match.id}/stats`).catch(() => ({ data: { stats: [] } })),
        api.get(`/api/matches/${match.id}/participants`).catch(() => ({ data: {} }))
      ])
      const stats = (statsResp.data?.stats || []) as StatEvent[]
      const p = participantsResp.data || {}
      const blackIds = (p.black_team || p.black_ids || []) as number[]
      const orangeIds = (p.orange_team || p.orange_ids || []) as number[]
      setDetailsModal(prev => ({
        ...prev,
        loading: false,
        stats,
        black_ids: blackIds,
        orange_ids: orangeIds
      }))
    } catch {
      setDetailsModal(prev => ({ ...prev, loading: false }))
      toast.error('Falha ao carregar detalhes da partida')
    }
  }

  const submitGoal = async () => {
    if (!goalModal?.open || !currentMatchId) {
      setGoalModal(null)
      return
    }
    if (submittingGoal) return
    const team = goalModal.team
    const scorerId = goalForm.scorer_id
    const assistId = goalForm.assist_id
    if (!scorerId) {
      toast.error('Selecione o autor do gol')
      return
    }
    try {
      setSubmittingGoal(true)
      await api.post(`/api/matches/${currentMatchId}/stats-goal`, {
        scorer_id: goalForm.is_own_goal ? undefined : (scorerId as number),
        assist_id: goalForm.is_own_goal ? undefined : (assistId || undefined),
        team_scored: team,
        is_own_goal: !!goalForm.is_own_goal,
        goal_minute: Math.min(120, Math.max(0, Math.floor(tick / 60)))
      })
      setLiveStats(prev => {
        const next = { ...prev }
        if (!goalForm.is_own_goal && typeof scorerId === 'number') {
          const scorer = next[scorerId] || { goals: 0, assists: 0, ownGoals: 0 }
          scorer.goals += 1
          next[scorerId] = scorer
        } else if (goalForm.is_own_goal && typeof scorerId === 'number') {
          const scorer = next[scorerId] || { goals: 0, assists: 0, ownGoals: 0 }
          scorer.ownGoals += 1
          next[scorerId] = scorer
        }
        if (assistId) {
          const assister = next[assistId] || { goals: 0, assists: 0, ownGoals: 0 }
          assister.assists += 1
          next[assistId] = assister
        }
        try {
          localStorage.setItem('matchLiveStats', JSON.stringify(next))
        } catch { void 0 }
        return next
      })
      setCurrentMatch(prev => ({
        ...prev!,
        [team === 'black' ? 'blackScore' : 'orangeScore']: prev![team === 'black' ? 'blackScore' : 'orangeScore'] + 1
      }))
      const raw = localStorage.getItem('matchTicker')
      try {
        const t = raw ? JSON.parse(raw) as { startTime: string; blackScore: number; orangeScore: number } : null
        const updated = {
          startTime: t?.startTime || new Date().toISOString(),
          blackScore: team === 'black' ? (t?.blackScore || 0) + 1 : (t?.blackScore || 0),
          orangeScore: team === 'orange' ? (t?.orangeScore || 0) + 1 : (t?.orangeScore || 0)
        }
        localStorage.setItem('matchTicker', JSON.stringify(updated))
      } catch { void 0 }
      toast.success('Gol registrado!')
      setGoalModal(null)
      try {
        const statsResp = await api.get(`/api/matches/${currentMatchId}/stats`)
        setMatchStats((statsResp.data?.stats || []) as StatEvent[])
      } catch { void 0 }
      setSubmittingGoal(false)
    } catch (e: unknown) {
      const err = e as { response?: { status?: number }, message?: string }
      logError('goal_register_error', { status: err?.response?.status, message: err?.message })
      const payload = {
        scorer_id: goalForm.is_own_goal ? undefined : (scorerId as number),
        assist_id: goalForm.is_own_goal ? undefined : (assistId || undefined),
        team_scored: team,
        is_own_goal: !!goalForm.is_own_goal,
        goal_minute: Math.min(120, Math.max(0, Math.floor(tick / 60)))
      }
      const item = { matchId: currentMatchId, payload, ts: Date.now() }
      try {
        const rawQ = localStorage.getItem('matchGoalQueue')
        const q = rawQ ? JSON.parse(rawQ) : []
        q.push(item)
        localStorage.setItem('matchGoalQueue', JSON.stringify(q))
      } catch { void 0 }
      setGoalModal(null)
      setSubmittingGoal(false)
      toast.warning('Sem conexão. Gol será sincronizado automaticamente.')
    }
  }

  useEffect(() => {
    if (!matchInProgress || !currentMatch?.startTime) return
    const i = setInterval(() => {
      setTick(t => t + 1)
    }, 1000)
    return () => clearInterval(i)
  }, [matchInProgress, currentMatch?.startTime])

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
      setConnectionStatus(navigator.onLine ? 'online' : 'offline')
      return
    }
    try {
      const base = ((api as AxiosInstance).defaults.baseURL) || ''
      const token = localStorage.getItem('token') || ''
      const es = new EventSource(`${base}/api/matches/${currentMatchId}/stream?token=${encodeURIComponent(token)}`)
      sseRef.current = es
      es.onopen = () => {
        setConnectionStatus('online')
      }
      es.onerror = () => {
        setConnectionStatus('reconnecting')
      }
      es.addEventListener('ping', () => {
        setConnectionStatus('online')
      })
      es.addEventListener('init', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { stats: StatEvent[]; blackGoals: number; orangeGoals: number }
          setMatchStats(data.stats || [])
          setCurrentMatch(prev => prev ? { ...prev, blackScore: Number(data.blackGoals || 0), orangeScore: Number(data.orangeGoals || 0) } : prev)
          const rawTicker = localStorage.getItem('matchTicker')
          if (rawTicker) {
            const t = JSON.parse(rawTicker) as { startTime: string; blackScore: number; orangeScore: number }
            t.blackScore = Number(data.blackGoals || 0)
            t.orangeScore = Number(data.orangeGoals || 0)
            localStorage.setItem('matchTicker', JSON.stringify(t))
          }
        } catch { void 0 }
      })
      es.addEventListener('goal', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { stat: StatEvent; blackGoals: number; orangeGoals: number }
          setMatchStats(prev => [...prev, data.stat])
          setCurrentMatch(prev => prev ? { ...prev, blackScore: Number(data.blackGoals || 0), orangeScore: Number(data.orangeGoals || 0) } : prev)
          const rawTicker = localStorage.getItem('matchTicker')
          if (rawTicker) {
            const t = JSON.parse(rawTicker) as { startTime: string; blackScore: number; orangeScore: number }
            t.blackScore = Number(data.blackGoals || 0)
            t.orangeScore = Number(data.orangeGoals || 0)
            localStorage.setItem('matchTicker', JSON.stringify(t))
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
    }
  }, [matchInProgress, currentMatchId])
  useEffect(() => {
    const overtime = matchInProgress && tick >= matchDurationMin * 60 && !alarmMuted
    const startBeeping = () => {
      if (beepIntervalRef.current) return
      if (!audioCtxRef.current) {
        try {
          const W = window as WebAudioWindow
          audioCtxRef.current = new (W.AudioContext || W.webkitAudioContext)()
        } catch { audioCtxRef.current = null }
      }
      const playBeepOnce = () => {
        const ctx = audioCtxRef.current
        if (!ctx) return
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = 900
        gain.gain.value = 0.15
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        setTimeout(() => {
          osc.stop()
          osc.disconnect()
          gain.disconnect()
        }, 350)
      }
      playBeepOnce()
      beepIntervalRef.current = window.setInterval(playBeepOnce, 1200)
    }
    const stopBeeping = () => {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current)
        beepIntervalRef.current = null
      }
    }
    if (overtime) {
      startBeeping()
    } else {
      stopBeeping()
    }
    return () => {
      stopBeeping()
    }
  }, [matchInProgress, tick, matchDurationMin, alarmMuted])

  useEffect(() => {
    if (restoredRef.current) return
    if (loading) return
    const rawTicker = localStorage.getItem('matchTicker')
    const rawTeams = localStorage.getItem('matchTeams')
    const rawBench = localStorage.getItem('matchBench')
    const rawId = localStorage.getItem('currentMatchId')
    const inProgress = localStorage.getItem('matchInProgress') === '1'
    try {
      const t = rawTicker ? JSON.parse(rawTicker) as { startTime: string; blackScore: number; orangeScore: number } : null
      if (t?.startTime) {
        setMatchInProgress(true)
        const start = new Date(t.startTime)
        setCurrentMatch({
          blackScore: Number(t.blackScore || 0),
          orangeScore: Number(t.orangeScore || 0),
          startTime: start,
          duration: 0
        })
        const initialTick = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000))
        setTick(initialTick)
      } else if (inProgress) {
        setMatchInProgress(true)
      }
      if (rawId) {
        const idNum = Number(rawId)
        if (!Number.isNaN(idNum)) setCurrentMatchId(idNum)
        if (!Number.isNaN(idNum)) {
          (async () => {
            try {
              const statsResp = await api.get(`/api/matches/${idNum}/stats`)
              setMatchStats((statsResp.data?.stats || []) as StatEvent[])
            } catch { void 0 }
          })()
        }
      }
      if (rawTeams) {
        const tt = JSON.parse(rawTeams) as { black: number[]; orange: number[] }
        const blackPlayers = players.filter(p => (tt.black || []).includes(p.id))
        const orangePlayers = players.filter(p => (tt.orange || []).includes(p.id))
        if (blackPlayers.length || orangePlayers.length) {
          setTeams({ black: blackPlayers, orange: orangePlayers })
        }
      }
      if (rawBench) {
        const benchIds = JSON.parse(rawBench) as number[]
        const benchPlayers = players.filter(p => (benchIds || []).includes(p.id))
        setBench(benchPlayers)
      }
      const rawStats = localStorage.getItem('matchLiveStats')
      if (rawStats) {
        try {
          const ls = JSON.parse(rawStats) as Record<number, { goals: number; assists: number; ownGoals: number }>
          setLiveStats(ls)
        } catch { void 0 }
      }
      restoredRef.current = true
    } catch { void 0 }
  }, [loading, players])

  useEffect(() => {
    if (!matchStats || matchStats.length === 0) {
      setLiveStats({})
      try {
        localStorage.setItem('matchLiveStats', JSON.stringify({}))
      } catch { void 0 }
      return
    }
    const agg: Record<number, { goals: number; assists: number; ownGoals: number }> = {}
    for (const ev of matchStats) {
      const scorerId = ev.player_scorer_id || undefined
      const assistId = ev.player_assist_id || undefined
      if (!ev.is_own_goal && typeof scorerId === 'number') {
        const s = agg[scorerId] || { goals: 0, assists: 0, ownGoals: 0 }
        s.goals += 1
        agg[scorerId] = s
      }
      if (ev.is_own_goal && typeof scorerId === 'number') {
        const s = agg[scorerId] || { goals: 0, assists: 0, ownGoals: 0 }
        s.ownGoals += 1
        agg[scorerId] = s
      }
      if (typeof assistId === 'number') {
        const a = agg[assistId] || { goals: 0, assists: 0, ownGoals: 0 }
        a.assists += 1
        agg[assistId] = a
      }
    }
    setLiveStats(agg)
    try {
      localStorage.setItem('matchLiveStats', JSON.stringify(agg))
    } catch { void 0 }
  }, [matchStats])

  const prepareNextTeamsRotation = (blackScore: number, orangeScore: number) => {
    try {
      if (blackScore === orangeScore) {
        // empate: mantém times
        return
      }
      const loser: 'black' | 'orange' = blackScore > orangeScore ? 'orange' : 'black'
      const winner: 'black' | 'orange' = loser === 'black' ? 'orange' : 'black'
      const loserSize = teams[loser].length
      const benchIds = bench.map(p => p.id)
      const incomingIds = benchIds.slice(0, loserSize)
      const remainingBenchIds = benchIds.slice(loserSize)
      const outgoingLoserIds = teams[loser].map(p => p.id)
      const newBenchIds = [...remainingBenchIds, ...outgoingLoserIds]
      const incomingPlayers = players.filter(p => incomingIds.includes(p.id))
      const newTeams = {
        [winner]: teams[winner],
        [loser]: incomingPlayers.length === loserSize ? incomingPlayers : teams[loser]
      } as { black: Player[]; orange: Player[] }
      setTeams(newTeams)
      const newBenchPlayers = players.filter(p => newBenchIds.includes(p.id))
      setBench(newBenchPlayers)
      localStorage.setItem('matchTeams', JSON.stringify({
        black: newTeams.black.map(p => p.id),
        orange: newTeams.orange.map(p => p.id),
      }))
      localStorage.setItem('matchBench', JSON.stringify(newBenchIds))
    } catch { void 0 }
  }

  const handleDeleteMatch = async (matchId: number) => {
    try {
      setDeleteLoading(true)
      await api.delete(`/api/matches/${matchId}`)
      toast.success('Partida excluída com sucesso!')
      setConfirmDeleteId(null)
      fetchData()
    } catch (error) {
      toast.error('Erro ao excluir partida')
    } finally {
      setDeleteLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {matchInProgress && (
        <div className="w-full">
          <div className={`rounded-none md:rounded-2xl ${tick >= matchDurationMin * 60 ? 'bg-gradient-to-r from-red-700 via-red-600 to-red-500' : 'bg-gradient-to-r from-black via-gray-800 to-orange-600'} p-3 md:p-4 text-white shadow md:shadow-xl`}>
            <div className="grid grid-cols-3 items-center">
              <div className="flex items-center justify-start">
                <button
                  onClick={() => updateScore('black', true)}
                  className="bg-green-500 hover:bg-green-600 text-white w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center"
                >
                  +
                </button>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2 md:space-x-3 mb-1">
                  <span className="inline-flex items-center justify-center px-2 md:px-3 py-1 rounded-full bg-white ring-2 ring-black text-xs md:text-sm font-bold text-black shadow-sm">
                    {teams.black.length ? teamOverallAvg(teams.black) : 0}
                  </span>
                  <span className="inline-flex items-center px-2 md:px-3 py-1 rounded-full bg-black text-white text-xs md:text-sm font-extrabold tracking-wider shadow">
                    PRETO
                  </span>
                  <span className="inline-flex items-center justify-center px-4 md:px-6 py-2 md:py-3 rounded-xl bg-white ring-2 md:ring-4 ring-black text-4xl md:text-7xl font-extrabold text-black shadow-sm">
                    {currentMatch?.blackScore}
                  </span>
                  <span className="text-xl md:text-3xl font-extrabold text-white/80">x</span>
                  <span className="inline-flex items-center justify-center px-4 md:px-6 py-2 md:py-3 rounded-xl bg-white ring-2 md:ring-4 ring-orange-500 text-4xl md:text-7xl font-extrabold text-orange-600 shadow-sm">
                    {currentMatch?.orangeScore}
                  </span>
                  <span className="inline-flex items-center px-2 md:px-3 py-1 rounded-full bg-orange-500 text-white text-xs md:text-sm font-extrabold tracking-wider shadow">
                    LARANJA
                  </span>
                  <span className="inline-flex items-center justify-center px-2 md:px-3 py-1 rounded-full bg-white ring-2 ring-orange-500 text-xs md:text-sm font-bold text-orange-600 shadow-sm">
                    {teams.orange.length ? teamOverallAvg(teams.orange) : 0}
                  </span>
                </div>
                <div className="text-[10px] md:text-xs opacity-80">
                  {connectionStatus === 'online' ? 'Conexão: Online' : connectionStatus === 'reconnecting' ? 'Conexão: Reconectando…' : 'Conexão: Offline'}
                </div>
                <div className={`text-[10px] md:text-xs ${tick >= matchDurationMin * 60 ? 'text-red-200' : 'opacity-80'}`}>{tick >= matchDurationMin * 60 ? 'Tempo esgotado' : 'Duração'}</div>
                <div className="text-xl md:text-3xl font-extrabold">{String(Math.floor(tick / 60)).padStart(2, '0')}:{String(tick % 60).padStart(2, '0')}</div>
                {tick >= matchDurationMin * 60 && (
                  <div className="mt-2">
                    <button
                      onClick={() => {
                        const next = !alarmMuted
                        setAlarmMuted(next)
                        try {
                          if (next) localStorage.setItem('matchAlarmMuted', '1')
                          else localStorage.removeItem('matchAlarmMuted')
                        } catch { void 0 }
                      }}
                      className={`inline-flex items-center px-3 py-1 rounded-md text-xs md:text-sm font-semibold shadow ${
                        alarmMuted ? 'bg-gray-200 text-gray-800 hover:bg-gray-300' : 'bg-red-600 text-white hover:bg-red-700'
                      }`}
                      title={alarmMuted ? 'Reativar alarme' : 'Silenciar alarme'}
                    >
                      {alarmMuted ? 'Reativar alarme' : 'Silenciar alarme'}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end">
                <button
                  onClick={() => updateScore('orange', true)}
                  className="bg-green-500 hover:bg-green-600 text-white w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center"
                >
                  +
                </button>
              </div>
            </div>
          </div>
          <div className="mt-3 md:mt-4 bg-white rounded-lg p-4 shadow">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Histórico de gols</h3>
            <div className="space-y-2">
              {matchStats.length === 0 && (
                <div className="text-xs text-gray-500">Sem eventos registrados ainda</div>
              )}
              {matchStats.map(ev => {
                const allPlayers = [...teams.black, ...teams.orange]
                const scorer = allPlayers.find(p => p.id === (ev.player_scorer_id ?? -1))
                const assist = allPlayers.find(p => p.id === (ev.player_assist_id ?? -1))
                const teamClass = ev.team_scored === 'black' ? 'bg-black text-white' : 'bg-orange-500 text-white'
                const minute = typeof ev.goal_minute === 'number' ? ev.goal_minute : 0
                return (
                  <div key={ev.stat_id} className="flex items-center justify-between rounded-md border border-gray-200 p-2">
                    <div className="flex items-center space-x-2">
                      <span className={`text-[10px] px-2 py-1 rounded ${teamClass}`}>{ev.team_scored === 'black' ? 'Preto' : 'Laranja'}</span>
                      <span className="text-xs text-gray-600">{String(minute).padStart(2, '0')}'</span>
                      <span className="text-sm font-medium text-gray-900">
                        {ev.is_own_goal ? 'Contra' : (scorer?.name || '—')}
                      </span>
                      {ev.player_assist_id ? (
                        <span className="text-xs text-gray-600">assistência: {assist?.name || '—'}</span>
                      ) : null}
                    </div>
                    <button
                      className="text-red-600 hover:text-red-700 text-sm"
                      onClick={async () => {
                        try {
                          await api.delete(`/api/matches/stats/${ev.stat_id}`)
                          setCurrentMatch(prev => ({
                            ...prev!,
                            blackScore: ev.team_scored === 'black' ? Math.max(0, (prev?.blackScore || 0) - 1) : (prev?.blackScore || 0),
                            orangeScore: ev.team_scored === 'orange' ? Math.max(0, (prev?.orangeScore || 0) - 1) : (prev?.orangeScore || 0)
                          }))
                          const raw = localStorage.getItem('matchTicker')
                          try {
                            const t = raw ? JSON.parse(raw) as { startTime: string; blackScore: number; orangeScore: number } : null
                            const updated = {
                              startTime: t?.startTime || new Date().toISOString(),
                              blackScore: ev.team_scored === 'black' ? Math.max(0, (t?.blackScore || 0) - 1) : (t?.blackScore || 0),
                              orangeScore: ev.team_scored === 'orange' ? Math.max(0, (t?.orangeScore || 0) - 1) : (t?.orangeScore || 0)
                            }
                            localStorage.setItem('matchTicker', JSON.stringify(updated))
                          } catch { void 0 }
                          setLiveStats(prev => {
                            const next = { ...prev }
                            if (!ev.is_own_goal && ev.player_scorer_id) {
                              const s = next[ev.player_scorer_id] || { goals: 0, assists: 0, ownGoals: 0 }
                              s.goals = Math.max(0, s.goals - 1)
                              next[ev.player_scorer_id] = s
                            }
                            if (ev.player_assist_id) {
                              const a = next[ev.player_assist_id] || { goals: 0, assists: 0, ownGoals: 0 }
                              a.assists = Math.max(0, a.assists - 1)
                              next[ev.player_assist_id] = a
                            }
                            try {
                              localStorage.setItem('matchLiveStats', JSON.stringify(next))
                            } catch { void 0 }
                            return next
                          })
                          try {
                            const statsResp = await api.get(`/api/matches/${currentMatchId}/stats`)
                            setMatchStats((statsResp.data?.stats || []) as StatEvent[])
                          } catch { void 0 }
                          toast.success('Gol removido')
                        } catch {
                          toast.error('Falha ao remover gol')
                        }
                      }}
                      title="Remover gol"
                    >
                      ✖
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Partidas</h1>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nova Partida
        </button>
      </div>

      {matchInProgress && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Partida em Andamento</h2>
            <span className="px-3 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">Em andamento</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-gray-100 rounded-lg p-4">
              <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                <div className="w-4 h-4 bg-black rounded-full mr-2"></div>
                Time Preto ({teams.black.length})
              </h4>
              <div className="space-y-2">
                {teams.black.map((player) => (
                  <div key={player.id} className="flex justify-between items-center text-sm">
                    <span className="font-medium">{player.name}</span>
                    <span className="text-gray-600">{player.position}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-orange-50 rounded-lg p-4">
              <h4 className="text-lg font-semibold text-orange-900 mb-3 flex items-center">
                <div className="w-4 h-4 bg-orange-500 rounded-full mr-2"></div>
                Time Laranja ({teams.orange.length})
              </h4>
              <div className="space-y-2">
                {teams.orange.map((player) => (
                  <div key={player.id} className="flex justify-between items-center text-sm">
                    <span className="font-medium">{player.name}</span>
                    <span className="text-gray-600">{player.position}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="text-center text-gray-600">
              <Clock className="w-5 h-5 inline mr-2" />
              <span>Duração: {String(Math.floor(tick / 60)).padStart(2, '0')}:{String(tick % 60).padStart(2, '0')}</span>
            </div>
            <div className="text-center">
              <button
                onClick={finishMatch}
                className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-danger-600 hover:bg-danger-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-danger-500"
              >
                <Trophy className="w-5 h-5 mr-2" />
                Finalizar Partida
              </button>
            </div>
          </div>
        </div>
      )}

      {gkModal?.open && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Definir goleiro na linha</h3>
            <p className="text-sm text-gray-600 mb-4">Selecione qual goleiro jogará na linha para este sorteio.</p>
            <div className="space-y-2">
              {gkModal.candidates.map(c => (
                <label key={c.id} className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="gk-as-field"
                    checked={gkAsFieldId === c.id}
                    onChange={() => setGkAsFieldId(c.id)}
                  />
                  <span className="text-sm">{c.name}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => setGkModal(null)}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!gkAsFieldId) {
                    toast.error('Selecione um goleiro para jogar na linha')
                    return
                  }
                  const selected = players.filter(p => selectedPlayers.includes(p.id))
                  const { black, orange } = sortTeamsLocal(selected, gkAsFieldId)
                  setTeams({ black, orange })
                  const teamIds = new Set<number>([...black.map(p => p.id), ...orange.map(p => p.id)])
                  const benchIds = selectedPlayers.filter(id => !teamIds.has(id))
                  const benchPlayers = players.filter(p => benchIds.includes(p.id))
                  setBench(benchPlayers)
                  try {
                    localStorage.setItem('matchBench', JSON.stringify(benchIds))
                  } catch { void 0 }
                  setGkModal(null)
                  toast.success('Times sorteados com goleiro na linha')
                }}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Match Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Criar Nova Partida</h2>
          
          {/* Player Selection */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-3">Selecione os Jogadores ({selectedPlayers.length}/10)</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {players.map((player) => (
                <button
                  key={player.id}
                  onClick={() => handlePlayerSelection(player.id)}
                  className={`p-3 rounded-lg border-2 text-left transition-colors ${
                    selectedPlayers.includes(player.id)
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-sm">{player.name}</div>
                  <div className="text-xs text-gray-500">{player.position}</div>
                  <div className="text-xs text-gray-400">
                    {player.total_goals_scored} gols • {player.win_rate.toFixed(0)}% vit.
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Team Sorting */}
          {selectedPlayers.length >= 6 && (
            <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">Times</h3>
                <button
                  onClick={sortTeams}
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-success-600 hover:bg-success-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success-500"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Sortear Times
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Time Preto */}
                <div className="bg-gray-100 rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                    <div className="w-4 h-4 bg-black rounded-full mr-2"></div>
                    Time Preto ({teams.black.length}) {teams.black.length ? teamOverallAvg(teams.black) : 0}
                  </h4>
                  <div className="space-y-2">
                    {teams.black.map((player) => (
                      <div key={player.id} className="flex justify-between items-center text-sm">
                        <span className="font-medium">{player.name}</span>
                        <span className="text-gray-600">
                          {player.position}
                          {(() => {
                            const s = liveStats[player.id]
                            if (!s) return ''
                            const parts = []
                            if (s.goals) parts.push(`${s.goals} gol${s.goals > 1 ? 's' : ''}`)
                            if (s.assists) parts.push(`${s.assists} assist.`)
                            if (s.ownGoals) parts.push(`${s.ownGoals} GC`)
                            return parts.length ? ` • ${parts.join(' • ')}` : ''
                          })()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Orange Team */}
                <div className="bg-orange-50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-orange-900 mb-3 flex items-center">
                    <div className="w-4 h-4 bg-orange-500 rounded-full mr-2"></div>
                    Time Laranja ({teams.orange.length}) {teams.orange.length ? teamOverallAvg(teams.orange) : 0}
                  </h4>
                  <div className="space-y-2">
                    {teams.orange.map((player) => (
                      <div key={player.id} className="flex justify-between items-center text-sm">
                        <span className="font-medium">{player.name}</span>
                        <span className="text-gray-600">
                          {player.position}
                          {(() => {
                            const s = liveStats[player.id]
                            if (!s) return ''
                            const parts = []
                            if (s.goals) parts.push(`${s.goals} gol${s.goals > 1 ? 's' : ''}`)
                            if (s.assists) parts.push(`${s.assists} assist.`)
                            if (s.ownGoals) parts.push(`${s.ownGoals} GC`)
                            return parts.length ? ` • ${parts.join(' • ')}` : ''
                          })()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {goalModal?.open && (
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Registrar Gol — {goalModal.team === 'black' ? 'Time Preto' : 'Time Laranja'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">Autor do Gol</label>
                <select
                  value={goalForm.scorer_id ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value
                    const val = raw === 'own' ? 'own' : (raw ? Number(raw) : null)
                    const isOwn = val === 'own'
                    setGoalForm({
                      ...goalForm,
                      scorer_id: val,
                      assist_id: isOwn ? null : (val && goalForm.assist_id === val ? null : goalForm.assist_id),
                      is_own_goal: isOwn
                    })
                  }}
                  className="mt-1 block w-full border-gray-300 rounded-md"
                >
                  <option value="">Selecione</option>
                  {(goalModal.team === 'black' ? teams.black : teams.orange).map(p => (
                    <option key={`sc-${p.id}`} value={p.id}>{p.name}</option>
                  ))}
                  <option value="own">Contra</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Assistência (opcional)</label>
                <select
                  value={goalForm.assist_id ?? ''}
                  onChange={(e) => setGoalForm({ ...goalForm, assist_id: e.target.value ? Number(e.target.value) : null })}
                  className="mt-1 block w-full border-gray-300 rounded-md"
                  disabled={goalForm.is_own_goal}
                >
                  <option value="">Selecione</option>
                  {(goalModal.team === 'black' ? teams.black : teams.orange)
                    .filter(p => p.id !== ((goalForm.scorer_id ?? -1) as number))
                    .map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
              </div>
            </div>
                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setGoalModal(null)}
                    className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={submitGoal}
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                    disabled={submittingGoal}
                  >
                    {submittingGoal ? 'Registrando...' : 'Registrar Gol'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Match Controls */}
          {teams.black.length > 0 && teams.orange.length > 0 && (
            <div className="border-t pt-6">
              {!matchInProgress ? (
                <button
                  onClick={startMatch}
                  className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-success-600 hover:bg-success-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success-500"
                >
                  <Play className="w-5 h-5 mr-2" />
                  Iniciar Partida
                </button>
              ) : (
                <div className="text-center">
                  <button
                    onClick={finishMatch}
                    className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-danger-600 hover:bg-danger-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-danger-500"
                  >
                    <Trophy className="w-5 h-5 mr-2" />
                    Finalizar Partida
                  </button>
                </div>
              )}
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-4">
          <button
            onClick={() => {
              setShowForm(false)
              setTeams({ black: [], orange: [] })
              setSelectedPlayers([])
              setMatchInProgress(false)
              setCurrentMatch(null)
            }}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            Cancelar
          </button>
        </div>
      </div>
    )}

      {/* Recent Matches */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Partidas Recentes</h2>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {matches.length > 0 ? (
              matches.slice(0, 10).map((match) => (
                <div
                  key={match.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100"
                  onClick={() => openMatchDetails(match)}
                >
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-black rounded-full"></div>
                      <span className="font-medium">{match.team_blue_score}</span>
                    </div>
                    <span className="text-gray-400">x</span>
                    <div className="flex items-center space-x-2">
                      <span className="font-medium">{match.team_orange_score}</span>
                      <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="text-sm text-gray-500">
                      {new Date(match.match_date).toLocaleDateString('pt-BR')}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(match.id) }}
                      className="text-gray-400 hover:text-red-600"
                      title="Excluir partida"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-center py-4">Nenhuma partida encontrada</p>
            )}
          </div>
        </div>
      </div>
      {detailsModal.open && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Detalhes da Partida — {detailsModal.match_date ? new Date(detailsModal.match_date).toLocaleDateString('pt-BR') : ''}
                </h3>
                <button
                  onClick={() => setDetailsModal({ open: false, matchId: null, loading: false, stats: [], black_ids: [], orange_ids: [] })}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✖
                </button>
              </div>
              <div className="mb-4">
                <div className="flex items-center justify-center space-x-2">
                  <span className="inline-flex items-center px-2 py-1 rounded-full bg-black text-white text-xs font-extrabold tracking-wider">PRETO</span>
                  <span className="inline-flex items-center justify-center px-3 py-1 rounded-md bg-white ring-2 ring-black text-2xl font-extrabold text-black">
                    {detailsModal.black_score ?? 0}
                  </span>
                  <span className="text-lg font-extrabold text-gray-600">x</span>
                  <span className="inline-flex items-center justify-center px-3 py-1 rounded-md bg-white ring-2 ring-orange-500 text-2xl font-extrabold text-orange-600">
                    {detailsModal.orange_score ?? 0}
                  </span>
                  <span className="inline-flex items-center px-2 py-1 rounded-full bg-orange-500 text-white text-xs font-extrabold tracking-wider">LARANJA</span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-gray-100 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center">
                    <div className="w-3 h-3 bg-black rounded-full mr-2"></div>
                    Participantes — Preto ({detailsModal.black_ids.length})
                  </h4>
                  <div className="space-y-2">
                    {detailsModal.black_ids.map(id => {
                      const p = players.find(pl => pl.id === id)
                      return (
                        <div key={`bp-${id}`} className="text-sm flex justify-between">
                          <span className="font-medium">{p?.name || `#${id}`}</span>
                          <span className="text-gray-600">{p?.position || ''}</span>
                        </div>
                      )
                    })}
                    {detailsModal.black_ids.length === 0 && <div className="text-xs text-gray-500">Não disponível</div>}
                  </div>
                </div>
                <div className="bg-orange-50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-orange-900 mb-3 flex items-center">
                    <div className="w-3 h-3 bg-orange-500 rounded-full mr-2"></div>
                    Participantes — Laranja ({detailsModal.orange_ids.length})
                  </h4>
                  <div className="space-y-2">
                    {detailsModal.orange_ids.map(id => {
                      const p = players.find(pl => pl.id === id)
                      return (
                        <div key={`op-${id}`} className="text-sm flex justify-between">
                          <span className="font-medium">{p?.name || `#${id}`}</span>
                          <span className="text-gray-600">{p?.position || ''}</span>
                        </div>
                      )
                    })}
                    {detailsModal.orange_ids.length === 0 && <div className="text-xs text-gray-500">Não disponível</div>}
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg p-4 border">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Histórico de gols</h4>
                {detailsModal.loading ? (
                  <div className="text-xs text-gray-500">Carregando...</div>
                ) : (
                  <div className="space-y-2">
                    {detailsModal.stats.length === 0 && (
                      <div className="text-xs text-gray-500">Sem eventos</div>
                    )}
                    {detailsModal.stats.map(ev => {
                      const allPlayers = players
                      const scorer = allPlayers.find(p => p.id === (ev.player_scorer_id ?? -1))
                      const assist = allPlayers.find(p => p.id === (ev.player_assist_id ?? -1))
                      const teamClass = ev.team_scored === 'black' ? 'bg-black text-white' : 'bg-orange-500 text-white'
                      const minute = typeof ev.goal_minute === 'number' ? ev.goal_minute : 0
                      return (
                        <div key={`ev-${ev.stat_id}`} className="flex items-center justify-between rounded-md border border-gray-200 p-2">
                          <div className="flex items-center space-x-2">
                            <span className={`text-[10px] px-2 py-1 rounded ${teamClass}`}>{ev.team_scored === 'black' ? 'Preto' : 'Laranja'}</span>
                            <span className="text-xs text-gray-600">{String(minute).padStart(2, '0')}'</span>
                            <span className="text-sm font-medium text-gray-900">
                              {ev.is_own_goal ? 'Contra' : (scorer?.name || '—')}
                            </span>
                            {ev.player_assist_id ? (
                              <span className="text-xs text-gray-600">assistência: {assist?.name || '—'}</span>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Excluir Partida</h3>
            <p className="text-sm text-gray-600 mb-6">
              Tem certeza que deseja excluir esta partida? Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                disabled={deleteLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteMatch(confirmDeleteId)}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Matches
