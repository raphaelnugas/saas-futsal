import React, { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Plus, Edit, Trash2, User, Search, BarChart3, Download, XCircle, LineChart, Share2, ArrowUp, ArrowDown } from 'lucide-react'
import api from '../services/api'
import { logError } from '../services/logger'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts'
import FifaPlayerCard from '../components/FifaPlayerCard'
import PlayerHistoryChartModal from '../components/players/PlayerHistoryChartModal'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'

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

  const [chartModal, setChartModal] = useState<{ isOpen: boolean; playerId: number | null; playerName: string }>({ isOpen: false, playerId: null, playerName: '' })

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
    rank: number
    rank_change: number
    goals: number
    assists: number
    goals_conceded: number
    goals_conceded_per_game: number
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
    trend?: 'up' | 'down' | 'neutral'
  }
  const [showGeneralStats, setShowGeneralStats] = useState(false)
  const [generalStatsLoading, setGeneralStatsLoading] = useState(false)
  const [generalStatsRows, setGeneralStatsRows] = useState<GeneralStatsRow[]>([])
  const [generalFilter, setGeneralFilter] = useState('')
  const [generalSortKey, setGeneralSortKey] = useState<keyof GeneralStatsRow>('goals')
  const [generalSortAsc, setGeneralSortAsc] = useState(false)
  
  // Novo estado para o modo de tabela
  type TableMode = 'artilharia' | 'assistentes' | 'defensores'
  const [tableMode, setTableMode] = useState<TableMode>('artilharia')

  // Efeito para ajustar ordenação quando muda o modo
  useEffect(() => {
    if (showGeneralStats) {
      openGeneralStats()
    }
  }, [tableMode])

  const openGeneralStats = async () => {
    try {
      setShowGeneralStats(true)
      setGeneralStatsLoading(true)
      const [detailedResp, sundaysResp] = await Promise.all([
        api.get('/api/stats/players/detailed'),
        api.get('/api/sundays')
      ])
      // ... resto do código de fetching (igual ao anterior até o cálculo de ranking)
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
        trend?: 'up' | 'down' | 'neutral'
      }> : []
      const sundaysList = Array.isArray(sundaysResp.data?.sundays) ? sundaysResp.data.sundays as Array<{ sunday_id: number; date: string; finished_matches?: number; craque_player_id?: number | null }> : []
      const craquesMap = new Map<number, number>()
      for (const s of sundaysList) {
        const pid = Number(s.craque_player_id || 0)
        if (pid > 0) craquesMap.set(pid, (craquesMap.get(pid) || 0) + 1)
      }
      const lastFinishedSunday = sundaysList.find(s => Number(s.finished_matches || 0) > 0) 
        || (sundaysList.length > 1 ? sundaysList[1] : sundaysList[0])
      
      const lastFinishedSundayId = lastFinishedSunday?.sunday_id || 0

      const lastGoalsMap = new Map<number, number>()
      const lastAssistsMap = new Map<number, number>()
      const lastMatchesMap = new Map<number, number>()
      const lastGoalsConcededMap = new Map<number, number>()
      const lastCleanSheetsMap = new Map<number, number>()

      if (lastFinishedSundayId) {
        const matchesResp = await api.get(`/api/sundays/${lastFinishedSundayId}/matches`)
        const matches = Array.isArray(matchesResp.data?.matches) ? matchesResp.data.matches as Array<{ match_id: number; match_number: number; status: string; team_orange_score?: number; team_black_score?: number; participants?: any[] }> : []
        const realMatches = matches.filter(m => Number(m.match_number) > 0 && String(m.status) === 'finished')
        
        // Calcular estatísticas do ÚLTIMO DOMINGO para subtrair
        for (const m of realMatches) {
           // Partidas jogadas
           if (m.participants) {
             for (const p of m.participants) {
               const pid = Number(p.player_id)
               lastMatchesMap.set(pid, (lastMatchesMap.get(pid) || 0) + 1)
               
               // Gols Sofridos no último domingo
               const conceded = p.team === 'orange' ? Number(m.team_black_score || 0) : Number(m.team_orange_score || 0)
               lastGoalsConcededMap.set(pid, (lastGoalsConcededMap.get(pid) || 0) + conceded)

               // Clean Sheets no último domingo
               if (conceded === 0) {
                 lastCleanSheetsMap.set(pid, (lastCleanSheetsMap.get(pid) || 0) + 1)
               }
             }
           }

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
        }

        // Summary Match (apenas gols/assistências)
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

      // --- CÁLCULO DE RANKING ---
      
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

      // Função de ordenação dinâmica baseada no modo
      const rankSort = (
        a: {goals: number, assists: number, name: string, goals_conceded_per_game: number, clean_sheets: number, matches: number}, 
        b: {goals: number, assists: number, name: string, goals_conceded_per_game: number, clean_sheets: number, matches: number}
      ) => {
        if (tableMode === 'artilharia') {
           // Gols > Assistências > Nome
           if (b.goals !== a.goals) return b.goals - a.goals
           if (b.assists !== a.assists) return b.assists - a.assists
        } else if (tableMode === 'assistentes') {
           // Assistências > Gols > Nome
           if (b.assists !== a.assists) return b.assists - a.assists
           if (b.goals !== a.goals) return b.goals - a.goals
        } else if (tableMode === 'defensores') {
           // Média Gols Sofridos ASC (menor é melhor) > Clean Sheets DESC > Nome
           // Importante: Jogadores com 0 jogos devem ir pro fim? Ou 0 média é bom?
           // Assumindo que 0 jogos não entra no ranking de defensores ou tem média 0 mas deve ter prioridade menor se não jogou.
           // Vamos tratar quem tem jogos > 0 primeiro se ambos tiverem 0.
           
           if (a.matches === 0 && b.matches > 0) return 1
           if (b.matches === 0 && a.matches > 0) return -1
           
           if (Math.abs(a.goals_conceded_per_game - b.goals_conceded_per_game) > 0.001) 
             return a.goals_conceded_per_game - b.goals_conceded_per_game // Menor é melhor
           
           if (b.clean_sheets !== a.clean_sheets) return b.clean_sheets - a.clean_sheets
        }
        return a.name.localeCompare(b.name)
      }

      // 1. Calcular Ranking Atual
      const currentStatsList = detailed.map(d => ({
        id: Number(d.player_id),
        name: String(d.name),
        goals: Number(d.total_goals_scored || 0),
        assists: Number(d.total_assists || 0),
        goals_conceded_per_game: Number(d.goals_conceded_per_game || 0),
        clean_sheets: Number(cleanSheetsMap.get(Number(d.player_id)) || 0),
        matches: Number(d.total_games_played || 0)
      })).sort(rankSort)

      const currentRankMap = new Map<number, number>()
      currentStatsList.forEach((p, index) => currentRankMap.set(p.id, index + 1))

      // 2. Calcular Ranking Anterior (subtraindo o último domingo)
      const prevStatsList = detailed.map(d => {
        const pid = Number(d.player_id)
        const currentG = Number(d.total_goals_scored || 0)
        const currentA = Number(d.total_assists || 0)
        const currentMatches = Number(d.total_games_played || 0)
        const currentConceded = Number(d.total_goals_conceded || 0)
        const currentClean = Number(cleanSheetsMap.get(pid) || 0)

        const lastG = lastGoalsMap.get(pid) || 0
        const lastA = lastAssistsMap.get(pid) || 0
        const lastM = lastMatchesMap.get(pid) || 0
        const lastConceded = lastGoalsConcededMap.get(pid) || 0
        const lastClean = lastCleanSheetsMap.get(pid) || 0

        const prevG = Math.max(0, currentG - lastG)
        const prevA = Math.max(0, currentA - lastA)
        const prevM = Math.max(0, currentMatches - lastM)
        const prevConceded = Math.max(0, currentConceded - lastConceded)
        const prevClean = Math.max(0, currentClean - lastClean)
        const prevAvgConceded = prevM > 0 ? prevConceded / prevM : 0

        return {
          id: pid,
          name: String(d.name),
          goals: prevG,
          assists: prevA,
          goals_conceded_per_game: prevAvgConceded,
          clean_sheets: prevClean,
          matches: prevM
        }
      }).sort(rankSort)

      const prevRankMap = new Map<number, number>()
      prevStatsList.forEach((p, index) => prevRankMap.set(p.id, index + 1))

      // --- FIM CÁLCULO DE RANKING ---

      const baseMap = new Map<number, { name: string; is_goalkeeper: boolean }>()
      for (const pl of players) baseMap.set(pl.id, { name: pl.name, is_goalkeeper: pl.is_goalkeeper })
      const rows: GeneralStatsRow[] = detailed.map(d => {
        const pid = Number(d.player_id)
        const curRank = currentRankMap.get(pid) || 999
        const preRank = prevRankMap.get(pid) || 999
        const change = (preRank !== 999 && curRank !== 999) ? (preRank - curRank) : 0

        return {
          player_id: Number(d.player_id),
          name: baseMap.get(Number(d.player_id))?.name || String(d.name),
          is_goalkeeper: !!(baseMap.get(Number(d.player_id))?.is_goalkeeper || d.is_goalkeeper),
          rank: curRank,
          rank_change: change,
          goals: Number(d.total_goals_scored || 0),
          assists: Number(d.total_assists || 0),
          goals_conceded: Number(d.total_goals_conceded || 0),
          goals_conceded_per_game: Number(d.goals_conceded_per_game || 0),
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
          trend: d.trend || 'neutral'
        }
      })
      
      // Ordena a lista final para exibição inicial de acordo com o ranking calculado
      rows.sort((a, b) => a.rank - b.rank)
      
      setGeneralStatsRows(rows)
    } catch {
      toast.error('Erro ao carregar estatísticas gerais')
      setGeneralStatsRows([])
    } finally {
      setGeneralStatsLoading(false)
    }
  }

  // Ajuste na ordenação visual para respeitar o ranking quando a chave for padrão
  const sortedAndFilteredGeneralRows = generalStatsRows
    .filter(r => r.name.toLowerCase().includes(generalFilter.toLowerCase()))
    .sort((a, b) => {
      // Se o usuário clicou para ordenar por outra coluna, respeita a coluna
      // Se não, respeita o ranking do modo atual
      if (generalSortKey === 'goals' && tableMode === 'artilharia') return a.rank - b.rank
      if (generalSortKey === 'assists' && tableMode === 'assistentes') return a.rank - b.rank
      if (generalSortKey === 'goals_conceded_per_game' && tableMode === 'defensores') return a.rank - b.rank
      
      const va = a[generalSortKey]
      const vb = b[generalSortKey]
      const cmp = typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb)
        : Number(vb) - Number(va)
      return generalSortAsc ? -cmp : cmp
    })

  const [generalStatsSharing, setGeneralStatsSharing] = useState(false)
  const generalStatsRef = useRef<HTMLDivElement>(null)

  const exportGeneralStatsImage = async () => {
    if (generalStatsSharing) return
    try {
      setGeneralStatsSharing(true)
      
      // Capturar apenas os 25 primeiros registros da tabela atual
      // Vamos criar um elemento temporário fora da tela, preenchê-lo com os dados e capturá-lo
      const top25 = sortedAndFilteredGeneralRows.slice(0, 25)
      
      const tempDiv = document.createElement('div')
      tempDiv.style.position = 'absolute'
      tempDiv.style.left = '-9999px'
      tempDiv.style.top = '0'
      tempDiv.style.width = '1200px' // Largura fixa para garantir boa visualização
      tempDiv.style.backgroundColor = '#ffffff'
      tempDiv.style.padding = '20px'
      tempDiv.className = 'p-4 bg-white'
      
      // Construir HTML da tabela
      let html = `
        <h2 style="text-align:center; font-size: 24px; margin-bottom: 20px; font-weight: bold; font-family: sans-serif; color: #111;">Estatísticas Gerais (Top 25) - ${tableMode.toUpperCase()}</h2>
        <table style="width: 100%; border-collapse: collapse; font-family: sans-serif; font-size: 14px;">
          <thead>
            <tr style="background-color: #f3f4f6; border-bottom: 2px solid #e5e7eb;">
              <th style="padding: 10px; text-align: center; color: #4b5563;">#</th>
              <th style="padding: 10px; text-align: left; color: #4b5563;">Jogador</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">G</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">A</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">MGS/J</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">NG</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">C</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">D</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">J</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">V</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">E</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">MG/J</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">MG/D</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">UG</th>
              <th style="padding: 10px; text-align: center; color: #4b5563;">UA</th>
            </tr>
          </thead>
          <tbody>
      `
      
      top25.forEach((r, index) => {
        const bg = index % 2 === 0 ? '#ffffff' : '#f9fafb'
        // Ícones de seta simples
        let arrow = ''
        if (r.rank_change > 0) arrow = `<span style="color: #16a34a; font-size: 10px;">▲ ${r.rank_change}</span>`
        if (r.rank_change < 0) arrow = `<span style="color: #dc2626; font-size: 10px;">▼ ${Math.abs(r.rank_change)}</span>`
        
        let trendArrow = ''
        if (tableMode === 'defensores' && r.trend && r.trend !== 'neutral') {
           const color = r.trend === 'up' ? '#16a34a' : '#dc2626'
           const symbol = r.trend === 'up' ? '▲' : '▼'
           trendArrow = `<span style="color: ${color}; margin-left: 4px; font-size: 10px;">${symbol}</span>`
        }

        html += `
          <tr style="background-color: ${bg}; border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 8px; text-align: center; font-weight: bold; color: #4b5563;">${r.rank}º</td>
            <td style="padding: 8px; text-align: left; font-weight: 500;">
              ${r.name} ${arrow}
            </td>
            <td style="padding: 8px; text-align: center;">${r.goals}</td>
            <td style="padding: 8px; text-align: center;">${r.assists}</td>
            <td style="padding: 8px; text-align: center;">${Number(r.goals_conceded_per_game).toFixed(2)}${trendArrow}</td>
            <td style="padding: 8px; text-align: center;">${r.clean_sheets}</td>
            <td style="padding: 8px; text-align: center;">${r.craques}</td>
            <td style="padding: 8px; text-align: center;">${r.sundays}</td>
            <td style="padding: 8px; text-align: center;">${r.matches}</td>
            <td style="padding: 8px; text-align: center;">${r.wins}</td>
            <td style="padding: 8px; text-align: center;">${r.draws}</td>
            <td style="padding: 8px; text-align: center;">${Number(r.goals_per_game).toFixed(2)}</td>
            <td style="padding: 8px; text-align: center;">${Number(r.goals_per_sunday).toFixed(2)}</td>
            <td style="padding: 8px; text-align: center; background-color: #fefce8; color: #a16207; font-weight: bold;">${r.last_goals}</td>
            <td style="padding: 8px; text-align: center; background-color: #eff6ff; color: #1d4ed8; font-weight: bold;">${r.last_assists}</td>
          </tr>
        `
      })
      
      html += `
          </tbody>
        </table>
        <div style="margin-top: 10px; text-align: right; font-size: 12px; color: #6b7280; font-family: sans-serif;">
          Gerado em ${new Date().toLocaleDateString('pt-BR')}
        </div>
      `
      
      tempDiv.innerHTML = html
      document.body.appendChild(tempDiv)
      
      const canvas = await html2canvas(tempDiv, { backgroundColor: '#ffffff', scale: 2 })
      document.body.removeChild(tempDiv)
      
      const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('no_blob')
      
      const fileName = `estatisticas_top25_${tableMode}_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.png`
      const file = new File([blob], fileName, { type: 'image/png' })
      const text = `Estatísticas Gerais (Top 25) - ${tableMode.toUpperCase()}`
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Top 25 Jogadores', text })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      console.error(e)
      toast.error('Erro ao exportar imagem')
    } finally {
      setGeneralStatsSharing(false)
    }
  }

  const exportGeneralStatsXlsx = () => {
    const data = sortedAndFilteredGeneralRows.map(r => ({
      Posição: r.rank,
      Variação: r.rank_change,
      Jogador: r.name,
      Gols: r.goals,
      Assistências: r.assists,
      'Média Gols Sofridos/Jogo': Number(r.goals_conceded_per_game).toFixed(2),
      'Sem Levar Gols': r.clean_sheets,
      Craques: r.craques,
      Domingos: r.sundays,
      Jogos: r.matches,
      Vitórias: r.wins,
      Empates: r.draws,
      'Média Gols/Jogo': Number(r.goals_per_game).toFixed(2),
      'Média Gols/Domingo': Number(r.goals_per_sunday).toFixed(2),
      'Últimos Gols': r.last_goals,
      'Últimas Assistências': r.last_assists
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Estatísticas Gerais')
    XLSX.writeFile(wb, `estatisticas_gerais_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`)
  }

  const filteredPlayers = players.filter(player =>
    player.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

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
        <div className="h-10 w-full bg-gray-200 rounded animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow p-6 h-64 animate-pulse">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="rounded-full bg-gray-200 h-12 w-12"></div>
                  <div className="space-y-2">
                    <div className="h-4 w-24 bg-gray-200 rounded"></div>
                    <div className="h-3 w-16 bg-gray-200 rounded"></div>
                  </div>
                </div>
              </div>
              <div className="space-y-2 mt-4">
                <div className="h-4 bg-gray-200 rounded w-full"></div>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              </div>
            </div>
          ))}
        </div>
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
            <BarChart3 className="w-4 h-4 md:mr-2" />
            <span className="hidden md:inline">Estatísticas gerais</span>
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <Plus className="w-4 h-4 md:mr-2" />
            <span className="hidden md:inline">Novo Jogador</span>
            <span className="md:hidden">Novo</span>
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
                      loading="lazy"
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
                  onClick={(e) => { 
                    e.stopPropagation() 
                    setChartModal({ isOpen: true, playerId: player.id, playerName: player.name })
                  }}
                  className="text-gray-400 hover:text-blue-600"
                  title="Ver evolução"
                >
                  <LineChart className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleEdit(player) }}
                  className="text-gray-400 hover:text-gray-600"
                  title="Editar jogador"
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
          <div className="bg-white rounded-lg max-w-[95vw] w-full p-4 relative flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowGeneralStats(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 z-50"
            >
              <XCircle className="w-8 h-8" />
            </button>
            
            <h2 className="text-2xl font-bold mb-4 text-center mt-2">Estatísticas Gerais dos Jogadores</h2>
            
            <div className="flex flex-col space-y-3 mb-4">
              {/* Linha de Navegação (Abas) */}
              <div className="flex justify-center">
                <div className="flex border border-gray-300 rounded-md overflow-hidden shadow-sm">
                  <button
                    onClick={() => {
                       setTableMode('artilharia')
                       setGeneralSortKey('goals')
                       setGeneralSortAsc(false)
                    }}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${tableMode === 'artilharia' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    title="Artilharia"
                  >
                    Artilheiros
                  </button>
                  <button
                    onClick={() => {
                       setTableMode('assistentes')
                       setGeneralSortKey('assists')
                       setGeneralSortAsc(false)
                    }}
                    className={`px-4 py-2 text-sm font-medium border-l border-r border-gray-300 transition-colors ${tableMode === 'assistentes' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    title="Assistentes"
                  >
                    Assistentes
                  </button>
                  <button
                    onClick={() => {
                       setTableMode('defensores')
                       setGeneralSortKey('goals_conceded_per_game')
                       setGeneralSortAsc(true)
                    }}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${tableMode === 'defensores' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    title="Defensores"
                  >
                    Defensores
                  </button>
                </div>
              </div>

              {/* Linha de Filtros e Ações */}
              <div className="flex flex-col md:flex-row justify-between items-center gap-3">
                <div className="relative w-full md:w-64">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Filtrar jogador..."
                    className="pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm w-full focus:ring-primary-500 focus:border-primary-500"
                    value={generalFilter}
                    onChange={(e) => setGeneralFilter(e.target.value)}
                  />
                </div>

                <div className="flex flex-wrap justify-center gap-2">
                  <select
                    value={generalSortKey}
                    onChange={(e) => setGeneralSortKey(e.target.value as keyof GeneralStatsRow)}
                    className="pl-3 pr-8 py-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-primary-500 focus:border-primary-500"
                    title="Ordenar por"
                  >
                    <option value="goals">Gols (G)</option>
                    <option value="assists">Assistências (A)</option>
                    <option value="goals_conceded">Gols sofridos (GS)</option>
                    <option value="goals_conceded_per_game">Média Gols Sofridos (MGS/J)</option>
                    <option value="clean_sheets">Sem levar gol (NG)</option>
                    <option value="craques">Craques (C)</option>
                    <option value="matches">Partidas (J)</option>
                    <option value="wins">Vitórias (V)</option>
                    <option value="draws">Empates (E)</option>
                    <option value="sundays">Domingos (D)</option>
                    <option value="goals_per_game">Média/jogo (MG/J)</option>
                    <option value="goals_per_sunday">Média/domingo (MG/D)</option>
                    <option value="last_goals">Gols último (UG)</option>
                    <option value="last_assists">Assist. último (UA)</option>
                  </select>
                  
                  <button
                    onClick={() => setGeneralSortAsc(s => !s)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 text-gray-700"
                    title="Alternar ordem"
                  >
                    {generalSortAsc ? 'Asc' : 'Desc'}
                  </button>

                  <button
                    onClick={exportGeneralStatsImage}
                    disabled={generalStatsSharing}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 shadow-sm"
                    title="Compartilhar Imagem"
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    {generalStatsSharing ? '...' : 'Imagem'}
                  </button>
                  
                  <button
                    onClick={exportGeneralStatsXlsx}
                    className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 shadow-sm"
                    title="Exportar XLSX"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    XLSX
                  </button>
                </div>
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
                    <div className="overflow-auto max-h-[70vh]" ref={generalStatsRef}>
                      <table className="min-w-full border-collapse">
                        <thead className="sticky top-0 bg-white z-20 shadow-sm">
                          <tr>
                            <th className="sticky left-0 bg-white z-30 text-center px-2 py-2 border-b border-gray-200 w-10 text-xs font-semibold text-gray-500 uppercase shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                              #
                            </th>
                            <th className="sticky left-10 bg-white z-30 text-left px-2 py-2 border-b border-gray-200 max-w-[150px] md:max-w-[200px] shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                              Jogador
                            </th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Gols">G</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Assistências">A</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Média Gols Sofridos por Jogo">MGS/J</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Partidas Sem Levar Gols">NG</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Craques">C</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Domingos">D</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Jogos">J</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Vitórias">V</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Empates">E</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Média Gols/Jogo">MG/J</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Média Gols/Domingo">MG/D</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Últimos Gols">UG</th>
                            <th className="px-2 py-2 text-center border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase" title="Últimas Assistências">UA</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedAndFilteredGeneralRows.map(r => (
                            <tr key={r.player_id} className="hover:bg-gray-50">
                              <td className="sticky left-0 bg-white z-10 text-center px-1 py-2 border-r border-gray-200 font-bold text-xs md:text-sm text-gray-600 shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                                {r.rank}º
                              </td>
                              <td className="sticky left-10 bg-white z-10 text-left px-2 py-2 border-r border-gray-200 whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px] md:max-w-[200px] font-medium text-xs md:text-sm shadow-[1px_0_0_0_rgba(0,0,0,0.05)]" title={r.name}>
                                <div className="flex items-center space-x-1">
                                  <span className="truncate">{r.name}</span>
                                  {r.rank_change !== 0 && (
                                    <span className={`text-[10px] flex items-center ${r.rank_change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {r.rank_change > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                      {Math.abs(r.rank_change)}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">{r.goals}</td>
                               <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">{r.assists}</td>
                               <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">
                                {Number(r.goals_conceded_per_game).toFixed(2)}
                                {tableMode === 'defensores' && r.trend && r.trend !== 'neutral' && (
                                  <span className={`ml-1 inline-flex ${r.trend === 'up' ? 'text-green-600' : 'text-red-600'}`} title={r.trend === 'up' ? 'Melhorou defesa' : 'Piorou defesa'}>
                                    {r.trend === 'up' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                  </span>
                                )}
                               </td>
                               <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">{r.clean_sheets}</td>
                               <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">{r.craques}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">{r.sundays}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">{r.matches}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">{r.wins}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">{r.draws}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">{Number(r.goals_per_game).toFixed(2)}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-semibold text-xs md:text-sm">{Number(r.goals_per_sunday).toFixed(2)}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-bold text-xs md:text-sm bg-yellow-50 text-yellow-700">{r.last_goals}</td>
                              <td className="text-center tabular-nums px-2 py-2 font-bold text-xs md:text-sm bg-blue-50 text-blue-700">{r.last_assists}</td>
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
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowDetails(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 z-50"
            >
              <XCircle className="w-8 h-8" />
            </button>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">{details.player.name}</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="w-full flex justify-center items-start">
                  <div className="w-72" id="player-card-container">
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
                
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={async () => {
                      try {
                        const el = document.getElementById('player-card-container')
                        if (!el) return
                        
                        // Temporariamente ajustar para captura de alta qualidade
                        const canvas = await html2canvas(el, { 
                          backgroundColor: null,
                          scale: 2,
                          useCORS: true,
                          allowTaint: true
                        })
                        
                        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
                        if (!blob) return
                        
                        const fileName = `card_${details.player.name.replace(/\s+/g, '_').toLowerCase()}.png`
                        const file = new File([blob], fileName, { type: 'image/png' })
                        
                        if (navigator.canShare && navigator.canShare({ files: [file] })) {
                          await navigator.share({
                            files: [file],
                            title: `Card - ${details.player.name}`,
                            text: `Confira o card de ${details.player.name}!`
                          })
                        } else {
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = fileName
                          document.body.appendChild(a)
                          a.click()
                          document.body.removeChild(a)
                          URL.revokeObjectURL(url)
                        }
                      } catch (err) {
                        console.error(err)
                        toast.error('Erro ao compartilhar card')
                      }
                    }}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 shadow-sm"
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Compartilhar Card
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
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
      {/* Modal de Gráfico de Evolução */}
      <PlayerHistoryChartModal
        isOpen={chartModal.isOpen}
        onClose={() => setChartModal({ isOpen: false, playerId: null, playerName: '' })}
        playerId={chartModal.playerId}
        playerName={chartModal.playerName}
      />
    </div>
  )
}

export default Players
