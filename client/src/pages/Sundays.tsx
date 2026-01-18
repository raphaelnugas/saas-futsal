import React, { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Plus, Calendar, Users, CheckCircle, XCircle, Clock, Trash2, BookOpen, Share2 } from 'lucide-react'
import api from '../services/api'
import { logError } from '../services/logger'
import FifaPlayerCard from '../components/FifaPlayerCard'
import html2canvas from 'html2canvas'

interface Player {
  id: number
  name: string
  position: string
}

interface Sunday {
  id: number
  sunday_date: string
  status: 'scheduled' | 'in_progress' | 'completed'
  total_players: number
  created_at: string
  craque_player_id?: number | null
}

interface Attendance {
  player_id: number
  is_present: boolean
  arrival_time?: string
}

type ApiSundayRow = {
  sunday_id: number
  date: string
  total_attendees?: number
  total_matches?: number
  created_at: string
  craque_player_id?: number | null
}

type ApiPlayerRow = {
  player_id: number
  name: string
  is_goalkeeper?: boolean
}

type ApiAttendanceRow = {
  player_id: number
  is_present: boolean
  arrival_time?: string | null
  arrival_order?: number | null
}

const Sundays: React.FC = () => {
  const parseSundayDate = (dateStr: string) => {
    const s = String(dateStr || '')
    if (!s) return new Date(NaN)
    // Se vier apenas 'YYYY-MM-DD', interpretar em horário local
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s)
    if (isDateOnly) return new Date(`${s}T00:00:00`)
    // Se vier timestamp (com 'T' ou 'Z'), extrair apenas a parte da data e interpretar local
    const match = s.match(/^(\d{4}-\d{2}-\d{2})/)
    if (match) return new Date(`${match[1]}T00:00:00`)
    // Fallback
    return new Date(s.replace(' ', 'T'))
  }

  const [sundays, setSundays] = useState<Sunday[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedSunday, setSelectedSunday] = useState<Sunday | null>(null)
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [showAttendance, setShowAttendance] = useState(false)
  const [deletingSundayId, setDeletingSundayId] = useState<number | null>(null)
  const [confirmDeleteSunday, setConfirmDeleteSunday] = useState<Sunday | null>(null)
  const [showSummary, setShowSummary] = useState(false)
  const [summarySunday, setSummarySunday] = useState<Sunday | null>(null)
  const [summaryRows, setSummaryRows] = useState<Array<{ player_id: number; name: string; goals: number; assists: number }>>([])
  const [summaryTotals, setSummaryTotals] = useState<{ goals: number; assists: number }>({ goals: 0, assists: 0 })
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [craquePhotos, setCraquePhotos] = useState<Record<number, string>>({})
  const [craqueBadgeUrl, setCraqueBadgeUrl] = useState<string>('')
  const [craqueStats, setCraqueStats] = useState<Record<number, { goals: number; assists: number; wins: number }>>({})
  const [showStats, setShowStats] = useState(false)
  const [statsSunday, setStatsSunday] = useState<Sunday | null>(null)
  const [statsRows, setStatsRows] = useState<Array<{ player_id: number; name: string; matches: number; goals: number; assists: number; wins: number; conceded: number }>>([])
  const [statsTotals, setStatsTotals] = useState<{ goals: number; assists: number }>({ goals: 0, assists: 0 })
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsSharing, setStatsSharing] = useState(false)
  const statsCaptureRef = useRef<HTMLDivElement | null>(null)
  const [craqueModalOpen, setCraqueModalOpen] = useState(false)
  const [craqueDetails, setCraqueDetails] = useState<{
    name: string
    overall: number
    role: string
    photo2Url?: string
    badgeUrl?: string
    stats: { ofe: number; def: number; tec: number; for: number; vel: number; pot: number }
    templateUrl: string
  } | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [sundaysResponse, playersResponse] = await Promise.all([
        api.get('/api/sundays'),
        api.get('/api/players')
      ])
      const apiSundays = (sundaysResponse.data?.sundays || []) as ApiSundayRow[]
      const sundaysList = apiSundays.map((s: ApiSundayRow, index: number) => {
        const isMostRecent = index === 0
        const hasMatches = Number(s.total_matches || 0) > 0
        const status: Sunday['status'] = isMostRecent
          ? (hasMatches ? 'in_progress' : 'scheduled')
          : 'completed'
        return {
          id: s.sunday_id,
          sunday_date: s.date,
          status,
          total_players: Number(s.total_attendees || 0),
          created_at: s.created_at,
          craque_player_id: s.craque_player_id || null
        }
      })
      const apiPlayers = (playersResponse.data?.players || []) as ApiPlayerRow[]
      const playersList = apiPlayers.map((p: ApiPlayerRow) => ({
        id: p.player_id,
        name: p.name,
        position: p.is_goalkeeper ? 'Goleiro' : 'Jogador'
      }))
      setSundays(sundaysList)
      setPlayers(playersList)
      const withCraque = sundaysList.filter(s => Number.isFinite(Number(s.craque_player_id)) && Number(s.craque_player_id) > 0)
      if (withCraque.length) {
        const updates: Record<number, string> = {}
        await Promise.all(withCraque.map(async (s) => {
          try {
            const resp = await api.get(`/api/players/${s.craque_player_id}/photo`, { responseType: 'arraybuffer' })
            const mime = resp.headers['content-type'] || 'image/jpeg'
            const bytes = new Uint8Array(resp.data as ArrayBuffer)
            let bin = ''
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
            const base64 = btoa(bin)
            updates[s.id] = `data:${mime};base64,${base64}`
          } catch { /* ignore */ }
        }))
        setCraquePhotos(prev => ({ ...prev, ...updates }))
      }
      try {
        const badgeResp = await api.get('/api/assets/craque-badge', { responseType: 'arraybuffer' })
        const mime = badgeResp.headers['content-type'] || 'image/png'
        const bytes = new Uint8Array(badgeResp.data as ArrayBuffer)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        const base64 = btoa(bin)
        setCraqueBadgeUrl(`data:${mime};base64,${base64}`)
      } catch { setCraqueBadgeUrl('') }
    } catch (error: unknown) {
      toast.error('Erro ao carregar dados')
      const status = typeof error === 'object' && error && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined
      const message = typeof error === 'object' && error && 'message' in error
        ? (error as { message?: string }).message
        : undefined
      logError('sundays_load_error', { status, message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const run = async () => {
      const targets = sundays.filter(s => Number.isFinite(Number(s.craque_player_id)) && Number(s.craque_player_id) > 0)
      if (!targets.length) return
      await Promise.all(targets.map(s => computeCraqueStatsForSunday(s.id, Number(s.craque_player_id))))
    }
    run()
  }, [sundays])

  const openCraqueModal = async (playerId?: number | null) => {
    if (!playerId) return
    try {
      const playerResp = await api.get(`/api/players/${playerId}`)
      const p = playerResp.data?.player
      if (!p) {
        toast.error('Jogador não encontrado')
        return
      }
      let photo2Url = ''
      try {
        const photo2Resp = await api.get(`/api/players/${playerId}/photo2`, { responseType: 'arraybuffer' })
        const mime = photo2Resp.headers['content-type'] || 'image/jpeg'
        const bytes = new Uint8Array(photo2Resp.data as ArrayBuffer)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        const base64 = btoa(bin)
        photo2Url = `data:${mime};base64,${base64}`
      } catch { photo2Url = '' }
      let templateUrl = ''
      try {
        const goldResp = await api.get('/api/assets/card-gold', { responseType: 'arraybuffer' })
        const mime = goldResp.headers['content-type'] || 'image/png'
        const bytes = new Uint8Array(goldResp.data as ArrayBuffer)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        const base64 = btoa(bin)
        templateUrl = `data:${mime};base64,${base64}`
      } catch { templateUrl = '' }
      let badgeUrl = ''
      try {
        const badgeResp = await api.get('/api/assets/craque-badge', { responseType: 'arraybuffer' })
        const mime = badgeResp.headers['content-type'] || 'image/png'
        const bytes = new Uint8Array(badgeResp.data as ArrayBuffer)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        const base64 = btoa(bin)
        badgeUrl = `data:${mime};base64,${base64}`
      } catch { badgeUrl = '' }
      const role = p.is_goalkeeper ? 'GOLEIRO' : 'LINHA'
      const overall = Math.round(
        ((Number(p.attr_ofe || 50) + Number(p.attr_def || 50) + Number(p.attr_vel || 50) + Number(p.attr_tec || 50) + Number(p.attr_for || 50) + Number(p.attr_pot || 50)) / 6)
      )
      setCraqueDetails({
        name: String(p.name || ''),
        overall,
        role,
        photo2Url,
        badgeUrl,
        templateUrl,
        stats: {
          ofe: Number(p.attr_ofe || 50),
          def: Number(p.attr_def || 50),
          tec: Number(p.attr_tec || 50),
          for: Number(p.attr_for || 50),
          vel: Number(p.attr_vel || 50),
          pot: Number(p.attr_pot || 50),
        }
      })
      setCraqueModalOpen(true)
    } catch {
      toast.error('Erro ao carregar craque do domingo')
    }
  }

  const handleCreateSunday = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      await api.post('/api/sundays', { date: selectedDate })
      toast.success('Domingo criado com sucesso!')
      setShowForm(false)
      setSelectedDate('')
      fetchData()
    } catch (error) {
      toast.error('Erro ao criar domingo')
    }
  }

  const handleManageAttendance = async (sunday: Sunday) => {
    setSelectedSunday(sunday)
    setShowAttendance(true)
    
    try {
      const response = await api.get(`/api/sundays/${sunday.id}/attendances`)
      const rows: ApiAttendanceRow[] = Array.isArray(response.data?.attendances)
        ? (response.data.attendances as ApiAttendanceRow[])
        : Array.isArray(response.data)
          ? (response.data as ApiAttendanceRow[])
          : []
      const normalized = rows.map((a: ApiAttendanceRow) => ({
        player_id: Number(a.player_id),
        is_present: !!a.is_present,
        arrival_time: undefined
      }))
      setAttendance(normalized)
    } catch (error) {
      toast.error('Erro ao carregar presenças')
      // Initialize with all players absent
      setAttendance(players.map(player => ({
        player_id: player.id,
        is_present: false
      })))
    }
  }

  const updateAttendance = (playerId: number, isPresent: boolean) => {
    setAttendance(prev => {
      const existing = prev.find(a => a.player_id === playerId)
      if (existing) {
        return prev.map(a => 
          a.player_id === playerId 
            ? { ...a, is_present: isPresent, arrival_time: isPresent ? new Date().toISOString() : undefined }
            : a
        )
      } else {
        return [...prev, {
          player_id: playerId,
          is_present: isPresent,
          arrival_time: isPresent ? new Date().toISOString() : undefined
        }]
      }
    })
  }

  const saveAttendance = async () => {
    if (!selectedSunday) return

    try {
      const presentPlayers = attendance.filter(a => a.is_present)
      const payload = attendance.map(a => {
        const base: Record<string, unknown> = {
          player_id: a.player_id,
          is_present: a.is_present
        }
        if (a.is_present) {
          const order = presentPlayers.findIndex(p => p.player_id === a.player_id) + 1
          if (order > 0) base.arrival_order = order
        }
        return base
      })
      await api.post(`/api/sundays/${selectedSunday.id}/attendances`, { attendance: payload })
      toast.success('Presenças atualizadas com sucesso!')
      setShowAttendance(false)
      setSelectedSunday(null)
      setAttendance([])
      fetchData()
    } catch (error) {
      toast.error('Erro ao salvar presenças')
    }
  }

  const handleDeleteSunday = async (sunday: Sunday) => {
    try {
      setDeletingSundayId(sunday.id)
      await api.delete(`/api/sundays/${sunday.id}`)
      toast.success('Domingo apagado com sucesso!')
      await fetchData()
    } catch (err: unknown) {
      toast.error('Erro ao apagar domingo')
      const status = typeof err === 'object' && err && 'response' in err
        ? (err as { response?: { status?: number } }).response?.status
        : undefined
      const message = typeof err === 'object' && err && 'message' in err
        ? (err as { message?: string }).message
        : undefined
      logError('sunday_delete_error', { sunday_id: sunday.id, status, message })
    } finally {
      setDeletingSundayId(null)
    }
  }

  const handleOpenSummary = async (sunday: Sunday) => {
    try {
      setSummaryLoading(true)
      setSummarySunday(sunday)
      setShowSummary(true)
      const respSunday = await api.get(`/api/sundays/${sunday.id}`)
      const matches = Array.isArray(respSunday.data?.sunday?.matches) ? respSunday.data.sunday.matches as Array<{ match_id: number; match_number: number }> : []
      const summaryMatch = matches.find(m => Number(m.match_number) === 0)
      if (!summaryMatch) {
        setSummaryRows([])
        setSummaryTotals({ goals: 0, assists: 0 })
        return
      }
      const statsResp = await api.get(`/api/matches/${summaryMatch.match_id}/stats`)
      const stats = Array.isArray(statsResp.data?.stats) ? statsResp.data.stats as Array<{ player_scorer_id: number | null; player_assist_id: number | null; event_type?: string }> : []
      const onlySummary = stats.filter(s => String(s.event_type || 'goal') === 'summary_goal')
      const goalsMap = new Map<number, number>()
      const assistsMap = new Map<number, number>()
      for (const s of onlySummary) {
        if (Number.isFinite(s.player_scorer_id) && Number(s.player_scorer_id) > 0) {
          const pid = Number(s.player_scorer_id)
          goalsMap.set(pid, (goalsMap.get(pid) || 0) + 1)
        }
        if (Number.isFinite(s.player_assist_id) && Number(s.player_assist_id) > 0) {
          const pid = Number(s.player_assist_id)
          assistsMap.set(pid, (assistsMap.get(pid) || 0) + 1)
        }
      }
      const ids = Array.from(new Set([...goalsMap.keys(), ...assistsMap.keys()]))
      const nameById = new Map<number, string>()
      for (const p of players) {
        nameById.set(p.id, p.name)
      }
      const rows = ids.map(pid => ({
        player_id: pid,
        name: nameById.get(pid) || `Jogador ${pid}`,
        goals: goalsMap.get(pid) || 0,
        assists: assistsMap.get(pid) || 0
      })).sort((a, b) => (b.goals - a.goals) || (b.assists - a.assists) || (a.name.localeCompare(b.name)))
      const totals = {
        goals: rows.reduce((acc, r) => acc + r.goals, 0),
        assists: rows.reduce((acc, r) => acc + r.assists, 0)
      }
      setSummaryRows(rows)
      setSummaryTotals(totals)
    } catch {
      toast.error('Erro ao carregar súmula')
      setSummaryRows([])
      setSummaryTotals({ goals: 0, assists: 0 })
    } finally {
      setSummaryLoading(false)
    }
  }

  const handleOpenStats = async (sunday: Sunday) => {
    try {
      setStatsLoading(true)
      setStatsSunday(sunday)
      setShowStats(true)
      const matchesResp = await api.get(`/api/sundays/${sunday.id}/matches`)
      const matches = Array.isArray(matchesResp.data?.matches)
        ? matchesResp.data.matches as Array<{ match_id: number; match_number: number; status: string; team_orange_score: number; team_black_score: number }>
        : []
      const realMatches = matches.filter(m => Number(m.match_number) > 0)
      const byPlayer = new Map<number, { player_id: number; name: string; matches: number; goals: number; assists: number; wins: number; conceded: number }>()
      const nameById = new Map<number, string>()
      for (const p of players) nameById.set(p.id, p.name)
      await Promise.all(realMatches.map(async (m) => {
        const [matchResp, statsResp] = await Promise.all([
          api.get(`/api/matches/${m.match_id}`),
          api.get(`/api/matches/${m.match_id}/stats`)
        ])
        const participants = Array.isArray(matchResp.data?.match?.participants)
          ? matchResp.data.match.participants as Array<{ player_id: number; team: 'orange' | 'black' }>
          : []
        const stats = Array.isArray(statsResp.data?.stats)
          ? statsResp.data.stats as Array<{ player_scorer_id: number | null; player_assist_id: number | null; event_type?: string; is_own_goal?: boolean }>
          : []
        for (const part of participants) {
          const pid = Number(part.player_id)
          if (!Number.isFinite(pid) || pid <= 0) continue
          const entry = byPlayer.get(pid) || { player_id: pid, name: nameById.get(pid) || `Jogador ${pid}`, matches: 0, goals: 0, assists: 0, wins: 0, conceded: 0 }
          entry.matches += 1
          if (String(m.status) === 'finished') {
            const opponentTeam = part.team === 'orange' ? m.team_black_score : m.team_orange_score
            entry.conceded += opponentTeam
            const winnerTeam = String(matchResp.data?.match?.winner_team || 'draw')
            if (winnerTeam !== 'draw' && winnerTeam === String(part.team)) {
              entry.wins += 1
            }
          }
          byPlayer.set(pid, entry)
        }
        for (const s of stats) {
          if (String(s.event_type || 'goal') === 'goal') {
            if (!s.is_own_goal && Number.isFinite(Number(s.player_scorer_id)) && Number(s.player_scorer_id) > 0) {
              const pid = Number(s.player_scorer_id)
              const entry = byPlayer.get(pid) || { player_id: pid, name: nameById.get(pid) || `Jogador ${pid}`, matches: 0, goals: 0, assists: 0, wins: 0, conceded: 0 }
              entry.goals += 1
              byPlayer.set(pid, entry)
            }
            if (Number.isFinite(Number(s.player_assist_id)) && Number(s.player_assist_id) > 0) {
              const pid = Number(s.player_assist_id)
              const entry = byPlayer.get(pid) || { player_id: pid, name: nameById.get(pid) || `Jogador ${pid}`, matches: 0, goals: 0, assists: 0, wins: 0, conceded: 0 }
              entry.assists += 1
              byPlayer.set(pid, entry)
            }
          }
        }
      }))
      const summaryMatch = matches.find(m => Number(m.match_number) === 0)
      if (summaryMatch) {
        const statsResp = await api.get(`/api/matches/${summaryMatch.match_id}/stats`)
        const stats = Array.isArray(statsResp.data?.stats)
          ? statsResp.data.stats as Array<{ player_scorer_id: number | null; player_assist_id: number | null; event_type?: string }>
          : []
        const onlySummary = stats.filter(s => String(s.event_type || 'goal') === 'summary_goal')
        for (const s of onlySummary) {
          if (Number.isFinite(Number(s.player_scorer_id)) && Number(s.player_scorer_id) > 0) {
            const pid = Number(s.player_scorer_id)
            const entry = byPlayer.get(pid) || { player_id: pid, name: nameById.get(pid) || `Jogador ${pid}`, matches: 0, goals: 0, assists: 0, wins: 0, conceded: 0 }
            entry.goals += 1
            byPlayer.set(pid, entry)
          }
          if (Number.isFinite(Number(s.player_assist_id)) && Number(s.player_assist_id) > 0) {
            const pid = Number(s.player_assist_id)
            const entry = byPlayer.get(pid) || { player_id: pid, name: nameById.get(pid) || `Jogador ${pid}`, matches: 0, goals: 0, assists: 0, wins: 0, conceded: 0 }
            entry.assists += 1
            byPlayer.set(pid, entry)
          }
        }
      }
      const rows = Array.from(byPlayer.values()).filter(r => r.matches > 0 || r.goals > 0 || r.assists > 0 || r.wins > 0).sort((a, b) =>
        (b.wins - a.wins) ||
        (b.goals - a.goals) ||
        (b.assists - a.assists) ||
        (b.matches - a.matches) ||
        a.name.localeCompare(b.name)
      )
      const totals = {
        goals: rows.reduce((acc, r) => acc + r.goals, 0),
        assists: rows.reduce((acc, r) => acc + r.assists, 0)
      }
      setStatsRows(rows)
      setStatsTotals(totals)
    } catch {
      toast.error('Erro ao carregar estatísticas do domingo')
      setStatsRows([])
      setStatsTotals({ goals: 0, assists: 0 })
    } finally {
      setStatsLoading(false)
    }
  }

  const computeCraqueStatsForSunday = async (sundayId: number, playerId: number) => {
    try {
      const matchesResp = await api.get(`/api/sundays/${sundayId}/matches`)
      const matches = Array.isArray(matchesResp.data?.matches) ? matchesResp.data.matches as Array<{ match_id: number; match_number: number; status: string; winner_team?: 'orange' | 'black' | 'draw' | null }> : []
      let goals = 0
      let assists = 0
      let wins = 0
      const summaryMatch = matches.find(m => Number(m.match_number) === 0)
      if (summaryMatch) {
        const statsResp = await api.get(`/api/matches/${summaryMatch.match_id}/stats`)
        const stats = Array.isArray(statsResp.data?.stats) ? statsResp.data.stats as Array<{ player_scorer_id: number | null; player_assist_id: number | null; event_type?: string }> : []
        const onlySummary = stats.filter(s => String(s.event_type || 'goal') === 'summary_goal')
        for (const s of onlySummary) {
          if (Number.isFinite(Number(s.player_scorer_id)) && Number(s.player_scorer_id) === playerId) goals++
          if (Number.isFinite(Number(s.player_assist_id)) && Number(s.player_assist_id) === playerId) assists++
        }
      }
      const realMatches = matches.filter(m => Number(m.match_number) > 0)
      await Promise.all(realMatches.map(async (m) => {
        const statsResp = await api.get(`/api/matches/${m.match_id}/stats`)
        const stats = Array.isArray(statsResp.data?.stats) ? statsResp.data.stats as Array<{ player_scorer_id: number | null; player_assist_id: number | null; event_type?: string; is_own_goal?: boolean }> : []
        for (const s of stats) {
          if (String(s.event_type || 'goal') === 'goal') {
            if (!s.is_own_goal && Number.isFinite(Number(s.player_scorer_id)) && Number(s.player_scorer_id) === playerId) goals++
            if (Number.isFinite(Number(s.player_assist_id)) && Number(s.player_assist_id) === playerId) assists++
          }
        }
        if (String(m.status) === 'finished' && String(m.winner_team || 'draw') !== 'draw') {
          const matchResp = await api.get(`/api/matches/${m.match_id}`)
          const participants = Array.isArray(matchResp.data?.match?.participants) ? matchResp.data.match.participants as Array<{ player_id: number; team: 'orange' | 'black' }> : []
          const entry = participants.find(p => Number(p.player_id) === playerId)
          if (entry && String(entry.team) === String(m.winner_team)) wins++
        }
      }))
      setCraqueStats(prev => ({ ...prev, [sundayId]: { goals, assists, wins } }))
    } catch {
      setCraqueStats(prev => ({ ...prev, [sundayId]: { goals: 0, assists: 0, wins: 0 } }))
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800'
      case 'in_progress': return 'bg-yellow-100 text-yellow-800'
      case 'completed': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'scheduled': return 'Agendado'
      case 'in_progress': return 'Em andamento'
      case 'completed': return 'Encerrado'
      default: return status
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
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Domingos</h1>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo Domingo
        </button>
      </div>

      {/* Sundays Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sundays.map((sunday) => (
          <div key={sunday.id} className="bg-white rounded-lg shadow p-6 cursor-pointer" onClick={() => handleOpenStats(sunday)}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Calendar className="w-5 h-5 text-primary-600 mr-2" />
                <h3 className="text-xl font-bold text-gray-900">
                  {parseSundayDate(sunday.sunday_date).toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </h3>
              </div>
              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(sunday.status)}`}>
                {getStatusLabel(sunday.status)}
              </span>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center text-sm text-gray-600">
                <Users className="w-4 h-4 mr-2" />
                <span>{sunday.total_players} jogadores confirmados</span>
              </div>
              
              <div className="flex items-center text-sm text-gray-600">
                <Clock className="w-4 h-4 mr-2" />
                <span>Criado em {new Date(sunday.created_at).toLocaleDateString('pt-BR')}</span>
              </div>

              {Number.isFinite(Number(sunday.craque_player_id)) && Number(sunday.craque_player_id) > 0 ? (
                <div className="relative mt-4 bg-gray-50 rounded-md p-3">
                  <div className="flex items-center justify-center">
                    <button onClick={(e) => { e.stopPropagation(); openCraqueModal(sunday.craque_player_id) }} title="Ver craque do domingo">
                      {craquePhotos[sunday.id] ? (
                        <img
                          src={craquePhotos[sunday.id]}
                          alt="Craque do Domingo"
                          className="w-24 h-24 object-cover rounded-md border-2"
                          style={{ borderColor: '#FFD700' }}
                        />
                      ) : (
                        <div className="w-24 h-24 bg-gray-200 rounded-md" />
                      )}
                    </button>
                  </div>
                  <div className="mt-2 text-center text-sm text-gray-700">
                    {craqueStats[sunday.id] ? (
                      <span>
                        Gols: <span className="font-semibold">{craqueStats[sunday.id].goals}</span> • Assistências: <span className="font-semibold">{craqueStats[sunday.id].assists}</span> • Vitórias: <span className="font-semibold">{craqueStats[sunday.id].wins}</span>
                      </span>
                    ) : (
                      <span className="text-gray-500">Carregando…</span>
                    )}
                  </div>
                  {craqueBadgeUrl ? (
                    <img
                      src={craqueBadgeUrl}
                      alt="Selo Craque"
                      className="absolute -top-6 -right-6 w-32 h-32 z-10"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex space-x-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleManageAttendance(sunday) }}
                className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <Users className="w-4 h-4 mr-2" />
                Gerenciar Presenças
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleOpenSummary(sunday) }}
                className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                title="Visualizar súmula deste domingo"
              >
                <BookOpen className="w-4 h-4 mr-2" />
                Súmula
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteSunday(sunday) }}
                disabled={deletingSundayId === sunday.id}
                className={`inline-flex items-center justify-center px-3 py-2 border shadow-sm text-sm font-medium rounded-md ${
                  deletingSundayId === sunday.id
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'border-red-500 text-red-600 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500'
                }`}
                title="Apagar domingo"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {deletingSundayId === sunday.id ? 'Apagando...' : 'Apagar'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {sundays.length === 0 && (
        <div className="text-center py-12">
          <Calendar className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Nenhum domingo encontrado</h3>
          <p className="mt-1 text-sm text-gray-500">Comece criando um novo domingo</p>
        </div>
      )}

      {showStats && statsSunday && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6 relative">
              <div className="absolute right-4 top-4 flex items-center space-x-2">
                <button
                  onClick={async () => {
                    if (statsSharing) return
                    try {
                      setStatsSharing(true)
                      const el = statsCaptureRef.current
                      if (!el) throw new Error('no_element')
                      const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2 } as any)
                      const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
                      if (!blob) throw new Error('no_blob')
                      const fileName = `estatisticas_${parseSundayDate(statsSunday.sunday_date).toLocaleDateString('pt-BR')}.png`
                      const file = new File([blob], fileName, { type: 'image/png' })
                      const text = `Estatísticas do domingo ${parseSundayDate(statsSunday.sunday_date).toLocaleDateString('pt-BR')}`
                      if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({ files: [file], title: 'Estatísticas do Domingo', text })
                      } else {
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = fileName
                        document.body.appendChild(a)
                        a.click()
                        document.body.removeChild(a)
                        URL.revokeObjectURL(url)
                        const msg = encodeURIComponent(text)
                        window.open(`https://wa.me/?text=${msg}`, '_blank')
                      }
                    } catch {
                      toast.error('Falha ao compartilhar estatísticas')
                    } finally {
                      setStatsSharing(false)
                    }
                  }}
                  disabled={statsSharing}
                  className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium ${statsSharing ? 'bg-green-300 text-white cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
                  title="Enviar pelo WhatsApp"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  {statsSharing ? 'Gerando…' : 'Enviar pelo WhatsApp'}
                </button>
                <button
                  onClick={() => {
                    setShowStats(false)
                    setStatsSunday(null)
                    setStatsRows([])
                    setStatsTotals({ goals: 0, assists: 0 })
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
              <div ref={statsCaptureRef}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-gray-900">
                    Estatísticas — {parseSundayDate(statsSunday.sunday_date).toLocaleDateString('pt-BR')}
                  </h3>
                </div>
                {statsLoading ? (
                  <div className="text-sm text-gray-600">Carregando…</div>
                ) : (
                  <>
                    {statsRows.length === 0 ? (
                      <div className="text-sm text-gray-600">Nenhuma estatística registrada para este domingo.</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-sm text-gray-700">
                          Total — Gols: <span className="font-semibold">{statsTotals.goals}</span> • Assistências: <span className="font-semibold">{statsTotals.assists}</span>
                        </div>
                        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 text-center text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-2">
                          <div className="text-left">Jogador</div>
                          <div>Partidas</div>
                          <div>Gols</div>
                          <div>Assistências</div>
                          <div>Vitórias</div>
                          <div>Gols sofridos</div>
                        </div>
                        <div className="divide-y">
                          {statsRows.map(r => (
                            <div key={r.player_id} className="py-3 grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 text-center items-center">
                              <div className="text-sm text-gray-800 text-left break-words" title={r.name}>{r.name}</div>
                              <div className="text-sm text-gray-800 tabular-nums font-semibold">{r.matches}</div>
                              <div className="text-sm text-gray-800 tabular-nums font-semibold">{r.goals}</div>
                              <div className="text-sm text-gray-800 tabular-nums font-semibold">{r.assists}</div>
                              <div className="text-sm text-gray-800 tabular-nums font-semibold">{r.wins}</div>
                              <div className="text-sm text-gray-800 tabular-nums font-semibold">{r.conceded}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Sunday Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Criar Novo Domingo</h3>
            <form onSubmit={handleCreateSunday} className="space-y-4">
              <div>
                <label htmlFor="sunday_date" className="block text-sm font-medium text-gray-700">
                  Data do Domingo
                </label>
                <input
                  type="date"
                  id="sunday_date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  min={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  required
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    setSelectedDate('')
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attendance Management Modal */}
      {showAttendance && selectedSunday && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Gerenciar Presenças - {parseSundayDate(selectedSunday.sunday_date).toLocaleDateString('pt-BR')}
                </h3>
                <button
                  onClick={() => {
                    setShowAttendance(false)
                    setSelectedSunday(null)
                    setAttendance([])
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-3">
                {players.map((player) => {
                  const playerAttendance = attendance.find(a => a.player_id === player.id)
                  const isPresent = playerAttendance?.is_present || false
                  
                  return (
                    <div key={player.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => updateAttendance(player.id, !isPresent)}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                            isPresent 
                              ? 'bg-green-500 border-green-500 text-white' 
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          {isPresent && <CheckCircle className="w-4 h-4" />}
                        </button>
                        <div>
                          <p className="font-medium text-gray-900">{player.name}</p>
                          <p className="text-sm text-gray-500">{player.position}</p>
                        </div>
                      </div>
                      {isPresent && playerAttendance?.arrival_time && (
                        <div className="text-sm text-gray-500">
                          <Clock className="w-4 h-4 inline mr-1" />
                          {new Date(playerAttendance.arrival_time).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
                <button
                  onClick={() => {
                    setShowAttendance(false)
                    setSelectedSunday(null)
                    setAttendance([])
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveAttendance}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Salvar Presenças
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Sunday Modal */}
      {confirmDeleteSunday && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Confirmar exclusão</h3>
              <button
                onClick={() => setConfirmDeleteSunday(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <p className="text-sm text-gray-700">
              Tem certeza que deseja apagar o domingo de{' '}
              <span className="font-semibold">
                {parseSundayDate(confirmDeleteSunday.sunday_date).toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </span>
              ?
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Isso irá remover partidas, participantes, presenças e reverter estatísticas relacionadas.
            </p>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => setConfirmDeleteSunday(null)}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  const sunday = confirmDeleteSunday
                  setConfirmDeleteSunday(null)
                  if (sunday) {
                    await handleDeleteSunday(sunday)
                  }
                }}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Apagar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Modal */}
      {showSummary && summarySunday && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Súmula — {parseSundayDate(summarySunday.sunday_date).toLocaleDateString('pt-BR')}
                </h3>
                <button
                  onClick={() => {
                    setShowSummary(false)
                    setSummarySunday(null)
                    setSummaryRows([])
                    setSummaryTotals({ goals: 0, assists: 0 })
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
              {summaryLoading ? (
                <div className="text-sm text-gray-600">Carregando…</div>
              ) : (
                <>
                  {summaryRows.length === 0 ? (
                    <div className="text-sm text-gray-600">Nenhuma súmula registrada para este domingo.</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-sm text-gray-700">
                        Total — Gols: <span className="font-semibold">{summaryTotals.goals}</span> • Assistências: <span className="font-semibold">{summaryTotals.assists}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 pb-2">
                        <div>Jogador</div>
                        <div>Gols</div>
                        <div>Assistências</div>
                      </div>
                      <div className="divide-y">
                        {summaryRows.map(r => (
                          <div key={r.player_id} className="py-2 grid grid-cols-3 gap-2 text-center items-center">
                            <div className="text-sm text-gray-800 truncate" title={r.name}>{r.name}</div>
                            <div className="text-sm text-gray-800 tabular-nums font-semibold">{r.goals}</div>
                            <div className="text-sm text-gray-800 tabular-nums font-semibold">{r.assists}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {craqueModalOpen && craqueDetails && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-4 relative">
            {craqueDetails.badgeUrl ? (
              <img
                src={craqueDetails.badgeUrl}
                alt="Craque do Domingo"
                className="absolute top-[-17px] right-[-17px] w-[12.8rem] h-[12.8rem] object-contain transform rotate-12 drop-shadow z-50 pointer-events-none"
              />
            ) : null}
            <FifaPlayerCard
              name={craqueDetails.name}
              overall={craqueDetails.overall}
              role={craqueDetails.role}
              photoUrl={craqueDetails.photo2Url}
              stats={craqueDetails.stats}
              templateUrl={craqueDetails.templateUrl}
              className="w-full"
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => { setCraqueModalOpen(false); setCraqueDetails(null) }}
                className="px-3 py-1.5 rounded-md bg-gray-200 text-gray-700 text-sm"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Sundays
