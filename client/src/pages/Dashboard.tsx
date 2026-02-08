import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Users, Trophy, Calendar, TrendingUp, Crown, Shield } from 'lucide-react'
import { toast } from 'sonner'
import api from '../services/api'
import { logError } from '../services/logger'

interface DashboardStats {
  total_players: number
  total_matches: number
  total_sundays: number
  avg_goals_per_match: number
}

interface RecentMatch {
  id: number
  match_date: string
  team_blue_score: number
  team_orange_score: number
  winning_team: string
  tie_decider_winner?: 'black' | 'orange' | null
}

interface ApiRecentMatch {
  match_id: number
  sunday_date: string
  team_black_score: number
  team_orange_score: number
  winner_team: string
  tie_decider_winner?: 'black' | 'orange' | null
}

interface TopSummary {
  id: number
  name: string
  photo_url?: string
  count: number
}

interface ApiTopItem {
  player_id: number
  name: string
  photo_url?: string
}

// Componente otimizado para fotos com lazy loading
const PlayerPhoto: React.FC<{
  playerId: number
  name: string
  photoUrl?: string
  className?: string
  fallbackClassName?: string
}> = ({ playerId, name, photoUrl, className = '', fallbackClassName = '' }) => {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    // Usa photo_url direta se disponível, senão tenta a API
    if (photoUrl) {
      setImgSrc(photoUrl)
    } else {
      setImgSrc(`/api/players/${playerId}/photo`)
    }
    setLoading(true)
    setError(false)
  }, [playerId, photoUrl])

  const handleError = () => {
    setError(true)
    setLoading(false)
  }

  const handleLoad = () => {
    setLoading(false)
  }

  if (error || !imgSrc) {
    return (
      <div className={`${className} ${fallbackClassName} flex items-center justify-center bg-gradient-to-br from-gray-200 to-gray-300 text-gray-600 font-bold text-lg`}>
        {name.slice(0, 1).toUpperCase()}
      </div>
    )
  }

  return (
    <>
      {loading && (
        <div className={`${className} animate-pulse bg-gradient-to-br from-gray-200 to-gray-300`} />
      )}
      <img
        src={imgSrc}
        alt={name}
        loading="lazy"
        className={`${className} object-cover ${loading ? 'hidden' : ''}`}
        onError={handleError}
        onLoad={handleLoad}
      />
    </>
  )
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([])
  const [topScorers, setTopScorers] = useState<TopSummary[]>([])
  const [topAssisters, setTopAssisters] = useState<TopSummary[]>([])
  const [topGoalkeepers, setTopGoalkeepers] = useState<TopSummary[]>([])
  const [topDefenders, setTopDefenders] = useState<TopSummary[]>([])
  const [photoMap, setPhotoMap] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const parseMatchDate = (dateStr: string) => {
    const s = String(dateStr || '')
    if (!s) return new Date(NaN)
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s)
    if (isDateOnly) return new Date(`${s}T00:00:00`)
    const match = s.match(/^(\d{4}-\d{2}-\d{2})/)
    if (match) return new Date(`${match[1]}T00:00:00`)
    return new Date(s.replace(' ', 'T'))
  }

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      const statsResponse = await api.get('/api/stats/dashboard')

      const general = statsResponse.data?.general || {}
      const recent = statsResponse.data?.recentMatches || []
      const topS = statsResponse.data?.topScorers || []
      const topA = statsResponse.data?.topAssisters || []
      const topG = statsResponse.data?.topGoalkeepers || []
      const topD = statsResponse.data?.topDefenders || []

      setStats({
        total_players: general.total_players || 0,
        total_matches: general.total_matches || 0,
        total_sundays: general.total_sundays || 0,
        avg_goals_per_match: Number(general.avg_goals_per_match || 0)
      })
      const mappedRecent: RecentMatch[] = recent.map((m: unknown) => ({
        id: (m as ApiRecentMatch).match_id,
        match_date: (m as ApiRecentMatch).sunday_date,
        team_blue_score: (m as ApiRecentMatch).team_black_score,
        team_orange_score: (m as ApiRecentMatch).team_orange_score,
        winning_team: (m as ApiRecentMatch).winner_team,
        tie_decider_winner: (m as ApiRecentMatch).tie_decider_winner || null
      }))
      const currentSunday = mappedRecent.length ? mappedRecent[0].match_date : ''
      setRecentMatches(mappedRecent.filter((r: RecentMatch) => r.match_date === currentSunday))
      const mapTop = (arr: unknown[], field: 'goals' | 'assists' | 'conceded') => (arr as (ApiTopItem & { total_goals_scored?: number; total_assists?: number; total_goals_conceded?: number; avg_goals_conceded?: number })[]).map((p) => ({
        id: Number(p.player_id || 0),
        name: String(p.name || ''),
        photo_url: p.photo_url || '',
        count: Number(
          field === 'goals' ? (p.total_goals_scored || 0) :
            field === 'assists' ? (p.total_assists || 0) :
              (p.avg_goals_conceded ?? p.total_goals_conceded ?? 0)
        )
      }))
      const topSList = mapTop(topS, 'goals')
      const topAList = mapTop(topA, 'assists')
      const topGList = mapTop(topG, 'conceded')
      const topDList = mapTop(topD, 'conceded')
      setTopScorers(topSList)
      setTopAssisters(topAList)
      setTopGoalkeepers(topGList)
      setTopDefenders(topDList)
      try {
        const all = [...topSList, ...topAList, ...topGList, ...topDList]
        const unique = Array.from(new Map(all.map(p => [p.id, p])).values())
        type PlayerMeta = { player_id: number; photo_url?: string; photo_mime?: string | null; has_photo?: boolean }
        let metaById: Map<number, PlayerMeta> = new Map()
        try {
          const playersResp = await api.get('/api/players')
          const plist = ((playersResp.data?.players || []) as PlayerMeta[]).filter(p => typeof p.player_id === 'number')
          metaById = new Map(plist.map(p => [p.player_id, p]))
        } catch { metaById = new Map() }
        const results = await Promise.all(unique.map(async (pl) => {
          const meta = metaById.get(pl.id)
          const directUrl = pl.photo_url || meta?.photo_url || ''
          if (directUrl) return { id: pl.id, url: directUrl }
          const canFetch = !!(meta?.photo_mime || meta?.has_photo)
          if (!canFetch) return { id: pl.id, url: '' }
          try {
            const res = await api.get(`/api/players/${pl.id}/photo?v=${Date.now()}`, { responseType: 'arraybuffer' })
            const ct = res.headers['content-type'] || meta?.photo_mime || 'image/jpeg'
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
      } catch (e) {
        logError('dashboard_photos_error', { message: String((e as Error)?.message || '') })
      }
    } catch (error) {
      toast.error('Erro ao carregar dados do dashboard')
      const status = (error as { response?: { status?: number } })?.response?.status
      const message = (error as { message?: string })?.message || ''
      logError('dashboard_load_error', { route: '/api/stats/dashboard', status, message })
    } finally {
      setLoading(false)
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
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <div className="text-sm text-gray-500">
          {new Date().toLocaleDateString('pt-BR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Link to="/players" className="block bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-primary-100 rounded-lg p-3">
              <Users className="h-6 w-6 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Jogadores</p>
              <p className="text-2xl font-semibold text-gray-900">{stats?.total_players || 0}</p>
            </div>
          </div>
        </Link>

        <Link to="/matches" className="block bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-success-100 rounded-lg p-3">
              <Trophy className="h-6 w-6 text-success-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Partidas</p>
              <p className="text-2xl font-semibold text-gray-900">{stats?.total_matches || 0}</p>
            </div>
          </div>
        </Link>

        <Link to="/sundays" className="block bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-warning-100 rounded-lg p-3">
              <Calendar className="h-6 w-6 text-warning-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Domingos</p>
              <p className="text-2xl font-semibold text-gray-900">{stats?.total_sundays || 0}</p>
            </div>
          </div>
        </Link>

        <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer" onClick={() => navigate('/players?stats=artilharia')}>
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-danger-100 rounded-lg p-3">
              <TrendingUp className="h-6 w-6 text-danger-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Média Gols/Partida</p>
              <p className="text-2xl font-semibold text-gray-900">{stats?.avg_goals_per_match?.toFixed(1) || '0.0'}</p>
            </div>
          </div>
        </div>
      </div>



      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Matches */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">Partidas Recentes</h3>
              <Link to="/matches" className="text-sm text-primary-600 hover:text-primary-700">
                Ver todas
              </Link>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {recentMatches.length > 0 ? (
                recentMatches.map((match) => (
                  <div key={match.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
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
                      <span className="text-xs text-gray-600">
                        {(() => {
                          const wt = match.winning_team
                          const tieWinner = match.tie_decider_winner
                          if (wt === 'black') return '(preto)'
                          if (wt === 'orange') return '(laranja)'
                          if (wt === 'draw') {
                            if (tieWinner === 'black') return '(preto)'
                            if (tieWinner === 'orange') return '(laranja)'
                          }
                          return ''
                        })()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500">
                      {parseMatchDate(match.match_date).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-center py-4">Nenhuma partida recente</p>
              )}
            </div>
          </div>
        </div>

        {/* Top Categories - New Responsive Design */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Estatísticas Gerais
              </h3>
              <Link to="/players" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                Ver todos →
              </Link>
            </div>
          </div>
          <div className="p-4 md:p-6">
            {/* Grid responsivo: 1 coluna mobile, 2 colunas desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">

              {/* Top Goleadores */}
              <div
                className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100 hover:shadow-md transition-all duration-300 cursor-pointer"
                onClick={() => navigate('/players?stats=artilharia')}
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-orange-400 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold text-sm">⚽</span>
                  </div>
                  <h4 className="font-semibold text-gray-800">Top Goleadores</h4>
                </div>
                <div className="flex justify-center gap-3 md:gap-4">
                  {topScorers.length > 0 ? (
                    topScorers.slice(0, 3).map((p, index) => (
                      <div
                        key={`sc-${p.id}`}
                        className={`relative flex flex-col items-center transition-transform duration-200 hover:scale-105 ${index === 0 ? 'order-2' : index === 1 ? 'order-1' : 'order-3'}`}
                      >
                        {/* Medal Container */}
                        <div className={`relative ${index === 0 ? 'mb-1' : ''}`}>
                          {/* Crown for first place */}
                          {index === 0 && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                              <Crown className="w-5 h-5 text-yellow-500 drop-shadow-md" />
                            </div>
                          )}
                          {/* Photo */}
                          <div className={`
                            ${index === 0 ? 'w-16 h-16 md:w-20 md:h-20 ring-4 ring-yellow-400' :
                              index === 1 ? 'w-14 h-14 md:w-16 md:h-16 ring-3 ring-gray-400' :
                                'w-14 h-14 md:w-16 md:h-16 ring-3 ring-orange-400'}
                            rounded-full overflow-hidden bg-gray-200 shadow-lg
                          `}>
                            <PlayerPhoto
                              playerId={p.id}
                              name={p.name}
                              photoUrl={p.photo_url || photoMap[p.id]}
                              className="w-full h-full"
                            />
                          </div>
                          {/* Medal Badge */}
                          <div className={`
                            absolute -bottom-1 -right-1 w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center shadow-lg font-bold text-xs
                            ${index === 0 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-yellow-900' :
                              index === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-gray-800' :
                                'bg-gradient-to-br from-orange-300 to-orange-500 text-orange-900'}
                          `}>
                            {index + 1}º
                          </div>
                        </div>
                        {/* Name and Stats */}
                        <p className="text-xs md:text-sm font-medium text-gray-700 mt-2 text-center max-w-[80px] truncate" title={p.name}>
                          {p.name.split(' ')[0]}
                        </p>
                        <p className="text-xs font-bold text-amber-600">{p.count} gols</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-400 text-sm py-4">Sem dados disponíveis</div>
                  )}
                </div>
              </div>

              {/* Top Assistentes */}
              <div
                className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100 hover:shadow-md transition-all duration-300 cursor-pointer"
                onClick={() => navigate('/players?stats=assistentes')}
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold text-sm">🎯</span>
                  </div>
                  <h4 className="font-semibold text-gray-800">Top Assistentes</h4>
                </div>
                <div className="flex justify-center gap-3 md:gap-4">
                  {topAssisters.length > 0 ? (
                    topAssisters.slice(0, 3).map((p, index) => (
                      <div
                        key={`as-${p.id}`}
                        className={`relative flex flex-col items-center transition-transform duration-200 hover:scale-105 ${index === 0 ? 'order-2' : index === 1 ? 'order-1' : 'order-3'}`}
                      >
                        <div className={`relative ${index === 0 ? 'mb-1' : ''}`}>
                          {index === 0 && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                              <Crown className="w-5 h-5 text-yellow-500 drop-shadow-md" />
                            </div>
                          )}
                          <div className={`
                            ${index === 0 ? 'w-16 h-16 md:w-20 md:h-20 ring-4 ring-yellow-400' :
                              index === 1 ? 'w-14 h-14 md:w-16 md:h-16 ring-3 ring-gray-400' :
                                'w-14 h-14 md:w-16 md:h-16 ring-3 ring-orange-400'}
                            rounded-full overflow-hidden bg-gray-200 shadow-lg
                          `}>
                            <PlayerPhoto
                              playerId={p.id}
                              name={p.name}
                              photoUrl={p.photo_url || photoMap[p.id]}
                              className="w-full h-full"
                            />
                          </div>
                          <div className={`
                            absolute -bottom-1 -right-1 w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center shadow-lg font-bold text-xs
                            ${index === 0 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-yellow-900' :
                              index === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-gray-800' :
                                'bg-gradient-to-br from-orange-300 to-orange-500 text-orange-900'}
                          `}>
                            {index + 1}º
                          </div>
                        </div>
                        <p className="text-xs md:text-sm font-medium text-gray-700 mt-2 text-center max-w-[80px] truncate" title={p.name}>
                          {p.name.split(' ')[0]}
                        </p>
                        <p className="text-xs font-bold text-blue-600">{p.count} assist.</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-400 text-sm py-4">Sem dados disponíveis</div>
                  )}
                </div>
              </div>

              {/* Top Defensores */}
              <div
                className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100 hover:shadow-md transition-all duration-300 cursor-pointer"
                onClick={() => navigate('/players?stats=defensores')}
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-lg flex items-center justify-center">
                    <Shield className="w-4 h-4 text-white" />
                  </div>
                  <h4 className="font-semibold text-gray-800">Top Defensores</h4>
                </div>
                <div className="flex justify-center gap-3 md:gap-4">
                  {topDefenders.length > 0 ? (
                    topDefenders.slice(0, 3).map((p, index) => (
                      <div
                        key={`df-${p.id}`}
                        className={`relative flex flex-col items-center transition-transform duration-200 hover:scale-105 ${index === 0 ? 'order-2' : index === 1 ? 'order-1' : 'order-3'}`}
                      >
                        <div className={`relative ${index === 0 ? 'mb-1' : ''}`}>
                          {index === 0 && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                              <Crown className="w-5 h-5 text-yellow-500 drop-shadow-md" />
                            </div>
                          )}
                          <div className={`
                            ${index === 0 ? 'w-16 h-16 md:w-20 md:h-20 ring-4 ring-yellow-400' :
                              index === 1 ? 'w-14 h-14 md:w-16 md:h-16 ring-3 ring-gray-400' :
                                'w-14 h-14 md:w-16 md:h-16 ring-3 ring-orange-400'}
                            rounded-full overflow-hidden bg-gray-200 shadow-lg
                          `}>
                            <PlayerPhoto
                              playerId={p.id}
                              name={p.name}
                              photoUrl={p.photo_url || photoMap[p.id]}
                              className="w-full h-full"
                            />
                          </div>
                          <div className={`
                            absolute -bottom-1 -right-1 w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center shadow-lg font-bold text-xs
                            ${index === 0 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-yellow-900' :
                              index === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-gray-800' :
                                'bg-gradient-to-br from-orange-300 to-orange-500 text-orange-900'}
                          `}>
                            {index + 1}º
                          </div>
                        </div>
                        <p className="text-xs md:text-sm font-medium text-gray-700 mt-2 text-center max-w-[80px] truncate" title={p.name}>
                          {p.name.split(' ')[0]}
                        </p>
                        <p className="text-xs font-bold text-emerald-600">{p.count.toFixed ? p.count.toFixed(2) : p.count} avg</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-400 text-sm py-4">Sem dados disponíveis</div>
                  )}
                </div>
              </div>

              {/* Top Goleiros */}
              <div
                className="bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-xl p-4 border border-purple-100 hover:shadow-md transition-all duration-300 cursor-pointer"
                onClick={() => navigate('/players?stats=goleiros')}
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-purple-400 to-fuchsia-500 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold text-sm">🧤</span>
                  </div>
                  <h4 className="font-semibold text-gray-800">Top Goleiros</h4>
                </div>
                <div className="flex justify-center gap-3 md:gap-4">
                  {topGoalkeepers.length > 0 ? (
                    topGoalkeepers.slice(0, 3).map((p, index) => (
                      <div
                        key={`gk-${p.id}`}
                        className={`relative flex flex-col items-center transition-transform duration-200 hover:scale-105 ${index === 0 ? 'order-2' : index === 1 ? 'order-1' : 'order-3'}`}
                      >
                        <div className={`relative ${index === 0 ? 'mb-1' : ''}`}>
                          {index === 0 && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                              <Crown className="w-5 h-5 text-yellow-500 drop-shadow-md" />
                            </div>
                          )}
                          <div className={`
                            ${index === 0 ? 'w-16 h-16 md:w-20 md:h-20 ring-4 ring-yellow-400' :
                              index === 1 ? 'w-14 h-14 md:w-16 md:h-16 ring-3 ring-gray-400' :
                                'w-14 h-14 md:w-16 md:h-16 ring-3 ring-orange-400'}
                            rounded-full overflow-hidden bg-gray-200 shadow-lg
                          `}>
                            <PlayerPhoto
                              playerId={p.id}
                              name={p.name}
                              photoUrl={p.photo_url || photoMap[p.id]}
                              className="w-full h-full"
                            />
                          </div>
                          <div className={`
                            absolute -bottom-1 -right-1 w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center shadow-lg font-bold text-xs
                            ${index === 0 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-yellow-900' :
                              index === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-gray-800' :
                                'bg-gradient-to-br from-orange-300 to-orange-500 text-orange-900'}
                          `}>
                            {index + 1}º
                          </div>
                        </div>
                        <p className="text-xs md:text-sm font-medium text-gray-700 mt-2 text-center max-w-[80px] truncate" title={p.name}>
                          {p.name.split(' ')[0]}
                        </p>
                        <p className="text-xs font-bold text-purple-600">{p.count.toFixed ? p.count.toFixed(2) : p.count} avg</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-400 text-sm py-4">Sem dados disponíveis</div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
