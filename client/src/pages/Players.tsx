import React, { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Plus, Edit, Trash2, User, Search, BarChart3, Download, XCircle } from 'lucide-react'
import api from '../services/api'
import { logError } from '../services/logger'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts'
import FifaPlayerCard from '../components/FifaPlayerCard'
import * as XLSX from 'xlsx'

interface Player {
  id: number
  name: string
  is_goalkeeper: boolean
  photo_url?: string
  photo_mime?: string
  has_photo?: boolean
  created_at: string
  total_goals_scored: number
  total_matches_played: number
  total_assists: number
  win_rate: number
}

interface PlayerDetails {
  player: {
    name: string
    is_goalkeeper: boolean
    photo_url?: string
    photo_mime?: string
    photo2_mime?: string
    attr_ofe?: number
    attr_def?: number
    attr_tec?: number
    attr_for?: number
    attr_vel?: number
    attr_pot?: number
    dominant_foot?: string
    height_cm?: number
    birthdate?: string
    total_assists?: number
  }
  stats: {
    goals_scored: number
    goals_conceded: number
    wins: number
    draws: number
    losses: number
    matches: number
    sundays: number
  }
}

const Players: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [details, setDetails] = useState<PlayerDetails | null>(null)
  const [detailsPhotoUrl, setDetailsPhotoUrl] = useState<string>('')
  const [cardGoldUrl, setCardGoldUrl] = useState<string>('')
  const [cropOpen, setCropOpen] = useState(false)
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null)
  const [cropScale, setCropScale] = useState(1)
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [lastDrag, setLastDrag] = useState<{ x: number; y: number } | null>(null)
  const [originalMime, setOriginalMime] = useState<string>('image/jpeg')
  const cropSize = 300
  const [crop2Open, setCrop2Open] = useState(false)
  const [crop2Image, setCrop2Image] = useState<HTMLImageElement | null>(null)
  const [crop2Scale, setCrop2Scale] = useState(1)
  const [crop2Pos, setCrop2Pos] = useState({ x: 0, y: 0 })
  const [isDragging2, setIsDragging2] = useState(false)
  const [lastDrag2, setLastDrag2] = useState<{ x: number; y: number } | null>(null)
  const [originalMime2, setOriginalMime2] = useState<string>('image/jpeg')
  const [autoRemoveBg2, setAutoRemoveBg2] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [photoMap, setPhotoMap] = useState<Record<number, string>>({})
  const [formData, setFormData] = useState({
    name: '',
    photo_url: '',
    is_goalkeeper: false,
    photo_base64: '',
    photo_mime: '',
    photo2_base64: '',
    photo2_mime: '',
    remove_photo: false,
    remove_photo2: false,
    dominant_foot: '',
    height_cm: '',
    birthdate_str: ''
  })

  const maskBirthdate = (s: string) => {
    const digits = s.replace(/\D/g, '').slice(0, 8)
    if (digits.length <= 2) return digits
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
  }
  const isValidBirthdateStr = (s: string) => {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (!m) return false
    const dd = parseInt(m[1], 10)
    const mm = parseInt(m[2], 10)
    const yyyy = parseInt(m[3], 10)
    if (yyyy < 1900 || yyyy > 2100) return false
    if (mm < 1 || mm > 12) return false
    const d = new Date(yyyy, mm - 1, dd)
    return d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd
  }
  const toBirthdateStr = (value: unknown) => {
    if (!value) return ''
    let iso = ''
    if (typeof value === 'string') {
      iso = value.slice(0, 10)
    } else {
      try {
        iso = new Date(value as Date | number | string).toISOString().slice(0, 10)
      } catch {
        return ''
      }
    }
    const parts = iso.split('-')
    if (parts.length !== 3) return ''
    const [y, m, d] = parts
    return `${d}/${m}/${y}`
  }
  

  const didRunRef = useRef(false)
  useEffect(() => {
    if (didRunRef.current) return
    didRunRef.current = true
    fetchPlayers()
  }, [])

  type PlayerApi = {
    player_id: number
    name: string
    is_goalkeeper: boolean
    photo_url?: string
    photo_mime?: string
    has_photo?: boolean
    created_at: string
    total_goals_scored?: number
    total_games_played?: number
    total_assists?: number
  }

  const fetchPlayers = async () => {
    try {
      const response = await api.get('/api/players')
      const list: Player[] = ((response.data?.players || []) as PlayerApi[]).map((p) => ({
        id: p.player_id,
        name: p.name,
        is_goalkeeper: !!p.is_goalkeeper,
        photo_url: p.photo_url,
        photo_mime: p.photo_mime,
        has_photo: !!p.has_photo,
        created_at: p.created_at,
        total_goals_scored: Number(p.total_goals_scored || 0),
        total_matches_played: Number(p.total_games_played || 0),
        total_assists: Number(p.total_assists || 0),
        win_rate: 0
      }))
      setPlayers(list)
      try {
        const results = await Promise.all(list.map(async (pl: Player) => {
          if (pl.photo_url) return { id: pl.id, url: pl.photo_url }
          if (!(pl.photo_mime || pl.has_photo)) return { id: pl.id, url: '' }
          try {
            const res = await api.get(`/api/players/${pl.id}/photo?v=${Date.now()}`, { responseType: 'arraybuffer' })
            const ct = res.headers['content-type'] || pl.photo_mime || 'image/jpeg'
            const bytes = new Uint8Array(res.data as ArrayBuffer)
            let bin = ''
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
            const base64 = btoa(bin)
            return { id: pl.id, url: `data:${ct};base64,${base64}` }
          } catch {
            return { id: pl.id, url: '' }
          }
        }))
        const map: Record<number, string> = {}
        results.forEach(r => { if (r.url) map[r.id] = r.url })
        setPhotoMap(map)
      } catch { void 0 }
    } catch (error: unknown) {
      toast.error('Erro ao carregar jogadores')
      const status = typeof error === 'object' && error && 'response' in error ? (error as { response?: { status?: number } }).response?.status : undefined
      const message = typeof error === 'object' && error && 'message' in error ? (error as { message?: string }).message : undefined
      logError('players_load_error', { status, message })
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      const payload: Record<string, unknown> = { ...formData }
      const photoUrl = typeof payload['photo_url'] === 'string' ? (payload['photo_url'] as string) : ''
      if (!photoUrl || photoUrl.trim() === '') {
        delete payload['photo_url']
      }
      if (!payload['photo_base64']) {
        delete payload['photo_base64']
      }
      if (!payload['photo_mime']) {
        delete payload['photo_mime']
      }
      if (!payload['photo2_base64']) {
        delete payload['photo2_base64']
      }
      if (!payload['photo2_mime']) {
        delete payload['photo2_mime']
      }
      if (payload['remove_photo'] !== true) {
        delete payload['remove_photo']
      }
      if (payload['remove_photo2'] !== true) {
        delete payload['remove_photo2']
      }
      const dominant = typeof payload['dominant_foot'] === 'string' ? (payload['dominant_foot'] as string).trim() : ''
      if (!dominant) {
        delete payload['dominant_foot']
      } else {
        payload['dominant_foot'] = dominant
      }
      if (payload['height_cm'] !== undefined && payload['height_cm'] !== null) {
        const num = parseInt(String(payload['height_cm']), 10)
        if (isNaN(num)) {
          delete payload['height_cm']
        } else {
          payload['height_cm'] = num
        }
      } else {
        delete payload['height_cm']
      }
      if (payload['birthdate_str']) {
        const s = String(payload['birthdate_str']).trim()
        const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
        if (m) {
          const dd = parseInt(m[1], 10)
          const mm = parseInt(m[2], 10)
          const yyyy = parseInt(m[3], 10)
          const isValid = yyyy >= 1900 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31
          if (isValid) {
            const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
            payload.birthdate = iso
          }
        }
        delete payload.birthdate_str
      }
      if (editingPlayer) {
        await api.put(`/api/players/${editingPlayer.id}`, payload)
        toast.success('Jogador atualizado com sucesso!')
      } else {
        await api.post('/api/players', payload)
        toast.success('Jogador criado com sucesso!')
      }
      
      setShowForm(false)
      setEditingPlayer(null)
      setFormData({ name: '', photo_url: '', is_goalkeeper: false, photo_base64: '', photo_mime: '', photo2_base64: '', photo2_mime: '', remove_photo: false, remove_photo2: false, dominant_foot: '', height_cm: '', birthdate_str: '' })
      fetchPlayers()
    } catch (error: unknown) {
      const msg =
        (typeof error === 'object' && error && 'response' in error && (error as { response?: { data?: Record<string, unknown> } }).response?.data?.message as string) ||
        (typeof error === 'object' && error && 'response' in error && (error as { response?: { data?: Record<string, unknown> } }).response?.data?.error as string) ||
        'Erro ao salvar jogador'
      toast.error(msg)
    }
  }

  const handleEdit = async (player: Player) => {
    setEditingPlayer(player)
    try {
      const res = await api.get(`/api/players/${player.id}`)
      const p = res.data?.player || {}
      setFormData({
        name: player.name,
        photo_url: player.photo_url || '',
        is_goalkeeper: !!player.is_goalkeeper,
        photo_base64: '',
        photo_mime: '',
        photo2_base64: '',
        photo2_mime: '',
        remove_photo: false,
        remove_photo2: false,
        dominant_foot: p.dominant_foot || '',
        height_cm: p.height_cm ? String(p.height_cm) : '',
        birthdate_str: toBirthdateStr(p.birthdate)
      })
    } catch {
      setFormData({
        name: player.name,
        photo_url: player.photo_url || '',
        is_goalkeeper: !!player.is_goalkeeper,
        photo_base64: '',
        photo_mime: '',
        photo2_base64: '',
        photo2_mime: '',
        remove_photo: false,
        remove_photo2: false,
        dominant_foot: '',
        height_cm: '',
        birthdate_str: ''
      })
    }
    setShowForm(true)
  }

  const openDetails = async (playerId: number) => {
    try {
      const res = await api.get(`/api/players/${playerId}`)
      setDetails(res.data)
      setShowDetails(true)
      setDetailsPhotoUrl('')
      try {
        const goldRes = await api.get(`/api/assets/card-gold`, { responseType: 'arraybuffer' })
        const mime = goldRes.headers['content-type'] || 'image/png'
        const bytes = new Uint8Array(goldRes.data as ArrayBuffer)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        const base64 = btoa(bin)
        setCardGoldUrl(`data:${mime};base64,${base64}`)
      } catch (e) {
        setCardGoldUrl('')
      }
      const p = res.data?.player || {}
      const hasPhoto2 = typeof p.photo2_mime === 'string' && p.photo2_mime.trim() !== ''
      const hasPhoto1 = typeof p.photo_mime === 'string' && p.photo_mime.trim() !== ''
      const directUrl = typeof p.photo_url === 'string' && p.photo_url.trim() !== '' ? p.photo_url : ''
      if (hasPhoto2) {
        try {
          const photoRes2 = await api.get(`/api/players/${playerId}/photo2?v=${Date.now()}`, { responseType: 'arraybuffer' })
          const ct2 = (photoRes2.headers && (photoRes2.headers['content-type'] as string)) || p.photo2_mime || 'image/jpeg'
          const bytes2 = new Uint8Array(photoRes2.data as ArrayBuffer)
          let bin2 = ''
          for (let i = 0; i < bytes2.length; i++) bin2 += String.fromCharCode(bytes2[i])
          const base642 = btoa(bin2)
          setDetailsPhotoUrl(`data:${ct2};base64,${base642}`)
        } catch { void 0 }
      } else if (hasPhoto1) {
        try {
          const photoRes = await api.get(`/api/players/${playerId}/photo?v=${Date.now()}`, { responseType: 'arraybuffer' })
          const ct = (photoRes.headers && (photoRes.headers['content-type'] as string)) || p.photo_mime || 'image/jpeg'
          const bytes = new Uint8Array(photoRes.data as ArrayBuffer)
          let bin = ''
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
          const base64 = btoa(bin)
          setDetailsPhotoUrl(`data:${ct};base64,${base64}`)
        } catch { void 0 }
      } else if (directUrl) {
        setDetailsPhotoUrl(directUrl)
      }
    } catch {
      toast.error('Erro ao carregar detalhes do jogador')
    }
  }

  const handleDelete = async (playerId: number) => {
    try {
      setDeleteLoading(true)
      await api.delete(`/api/players/${playerId}`)
      toast.success('Jogador excluído com sucesso!')
      setConfirmDeleteId(null)
      fetchPlayers()
    } catch (error) {
      toast.error('Erro ao excluir jogador')
    } finally {
      setDeleteLoading(false)
    }
  }

  type GeneralStatsRow = {
    player_id: number
    name: string
    is_goalkeeper: boolean
    goals: number
    assists: number
    goals_conceded: number
    clean_sheets: number
    craques: number
    matches: number
    wins: number
    draws: number
    losses: number
    sundays: number
    goals_per_game: number
    goals_per_sunday: number
    last_goals: number
    last_assists: number
  }
  const [showGeneralStats, setShowGeneralStats] = useState(false)
  const [generalStatsLoading, setGeneralStatsLoading] = useState(false)
  const [generalStatsRows, setGeneralStatsRows] = useState<GeneralStatsRow[]>([])
  const [generalFilter, setGeneralFilter] = useState('')
  const [generalSortKey, setGeneralSortKey] = useState<keyof GeneralStatsRow>('goals')
  const [generalSortAsc, setGeneralSortAsc] = useState(false)

  const openGeneralStats = async () => {
    try {
      setShowGeneralStats(true)
      setGeneralStatsLoading(true)
      const [detailedResp, sundaysResp] = await Promise.all([
        api.get('/api/stats/players/detailed'),
        api.get('/api/sundays')
      ])
      const detailed = Array.isArray(detailedResp.data?.players) ? detailedResp.data.players as Array<{
        player_id: number
        name: string
        photo_url?: string
        is_goalkeeper: boolean
        total_games_played: number
        total_goals_scored: number
        total_assists: number
        total_goals_conceded: number
        goals_per_game: number
        assists_per_game: number
        goals_conceded_per_game: number
        games_finished: number
        games_won: number
        games_lost: number
        games_drawn: number
        sundays_played: number
        goals_per_sunday: number
      }> : []
      const sundaysList = Array.isArray(sundaysResp.data?.sundays) ? sundaysResp.data.sundays as Array<{ sunday_id: number; date: string; craque_player_id?: number | null }> : []
      const craquesMap = new Map<number, number>()
      for (const s of sundaysList) {
        const pid = Number(s.craque_player_id || 0)
        if (pid > 0) craquesMap.set(pid, (craquesMap.get(pid) || 0) + 1)
      }
      const lastFinishedSundayId = sundaysList.length > 1 ? sundaysList[1].sunday_id : (sundaysList[0]?.sunday_id ?? 0)
      const lastGoalsMap = new Map<number, number>()
      const lastAssistsMap = new Map<number, number>()
      if (lastFinishedSundayId) {
        const matchesResp = await api.get(`/api/sundays/${lastFinishedSundayId}/matches`)
        const matches = Array.isArray(matchesResp.data?.matches) ? matchesResp.data.matches as Array<{ match_id: number; match_number: number; status: string }> : []
        const realMatches = matches.filter(m => Number(m.match_number) > 0 && String(m.status) === 'finished')
        await Promise.all(realMatches.map(async (m) => {
          const statsResp = await api.get(`/api/matches/${m.match_id}/stats`)
          const stats = Array.isArray(statsResp.data?.stats) ? statsResp.data.stats as Array<{ player_scorer_id: number | null; player_assist_id: number | null; event_type?: string; is_own_goal?: boolean }> : []
          for (const s of stats) {
            if (String(s.event_type || 'goal') === 'goal') {
              if (!s.is_own_goal && Number(s.player_scorer_id || 0) > 0) {
                const pid = Number(s.player_scorer_id)
                lastGoalsMap.set(pid, (lastGoalsMap.get(pid) || 0) + 1)
              }
              if (Number(s.player_assist_id || 0) > 0) {
                const pid = Number(s.player_assist_id)
                lastAssistsMap.set(pid, (lastAssistsMap.get(pid) || 0) + 1)
              }
            }
          }
        }))
        const summaryMatch = matches.find(m => Number(m.match_number) === 0)
        if (summaryMatch) {
          const statsResp = await api.get(`/api/matches/${summaryMatch.match_id}/stats`)
          const stats = Array.isArray(statsResp.data?.stats) ? statsResp.data.stats as Array<{ player_scorer_id: number | null; player_assist_id: number | null; event_type?: string }> : []
          const onlySummary = stats.filter(s => String(s.event_type || 'goal') === 'summary_goal')
          for (const s of onlySummary) {
            if (Number(s.player_scorer_id || 0) > 0) {
              const pid = Number(s.player_scorer_id)
              lastGoalsMap.set(pid, (lastGoalsMap.get(pid) || 0) + 1)
            }
            if (Number(s.player_assist_id || 0) > 0) {
              const pid = Number(s.player_assist_id)
              lastAssistsMap.set(pid, (lastAssistsMap.get(pid) || 0) + 1)
            }
          }
        }
      }
      const matchesResp = await api.get('/api/matches')
      const allMatches = Array.isArray(matchesResp.data?.matches) ? matchesResp.data.matches as Array<{ match_id: number }> : []
      const cleanSheetsMap = new Map<number, number>()
      await Promise.all(allMatches.map(async (m) => {
        const detResp = await api.get(`/api/matches/${m.match_id}`)
        const match = detResp.data?.match as { status?: string; team_orange_score?: number; team_black_score?: number; participants?: Array<{ player_id: number; team: 'orange' | 'black' }> }
        const finished = String(match?.status || '') === 'finished'
        if (!finished) return
        const orangeConcededZero = Number(match.team_black_score || 0) === 0
        const blackConcededZero = Number(match.team_orange_score || 0) === 0
        const parts = Array.isArray(match.participants) ? match.participants : []
        for (const p of parts) {
          const pid = Number(p.player_id)
          if (!Number.isFinite(pid) || pid <= 0) continue
          const teamClean = p.team === 'orange' ? orangeConcededZero : blackConcededZero
          if (teamClean) cleanSheetsMap.set(pid, (cleanSheetsMap.get(pid) || 0) + 1)
        }
      }))
      const baseMap = new Map<number, { name: string; is_goalkeeper: boolean }>()
      for (const pl of players) baseMap.set(pl.id, { name: pl.name, is_goalkeeper: pl.is_goalkeeper })
      const rows: GeneralStatsRow[] = detailed.map(d => ({
        player_id: Number(d.player_id),
        name: baseMap.get(Number(d.player_id))?.name || String(d.name),
        is_goalkeeper: !!(baseMap.get(Number(d.player_id))?.is_goalkeeper || d.is_goalkeeper),
        goals: Number(d.total_goals_scored || 0),
        assists: Number(d.total_assists || 0),
        goals_conceded: Number(d.total_goals_conceded || 0),
        clean_sheets: Number(cleanSheetsMap.get(Number(d.player_id)) || 0),
        craques: Number(craquesMap.get(Number(d.player_id)) || 0),
        matches: Number(d.total_games_played || 0),
        wins: Number(d.games_won || 0),
        draws: Number(d.games_drawn || 0),
        losses: Number(d.games_lost || 0),
        sundays: Number(d.sundays_played || 0),
        goals_per_game: Number(d.goals_per_game || 0),
        goals_per_sunday: Number(d.goals_per_sunday || 0),
        last_goals: Number(lastGoalsMap.get(Number(d.player_id)) || 0),
        last_assists: Number(lastAssistsMap.get(Number(d.player_id)) || 0),
      }))
      setGeneralStatsRows(rows)
    } catch {
      toast.error('Erro ao carregar estatísticas gerais')
      setGeneralStatsRows([])
    } finally {
      setGeneralStatsLoading(false)
    }
  }

  const sortedAndFilteredGeneralRows = generalStatsRows
    .filter(r => r.name.toLowerCase().includes(generalFilter.toLowerCase()))
    .sort((a, b) => {
      const va = a[generalSortKey]
      const vb = b[generalSortKey]
      const cmp = typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb)
        : Number(vb) - Number(va)
      return generalSortAsc ? -cmp : cmp
    })

  const exportGeneralStatsXlsx = () => {
    const data = sortedAndFilteredGeneralRows.map(r => ({
      Jogador: r.name,
      Gols: r.goals,
      Assistências: r.assists,
      'Gols sofridos': r.goals_conceded,
      'Sem sofrer gol': r.clean_sheets,
      Craques: r.craques,
      Partidas: r.matches,
      Vitórias: r.wins,
      Empates: r.draws,
      Derrotas: r.losses,
      Domingos: r.sundays,
      'Média/jogo (gols)': r.goals_per_game,
      'Média/domingo (gols)': r.goals_per_sunday,
      'Gols último domingo': r.last_goals,
      'Assistências último domingo': r.last_assists
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Estatísticas')
    XLSX.writeFile(wb, 'estatisticas_jogadores.xlsx')
  }

  const filteredPlayers = players.filter(player =>
    player.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

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
        <h1 className="text-3xl font-bold text-gray-900">Jogadores</h1>
        <div className="flex items-center space-x-2">
          <button
            onClick={openGeneralStats}
            className="inline-flex items-center px-3 py-2 border border-primary-600 text-sm font-medium rounded-md text-primary-700 bg-white hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            title="Estatísticas gerais"
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Estatísticas gerais
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <Plus className="w-4 h-4 mr-2" />
            Novo Jogador
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          placeholder="Buscar jogadores..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
        />
      </div>

      {/* Players Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredPlayers.map((player) => (
          <div key={player.id} className="bg-white rounded-lg shadow p-6 cursor-pointer" onClick={() => openDetails(player.id)}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <div className="flex-shrink-0 rounded-full overflow-hidden w-12 h-12 bg-primary-100">
                  {photoMap[player.id] ? (
                    <img
                      src={photoMap[player.id]}
                      alt={player.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-12 h-12 p-2 text-primary-600" />
                  )}
                </div>
              <div className="ml-3">
                <h3 className="text-lg font-medium text-gray-900">{player.name}</h3>
                <p className="text-sm text-gray-500">{player.is_goalkeeper ? 'Goleiro' : 'Linha'}</p>
              </div>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleEdit(player) }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(player.id) }}
                  className="text-gray-400 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="pt-2 border-t border-gray-200">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{player.total_matches_played}</p>
                    <p className="text-xs text-gray-500">Jogos</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{player.total_goals_scored}</p>
                    <p className="text-xs text-gray-500">Gols</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{player.total_assists}</p>
                    <p className="text-xs text-gray-500">Assist.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredPlayers.length === 0 && (
        <div className="text-center py-12">
          <User className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Nenhum jogador encontrado</h3>
          <p className="mt-1 text-sm text-gray-500">
            {searchTerm ? 'Tente ajustar sua busca' : 'Comece criando um novo jogador'}
          </p>
        </div>
      )}

      {showGeneralStats && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50" onClick={() => setShowGeneralStats(false)}>
          <div className="bg-white rounded-lg max-w-6xl w-full p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Estatísticas gerais de jogadores</h3>
              <div className="flex items-center space-x-2">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Filtrar por nome..."
                    value={generalFilter}
                    onChange={(e) => setGeneralFilter(e.target.value)}
                    className="block w-64 pl-3 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                </div>
                <select
                  value={generalSortKey}
                  onChange={(e) => setGeneralSortKey(e.target.value as keyof GeneralStatsRow)}
                  className="pl-3 pr-8 py-2 border border-gray-300 rounded-md text-sm"
                  title="Ordenar por"
                >
                  <option value="goals">Gols</option>
                  <option value="assists">Assistências</option>
                  <option value="goals_conceded">Gols sofridos</option>
                  <option value="clean_sheets">Sem sofrer gol</option>
                  <option value="craques">Craques</option>
                  <option value="matches">Partidas</option>
                  <option value="wins">Vitórias</option>
                  <option value="draws">Empates</option>
                  <option value="losses">Derrotas</option>
                  <option value="sundays">Domingos</option>
                  <option value="goals_per_game">Média/jogo (gols)</option>
                  <option value="goals_per_sunday">Média/domingo (gols)</option>
                  <option value="last_goals">Gols último domingo</option>
                  <option value="last_assists">Assistências último domingo</option>
                </select>
                <button
                  onClick={() => setGeneralSortAsc(s => !s)}
                  className="px-2 py-2 border border-gray-300 rounded-md text-sm"
                  title="Alternar ordem"
                >
                  {generalSortAsc ? 'Asc' : 'Desc'}
                </button>
                <button
                  onClick={exportGeneralStatsXlsx}
                  className="inline-flex items-center px-3 py-2 border border-success-600 text-sm font-medium rounded-md text-white bg-success-600 hover:bg-success-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success-500"
                  title="Exportar XLSX"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Exportar XLSX
                </button>
                <button onClick={() => setShowGeneralStats(false)} className="text-gray-400 hover:text-gray-600" title="Fechar">
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
            </div>
            {generalStatsLoading ? (
              <div className="text-sm text-gray-600">Carregando…</div>
            ) : (
              <>
                {sortedAndFilteredGeneralRows.length === 0 ? (
                  <div className="text-sm text-gray-600">Sem dados.</div>
                ) : (
                  <>
                    <div className="overflow-auto max-h-[70vh]">
                      <table className="min-w-[1920px] border-collapse">
                        <thead className="sticky top-0 bg-white z-20 shadow-sm">
                          <tr>
                            <th className="sticky left-0 bg-white z-30 text-left px-2 py-2 border-b border-gray-200">
                              Jogador
                            </th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Gols</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Assistências</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Gols sofridos</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Sem sofrer gol</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Craques</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Partidas</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Vitórias</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Empates</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Derrotas</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Domingos</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Média/jogo</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Média/domingo</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Gols último</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase">Assist. último</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedAndFilteredGeneralRows.map(r => (
                            <tr key={r.player_id} className="hover:bg-gray-50">
                              <td className="sticky left-0 bg-white z-10 text-left px-2 py-2 border-r border-gray-200" title={r.name}>{r.name}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.goals}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.assists}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.goals_conceded}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.clean_sheets}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.craques}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.matches}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.wins}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.draws}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.losses}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.sundays}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{Number(r.goals_per_game).toFixed(2)}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{Number(r.goals_per_sunday).toFixed(2)}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.last_goals}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold">{r.last_assists}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showDetails && details && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50" onClick={() => setShowDetails(false)}>
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">{details.player.name}</h3>
              <button onClick={() => setShowDetails(false)} className="text-gray-500 hover:text-gray-700">Fechar</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="w-full flex justify-center items-start">
                  <div className="w-72">
                    <FifaPlayerCard
                      name={details.player.name}
                      overall={Math.round((
                        (details.player.attr_ofe || 50) +
                        (details.player.attr_def || 50) +
                        (details.player.attr_tec || 50) +
                        (details.player.attr_for || 50) +
                        (details.player.attr_vel || 50) +
                        (details.player.attr_pot || 50)
                      ) / 6)}
                      role={details.player.is_goalkeeper ? 'GOL' : 'LINHA'}
                      photoUrl={detailsPhotoUrl || details.player.photo_url}
                      stats={{
                        ofe: details.player.attr_ofe || 50,
                        def: details.player.attr_def || 50,
                        tec: details.player.attr_tec || 50,
                        for: details.player.attr_for || 50,
                        vel: details.player.attr_vel || 50,
                        pot: details.player.attr_pot || 50
                      }}
                      templateUrl={cardGoldUrl || '/assets/fifa-card-gold.png'}
                    />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-gray-500">Gols</div>
                    <div className="text-gray-900 font-semibold">{details.stats.goals_scored}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Assistências</div>
                    <div className="text-gray-900 font-semibold">{Number(details.player.total_assists || 0)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Vitórias</div>
                    <div className="text-gray-900 font-semibold">{details.stats.wins}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Empates</div>
                    <div className="text-gray-900 font-semibold">{details.stats.draws}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Partidas</div>
                    <div className="text-gray-900 font-semibold">{details.stats.matches}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Gols Sofridos</div>
                    <div className="text-gray-900 font-semibold">{details.stats.goals_conceded}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Domingos</div>
                    <div className="text-gray-900 font-semibold">{details.stats.sundays}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Pé Dominante</div>
                    <div className="text-gray-900 font-semibold">{details.player.dominant_foot || '-'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Altura</div>
                    <div className="text-gray-900 font-semibold">{details.player.height_cm ? `${details.player.height_cm} cm` : '-'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Idade</div>
                    <div className="text-gray-900 font-semibold">{details.player.birthdate ? `${Math.floor((Date.now() - new Date(details.player.birthdate).getTime()) / (365.25 * 24 * 3600 * 1000))}` : '-'}</div>
                  </div>
                </div>
              </div>
              <div className="flex flex-col">
                <div className="text-sm text-gray-700 mb-2">Atributos</div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="80%" data={[
                      { attr: 'OFE', value: Math.min(99, Math.max(1, Number(details.player.attr_ofe ?? 50))) },
                      { attr: 'TEC', value: Math.min(99, Math.max(1, Number(details.player.attr_tec ?? 50))) },
                      { attr: 'FOR', value: Math.min(99, Math.max(1, Number(details.player.attr_for ?? 50))) },
                      { attr: 'DEF', value: Math.min(99, Math.max(1, Number(details.player.attr_def ?? 50))) },
                      { attr: 'POT', value: Math.min(99, Math.max(1, Number(details.player.attr_pot ?? 50))) },
                      { attr: 'VEL', value: Math.min(99, Math.max(1, Number(details.player.attr_vel ?? 50))) }
                    ]}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="attr" />
                      <PolarRadiusAxis domain={[0, 99]} />
                      <Radar name="Atributos" dataKey="value" stroke="#ef4444" fill="#ef4444" fillOpacity={0.4} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {editingPlayer ? 'Editar Jogador' : 'Novo Jogador'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Nome
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  required
                />
              </div>
              <div>
                <label htmlFor="photo_url" className="block text-sm font-medium text-gray-700">
                  URL da Foto (opcional)
                </label>
                <input
                  type="url"
                  id="photo_url"
                  value={formData.photo_url}
                  onChange={(e) => setFormData({ ...formData, photo_url: e.target.value })}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="photo_file" className="block text-sm font-medium text-gray-700">
                  Upload de Foto (opcional) — suporta JPG, PNG e WebP
                </label>
                <input
                  type="file"
                  id="photo_file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) {
                      setFormData({ ...formData, photo_base64: '', photo_mime: '' })
                      return
                    }
                    setOriginalMime(file.type || 'image/jpeg')
                    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                      const reader = new FileReader()
                      reader.onload = () => {
                        const src = reader.result as string
                        const image = new Image()
                        image.onload = () => resolve(image)
                        image.onerror = reject
                        image.src = src
                      }
                      reader.onerror = reject
                      reader.readAsDataURL(file)
                    })
                    setCropImage(img)
                    const fitScale = Math.min(cropSize / img.width, cropSize / img.height)
                    setCropScale(Math.max(0.05, fitScale * 0.6))
                    setCropPos({ x: 0, y: 0 })
                    setCropOpen(true)
                  }}
                  className="mt-1 block w-full text-sm text-gray-700"
                />
                {editingPlayer && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFormData({ ...formData, photo_base64: '', photo_mime: '', remove_photo: true })
                        toast.info('Foto principal será removida ao salvar')
                      }}
                      className="px-3 py-1.5 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100"
                    >
                      Remover foto
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="photo2_file" className="block text-sm font-medium text-gray-700">
                  Upload de Foto Detalhada (imagem 2)
                </label>
                <input
                  type="file"
                  id="photo2_file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) {
                      setFormData({ ...formData, photo2_base64: '', photo2_mime: '' })
                      return
                    }
                    setOriginalMime2(file.type || 'image/jpeg')
                    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                      const reader = new FileReader()
                      reader.onload = () => {
                        const src = reader.result as string
                        const image = new Image()
                        image.onload = () => resolve(image)
                        image.onerror = reject
                        image.src = src
                      }
                      reader.onerror = reject
                      reader.readAsDataURL(file)
                    })
                    setCrop2Image(img)
                    const fitScale = Math.min(cropSize / img.width, cropSize / img.height)
                    setCrop2Scale(Math.max(0.05, fitScale * 0.6))
                    setCrop2Pos({ x: 0, y: 0 })
                    setCrop2Open(true)
                  }}
                  className="mt-1 block w-full text-sm text-gray-700"
                />
                {editingPlayer && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFormData({ ...formData, photo2_base64: '', photo2_mime: '', remove_photo2: true })
                        toast.info('Foto detalhada será removida ao salvar')
                      }}
                      className="px-3 py-1.5 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100"
                    >
                      Remover foto detalhada
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="dominant_foot" className="block text-sm font-medium text-gray-700">
                  Pé dominante
                </label>
                <select
                  id="dominant_foot"
                  value={formData.dominant_foot}
                  onChange={(e) => setFormData({ ...formData, dominant_foot: e.target.value })}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                >
                  <option value="">Selecione</option>
                  <option value="direito">Direito</option>
                  <option value="esquerdo">Esquerdo</option>
                </select>
              </div>
              <div>
                <label htmlFor="height_cm" className="block text-sm font-medium text-gray-700">
                  Altura (cm)
                </label>
                <input
                  type="number"
                  id="height_cm"
                  min={100}
                  max={250}
                  value={formData.height_cm}
                  onChange={(e) => setFormData({ ...formData, height_cm: e.target.value })}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="birthdate_str" className="block text-sm font-medium text-gray-700">
                  Data de nascimento (DD/MM/YYYY)
                </label>
                <input
                  type="text"
                  id="birthdate_str"
                  placeholder="DD/MM/YYYY"
                  value={formData.birthdate_str}
                  onChange={(e) => setFormData({ ...formData, birthdate_str: maskBirthdate(e.target.value) })}
                  onBlur={() => {
                    if (formData.birthdate_str && !isValidBirthdateStr(formData.birthdate_str)) {
                      toast.error('Data de nascimento inválida')
                      setFormData({ ...formData, birthdate_str: '' })
                    }
                  }}
                  inputMode="numeric"
                  maxLength={10}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
              </div>
              <div className="flex items-center">
                <input
                  id="is_goalkeeper"
                  type="checkbox"
                  checked={formData.is_goalkeeper}
                  onChange={(e) => setFormData({ ...formData, is_goalkeeper: e.target.checked })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="is_goalkeeper" className="ml-2 block text-sm text-gray-700">
                  É goleiro
                </label>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    setEditingPlayer(null)
                    setFormData({ name: '', photo_url: '', is_goalkeeper: false, photo_base64: '', photo_mime: '', photo2_base64: '', photo2_mime: '', remove_photo: false, remove_photo2: false, dominant_foot: '', height_cm: '', birthdate_str: '' })
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  {editingPlayer ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Confirm Delete Modal */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Excluir Jogador</h3>
            <p className="text-sm text-gray-600 mb-6">
              Tem certeza que deseja excluir este jogador? Esta ação não pode ser desfeita.
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
                onClick={() => handleDelete(confirmDeleteId)}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
      {cropOpen && cropImage && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Ajustar enquadramento da foto</h3>
            <div
              className="relative bg-black mx-auto"
              style={{ width: cropSize, height: cropSize, overflow: 'hidden', borderRadius: 8 }}
              onMouseDown={(e) => {
                setIsDragging(true)
                setLastDrag({ x: e.clientX, y: e.clientY })
              }}
              onMouseMove={(e) => {
                if (!isDragging || !lastDrag) return
                const dx = e.clientX - lastDrag.x
                const dy = e.clientY - lastDrag.y
                setCropPos({ x: cropPos.x + dx, y: cropPos.y + dy })
                setLastDrag({ x: e.clientX, y: e.clientY })
              }}
              onMouseUp={() => {
                setIsDragging(false)
                setLastDrag(null)
              }}
              onMouseLeave={() => {
                setIsDragging(false)
                setLastDrag(null)
              }}
              onTouchStart={(e) => {
                const t = e.touches[0]
                setIsDragging(true)
                setLastDrag({ x: t.clientX, y: t.clientY })
              }}
              onTouchMove={(e) => {
                const t = e.touches[0]
                if (!isDragging || !lastDrag) return
                const dx = t.clientX - lastDrag.x
                const dy = t.clientY - lastDrag.y
                setCropPos({ x: cropPos.x + dx, y: cropPos.y + dy })
                setLastDrag({ x: t.clientX, y: t.clientY })
              }}
              onTouchEnd={() => {
                setIsDragging(false)
                setLastDrag(null)
              }}
            >
              <img
                src={cropImage.src}
                alt="crop"
                draggable={false}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: `translate(calc(-50% + ${cropPos.x}px), calc(-50% + ${cropPos.y}px)) scale(${cropScale})`,
                  userSelect: 'none',
                  maxWidth: 'none'
                }}
              />
            </div>
            <div className="mt-4">
              <input
                type="range"
                min={0.05}
                max={3}
                step={0.01}
                value={cropScale}
                onChange={(e) => setCropScale(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setCropOpen(false)
                  setCropImage(null)
                }}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const canvas = document.createElement('canvas')
                  canvas.width = cropSize
                  canvas.height = cropSize
                  const ctx = canvas.getContext('2d')
                  if (!ctx || !cropImage) return
                  const scaledW = cropImage.width * cropScale
                  const scaledH = cropImage.height * cropScale
                  const topLeftX = cropPos.x + cropSize / 2 - scaledW / 2
                  const topLeftY = cropPos.y + cropSize / 2 - scaledH / 2
                  ctx.imageSmoothingQuality = 'high'
                  ctx.drawImage(cropImage, topLeftX, topLeftY, scaledW, scaledH)
                  let targetMime = 'image/jpeg'
                  if (originalMime.includes('png')) targetMime = 'image/png'
                  else if (originalMime.includes('webp')) targetMime = 'image/webp'
                  const quality = targetMime === 'image/jpeg' || targetMime === 'image/webp' ? 0.85 : undefined
                  const dataUrl = canvas.toDataURL(targetMime, quality as number | undefined)
                  const parts = dataUrl.split(',')
                  const meta = parts[0]
                  const data = parts[1]
                  const mimeStart = meta.indexOf(':') + 1
                  const mimeEnd = meta.indexOf(';')
                  const mime = meta.substring(mimeStart, mimeEnd)
                  setFormData({ ...formData, photo_base64: data, photo_mime: mime })
                  setCropOpen(false)
                  setCropImage(null)
                }}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Salvar enquadramento
              </button>
            </div>
          </div>
        </div>
      )}
      {crop2Open && crop2Image && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Ajustar enquadramento da imagem 2</h3>
            <div
              className="relative bg-black mx-auto"
              style={{ width: cropSize, height: cropSize, overflow: 'hidden', borderRadius: 8 }}
              onMouseDown={(e) => {
                setIsDragging2(true)
                setLastDrag2({ x: e.clientX, y: e.clientY })
              }}
              onMouseMove={(e) => {
                if (!isDragging2 || !lastDrag2) return
                const dx = e.clientX - lastDrag2.x
                const dy = e.clientY - lastDrag2.y
                setCrop2Pos({ x: crop2Pos.x + dx, y: crop2Pos.y + dy })
                setLastDrag2({ x: e.clientX, y: e.clientY })
              }}
              onMouseUp={() => {
                setIsDragging2(false)
                setLastDrag2(null)
              }}
              onMouseLeave={() => {
                setIsDragging2(false)
                setLastDrag2(null)
              }}
              onTouchStart={(e) => {
                const t = e.touches[0]
                setIsDragging2(true)
                setLastDrag2({ x: t.clientX, y: t.clientY })
              }}
              onTouchMove={(e) => {
                const t = e.touches[0]
                if (!isDragging2 || !lastDrag2) return
                const dx = t.clientX - lastDrag2.x
                const dy = t.clientY - lastDrag2.y
                setCrop2Pos({ x: crop2Pos.x + dx, y: crop2Pos.y + dy })
                setLastDrag2({ x: t.clientX, y: t.clientY })
              }}
              onTouchEnd={() => {
                setIsDragging2(false)
                setLastDrag2(null)
              }}
            >
              <img
                src={crop2Image.src}
                alt="crop2"
                draggable={false}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: `translate(calc(-50% + ${crop2Pos.x}px), calc(-50% + ${crop2Pos.y}px)) scale(${crop2Scale})`,
                  userSelect: 'none',
                  maxWidth: 'none'
                }}
              />
            </div>
            <div className="mt-4">
              <input
                type="range"
                min={0.05}
                max={3}
                step={0.01}
                value={crop2Scale}
                onChange={(e) => setCrop2Scale(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="mt-2 flex items-center">
              <input
                id="auto_remove_bg2"
                type="checkbox"
                checked={autoRemoveBg2}
                onChange={(e) => setAutoRemoveBg2(e.target.checked)}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor="auto_remove_bg2" className="ml-2 block text-sm text-gray-700">
                Remover fundo automaticamente (apenas para JPEG)
              </label>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setCrop2Open(false)
                  setCrop2Image(null)
                }}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const canvas = document.createElement('canvas')
                  canvas.width = cropSize
                  canvas.height = cropSize
                  const ctx = canvas.getContext('2d')
                  if (!ctx || !crop2Image) return
                  const scaledW = crop2Image.width * crop2Scale
                  const scaledH = crop2Image.height * crop2Scale
                  const topLeftX = crop2Pos.x + cropSize / 2 - scaledW / 2
                  const topLeftY = crop2Pos.y + cropSize / 2 - scaledH / 2
                  ctx.imageSmoothingQuality = 'high'
                  ctx.drawImage(crop2Image, topLeftX, topLeftY, scaledW, scaledH)
                  const hasAlphaFormat = originalMime2.includes('png') || originalMime2.includes('webp')
                  if (autoRemoveBg2 && !hasAlphaFormat) {
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
                    const d = imgData.data
                    const samples = [
                      0, 0,
                      canvas.width - 1, 0,
                      0, canvas.height - 1,
                      canvas.width - 1, canvas.height - 1,
                      Math.floor(canvas.width / 2), 0,
                      0, Math.floor(canvas.height / 2),
                      canvas.width - 1, Math.floor(canvas.height / 2),
                      Math.floor(canvas.width / 2), canvas.height - 1
                    ]
                    let sr = 0, sg = 0, sb = 0, sc = 0
                    for (let i = 0; i < samples.length; i += 2) {
                      const x = samples[i]
                      const y = samples[i + 1]
                      const idx = (y * canvas.width + x) * 4
                      const a = d[idx + 3]
                      if (a > 200) {
                        sr += d[idx]
                        sg += d[idx + 1]
                        sb += d[idx + 2]
                        sc++
                      }
                    }
                    const br = sc ? Math.round(sr / sc) : 255
                    const bg = sc ? Math.round(sg / sc) : 255
                    const bb = sc ? Math.round(sb / sc) : 255
                    const th = 40
                    for (let i = 0; i < d.length; i += 4) {
                      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]
                      if (a === 0) continue
                      const dr = r - br, dg = g - bg, db = b - bb
                      const dist = Math.sqrt(dr * dr + dg * dg + db * db)
                      const bright = r > 240 && g > 240 && b > 240
                      if (dist < th || bright) {
                        d[i + 3] = 0
                      }
                    }
                    ctx.putImageData(imgData, 0, 0)
                  }
                  let targetMime = 'image/png'
                  if (originalMime2.includes('webp')) targetMime = 'image/webp'
                  const quality = targetMime === 'image/jpeg' || targetMime === 'image/webp' ? 0.85 : undefined
                  const dataUrl = canvas.toDataURL(targetMime, quality as number | undefined)
                  const parts = dataUrl.split(',')
                  const meta = parts[0]
                  const data = parts[1]
                  const mimeStart = meta.indexOf(':') + 1
                  const mimeEnd = meta.indexOf(';')
                  const mime = meta.substring(mimeStart, mimeEnd)
                  setFormData({ ...formData, photo2_base64: data, photo2_mime: mime })
                  setCrop2Open(false)
                  setCrop2Image(null)
                  }}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Salvar enquadramento
                </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Players
