import React, { useState, useEffect, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import { Plus, Play, RotateCcw, Trophy, Clock, Trash2 } from 'lucide-react'
import api from '../services/api'
import { logError } from '../services/logger'
import { useAuth } from '../hooks/useAuth'
import { useMatchSocket } from '../hooks/useMatchSocket'
import { useMatchTimer } from '../hooks/useMatchTimer'
import AuditModal from '../components/matches/AuditModal'
import ScoreBoard from '../components/matches/ScoreBoard'
import PlayerSelectionGrid from '../components/matches/PlayerSelectionGrid'

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
  const restoredRef = useRef(false)
  const [gkModal, setGkModal] = useState<{ open: boolean; candidates: Player[] } | null>(null)
  const [gkAsFieldId, setGkAsFieldId] = useState<number | null>(null)
  const [liveStats, setLiveStats] = useState<Record<number, { goals: number; assists: number; ownGoals: number }>>({})
  const [bench, setBench] = useState<Player[]>([])
  const [matchStats, setMatchStats] = useState<StatEvent[]>([])
  const [matchDurationMin, setMatchDurationMin] = useState<number>(10)
  const [submittingGoal, setSubmittingGoal] = useState<boolean>(false)
  const [alarmMuted, setAlarmMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('matchAlarmMuted') === '1'
    } catch {
      return false
    }
  })
  
  const { tick, setTick } = useMatchTimer({
    matchInProgress,
    matchDurationMin,
    startTime: currentMatch?.startTime,
    alarmMuted
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
  const { isAdmin } = useAuth()
  const [editBlackScore, setEditBlackScore] = useState<string>('')
  const [editOrangeScore, setEditOrangeScore] = useState<string>('')
  
  const { connectionStatus, startPolling } = useMatchSocket({
    currentMatchId,
    matchInProgress,
    onMatchStatsUpdate: (stats) => setMatchStats(stats),
    onScoreUpdate: (black, orange) => {
      setCurrentMatch(prev => prev ? { ...prev, blackScore: black, orangeScore: orange } : prev)
      try {
        const rawTicker = localStorage.getItem('matchTicker')
        if (rawTicker) {
          const t = JSON.parse(rawTicker) as { startTime: string; blackScore: number; orangeScore: number }
          t.blackScore = black
          t.orangeScore = orange
          localStorage.setItem('matchTicker', JSON.stringify(t))
        }
      } catch { void 0 }
    },
    onStreakUpdate: (black, orange) => setConsecutiveUnchanged({ black, orange }),
    onFinishRemote: (black, orange) => finishMatchRemote(black, orange, 'Partida finalizada')
  })

  const lastWinnerRef = useRef<{ black: number[]; orange: number[] }>({ black: [], orange: [] })
  const didRunFetchRef = useRef(false)
  const didRunConfigRef = useRef(false)
  const [rodizioMode, setRodizioMode] = useState<boolean>(false)
  const [rodizioWinnerColor, setRodizioWinnerColor] = useState<'black'|'orange'|null>(null)
  const [, setSelectedChallengers] = useState<number[]>([])
  const [rotationApplied, setRotationApplied] = useState<'gk'|'full'|null>(null)
  const [currentSundayDate, setCurrentSundayDate] = useState<string | undefined>(undefined)
  const dateOnly = (s: string | undefined): string | undefined => {
    const t = String(s || '')
    if (!t) return undefined
    const m = t.match(/^(\d{4}-\d{2}-\d{2})/)
    return m ? m[1] : undefined
  }
  const nextSundayDate = (): string => {
    const now = new Date()
    const d = now.getDay()
    const delta = (7 - d) % 7
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta)
    const y = target.getFullYear()
    const m = `${target.getMonth() + 1}`.padStart(2, '0')
    const dd = `${target.getDate()}`.padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  useEffect(() => {
    if (didRunFetchRef.current) return
    didRunFetchRef.current = true
    fetchData()
  }, [])
  const isFirstMatchToday = useMemo(() => {
    const target = dateOnly(currentSundayDate)
    if (!target) return true
    const todayMatches = matches.filter(m => dateOnly(m.match_date) === target)
    return todayMatches.length === 0
  }, [matches, currentSundayDate])

  const startMatchButtonRef = useRef<HTMLButtonElement>(null)
  const selectedCount = isFirstMatchToday 
    ? selectedPlayers.length 
    : teams.black.length + teams.orange.length

  useEffect(() => {
    if (selectedCount >= 10 && startMatchButtonRef.current) {
      startMatchButtonRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [selectedCount])

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
        total_wins?: number
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
        win_rate: Number(p.total_games_played) > 0 
          ? (Number(p.total_wins || 0) / Number(p.total_games_played)) * 100 
          : 0,
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
        const sundaysApi = (sundaysResponse.data?.sundays || []) as Array<{ sunday_id: number; date?: string }>
        if (sundaysApi.length > 0) {
          const todaySunday = nextSundayDate()
          const foundToday = sundaysApi.find(s => dateOnly(String(s.date || '')) === todaySunday)
          const sundayId = foundToday ? foundToday.sunday_id : sundaysApi[0].sunday_id
          setCurrentSundayDate(todaySunday)
          const attResp = await api.get(`/api/sundays/${sundayId}/attendances`)
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
          setConsecutiveUnchanged({ black: Number(initBlackStreak), orange: Number(initOrangeStreak) })
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

  const sortButtonRef = useRef<HTMLButtonElement>(null)

  const handlePlayerSelection = (playerId: number) => {
    if (teams.black.some(p => p.id === playerId)) {
      removeFromTeam('black', playerId)
      return
    }
    if (teams.orange.some(p => p.id === playerId)) {
      removeFromTeam('orange', playerId)
      return
    }
    if (!isFirstMatchToday) {
      return
    }
    setSelectedPlayers(prev => {
      const isSelected = prev.includes(playerId)
      let next = prev
      if (isSelected) {
        next = prev.filter(id => id !== playerId)
      } else if (prev.length < 10) {
        next = [...prev, playerId]
      }
      
      // Se selecionou o 10º jogador, faz scroll para o botão de sortear
      if (!isSelected && next.length === 10) {
        setTimeout(() => {
          sortButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 100)
      }

      return next
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
    if (!isFirstMatchToday) {
      toast.error('Sorteio permitido apenas na primeira partida do dia')
      return
    }
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
  const addToTeam = (team: 'black'|'orange', playerId: number) => {
    const inBlack = teams.black.some(p => p.id === playerId)
    const inOrange = teams.orange.some(p => p.id === playerId)
    if (inBlack || inOrange) return
    const maxPerTeam = 5
    const target = team === 'black' ? teams.black : teams.orange
    if (target.length >= maxPerTeam) {
      toast.error(team === 'black' ? 'Time preto cheio' : 'Time laranja cheio')
      return
    }
    const player = players.find(p => p.id === playerId)
    if (!player) return
    const nextTeams = team === 'black'
      ? { black: [...teams.black, player], orange: teams.orange }
      : { black: teams.black, orange: [...teams.orange, player] }
    setTeams(nextTeams)
    const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
    const teamIds = new Set<number>([...nextTeams.black.map(p => p.id), ...nextTeams.orange.map(p => p.id)])
    const benchPlayers = players.filter(p => presentIds.includes(p.id) && !teamIds.has(p.id))
    setBench(benchPlayers)
    try { localStorage.setItem('matchBench', JSON.stringify(Array.from(new Set(benchPlayers.map(p => p.id))))) } catch { void 0 }
  }
  const removeFromTeam = (team: 'black'|'orange', playerId: number) => {
    const nextTeams = team === 'black'
      ? { black: teams.black.filter(p => p.id !== playerId), orange: teams.orange }
      : { black: teams.black, orange: teams.orange.filter(p => p.id !== playerId) }
    setTeams(nextTeams)
    const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
    const teamIds = new Set<number>([...nextTeams.black.map(p => p.id), ...nextTeams.orange.map(p => p.id)])
    const benchPlayers = players.filter(p => presentIds.includes(p.id) && !teamIds.has(p.id))
    setBench(benchPlayers)
    try { localStorage.setItem('matchBench', JSON.stringify(Array.from(new Set(benchPlayers.map(p => p.id))))) } catch { void 0 }
  }
  const prefillNextMatch = async () => {
    try {
      const targetDate = dateOnly(currentSundayDate)
      const finishedToday = matches.filter(m => {
        const md = dateOnly(m.match_date)
        return m.status === 'finished' && !!targetDate && md === targetDate
      })
      if (!finishedToday.length) {
        toast.error('Nenhuma partida finalizada para rodízio')
        return
      }
      const last = finishedToday[0]
      const det = await api.get(`/api/matches/${last.id}`)
      const statsResp = await api.get(`/api/matches/${last.id}/stats`).catch(() => ({ data: { stats: [] } }))
      const parts = Array.isArray(det.data?.match?.participants) ? det.data.match.participants as Array<{ team: 'black'|'orange'; player_id: number }> : []
      const getWinnerColor = (m: Match): 'black'|'orange'|null => {
        const raw = typeof m.winning_team === 'string' ? m.winning_team : 'draw'
        if (raw === 'orange') return 'orange'
        if (raw === 'black') return 'black'
        if (m.tie_decider_winner === 'orange' || m.tie_decider_winner === 'black') return m.tie_decider_winner
        return null
      }
      const lastWinner = getWinnerColor(last)
      const orangeCounter = Number((det.data?.match as { team_orange_win_streak?: number })?.team_orange_win_streak || 0)
      const blackCounter = Number((det.data?.match as { team_black_win_streak?: number })?.team_black_win_streak || 0)
      const presentIdsAll = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
      const presentCountAll = presentIdsAll.length
      const winnerCounter = lastWinner === 'black' ? blackCounter : lastWinner === 'orange' ? orangeCounter : 0
      // Terceira consecutiva do vencedor: ambos saem, sem pré-preencher
      if (winnerCounter >= 2) {
        setRodizioMode(false)
        setRodizioWinnerColor(null)
        setSelectedPlayers([])
        setSelectedChallengers([])
        setTeams({ black: [], orange: [] })
        setShowForm(true)
        const benchIdsAll = Array.from(new Set<number>([
          ...teams.black.map(p => p.id),
          ...teams.orange.map(p => p.id),
          ...bench.map(p => p.id)
        ]))
        setBench(players.filter(p => benchIdsAll.includes(p.id)))
        try {
          localStorage.setItem('matchTeams', JSON.stringify({ black: [], orange: [] }))
          localStorage.setItem('matchBench', JSON.stringify(benchIdsAll))
        } catch { void 0 }
        toast.success('Terceira vitória consecutiva: ambos os times saem. Selecione manualmente.')
        return
      }
      const isDraw = (typeof last.winning_team === 'string' ? last.winning_team : 'draw') === 'draw'
      if (isDraw && presentCountAll > 17) {
        setRodizioMode(false)
        setRodizioWinnerColor(null)
        setSelectedPlayers([])
        setSelectedChallengers([])
        setTeams({ black: [], orange: [] })
        setShowForm(true)
        const benchIdsAll = Array.from(new Set<number>([
          ...teams.black.map(p => p.id),
          ...teams.orange.map(p => p.id),
          ...bench.map(p => p.id)
        ]))
        setBench(players.filter(p => benchIdsAll.includes(p.id)))
        try {
          localStorage.setItem('matchTeams', JSON.stringify({ black: [], orange: [] }))
          localStorage.setItem('matchBench', JSON.stringify(benchIdsAll))
        } catch { void 0 }
        toast.success('Empate com muitos presentes: ambos os times saem. Selecione manualmente.')
        return
      }
      let remainTeam: 'black'|'orange'|null = null
      if (manyPresentRuleEnabled && presentCountAll > 17) {
        remainTeam = lastWinner
      } else {
        remainTeam = null
      }
      const winnerColor = remainTeam || lastWinner
      if (!winnerColor) {
        setRodizioMode(false)
        setRodizioWinnerColor(null)
        setSelectedPlayers([])
        setSelectedChallengers([])
        setTeams({ black: [], orange: [] })
        setShowForm(true)
        const benchIdsAll = Array.from(new Set<number>([
          ...teams.black.map(p => p.id),
          ...teams.orange.map(p => p.id),
          ...bench.map(p => p.id)
        ]))
        setBench(players.filter(p => benchIdsAll.includes(p.id)))
        try {
          localStorage.setItem('matchTeams', JSON.stringify({ black: [], orange: [] }))
          localStorage.setItem('matchBench', JSON.stringify(benchIdsAll))
        } catch { void 0 }
        toast.success('Sem vencedor definido: selecione manualmente.')
        return
      }
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
      const todaySunday = nextSundayDate()
      const byDate = (sundaysRaw as Array<{ sunday_id: number; date: string }>).find(s => dateOnly(String(s.date || '')) === todaySunday)
      let latestSundayId = byDate?.sunday_id
      if (!latestSundayId) {
        const createResp = await api.post('/api/sundays', { date: todaySunday })
        latestSundayId = createResp.data?.sunday?.sunday_id
      }
      if (!latestSundayId) {
        toast.error('Falha ao localizar ou criar o domingo atual')
        return
      }
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
        orange_team: teams.orange.map(p => p.id),
        apply_many_present_rule: manyPresentRuleEnabled
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
        setConsecutiveUnchanged({ black: Number(blackSt), orange: Number(orangeSt) })
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

  const [manyPresentRuleEnabled, setManyPresentRuleEnabled] = useState<boolean>(true)
  const [auditModalOpen, setAuditModalOpen] = useState(false)

  // Carregar configuração inicial do servidor
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const resp = await api.get('/api/auth/config')
        if (typeof resp.data?.manyPresentRuleEnabled === 'boolean') {
          setManyPresentRuleEnabled(resp.data.manyPresentRuleEnabled)
        }
      } catch (error) {
        console.error('Erro ao carregar configurações:', error)
      }
    }
    loadConfig()
  }, [])

  // Atualizar servidor quando houver mudança
  const toggleManyPresentRule = async () => {
    const newValue = !manyPresentRuleEnabled
    setManyPresentRuleEnabled(newValue)
    try {
      await api.put('/api/auth/config', { many_present_rule_enabled: newValue })
    } catch (error) {
      console.error('Erro ao salvar configuração:', error)
      toast.error('Erro ao salvar configuração no servidor')
      // Reverter em caso de erro
      setManyPresentRuleEnabled(!newValue)
    }
  }
  const adjustStreak = (team: 'black'|'orange', delta: number) => {
    if (!currentMatchId) return
    const next = { black: Number(consecutiveUnchanged.black || 0), orange: Number(consecutiveUnchanged.orange || 0) }
    if (team === 'black') {
      next.black = Math.max(0, Math.floor(next.black + delta))
    } else {
      next.orange = Math.max(0, Math.floor(next.orange + delta))
    }
    const submit = async () => {
      try {
        const resp = await api.post(`/api/matches/${currentMatchId}/win-streak`, { black: next.black, orange: next.orange })
        const s = (resp.data?.streak || next) as { black: number; orange: number }
        setConsecutiveUnchanged({ black: Number(s.black || 0), orange: Number(s.orange || 0) })
        toast.success('Sequência atualizada no servidor')
      } catch {
        toast.error('Falha ao atualizar sequência no servidor')
      }
    }
    submit()
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

  const confirmFinishMatch = async () => {
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
      setAuditModalOpen(false)
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

  const handleFinishClick = () => {
    setAuditModalOpen(true)
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
          orange_team: nextOrangeIds,
          apply_many_present_rule: manyPresentRuleEnabled
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
          orange_team: nextOrangeIds,
          apply_many_present_rule: manyPresentRuleEnabled
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
  useEffect(() => {
    if (detailsModal.open) {
      setEditBlackScore(String(detailsModal.black_score ?? ''))
      setEditOrangeScore(String(detailsModal.orange_score ?? ''))
    } else {
      setEditBlackScore('')
      setEditOrangeScore('')
    }
  }, [detailsModal.open, detailsModal.black_score, detailsModal.orange_score])
  const saveEditedScore = async () => {
    if (!detailsModal.matchId) return
    try {
      const orange = Math.max(0, Number(editOrangeScore || 0))
      const black = Math.max(0, Number(editBlackScore || 0))
      await api.post(`/api/matches/${detailsModal.matchId}/adjust-score`, {
        orange_score: orange,
        black_score: black
      })
      toast.success('Placar ajustado')
      setDetailsModal(prev => ({ ...prev, black_score: black, orange_score: orange }))
      await fetchData()
    } catch {
      toast.error('Erro ao ajustar placar')
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
    // A lógica de tick foi movida para useMatchTimer
  }, [matchInProgress, currentMatch?.startTime])

  useEffect(() => {
    // A lógica de SSE foi movida para useMatchSocket.
    // Este useEffect vazio é mantido temporariamente para garantir que não quebramos a estrutura
    // até removermos completamente o código antigo na próxima etapa.
  }, [matchInProgress, currentMatchId])
  useEffect(() => {
    // A lógica de cronômetro foi movida para useMatchTimer
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
        // const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number) // removido por não uso
        // const presentCount = presentIds.length // removido
        const leavingIdsAll = [...currentBlackIds, ...currentOrangeIds]
        const newBenchIds = Array.from(new Set<number>([...benchIdsAll, ...leavingIdsAll]))
        
        // Se a regra de sair os dois estiver ligada (manyPresentRuleEnabled)
        if (manyPresentRuleEnabled) {
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
          toast.info('Regra de sair os dois ativa: ambos os times saem no empate.')
          ;(async () => {
            try {
              if (currentMatchId) {
                const resp = await api.post(`/api/matches/${currentMatchId}/win-streak`, { black: 0, orange: 0 })
                const s = (resp.data?.streak || { black: 0, orange: 0 }) as { black: number; orange: number }
                setConsecutiveUnchanged({ black: Number(s.black || 0), orange: Number(s.orange || 0) })
              }
            } catch { void 0 }
          })()
          return
        }

        setTieModal({ open: true, winner: null })
        return
      }
      const loser: 'black' | 'orange' = blackScore > orangeScore ? 'orange' : 'black'
      const winner: 'black' | 'orange' = loser === 'black' ? 'orange' : 'black'
      const presentIds = Object.keys(presentMap).filter(id => presentMap[Number(id)]).map(Number)
      const winnerCount = Math.max(0, Math.floor(consecutiveUnchanged[winner] || 0))
      const leaveSide: 'black'|'orange' = winnerCount >= 2 ? winner : loser
      const staySide: 'black'|'orange' = leaveSide === 'black' ? 'orange' : 'black'
      const outgoingLeaveIds = teams[leaveSide].map(p => p.id)
      const newBenchBase = Array.from(new Set<number>([...benchIdsAll, ...outgoingLeaveIds]))
      if (winnerCount >= 2) {
        const leavingBoth = [...teams.black.map(p => p.id), ...teams.orange.map(p => p.id)]
        const newBenchIds = Array.from(new Set<number>([...benchIdsAll, ...leavingBoth]))
        setTeams({ black: [], orange: [] })
        setBench(players.filter(p => newBenchIds.includes(p.id)))
        localStorage.setItem('matchTeams', JSON.stringify({ black: [], orange: [] }))
        localStorage.setItem('matchBench', JSON.stringify(newBenchIds))
        setRodizioMode(false)
        setSelectedPlayers([])
        setSelectedChallengers([])
        setShowForm(true)
        setRotationApplied('full')
        toast.success('Terceira partida do vencedor: ambos os times saem. Selecione manualmente.')
        ;(async () => {
          try {
            if (currentMatchId) {
              const resp = await api.post(`/api/matches/${currentMatchId}/win-streak`, { black: 0, orange: 0 })
              const s = (resp.data?.streak || { black: 0, orange: 0 }) as { black: number; orange: number }
              setConsecutiveUnchanged({ black: Number(s.black || 0), orange: Number(s.orange || 0) })
            }
          } catch { void 0 }
        })()
        return
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
        toast.success('Derrota: perdedor sai. Selecione os desafiantes manualmente.')
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
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div className="h-8 w-40 bg-gray-200 rounded animate-pulse"></div>
          <div className="flex space-x-2">
            <div className="h-10 w-32 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-10 w-32 bg-gray-200 rounded animate-pulse"></div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow p-6 h-64 animate-pulse">
              <div className="flex justify-between items-center mb-4">
                <div className="h-4 w-20 bg-gray-200 rounded"></div>
                <div className="h-6 w-16 bg-gray-200 rounded"></div>
              </div>
              <div className="flex justify-between items-center my-6">
                <div className="h-12 w-12 bg-gray-200 rounded-full"></div>
                <div className="h-8 w-16 bg-gray-200 rounded"></div>
                <div className="h-12 w-12 bg-gray-200 rounded-full"></div>
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full bg-gray-200 rounded"></div>
                <div className="h-4 w-3/4 bg-gray-200 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {matchInProgress && (
        <div className="w-full">
          <ScoreBoard
            blackScore={currentMatch?.blackScore || 0}
            orangeScore={currentMatch?.orangeScore || 0}
            tick={tick}
            matchDurationMin={matchDurationMin}
            matchInProgress={matchInProgress}
            consecutiveUnchanged={consecutiveUnchanged}
            connectionStatus={connectionStatus}
            manyPresentRuleEnabled={manyPresentRuleEnabled}
            alarmMuted={alarmMuted}
            blackTeamAvg={teams.black.length ? teamOverallAvg(teams.black) : 0}
            orangeTeamAvg={teams.orange.length ? teamOverallAvg(teams.orange) : 0}
            onUpdateScore={updateScore}
            onAdjustStreak={adjustStreak}
            onFinishMatch={handleFinishClick}
            onToggleManyRule={toggleManyPresentRule}
            onToggleAlarm={() => {
              const next = !alarmMuted
              setAlarmMuted(next)
              try {
                if (next) localStorage.setItem('matchAlarmMuted', '1')
                else localStorage.removeItem('matchAlarmMuted')
              } catch { void 0 }
            }}
          />
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
            <div className="flex justify-end mt-6">
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
                    const benchIdsAll = bench.map(p => p.id)
                    const leavingIds = teams[leaveSide].map(p => p.id)
                    const newBenchIds = Array.from(new Set<number>([...benchIdsAll, ...leavingIds]))
                    const newTeams = { black: leaveSide === 'black' ? [] : teams.black, orange: leaveSide === 'orange' ? [] : teams.orange }
                    setTeams(newTeams)
                    const newBenchPlayers = players.filter(p => newBenchIds.includes(p.id))
                    setBench(newBenchPlayers)
                    try {
                      localStorage.setItem('matchTeams', JSON.stringify({ black: newTeams.black.map(p => p.id), orange: newTeams.orange.map(p => p.id) }))
                      localStorage.setItem('matchBench', JSON.stringify(newBenchIds))
                    } catch { void 0 }
                    setRodizioMode(true)
                    setRodizioWinnerColor(stay)
                    setSelectedChallengers([])
                    setShowForm(true)
                    toast.success('Empate: perdedor sai. Selecione os desafiantes manualmente.')
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
          const targetDate = dateOnly(currentSundayDate)
          const hasFinishedToday = matches.some(m => {
            const md = dateOnly(m.match_date)
            return m.status === 'finished' && !!targetDate && md === targetDate
          })
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
              Criar Partida
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
                onClick={handleFinishClick}
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
            <h3 className="text-lg font-medium text-gray-900 mb-3">{rodizioMode ? 'Selecione os Desafiantes' : `Selecione os Jogadores (${selectedCount}/10)`}</h3>
            <PlayerSelectionGrid
              players={players}
              teams={teams}
              selectedPlayers={selectedPlayers}
              presentMap={presentMap}
              rodizioMode={rodizioMode}
              rodizioWinnerColor={rodizioWinnerColor}
              isFirstMatchToday={isFirstMatchToday}
              onPlayerSelection={handlePlayerSelection}
              onAddToTeam={addToTeam}
            />
          </div>

          {/* Team Sorting */}
          <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">Times</h3>
                <div className="flex items-center space-x-2">
                  {!rodizioMode && isFirstMatchToday && (
                    <button
                      ref={sortButtonRef}
                      onClick={sortTeams}
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-success-600 hover:bg-success-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success-500"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Sortear Times
                    </button>
                  )}
                </div>
              </div>
              {/* Lista manual removida: botões Preto/Laranja agora estão na seleção acima */}
              
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


          {/* Match Controls */}
          {teams.black.length > 0 && teams.orange.length > 0 && (
            <div className="border-t pt-6">
              {!matchInProgress ? (
                <button
                  ref={startMatchButtonRef}
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
                    onClick={handleFinishClick}
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
                {isAdmin && (
                  <div className="bg-white rounded-lg p-4 border md:col-span-2">
                    <div className="text-sm font-semibold text-gray-900 mb-2">Editar placar</div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-black text-white text-[10px] font-bold">PRETO</span>
                        <input
                          type="number"
                          min={0}
                          value={editBlackScore}
                          onChange={(e) => setEditBlackScore(e.target.value)}
                          className="w-24 px-2 py-1 border border-gray-300 rounded-md"
                        />
                      </div>
                      <span className="text-sm text-gray-600">x</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          value={editOrangeScore}
                          onChange={(e) => setEditOrangeScore(e.target.value)}
                          className="w-24 px-2 py-1 border border-gray-300 rounded-md"
                        />
                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-orange-500 text-white text-[10px] font-bold">LARANJA</span>
                      </div>
                      <button
                        onClick={saveEditedScore}
                        className="ml-auto px-3 py-1.5 rounded-md bg-primary-600 text-white text-sm"
                      >
                        Salvar placar
                      </button>
                    </div>
                  </div>
                )}
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
      <AuditModal
        isOpen={auditModalOpen}
        onClose={() => setAuditModalOpen(false)}
        onConfirm={confirmFinishMatch}
        currentMatch={currentMatch}
        tick={tick}
        matchStats={matchStats}
        players={players}
        manyPresentRuleEnabled={manyPresentRuleEnabled}
      />
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
