import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Users, Trophy, Calendar, TrendingUp, Award } from 'lucide-react'
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

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([])
  const [topScorers, setTopScorers] = useState<TopSummary[]>([])
  const [topAssisters, setTopAssisters] = useState<TopSummary[]>([])
  const [topGoalkeepers, setTopGoalkeepers] = useState<TopSummary[]>([])
  const [photoMap, setPhotoMap] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)

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
      setTopScorers(topSList)
      setTopAssisters(topAList)
      setTopGoalkeepers(topGList)
      try {
        const all = [...topSList, ...topAList, ...topGList]
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

  const medalClass = (index: number) => {
    if (index === 0) return 'bg-yellow-400 text-yellow-900'
    if (index === 1) return 'bg-gray-300 text-gray-800'
    return 'bg-orange-500 text-orange-100'
  }

  type ModalType = 'scorers' | 'assisters' | 'goalkeepers' | 'all' | null
  const [modalOpen, setModalOpen] = useState<ModalType>(null)
  const [category, setCategory] = useState<'all' | 'scorers' | 'assisters' | 'goalkeepers'>('all')
  const [sortKey, setSortKey] = useState<'goals'|'assists'|'conceded'|'games'|'wins'|'draws'|'losses'|'gpg'|'gps'>('goals')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc')
  interface DetailedPlayer {
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
    gk_avg_conceded_year: number
    gk_sundays_year: number
    total_sundays_year: number
    gk_sunday_participation_pct_year: number
  }
  const [detailedPlayers, setDetailedPlayers] = useState<DetailedPlayer[]>([])
  const openModal = async (type: ModalType) => {
    try {
      const resp = await api.get('/api/stats/players/detailed')
      const list = (resp.data?.players || []) as DetailedPlayer[]
      setDetailedPlayers(list.map(p => ({
        player_id: Number(p.player_id),
        name: String(p.name),
        photo_url: p.photo_url || '',
        is_goalkeeper: !!p.is_goalkeeper,
        total_games_played: Number(p.total_games_played || 0),
        total_goals_scored: Number(p.total_goals_scored || 0),
        total_assists: Number(p.total_assists || 0),
        total_goals_conceded: Number(p.total_goals_conceded || 0),
        goals_per_game: Number(p.goals_per_game || 0),
        assists_per_game: Number(p.assists_per_game || 0),
        goals_conceded_per_game: Number(p.goals_conceded_per_game || 0),
        games_finished: Number(p.games_finished || 0),
        games_won: Number(p.games_won || 0),
        games_lost: Number(p.games_lost || 0),
        games_drawn: Number(p.games_drawn || 0),
        sundays_played: Number(p.sundays_played || 0),
        goals_per_sunday: Number(p.goals_per_sunday || 0),
        gk_avg_conceded_year: Number(p.gk_avg_conceded_year || 0),
        gk_sundays_year: Number(p.gk_sundays_year || 0),
        total_sundays_year: Number(p.total_sundays_year || 0),
        gk_sunday_participation_pct_year: Number(p.gk_sunday_participation_pct_year || 0),
      })))
      setModalOpen(type)
      setCategory(type ? type : 'all')
      if (type === 'scorers') { setSortKey('goals'); setSortDir('desc') }
      else if (type === 'assisters') { setSortKey('assists'); setSortDir('desc') }
      else if (type === 'goalkeepers') { setSortKey('conceded'); setSortDir('asc') }
      else { setSortKey('goals'); setSortDir('desc') }
    } catch (e) {
      toast.error('Erro ao carregar lista completa')
    }
  }
  const sortedForModal = () => {
    let list = [...detailedPlayers]
    if (category === 'goalkeepers') list = list.filter(p => p.is_goalkeeper)
    const val = (p: DetailedPlayer) => {
      if (sortKey === 'goals') return p.total_goals_scored
      if (sortKey === 'assists') return p.total_assists
      if (sortKey === 'conceded') return p.total_goals_conceded
      if (sortKey === 'games') return p.total_games_played
      if (sortKey === 'wins') return p.games_won
      if (sortKey === 'draws') return p.games_drawn
      if (sortKey === 'losses') return p.games_lost
      if (sortKey === 'gpg') return p.goals_per_game
      return p.goals_per_sunday
    }
    list.sort((a, b) => {
      const diff = val(a) - val(b)
      return sortDir === 'asc' ? diff : -diff
    })
    return list
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

        <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer" onClick={() => openModal('all')}>
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

      {/* History Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Link to="/sundays" className="block bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-gray-100 rounded-lg p-3">
              <Calendar className="h-6 w-6 text-gray-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Histórico</p>
              <p className="text-sm text-gray-600">Alternar entre domingos</p>
            </div>
          </div>
        </Link>
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
                      {new Date(match.match_date).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-center py-4">Nenhuma partida recente</p>
              )}
            </div>
          </div>
        </div>

        {/* Top Categories */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">Tops</h3>
              <Link to="/players" className="text-sm text-primary-600 hover:text-primary-700">
                Ver todos
              </Link>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-6">
              <div>
                <div className="text-sm font-medium text-gray-700 mb-3 cursor-pointer" onClick={() => openModal('scorers')}>Top Goleadores</div>
                <div className="flex items-center space-x-4">
                  {topScorers.length > 0 ? (
                    topScorers.map((p, index) => (
                      <div key={`sc-${p.id}`} className="relative">
                        <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-200">
                          { (p.photo_url || photoMap[p.id]) ? (
                            <img src={p.photo_url || photoMap[p.id]} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">{p.name.slice(0,1)}</div>
                          ) }
                        </div>
                        <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center shadow ${medalClass(index)}`}>
                          <Award className="w-3 h-3" />
                        </div>
                        <div className="text-xs text-center mt-1 text-gray-700">{p.count} gols</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-500">Sem dados</div>
                  )}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 mb-3 cursor-pointer" onClick={() => openModal('assisters')}>Top Assistentes</div>
                <div className="flex items-center space-x-4">
                  {topAssisters.length > 0 ? (
                    topAssisters.map((p, index) => (
                      <div key={`as-${p.id}`} className="relative">
                        <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-200">
                          { (p.photo_url || photoMap[p.id]) ? (
                            <img src={p.photo_url || photoMap[p.id]} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">{p.name.slice(0,1)}</div>
                          ) }
                        </div>
                        <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center shadow ${medalClass(index)}`}>
                          <Award className="w-3 h-3" />
                        </div>
                        <div className="text-xs text-center mt-1 text-gray-700">{p.count} assistências</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-500">Sem dados</div>
                  )}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 mb-3 cursor-pointer" onClick={() => openModal('goalkeepers')}>Top Goleiros menos vazados</div>
                <div className="flex items-center space-x-4">
                  {topGoalkeepers.length > 0 ? (
                    topGoalkeepers.map((p, index) => (
                      <div key={`gk-${p.id}`} className="relative">
                        <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-200">
                          { (p.photo_url || photoMap[p.id]) ? (
                            <img src={p.photo_url || photoMap[p.id]} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">{p.name.slice(0,1)}</div>
                          ) }
                        </div>
                        <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center shadow ${medalClass(index)}`}>
                          <Award className="w-3 h-3" />
                        </div>
                        <div className="text-xs text-center mt-1 text-gray-700">{p.count.toFixed ? p.count.toFixed(2) : p.count} média</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-500">Sem dados</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {modalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="text-lg font-medium text-gray-900">
                {category === 'scorers' ? 'Lista completa — Goleadores' :
                 category === 'assisters' ? 'Lista completa — Assistentes' :
                 category === 'goalkeepers' ? 'Lista completa — Goleiros menos vazados' :
                 'Lista completa — Todos os jogadores'}
              </div>
              <button className="text-sm text-primary-600 hover:text-primary-700" onClick={() => setModalOpen(null)}>Fechar</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Filtro</span>
                  <select className="border rounded px-2 py-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value as 'all'|'scorers'|'assisters'|'goalkeepers')}>
                    <option value="all">Todos</option>
                    <option value="scorers">Goleadores</option>
                    <option value="assisters">Assistentes</option>
                    <option value="goalkeepers">Goleiros</option>
                  </select>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Ordenar por</span>
                  <select className="border rounded px-2 py-1 text-sm" value={sortKey} onChange={(e) => setSortKey(e.target.value as 'goals'|'assists'|'conceded'|'games'|'wins'|'draws'|'losses'|'gpg'|'gps')}>
                    <option value="goals">Gols</option>
                    <option value="assists">Assistências</option>
                    <option value="conceded">Gols sofridos</option>
                    <option value="games">Partidas</option>
                    <option value="wins">Vitórias</option>
                    <option value="draws">Empates</option>
                    <option value="losses">Derrotas</option>
                    <option value="gpg">Média/jogo (gols)</option>
                    <option value="gps">Média/domingo (gols)</option>
                  </select>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Direção</span>
                  <select className="border rounded px-2 py-1 text-sm" value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc'|'desc')}>
                    <option value="desc">Desc</option>
                    <option value="asc">Asc</option>
                  </select>
                </div>
              </div>
              <div className="border rounded-lg">
                <div className="max-h-[60vh] overflow-y-auto">
                  <table className="min-w-full table-fixed text-sm">
                    <thead className="sticky top-0 bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 text-left w-12">#</th>
                        <th className="px-3 py-2 text-left w-64">Jogador</th>
                        <th className="px-3 py-2 text-center w-24">Gols</th>
                        <th className="px-3 py-2 text-center w-28">Assistências</th>
                        <th className="px-3 py-2 text-center w-28">Gols sofridos</th>
                        <th className="px-3 py-2 text-center w-24">Partidas</th>
                        <th className="px-3 py-2 text-center w-24">Vitórias</th>
                        <th className="px-3 py-2 text-center w-24">Empates</th>
                        <th className="px-3 py-2 text-center w-24">Derrotas</th>
                        <th className="px-3 py-2 text-center w-36">Média/jogo (gols)</th>
                        <th className="px-3 py-2 text-center w-40">Média/domingo (gols)</th>
                        {category === 'goalkeepers' && (
                          <>
                            <th className="px-3 py-2 text-center w-44">Média/jogo (goleiro, ano)</th>
                            <th className="px-3 py-2 text-center w-44">% domingos (goleiro, ano)</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedForModal().map((p, idx) => (
                        <tr key={`dl-${p.player_id}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center space-x-2">
                              <div className="w-8 h-8 rounded overflow-hidden bg-gray-200 flex-shrink-0">
                                {p.photo_url ? (
                                  <img src={p.photo_url} alt={p.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">{p.name.slice(0,1)}</div>
                                )}
                              </div>
                              <div className="text-gray-900 truncate">{p.name}</div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center text-gray-900">{p.total_goals_scored}</td>
                          <td className="px-3 py-2 text-center text-gray-900">{p.total_assists}</td>
                          <td className="px-3 py-2 text-center text-gray-900">{p.total_goals_conceded}</td>
                          <td className="px-3 py-2 text-center text-gray-900">{p.total_games_played}</td>
                          <td className="px-3 py-2 text-center text-gray-900">{p.games_won}</td>
                          <td className="px-3 py-2 text-center text-gray-900">{p.games_drawn}</td>
                          <td className="px-3 py-2 text-center text-gray-900">{p.games_lost}</td>
                          <td className="px-3 py-2 text-center text-gray-900">{p.goals_per_game.toFixed(2)}</td>
                          <td className="px-3 py-2 text-center text-gray-900">{p.goals_per_sunday.toFixed(2)}</td>
                          {category === 'goalkeepers' && (
                            <>
                              <td className="px-3 py-2 text-center text-gray-900">{Number(p.gk_avg_conceded_year || 0).toFixed(2)}</td>
                              <td className="px-3 py-2 text-center text-gray-900">
                                {Number(p.gk_sunday_participation_pct_year || 0).toFixed(0)}%
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                      {sortedForModal().length === 0 && (
                        <tr>
                          <td className="px-3 py-6 text-center text-gray-500" colSpan={11}>Nenhum jogador encontrado</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
