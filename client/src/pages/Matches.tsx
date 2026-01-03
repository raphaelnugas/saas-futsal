import React, { useState, useEffect, useRef, useMemo } from 'react'
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
  tie_decider_winner?: 'black'|'orange'
  duration_minutes: number
  blue_players: number[]
  orange_players: number[]
  orange_win_streak: number
  status?: 'scheduled' | 'in_progress' | 'finished'
  start_time?: string
  match_number?: number
}

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
  const [substitutionModal, setSubstitutionModal] = useState<{ open: boolean; team: 'black'|'orange' } | null>(null)
  const [substitutionForm, setSubstitutionForm] = useState<{ out_id: number | null; in_id: number | null; mode: 'bench' | 'swap' }>({ out_id: null, in_id: null, mode: 'bench' })
  const [playedIds, setPlayedIds] = useState<Set<number>>(new Set<number>())
  const [presentMap, setPresentMap] = useState<Record<number, boolean>>({})
  useEffect(() => {
    if (substitutionModal?.open && substitutionForm.mode === 'swap' && bench.length > 0) {
      setSubstitutionForm(prev => ({ ...prev, mode: 'bench', in_id: null }))
    }
  }, [bench, substitutionModal?.open])
  const benchCandidates = useMemo(() => {
    const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
    const teamIds = new Set<number>([...teams.black.map(p => p.id), ...teams.orange.map(p => p.id)])
    const list = players.filter(p => presentIds.includes(p.id) && !teamIds.has(p.id))
    return list.filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i)
  }, [players, presentMap, teams])
  useEffect(() => {
    if (!matchInProgress) return
    setBench(benchCandidates)
    try {
      localStorage.setItem('matchBench', JSON.stringify(Array.from(new Set(benchCandidates.map(p => p.id)))))
    } catch { void 0 }
  }, [benchCandidates, matchInProgress])
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
  const [tieModal, setTieModal] = useState<{ open: boolean; winner: 'black'|'orange'|null }>(() => ({ open: false, winner: null }))
  const [lastFinishedMatchId, setLastFinishedMatchId] = useState<number | null>(null)
  const [consecutiveUnchanged, setConsecutiveUnchanged] = useState<{ black: number; orange: number }>({ black: 0, orange: 0 })
  const [connectionStatus, setConnectionStatus] = useState<'online'|'reconnecting'|'offline'>('offline')
  const sseRef = useRef<EventSource | null>(null)
  const sseAttemptsRef = useRef<number>(0)
  const pollIntervalRef = useRef<number | null>(null)
  const sseStatsRef = useRef<{ opens: number; errors: number; reconnects: number; pings: number; inits: number; goals: number; finishes: number; polls: number }>({
    opens: 0, errors: 0, reconnects: 0, pings: 0, inits: 0, goals: 0, finishes: 0, polls: 0
  })
  const lastWinnerRef = useRef<{ black: number[]; orange: number[] }>({ black: [], orange: [] })
  const didRunFetchRef = useRef(false)
  const didRunConfigRef = useRef(false)
  const [rodizioMode, setRodizioMode] = useState<boolean>(false)
  const [rodizioWinnerColor, setRodizioWinnerColor] = useState<'black'|'orange'|null>(null)
  const [selectedChallengers, setSelectedChallengers] = useState<number[]>([])
  const [rotationApplied, setRotationApplied] = useState<'gk'|'full'|null>(null)

  useEffect(() => {
    if (didRunFetchRef.current) return
    didRunFetchRef.current = true
    fetchData()
  }, [])

  useEffect(() => {
    if (didRunConfigRef.current) return
    didRunConfigRef.current = true
    ;(async () => {
      try {
        const res = await api.get('/api/auth/config')
        const md = Number(res.data?.matchDuration || 10)
        if (!Number.isNaN(md) && md > 0) setMatchDurationMin(md)
      } catch { void 0 }
    })()
  }, [])

  const fetchData = async () => {
    try {
      const [playersResponse, matchesResponse, sundaysResponse] = await Promise.all([
        api.get('/api/players'),
        api.get('/api/matches'),
        api.get('/api/sundays')
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
        tie_decider_winner?: 'black'|'orange'
        team_orange_win_streak?: number
        status?: 'scheduled' | 'in_progress' | 'finished'
        start_time?: string
        match_number?: number
      }
      let matchesList = ((matchesResponse.data?.matches || []) as MatchApi[]).map((m) => ({
        id: m.match_id,
        match_date: m.sunday_date,
        team_blue_score: m.team_black_score,
        team_orange_score: m.team_orange_score,
        winning_team: m.winner_team,
        tie_decider_winner: m.tie_decider_winner,
        duration_minutes: 0,
        blue_players: [],
        orange_players: [],
        orange_win_streak: Number(m.team_orange_win_streak || 0),
        status: m.status,
        start_time: m.start_time,
        match_number: typeof m.match_number === 'number' ? m.match_number : undefined
      }))
      matchesList = matchesList.sort((a, b) => {
        const da = new Date(a.match_date).getTime()
        const db = new Date(b.match_date).getTime()
        if (Number.isFinite(da) && Number.isFinite(db)) {
          if (db !== da) return db - da
        }
        const nb = typeof b.match_number === 'number' ? b.match_number : 0
        const na = typeof a.match_number === 'number' ? a.match_number : 0
        if (nb !== na) return nb - na
        return (b.id || 0) - (a.id || 0)
      })
      setPlayers(playersList)
      setMatches(matchesList)
      try {
        const sundaysApi = (sundaysResponse.data?.sundays || []) as Array<{ sunday_id: number }>
        if (sundaysApi.length > 0) {
          const latestSundayId = sundaysApi[0].sunday_id
          const attResp = await api.get(`/api/sundays/${latestSundayId}/attendances`)
          const rows = Array.isArray(attResp.data?.attendances)
            ? attResp.data.attendances
            : Array.isArray(attResp.data)
              ? attResp.data
              : []
          const map: Record<number, boolean> = {}
          for (const r of rows) {
            const pid = Number((r as { player_id: number }).player_id)
            const present = !!(r as { is_present: boolean }).is_present
            if (Number.isFinite(pid)) map[pid] = present
          }
          setPresentMap(map)
        } else {
          setPresentMap({})
        }
      } catch { setPresentMap({}) }
      const active = matchesList.find(m => m.status === 'in_progress')
      if (active && active.id) {
        setCurrentMatchId(active.id)
        setMatchInProgress(true)
        try {
          const det = await api.get(`/api/matches/${active.id}`)
          const match = det.data?.match as { participants?: Array<{ team: 'black'|'orange'; player_id: number }>, start_time?: string, team_black_score?: number, team_orange_score?: number, team_black_win_streak?: number, team_orange_win_streak?: number }
          const parts: Array<{ team: 'black'|'orange'; player_id: number }> = Array.isArray(match?.participants) ? match.participants : []
          const blackIds = parts.filter(p => p.team === 'black').map(p => p.player_id)
          const orangeIds = parts.filter(p => p.team === 'orange').map(p => p.player_id)
          const blackPlayers = playersList.filter(pl => blackIds.includes(pl.id))
          const orangePlayers = playersList.filter(pl => orangeIds.includes(pl.id))
          setTeams({ black: blackPlayers, orange: orangePlayers })
          const initBlackStreak = Number(match?.team_black_win_streak || 0)
          const initOrangeStreak = Number(match?.team_orange_win_streak || 0)
          setConsecutiveUnchanged({ black: initBlackStreak, orange: initOrangeStreak })
          console.info('[streak:init-active]', { partida: active.id, preto: initBlackStreak, laranja: initOrangeStreak })
          try {
            const rawBench = localStorage.getItem('matchBench')
            if (rawBench) {
              const bIds = Array.from(new Set((JSON.parse(rawBench) as number[])))
              const benchPlayers = playersList.filter(p => bIds.includes(p.id))
              setBench(benchPlayers)
            } else {
              const teamIds = new Set<number>([...blackIds, ...orangeIds])
              const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
              const benchPlayers = playersList.filter(p => presentIds.includes(p.id) && !teamIds.has(p.id))
              setBench(benchPlayers)
              localStorage.setItem('matchBench', JSON.stringify(Array.from(new Set(benchPlayers.map(p => p.id)))))
            }
          } catch { void 0 }
          const st = match?.start_time
          if (st) {
            const start = new Date(st)
            const now = new Date()
            const diff = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 1000))
            setTick(diff)
            setCurrentMatch({
              blackScore: Number(match?.team_black_score || 0),
              orangeScore: Number(match?.team_orange_score || 0),
              startTime: start,
              duration: 0
            })
          }
        } catch { void 0 }
      }
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
        setMatchStats(stats)
        const blackGoals = stats.filter(ev => ev.event_type === 'goal' && ev.team_scored === 'black').length
        const orangeGoals = stats.filter(ev => ev.event_type === 'goal' && ev.team_scored === 'orange').length
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
    if (rodizioMode) {
      const winnerIds = new Set((rodizioWinnerColor ? teams[rodizioWinnerColor] : []).map(p => p.id))
      if (winnerIds.has(playerId)) return
      setSelectedChallengers(prev => {
        if (prev.includes(playerId)) {
          const next = prev.filter(id => id !== playerId)
          const nextPlayers = players.filter(p => next.includes(p.id))
          setTeams(rodizioWinnerColor === 'black' ? { black: teams.black, orange: nextPlayers } : { black: nextPlayers, orange: teams.orange })
          return next
        } else {
          const winnerLen = rodizioWinnerColor ? teams[rodizioWinnerColor].length : 0
          const next = prev.length < winnerLen ? [...prev, playerId] : prev
          const nextPlayers = players.filter(p => next.includes(p.id))
          setTeams(rodizioWinnerColor === 'black' ? { black: teams.black, orange: nextPlayers } : { black: nextPlayers, orange: teams.orange })
          return next
        }
      })
      return
    }
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
      const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
      const benchPlayers = players.filter(p => presentIds.includes(p.id) && !teamIds.has(p.id))
      const benchIds = benchPlayers.map(p => p.id)
      setBench(benchPlayers)
      try {
        localStorage.setItem('matchBench', JSON.stringify(Array.from(new Set(benchIds))))
      } catch { void 0 }
      toast.success(`Times sorteados! Sequência de vitórias laranja: ${orange_win_streak}`)
    } catch (error: unknown) {
      toast.error('Erro ao sortear times')
    }
  }
  const prefillNextMatch = async () => {
    try {
      const latestDate = matches.length ? matches[0].match_date : undefined
      const finishedToday = matches.filter(m => m.status === 'finished' && (!latestDate || m.match_date === latestDate))
      if (!finishedToday.length) {
        toast.error('Nenhuma partida finalizada para rodízio')
        return
      }
      const last = finishedToday[0]
      const det = await api.get(`/api/matches/${last.id}`)
      const statsResp = await api.get(`/api/matches/${last.id}/stats`).catch(() => ({ data: { stats: [] } }))
      const parts = Array.isArray(det.data?.match?.participants) ? det.data.match.participants as Array<{ team: 'black'|'orange'; player_id: number }> : []
      const getWinnerColor = (m: Match): 'black'|'orange' => {
        const raw = typeof m.winning_team === 'string' ? m.winning_team : 'draw'
        if (raw === 'orange') return 'orange'
        if (raw === 'black') return 'black'
        if (m.tie_decider_winner === 'orange' || m.tie_decider_winner === 'black') return m.tie_decider_winner
        return 'black'
      }
      const lastWinner: 'black'|'orange' = getWinnerColor(last)
      const orangeCounter = Number((det.data?.match as { team_orange_win_streak?: number })?.team_orange_win_streak || 0)
      const blackCounter = Number((det.data?.match as { team_black_win_streak?: number })?.team_black_win_streak || 0)
      const blackPrevDots = blackCounter <= 0 ? 0 : (blackCounter === 1 ? 2 : 3)
      const orangePrevDots = orangeCounter <= 0 ? 0 : (orangeCounter === 1 ? 2 : 3)
      const presentIdsAll = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
      const presentCountAll = presentIdsAll.length
      let remainTeam: 'black'|'orange'|null = null
      if (presentCountAll > 17) {
        if (lastWinner === 'black' && blackPrevDots === 0) remainTeam = 'black'
        else if (lastWinner === 'orange' && orangePrevDots === 0) remainTeam = 'orange'
        else remainTeam = null
      } else {
        if (blackPrevDots === 3 && orangePrevDots !== 3) remainTeam = 'orange'
        else if (orangePrevDots === 3 && blackPrevDots !== 3) remainTeam = 'black'
        else {
          if (lastWinner === 'black' || lastWinner === 'orange') {
            remainTeam = lastWinner
          } else {
            const tieWin = (last.tie_decider_winner === 'black' || last.tie_decider_winner === 'orange') ? last.tie_decider_winner : null
            remainTeam = tieWin
          }
        }
      }
      let winnerColor: 'black'|'orange' = remainTeam || lastWinner
      if (!parts.length) {
        const winnerPlayers = teams[winnerColor]
        const winnerIds = winnerPlayers.map(p => p.id)
        setRodizioMode(true)
        setRodizioWinnerColor(winnerColor)
        setShowForm(true)
        setSelectedPlayers(winnerIds)
        setSelectedChallengers([])
        setTeams(
          winnerColor === 'black'
            ? { black: winnerPlayers, orange: [] }
            : { black: [], orange: winnerPlayers }
        )
        const rawBench = localStorage.getItem('matchBench')
        if (rawBench) {
          const bIds = JSON.parse(rawBench) as number[]
          const benchPlayers = players.filter(p => bIds.includes(p.id))
          setBench(benchPlayers)
        } else {
          const teamIdsAll = new Set<number>(winnerIds)
          const presentIdsAll = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
          const benchPlayers = players.filter(p => presentIdsAll.includes(p.id) && !teamIdsAll.has(p.id))
          setBench(benchPlayers)
          try { localStorage.setItem('matchBench', JSON.stringify(Array.from(new Set(benchPlayers.map(p => p.id))))) } catch { void 0 }
        }
        toast.success('Próxima partida: vencedores mantidos. Selecione os desafiantes.')
        return
      }
      const blackStartIds = parts.filter(p => p.team === 'black').map(p => p.player_id)
      const orangeStartIds = parts.filter(p => p.team === 'orange').map(p => p.player_id)
      const stats = (statsResp.data?.stats || []) as StatEvent[]
      const subs = stats.filter(ev => ev.event_type === 'substitution')
      const applySubs = (list: number[], team: 'black'|'orange'): number[] => {
        const current = [...list]
        for (const s of subs) {
          if (s.team_scored !== team) continue
          const outId = typeof s.player_assist_id === 'number' ? s.player_assist_id : null
          const inId = typeof s.player_scorer_id === 'number' ? s.player_scorer_id : null
          if (!outId || !inId) continue
          const idx = current.indexOf(outId)
          if (idx >= 0) {
            current[idx] = inId
          }
        }
        return current
      }
      const blackFinalIds = applySubs(blackStartIds, 'black')
      const orangeFinalIds = applySubs(orangeStartIds, 'orange')
      const winnerIds = (winnerColor === 'black' ? blackFinalIds : orangeFinalIds)
      const winnerPlayers = players.filter(p => winnerIds.includes(p.id))
      setRodizioMode(true)
      setRodizioWinnerColor(winnerColor)
      setShowForm(true)
      setSelectedPlayers(winnerIds)
      setSelectedChallengers([])
      setTeams(
        winnerColor === 'black'
          ? { black: winnerPlayers, orange: [] }
          : { black: [], orange: winnerPlayers }
      )
      const rawBench = localStorage.getItem('matchBench')
      if (rawBench) {
        const bIds = JSON.parse(rawBench) as number[]
        const benchPlayers = players.filter(p => bIds.includes(p.id))
        setBench(benchPlayers)
      } else {
        const teamIds = new Set<number>([...blackFinalIds, ...orangeFinalIds])
        const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
        const benchPlayers = players.filter(p => presentIds.includes(p.id) && !teamIds.has(p.id))
        setBench(benchPlayers)
        try { localStorage.setItem('matchBench', JSON.stringify(Array.from(new Set(benchPlayers.map(p => p.id))))) } catch { void 0 }
      }
      toast.success('Próxima partida: vencedores mantidos. Selecione os desafiantes.')
    } catch {
      toast.error('Falha ao preparar próxima partida')
    }
  }

  const startMatch = async () => {
    if (teams.black.length === 0 || teams.orange.length === 0) {
      toast.error('Sorteie os times primeiro')
      return
    }

    try {
      const sundaysResp = await api.get('/api/sundays')
      const sundaysRaw = sundaysResp.data?.sundays || []
      if (!sundaysRaw.length) {
        toast.error('Nenhum domingo encontrado para criar a partida')
        return
      }
      const sundaysComputed = (sundaysRaw as Array<{ sunday_id: number; date: string; created_at?: string; total_matches?: number }>).map((s, idx) => {
        const tm = Number(s.total_matches || 0)
        const status: 'scheduled' | 'in_progress' | 'completed' = idx === 0 ? (tm > 0 ? 'in_progress' : 'scheduled') : 'completed'
        return { id: s.sunday_id, date: s.date, created_at: s.created_at, total_matches: tm, status }
      })
      const targetSunday = sundaysComputed.find(s => s.status === 'scheduled') || sundaysComputed.find(s => s.status === 'in_progress') || sundaysComputed[0]
      const latestSundayId = targetSunday.id
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
      try {
        const det = await api.get(`/api/matches/${newMatchId}`)
        const match = det.data?.match as { team_black_win_streak?: number, team_orange_win_streak?: number }
        const blackSt = Number(match?.team_black_win_streak || 0)
        const orangeSt = Number(match?.team_orange_win_streak || 0)
        setConsecutiveUnchanged({ black: blackSt, orange: orangeSt })
        console.info('[streak:startMatch]', { partida: newMatchId, preto: blackSt, laranja: orangeSt })
      } catch { void 0 }
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
      setPlayedIds(new Set<number>([...teams.black.map(p => p.id), ...teams.orange.map(p => p.id)]))
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
      setShowForm(false)
      setRodizioMode(false)
      setRodizioWinnerColor(null)
      setSelectedChallengers([])
      setSelectedPlayers([])
    } catch (e: unknown) {
      toast.error('Erro ao iniciar partida')
      const err = e as { response?: { status?: number }, message?: string }
      logError('start_match_error', { status: err?.response?.status, message: err?.message })
    }
  }

  const renderStreakDots = (n: number) => {
    const c = Math.max(0, Math.floor(Number(n || 0)))
    const d = c <= 0 ? 0 : (c === 1 ? 2 : 3)
    const dots = Array.from({ length: d })
    return (
      <div className="flex space-x-1 mt-0.5 h-2 md:h-2.5">
        {dots.map((_, i) => (
          <span key={`st-${i}`} className="inline-block w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-green-500 ring-2 ring-white"></span>
        ))}
      </div>
    )
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
        setLastFinishedMatchId((prev) => prev)
        cleanup('Partida finalizada localmente')
        // preparar próxima partida com rotação de perdedor
        prepareNextTeamsRotation(currentMatch.blackScore, currentMatch.orangeScore)
        return
      }
 
      setLastFinishedMatchId(currentMatchId)
      const initialIds = new Set<number>([
        ...teams.black.map(p => p.id),
        ...teams.orange.map(p => p.id)
      ])
      const statsIds = new Set<number>()
      for (const ev of matchStats) {
        if (typeof ev.player_scorer_id === 'number') statsIds.add(ev.player_scorer_id)
        if (typeof ev.player_assist_id === 'number') statsIds.add(ev.player_assist_id)
      }
      const finalPlayed = Array.from(new Set<number>([
        ...Array.from(playedIds),
        ...Array.from(initialIds),
        ...Array.from(statsIds)
      ]))
      await api.post(`/api/matches/${currentMatchId}/finish`, {
        black_score: currentMatch.blackScore,
        orange_score: currentMatch.orangeScore,
        played_ids: finalPlayed
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
  const submitSubstitution = async () => {
    if (!substitutionModal?.open || !currentMatchId) {
      setSubstitutionModal(null)
      return
    }
    const team = substitutionModal.team
    const outId = substitutionForm.out_id
    const inId = substitutionForm.in_id
    if (!outId || !inId) {
      toast.error('Selecione quem sai e quem entra')
      return
    }
    const minute = Math.floor(tick / 60)
    try {
      if (substitutionForm.mode === 'bench') {
        await api.post(`/api/matches/${currentMatchId}/stats-substitution`, {
          team,
          out_id: outId,
          in_id: inId,
          minute
        })
        const currentTeam = team === 'black' ? teams.black : teams.orange
        const otherTeam = team === 'black' ? teams.orange : teams.black
        const outPlayer = currentTeam.find(p => p.id === outId) || null
        const inPlayer = benchCandidates.find(p => p.id === inId) || null
        if (!outPlayer || !inPlayer) {
          setSubstitutionModal(null)
          return
        }
        const nextTeam = currentTeam.map(p => (p.id === outId ? inPlayer : p))
        const nextBlackIds = (team === 'black' ? nextTeam : otherTeam).map(p => p.id)
        const nextOrangeIds = (team === 'orange' ? nextTeam : otherTeam).map(p => p.id)
        await api.post(`/api/matches/${currentMatchId}/participants`, {
          black_team: nextBlackIds,
          orange_team: nextOrangeIds
        })
        setTeams(team === 'black' ? { black: nextTeam, orange: otherTeam } : { black: otherTeam, orange: nextTeam })
        setPlayedIds(prev => new Set<number>([...Array.from(prev), inId]))
        try {
          localStorage.setItem('matchTeams', JSON.stringify({ black: (team === 'black' ? nextTeam : otherTeam).map(p => p.id), orange: (team === 'orange' ? nextTeam : otherTeam).map(p => p.id) }))
          localStorage.setItem('matchPlayedIds', JSON.stringify(Array.from(new Set<number>([...Array.from(playedIds), inId]))))
        } catch { void 0 }
        setSubstitutionModal(null)
        toast.success('Substituição registrada')
      } else {
        const currentTeam = team === 'black' ? teams.black : teams.orange
        const otherTeam = team === 'black' ? teams.orange : teams.black
        const outPlayer = currentTeam.find(p => p.id === outId) || null
        const inPlayer = otherTeam.find(p => p.id === inId) || null
        if (!outPlayer || !inPlayer) {
          setSubstitutionModal(null)
          return
        }
        await api.post(`/api/matches/${currentMatchId}/stats-substitution`, {
          team,
          out_id: outId,
          in_id: inId,
          minute
        })
        const oppTeam: 'black'|'orange' = team === 'black' ? 'orange' : 'black'
        await api.post(`/api/matches/${currentMatchId}/stats-substitution`, {
          team: oppTeam,
          out_id: inId,
          in_id: outId,
          minute
        })
        const nextTeam = currentTeam.map(p => (p.id === outId ? inPlayer : p))
        const nextOther = otherTeam.map(p => (p.id === inId ? outPlayer : p))
        const nextBlackIds = (team === 'black' ? nextTeam : nextOther).map(p => p.id)
        const nextOrangeIds = (team === 'orange' ? nextTeam : nextOther).map(p => p.id)
        await api.post(`/api/matches/${currentMatchId}/participants`, {
          black_team: nextBlackIds,
          orange_team: nextOrangeIds
        })
        setTeams(team === 'black' ? { black: nextTeam, orange: nextOther } : { black: nextOther, orange: nextTeam })
        try {
          localStorage.setItem('matchTeams', JSON.stringify({ black: (team === 'black' ? nextTeam : nextOther).map(p => p.id), orange: (team === 'orange' ? nextTeam : nextOther).map(p => p.id) }))
        } catch { void 0 }
        setSubstitutionModal(null)
        toast.success('Troca entre times registrada')
      }
    } catch {
      toast.error('Falha ao registrar substituição')
    }
  }
  const finishMatchRemote = (blackScore: number, orangeScore: number, message?: string) => {
    const msg = message || 'Partida finalizada'
    toast.success(msg)
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
    prepareNextTeamsRotation(blackScore, orangeScore)
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
      const [statsResp, detailsResp] = await Promise.all([
        api.get(`/api/matches/${match.id}/stats`).catch(() => ({ data: { stats: [] } })),
        api.get(`/api/matches/${match.id}`).catch(() => ({ data: { match: { participants: [] } } }))
      ])
      const stats = (statsResp.data?.stats || []) as StatEvent[]
      const parts = Array.isArray(detailsResp.data?.match?.participants)
        ? (detailsResp.data.match.participants as Array<{ team: 'black' | 'orange'; player_id: number }>)
        : []
      const blackIds = parts.filter((x) => x.team === 'black').map((x) => x.player_id)
      const orangeIds = parts.filter((x) => x.team === 'orange').map((x) => x.player_id)
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
      toast.success('Gol registrado!')
      setGoalModal(null)
      try {
        const statsResp = await api.get(`/api/matches/${currentMatchId}/stats`)
        setMatchStats((statsResp.data?.stats || []) as StatEvent[])
        await startPolling()
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

  const startPolling = async () => {
    if (!currentMatchId) return
    try {
      console.info('[sse:poll-tick]', { partida: currentMatchId })
      const statsResp = await api.get(`/api/matches/${currentMatchId}/stats`)
      const stats = (statsResp.data?.stats || []) as StatEvent[]
      setMatchStats(stats)
      const blackGoals = stats.filter(ev => ev.event_type === 'goal' && ev.team_scored === 'black').length
      const orangeGoals = stats.filter(ev => ev.event_type === 'goal' && ev.team_scored === 'orange').length
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
      try {
        const det = await api.get(`/api/matches/${currentMatchId}`)
        const st = det.data?.match?.status as string | undefined
        const b = Number(det.data?.match?.team_black_score || blackGoals || 0)
        const o = Number(det.data?.match?.team_orange_score || orangeGoals || 0)
        const m = det.data?.match as { team_black_win_streak?: number, team_orange_win_streak?: number }
        const pollBlack = Number(m?.team_black_win_streak || 0)
        const pollOrange = Number(m?.team_orange_win_streak || 0)
        setConsecutiveUnchanged({ black: pollBlack, orange: pollOrange })
        sseStatsRef.current.polls += 1
        console.info('[streak:poll]', { partida: currentMatchId, preto: pollBlack, laranja: pollOrange, polls: sseStatsRef.current.polls })
        if (st === 'finished') {
          finishMatchRemote(b, o, 'Partida finalizada')
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
          setMatchStats(data.stats || [])
          setCurrentMatch(prev => prev ? { ...prev, blackScore: Number(data.blackGoals || 0), orangeScore: Number(data.orangeGoals || 0) } : prev)
          const rawTicker = localStorage.getItem('matchTicker')
          if (rawTicker) {
            const t = JSON.parse(rawTicker) as { startTime: string; blackScore: number; orangeScore: number }
            t.blackScore = Number(data.blackGoals || 0)
            t.orangeScore = Number(data.orangeGoals || 0)
            localStorage.setItem('matchTicker', JSON.stringify(t))
          }
          (async () => {
            try {
              const det = await api.get(`/api/matches/${currentMatchId}`)
              const m = det.data?.match as { team_black_win_streak?: number, team_orange_win_streak?: number }
              const sseBlack = Number(m?.team_black_win_streak || 0)
              const sseOrange = Number(m?.team_orange_win_streak || 0)
              setConsecutiveUnchanged({ black: sseBlack, orange: sseOrange })
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
          setMatchStats(prev => [...prev, data.stat])
          setCurrentMatch(prev => prev ? { ...prev, blackScore: Number(data.blackGoals || 0), orangeScore: Number(data.orangeGoals || 0) } : prev)
          const rawTicker = localStorage.getItem('matchTicker')
          if (rawTicker) {
            const t = JSON.parse(rawTicker) as { startTime: string; blackScore: number; orangeScore: number }
            t.blackScore = Number(data.blackGoals || 0)
            t.orangeScore = Number(data.orangeGoals || 0)
            localStorage.setItem('matchTicker', JSON.stringify(t))
          }
          (async () => {
            try {
              const det = await api.get(`/api/matches/${currentMatchId}`)
              const m = det.data?.match as { team_black_win_streak?: number, team_orange_win_streak?: number }
              const sseBlack = Number(m?.team_black_win_streak || 0)
              const sseOrange = Number(m?.team_orange_win_streak || 0)
              setConsecutiveUnchanged({ black: sseBlack, orange: sseOrange })
              console.info('[streak:sse-goal]', { partida: currentMatchId, preto: sseBlack, laranja: sseOrange })
            } catch { void 0 }
          })()
        } catch { void 0 }
      })
      es.addEventListener('finish', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { match_id: number; blackScore?: number; orangeScore?: number }
          sseStatsRef.current.finishes += 1
          console.info('[sse:finish]', { partida: data.match_id, finishes: sseStatsRef.current.finishes })
          if (data.match_id === currentMatchId) {
            setLastFinishedMatchId(data.match_id)
            const b = Number((data.blackScore ?? currentMatch?.blackScore ?? 0) || 0)
            const o = Number((data.orangeScore ?? currentMatch?.orangeScore ?? 0) || 0)
            finishMatchRemote(b, o, 'Partida finalizada')
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
    const rawLastWinner = localStorage.getItem('matchLastWinnerLineup')
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
      if (rawLastWinner) {
        try {
          const lw = JSON.parse(rawLastWinner) as { black?: number[]; orange?: number[] }
          lastWinnerRef.current = {
            black: Array.isArray(lw.black) ? lw.black : [],
            orange: Array.isArray(lw.orange) ? lw.orange : []
          }
        } catch { lastWinnerRef.current = { black: [], orange: [] } }
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
  useEffect(() => {
    if (!rotationApplied) return
    const t = setTimeout(() => setRotationApplied(null), 8000)
    return () => clearTimeout(t)
  }, [rotationApplied])

  const prepareNextTeamsRotation = (blackScore: number, orangeScore: number) => {
    try {
      const benchIdsAll = bench.map(p => p.id)
      const currentBlackIds = teams.black.map(p => p.id)
      const currentOrangeIds = teams.orange.map(p => p.id)
      if (blackScore === orangeScore) {
        const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
        const presentCount = presentIds.length
        const leavingIdsAll = [...currentBlackIds, ...currentOrangeIds]
        const newBenchIds = Array.from(new Set<number>([...benchIdsAll, ...leavingIdsAll]))
        if (presentCount > 17) {
          setTeams({ black: [], orange: [] })
          setBench(players.filter(p => newBenchIds.includes(p.id)))
          localStorage.setItem('matchTeams', JSON.stringify({ black: [], orange: [] }))
          localStorage.setItem('matchBench', JSON.stringify(newBenchIds))
          setRotationApplied('full')
          setRodizioMode(false)
          setSelectedPlayers([])
          setSelectedChallengers([])
          setShowForm(true)
          setTieModal({ open: true, winner: null })
          return
        }
        setTieModal({ open: true, winner: null })
        return
      }
      const loser: 'black' | 'orange' = blackScore > orangeScore ? 'orange' : 'black'
      const winner: 'black' | 'orange' = loser === 'black' ? 'orange' : 'black'
      const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
      const currentIds = new Set<number>([...currentBlackIds, ...currentOrangeIds])
      const availableFromPresent = players.filter(p => presentIds.includes(p.id) && !currentIds.has(p.id))
      const winnerCount = Math.max(0, Math.floor(consecutiveUnchanged[winner] || 0))
      const leaveSide: 'black'|'orange' = winnerCount >= 2 ? winner : loser
      const staySide: 'black'|'orange' = leaveSide === 'black' ? 'orange' : 'black'
      const outgoingLeaveIds = teams[leaveSide].map(p => p.id)
      const newBenchBase = Array.from(new Set<number>([...benchIdsAll, ...outgoingLeaveIds]))
      if (winnerCount >= 2) {
        const newTeams = { black: leaveSide === 'black' ? [] : teams.black, orange: leaveSide === 'orange' ? [] : teams.orange }
        setTeams(newTeams)
        const newBenchPlayers = players.filter(p => newBenchBase.includes(p.id))
        setBench(newBenchPlayers)
        localStorage.setItem('matchTeams', JSON.stringify({ black: newTeams.black.map(p => p.id), orange: newTeams.orange.map(p => p.id) }))
        localStorage.setItem('matchBench', JSON.stringify(newBenchBase))
        setRodizioMode(true)
        setRodizioWinnerColor(staySide)
        setSelectedChallengers([])
        setShowForm(true)
        toast.success('Terceira vitória: vencedor sai. Selecione os desafiantes.')
      } else {
        const presentCount = presentIds.length
        if (presentCount > 17) {
          const newTeams = { black: leaveSide === 'black' ? [] : teams.black, orange: leaveSide === 'orange' ? [] : teams.orange }
          setTeams(newTeams)
          const newBenchPlayers = players.filter(p => newBenchBase.includes(p.id))
          setBench(newBenchPlayers)
          localStorage.setItem('matchTeams', JSON.stringify({ black: newTeams.black.map(p => p.id), orange: newTeams.orange.map(p => p.id) }))
          localStorage.setItem('matchBench', JSON.stringify(newBenchBase))
          setRodizioMode(true)
          setRodizioWinnerColor(staySide)
          setSelectedChallengers([])
          setShowForm(true)
          toast.success('Rodízio: perdedor sai. Escolha manual dos desafiantes (>17 presentes).')
          return
        }
        const sideSize = teams[leaveSide].length
        const incomingFromBench = benchIdsAll.slice(0, sideSize)
        const incomingFallback = availableFromPresent.map(p => p.id).slice(0, Math.max(0, sideSize - incomingFromBench.length))
        const incomingIds = [...incomingFromBench, ...incomingFallback].slice(0, sideSize)
        const remainingBenchIds = benchIdsAll.filter(id => !incomingFromBench.includes(id))
        const incomingPlayers = players.filter(p => incomingIds.includes(p.id))
        const nextLeave = incomingPlayers.length === sideSize ? incomingPlayers : []
        const newTeams = { black: leaveSide === 'black' ? nextLeave : teams.black, orange: leaveSide === 'orange' ? nextLeave : teams.orange }
        setTeams(newTeams)
        const newBenchPlayers = players.filter(p => Array.from(new Set<number>([...remainingBenchIds, ...outgoingLeaveIds])).includes(p.id))
        setBench(newBenchPlayers)
        localStorage.setItem('matchTeams', JSON.stringify({ black: newTeams.black.map(p => p.id), orange: newTeams.orange.map(p => p.id) }))
        localStorage.setItem('matchBench', JSON.stringify(Array.from(new Set<number>([...remainingBenchIds, ...outgoingLeaveIds]))))
        if (nextLeave.length === 0) {
          setRodizioMode(true)
          setRodizioWinnerColor(staySide)
          setSelectedChallengers([])
          setShowForm(true)
          toast.success('Derrota: perdedor sai. Selecione os desafiantes.')
        }
      }
    } catch { void 0 }
  }

 const forceRemoveTeam = (team: 'black'|'orange') => {
   try {
     const removed = teams[team]
     const newBenchIds = Array.from(new Set<number>([...bench.map(p => p.id), ...removed.map(p => p.id)]))
     const nextTeams = team === 'black' ? { black: [], orange: teams.orange } : { black: teams.black, orange: [] }
     setTeams(nextTeams)
     const nextBench = players.filter(p => newBenchIds.includes(p.id))
     setBench(nextBench)
     if (rodizioMode) {
       if (rodizioWinnerColor === team) {
         setSelectedPlayers([])
       } else {
         setSelectedChallengers([])
       }
     }
     toast.success(`Time ${team === 'black' ? 'preto' : 'laranja'} removido. Selecione novos jogadores para este lado.`)
   } catch { toast.error('Falha ao remover time') }
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
                  <div className="flex flex-col items-center">
                    <span className="inline-flex items-center px-2 md:px-3 py-1 rounded-full bg-black text-white text-xs md:text-sm font-extrabold tracking-wider shadow">
                      PRETO
                    </span>
                    {renderStreakDots(consecutiveUnchanged.black)}
                  </div>
                  <span className="inline-flex items-center justify-center px-4 md:px-6 py-2 md:py-3 rounded-xl bg-white ring-2 md:ring-4 ring-black text-4xl md:text-7xl font-extrabold text-black shadow-sm">
                    {currentMatch?.blackScore}
                  </span>
                  <span className="text-xl md:text-3xl font-extrabold text-white/80">x</span>
                  <span className="inline-flex items-center justify-center px-4 md:px-6 py-2 md:py-3 rounded-xl bg-white ring-2 md:ring-4 ring-orange-500 text-4xl md:text-7xl font-extrabold text-orange-600 shadow-sm">
                    {currentMatch?.orangeScore}
                  </span>
                  <div className="flex flex-col items-center">
                    <span className="inline-flex items-center px-2 md:px-3 py-1 rounded-full bg-orange-500 text-white text-xs md:text-sm font-extrabold tracking-wider shadow">
                      LARANJA
                    </span>
                    {renderStreakDots(consecutiveUnchanged.orange)}
                  </div>
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
            {tick >= matchDurationMin * 60 && currentMatch && (currentMatch.blackScore === currentMatch.orangeScore) && (
              <div className="mb-3">
                {(() => {
                  const presentCount = Object.keys(presentMap).filter(id => presentMap[Number(id)]).length
                  if (presentCount >= 20) {
                    return <div className="inline-flex items-center px-2 py-1 rounded-md bg-purple-100 text-purple-800 text-xs font-semibold">Rodízio em empate: Troca total (20+ presentes)</div>
                  }
                  if (presentCount >= 18) {
                    return <div className="inline-flex items-center px-2 py-1 rounded-md bg-blue-100 text-blue-800 text-xs font-semibold">Rodízio em empate: Mantém goleiros (18–19 presentes)</div>
                  }
                  return null
                })()}
              </div>
            )}
            <div className="space-y-2">
              {matchStats.length === 0 && (
                <div className="text-xs text-gray-500">Sem eventos registrados ainda</div>
              )}
              {matchStats.filter(ev => ev.event_type !== 'tie_decider').map(ev => {
                const allPlayers = players
                const scorer = allPlayers.find(p => p.id === (ev.player_scorer_id ?? -1))
                const assist = allPlayers.find(p => p.id === (ev.player_assist_id ?? -1))
                const teamClass = ev.team_scored === 'black' ? 'bg-black text-white' : 'bg-orange-500 text-white'
                const minute = typeof ev.goal_minute === 'number' ? ev.goal_minute : 0
                return (
                  <div key={ev.stat_id} className="flex items-center justify-between rounded-md border border-gray-200 p-2">
                    <div className="flex items-center space-x-2">
                      <span className={`text-[10px] px-2 py-1 rounded ${teamClass}`}>{ev.team_scored === 'black' ? 'Preto' : 'Laranja'}</span>
                      <span className="text-xs text-gray-600">{String(minute).padStart(2, '0')}'</span>
                      {ev.event_type === 'goal' ? (
                        <>
                          <span className="text-sm font-medium text-gray-900">
                            {ev.is_own_goal ? 'Contra' : (scorer?.name || '—')}
                          </span>
                          {ev.player_assist_id ? (
                            <span className="text-xs text-gray-600">assistência: {assist?.name || '—'}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-sm font-medium text-gray-900">
                          Substituição: sai {assist?.name || '—'}, entra {scorer?.name || '—'}
                        </span>
                      )}
                    </div>
                    <button
                      className="text-red-600 hover:text-red-700 text-sm"
                      onClick={async () => {
                        try {
                          await api.delete(`/api/matches/stats/${ev.stat_id}`)
                          if (ev.event_type === 'goal') {
                            setCurrentMatch(prev => ({
                              ...prev!,
                              blackScore: ev.team_scored === 'black' ? Math.max(0, (prev?.blackScore || 0) - 1) : (prev?.blackScore || 0),
                              orangeScore: ev.team_scored === 'orange' ? Math.max(0, (prev?.orangeScore || 0) - 1) : (prev?.orangeScore || 0)
                            }))
                          }
                          const raw = localStorage.getItem('matchTicker')
                          try {
                            const t = raw ? JSON.parse(raw) as { startTime: string; blackScore: number; orangeScore: number } : null
                            const updated = {
                              startTime: t?.startTime || new Date().toISOString(),
                              blackScore: ev.event_type === 'goal' && ev.team_scored === 'black' ? Math.max(0, (t?.blackScore || 0) - 1) : (t?.blackScore || 0),
                              orangeScore: ev.event_type === 'goal' && ev.team_scored === 'orange' ? Math.max(0, (t?.orangeScore || 0) - 1) : (t?.orangeScore || 0)
                            }
                            localStorage.setItem('matchTicker', JSON.stringify(updated))
                          } catch { void 0 }
                          if (ev.event_type === 'goal') {
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
                          }
                          try {
                            const statsResp = await api.get(`/api/matches/${currentMatchId}/stats`)
                            setMatchStats((statsResp.data?.stats || []) as StatEvent[])
                          } catch { void 0 }
                          toast.success(ev.event_type === 'goal' ? 'Gol removido' : 'Substituição removida')
                        } catch {
                          toast.error(ev.event_type === 'goal' ? 'Falha ao remover gol' : 'Falha ao remover substituição')
                        }
                      }}
                      title={ev.event_type === 'goal' ? 'Remover gol' : 'Remover substituição'}
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
      
      {tieModal.open && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Empate — Quem ganhou no par ou ímpar?</h3>
            <p className="text-sm text-gray-600 mb-4">Selecione o time vencedor do desempate.</p>
            {rotationApplied && (
              <div className={`mb-3 text-xs font-semibold inline-flex items-center px-2 py-1 rounded-md ${
                rotationApplied === 'full' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
              }`}>
                {rotationApplied === 'full' ? 'Rodízio aplicado: Troca total' : 'Rodízio aplicado: Mantém goleiros'}
              </div>
            )}
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setTieModal({ open: true, winner: 'black' })}
                className={`px-4 py-2 rounded-md text-sm font-medium ${tieModal.winner === 'black' ? 'bg-black text-white' : 'bg-gray-100 text-gray-900'}`}
              >
                Preto
              </button>
              <button
                onClick={() => setTieModal({ open: true, winner: 'orange' })}
                className={`px-4 py-2 rounded-md text-sm font-medium ${tieModal.winner === 'orange' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-900'}`}
              >
                Laranja
              </button>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setTieModal({ open: false, winner: null })}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Cancelar
              </button>
                <button
                  onClick={async () => {
                    const stay = tieModal.winner
                    if (!stay) {
                      toast.error('Selecione o time vencedor')
                      return
                    }
                    const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
                    const presentCount = presentIds.length
                    if (lastFinishedMatchId) {
                      try {
                        await api.post(`/api/matches/${lastFinishedMatchId}/tie-decider`, { winner: stay })
                      } catch { void 0 }
                    }
                    lastWinnerRef.current = {
                      black: stay === 'black' ? teams.black.map(p => p.id) : lastWinnerRef.current.black,
                      orange: stay === 'orange' ? teams.orange.map(p => p.id) : lastWinnerRef.current.orange
                    }
                    setTieModal({ open: false, winner: null })
                    if (presentCount > 17) {
                      const leavingIdsAll = [...teams.black.map(p => p.id), ...teams.orange.map(p => p.id)]
                      const newBenchIds = Array.from(new Set<number>([...bench.map(p => p.id), ...leavingIdsAll]))
                      setTeams({ black: [], orange: [] })
                      setBench(players.filter(p => newBenchIds.includes(p.id)))
                      try {
                        localStorage.setItem('matchTeams', JSON.stringify({ black: [], orange: [] }))
                        localStorage.setItem('matchBench', JSON.stringify(newBenchIds))
                      } catch { void 0 }
                      setRodizioMode(false)
                      setSelectedPlayers([])
                      setSelectedChallengers([])
                      setShowForm(true)
                      toast.success('Empate com muitos presentes: ambos os times saem.')
                      return
                    }
                    const countStay = Math.max(0, Math.floor(consecutiveUnchanged[stay] || 0))
                    if (countStay >= 2) {
                      const leaveSide = stay
                      const staySide = leaveSide === 'black' ? 'orange' : 'black'
                      const leavingIds = teams[leaveSide].map(p => p.id)
                      const newBenchIds = Array.from(new Set<number>([...bench.map(p => p.id), ...leavingIds]))
                      const newTeams = { black: leaveSide === 'black' ? [] : teams.black, orange: leaveSide === 'orange' ? [] : teams.orange }
                      setTeams(newTeams)
                      setBench(players.filter(p => newBenchIds.includes(p.id)))
                      try {
                        localStorage.setItem('matchTeams', JSON.stringify({ black: newTeams.black.map(p => p.id), orange: newTeams.orange.map(p => p.id) }))
                        localStorage.setItem('matchBench', JSON.stringify(newBenchIds))
                      } catch { void 0 }
                      setRodizioMode(true)
                      setRodizioWinnerColor(staySide)
                      setSelectedChallengers([])
                      setShowForm(true)
                      toast.success('Terceiro empate vencido: vencedor sai. Selecione os desafiantes.')
                      return
                    }
                    const leaveSide = stay === 'black' ? 'orange' : 'black'
                    const sideSize = teams[leaveSide].length
                    const benchIdsAll = bench.map(p => p.id)
                    const presentIdsStay = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
                    const currentIds = new Set<number>([...teams.black.map(p => p.id), ...teams.orange.map(p => p.id)])
                    const availableFromPresent = players.filter(p => presentIdsStay.includes(p.id) && !currentIds.has(p.id))
                    const incomingFromBench = benchIdsAll.slice(0, sideSize)
                    const incomingFallback = availableFromPresent.map(p => p.id).slice(0, Math.max(0, sideSize - incomingFromBench.length))
                    const incomingIds = [...incomingFromBench, ...incomingFallback].slice(0, sideSize)
                    const remainingBenchIds = benchIdsAll.filter(id => !incomingFromBench.includes(id))
                    const incomingPlayers = players.filter(p => incomingIds.includes(p.id))
                    const nextLeave = incomingPlayers.length === sideSize ? incomingPlayers : []
                    const newTeams = { black: leaveSide === 'black' ? nextLeave : teams.black, orange: leaveSide === 'orange' ? nextLeave : teams.orange }
                    setTeams(newTeams)
                    const outgoingLeaveIds = teams[leaveSide].map(p => p.id)
                    const newBenchPlayers = players.filter(p => Array.from(new Set<number>([...remainingBenchIds, ...outgoingLeaveIds])).includes(p.id))
                    setBench(newBenchPlayers)
                    try {
                      localStorage.setItem('matchTeams', JSON.stringify({ black: newTeams.black.map(p => p.id), orange: newTeams.orange.map(p => p.id) }))
                      localStorage.setItem('matchBench', JSON.stringify(Array.from(new Set<number>([...remainingBenchIds, ...outgoingLeaveIds]))))
                    } catch { void 0 }
                    if (nextLeave.length === 0) {
                      setRodizioMode(true)
                      setRodizioWinnerColor(stay)
                      setSelectedChallengers([])
                      setShowForm(true)
                      toast.success('Empate: perdedor sai. Selecione os desafiantes.')
                    } else {
                      toast.success(`${stay === 'black' ? 'Preto' : 'Laranja'} permanece.`)
                    }
                  }}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Confirmar
                </button>
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
      {substitutionModal?.open && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Registrar Substituição — {substitutionModal.team === 'black' ? 'Time Preto' : 'Time Laranja'}</h3>
            <div className="space-y-4">
              <div>
                <div className="inline-flex rounded-md shadow-sm" role="group">
                  <button
                    type="button"
                    className={`px-3 py-1 text-sm border ${substitutionForm.mode === 'bench' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300'}`}
                    onClick={() => setSubstitutionForm(prev => ({ ...prev, mode: 'bench', in_id: null }))}
                  >
                    Do banco
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 text-sm border ${substitutionForm.mode === 'swap' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300'}`}
                    onClick={() => setSubstitutionForm(prev => ({ ...prev, mode: 'swap', in_id: null }))}
                  >
                    Troca entre times
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Quem sai</label>
                <select
                  value={substitutionForm.out_id ?? ''}
                  onChange={(e) => setSubstitutionForm({ ...substitutionForm, out_id: e.target.value ? Number(e.target.value) : null })}
                  className="mt-1 block w-full border-gray-300 rounded-md"
                >
                  <option value="">Selecione</option>
                  {(substitutionModal.team === 'black' ? teams.black : teams.orange).map(p => (
                    <option key={`out-${p.id}`} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Quem entra</label>
                <select
                  value={substitutionForm.in_id ?? ''}
                  onChange={(e) => setSubstitutionForm({ ...substitutionForm, in_id: e.target.value ? Number(e.target.value) : null })}
                  className="mt-1 block w-full border-gray-300 rounded-md"
                >
                  <option value="">Selecione</option>
                  {(substitutionForm.mode === 'swap'
                    ? (substitutionModal.team === 'black' ? teams.orange : teams.black)
                    : benchCandidates
                  ).filter(p => p.id !== (substitutionForm.out_id ?? -1)).filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i).map(p => (
                    <option key={`in-${p.id}`} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => setSubstitutionModal(null)}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitSubstitution}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Registrar Substituição
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Partidas</h1>
        {(() => {
          const anyInProgress = matchInProgress || matches.some(m => m.status === 'in_progress')
          const latestDate = matches.length ? matches[0].match_date : undefined
          const hasFinishedToday = matches.some(m => m.status === 'finished' && (!latestDate || m.match_date === latestDate))
          if (anyInProgress) {
            return null
          }
          if (hasFinishedToday) {
            return (
              <button
                onClick={prefillNextMatch}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <Plus className="w-4 h-4 mr-2" />
                Próxima Partida
              </button>
            )
          }
          return (
            <button
              onClick={() => {
                setRodizioMode(false)
                setRodizioWinnerColor(null)
                setSelectedChallengers([])
                setTeams({ black: [], orange: [] })
                setBench([])
                setShowForm(true)
              }}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nova Partida
            </button>
          )
        })()}
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
              <div className="flex justify-end mb-2">
                <button
                  onClick={() => {
                    const defaultMode: 'bench' | 'swap' = bench.length > 0 ? 'bench' : 'swap'
                    setSubstitutionForm({ out_id: null, in_id: null, mode: defaultMode })
                    setSubstitutionModal({ open: true, team: 'black' })
                  }}
                  className="px-3 py-1 rounded-md text-xs font-medium text-white bg-gray-800 hover:bg-black"
                >
                  Substituir
                </button>
              </div>
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
              <div className="flex justify-end mb-2">
                <button
                  onClick={() => {
                    const defaultMode: 'bench' | 'swap' = bench.length > 0 ? 'bench' : 'swap'
                    setSubstitutionForm({ out_id: null, in_id: null, mode: defaultMode })
                    setSubstitutionModal({ open: true, team: 'orange' })
                  }}
                  className="px-3 py-1 rounded-md text-xs font-medium text-white bg-orange-500 hover:bg-orange-600"
                >
                  Substituir
                </button>
              </div>
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
          <h2 className="text-xl font-semibold text-gray-900 mb-4">{rodizioMode ? 'Próxima Partida' : 'Criar Nova Partida'}</h2>
          
          {/* Player Selection */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-3">{rodizioMode ? 'Selecione os Desafiantes' : `Selecione os Jogadores (${selectedPlayers.length}/10)`}</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {[...players].sort((a, b) => {
                const pa = presentMap[a.id] ? 1 : 0
                const pb = presentMap[b.id] ? 1 : 0
                if (pb !== pa) return pb - pa
                return a.name.localeCompare(b.name)
              }).map((player) => (
                <button
                  key={player.id}
                  onClick={() => handlePlayerSelection(player.id)}
                  className={`p-3 rounded-lg border-2 text-left transition-colors ${
                    (rodizioMode && rodizioWinnerColor && teams[rodizioWinnerColor].some(p => p.id === player.id))
                      ? 'border-blue-500 bg-blue-50'
                      : (selectedPlayers.includes(player.id) || selectedChallengers.includes(player.id))
                        ? 'border-primary-500 bg-primary-50'
                        : presentMap[player.id]
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 hover:border-gray-300'
                  }`}
                  disabled={!!(rodizioMode && rodizioWinnerColor && teams[rodizioWinnerColor].some(p => p.id === player.id))}
                >
                  <div className="font-medium text-sm">{player.name}</div>
                  <div className="text-xs text-gray-500">{player.position}</div>
                  <div className={`mt-1 inline-flex items-center px-2 py-0.5 rounded text-[10px] ${presentMap[player.id] ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {presentMap[player.id] ? 'Presente' : 'Ausente'}
                  </div>
                  <div className="text-xs text-gray-400">
                    {player.total_goals_scored} gols • {player.win_rate.toFixed(0)}% vit.
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Team Sorting */}
          {(!rodizioMode ? selectedPlayers.length >= 6 : true) && (
            <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">Times</h3>
                <div className="flex items-center space-x-2">
                  {!rodizioMode && (
                    <button
                      onClick={sortTeams}
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-success-600 hover:bg-success-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success-500"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Sortear Times
                    </button>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Time Preto */}
                <div className="bg-gray-100 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-semibold text-gray-900 flex items-center">
                      <div className="w-4 h-4 bg-black rounded-full mr-2"></div>
                      Time Preto ({teams.black.length}) {teams.black.length ? teamOverallAvg(teams.black) : 0}
                    </h4>
                    <button
                      onClick={() => forceRemoveTeam('black')}
                      className="text-gray-500 hover:text-red-600"
                      title="Remover Time Preto"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
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
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-semibold text-orange-900 flex items-center">
                      <div className="w-4 h-4 bg-orange-500 rounded-full mr-2"></div>
                      Time Laranja ({teams.orange.length}) {teams.orange.length ? teamOverallAvg(teams.orange) : 0}
                    </h4>
                    <button
                      onClick={() => forceRemoveTeam('orange')}
                      className="text-gray-500 hover:text-red-600"
                      title="Remover Time Laranja"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
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


          {/* Match Controls */}
          {teams.black.length > 0 && teams.orange.length > 0 && (
            <div className="border-t pt-6">
              {!matchInProgress ? (
                <button
                  onClick={startMatch}
                  disabled={rodizioMode ? ((rodizioWinnerColor ? teams[rodizioWinnerColor].length : 0) !== (rodizioWinnerColor === 'black' ? teams.orange.length : teams.black.length)) : false}
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
              setRodizioMode(false)
              setRodizioWinnerColor(null)
              setSelectedChallengers([])
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
                    {(() => {
                      const wt = typeof match.winning_team === 'string' ? match.winning_team : 'draw'
                      let label: string | null = null
                      if (wt === 'orange') label = '(laranja)'
                      else if (wt === 'black') label = '(preto)'
                      else if (match.tie_decider_winner === 'orange') label = '(laranja)'
                      else if (match.tie_decider_winner === 'black') label = '(preto)'
                      return label ? <span className="text-xs text-gray-600">{label}</span> : null
                    })()}
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
                  {(() => {
                    const b = Number(detailsModal.black_score ?? 0)
                    const o = Number(detailsModal.orange_score ?? 0)
                    let label: string | null = null
                    if (b > o) label = '(preto)'
                    else if (o > b) label = '(laranja)'
                    else {
                      const tieEvent = (detailsModal.stats || []).filter(ev => ev.event_type === 'tie_decider').slice(-1)[0]
                      if (tieEvent?.team_scored === 'orange') label = '(laranja)'
                      if (tieEvent?.team_scored === 'black') label = '(preto)'
                    }
                    return label ? <span className="text-xs text-gray-600 ml-2">{label}</span> : null
                  })()}
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
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Histórico de eventos</h4>
                {detailsModal.loading ? (
                  <div className="text-xs text-gray-500">Carregando...</div>
                ) : (
                  <div className="space-y-2">
                    {detailsModal.stats.length === 0 && (
                      <div className="text-xs text-gray-500">Sem eventos</div>
                    )}
                    {detailsModal.stats.filter(ev => ev.event_type !== 'tie_decider').map(ev => {
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
                            {ev.event_type === 'goal' ? (
                              <>
                                <span className="text-sm font-medium text-gray-900">
                                  {ev.is_own_goal ? 'Contra' : (scorer?.name || '—')}
                                </span>
                                {ev.player_assist_id ? (
                                  <span className="text-xs text-gray-600">assistência: {assist?.name || '—'}</span>
                                ) : null}
                              </>
                            ) : (
                              <span className="text-sm font-medium text-gray-900">
                                Substituição: sai {assist?.name || '—'}, entra {scorer?.name || '—'}
                              </span>
                            )}
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
