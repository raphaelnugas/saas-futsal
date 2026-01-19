import React, { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import api from '../services/api'
import { logError } from '../services/logger'

type MatchStatus = 'scheduled' | 'in_progress' | 'finished'
type TeamColor = 'black' | 'orange'

interface Player {
  id: number
  name: string
  is_goalkeeper: boolean
  photo_url?: string
}

interface Match {
  id: number
  match_date: string
  team_blue_score: number
  team_orange_score: number
  winning_team: string | null
  tie_decider_winner?: TeamColor | null
  status?: MatchStatus
  match_number?: number
}

interface StatEvent {
  stat_id: number
  match_id: number
  player_scorer_id: number | null
  player_assist_id: number | null
  team_scored: TeamColor
  goal_minute: number | null
  is_own_goal: boolean
  event_type: 'goal' | 'substitution' | 'tie_decider'
}

const History: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  const [statusFilter, setStatusFilter] = useState<'all' | MatchStatus>('all')
  const [winnerFilter, setWinnerFilter] = useState<'all' | TeamColor | 'draw'>('all')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')

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

  const [eventFilters, setEventFilters] = useState<{
    types: { goal: boolean; substitution: boolean; tie_decider: boolean }
    team: 'all' | TeamColor
    playerQ: string
  }>({ types: { goal: true, substitution: true, tie_decider: false }, team: 'all', playerQ: '' })

  useEffect(() => {
    (async () => {
      try {
        const [playersResponse, matchesResponse] = await Promise.all([
          api.get('/api/players'),
          api.get('/api/matches'),
        ])
        type PlayerApi = {
          player_id: number
          name: string
          is_goalkeeper: boolean
          photo_url?: string
        }
        const playersList = ((playersResponse.data?.players || []) as PlayerApi[]).map((p) => ({
          id: p.player_id,
          name: p.name,
          is_goalkeeper: !!p.is_goalkeeper,
          photo_url: p.photo_url || '',
        }))
        type MatchApi = {
          match_id: number
          sunday_date: string
          team_orange_score: number
          team_black_score: number
          winner_team: string | null
          tie_decider_winner?: TeamColor
          status?: MatchStatus
          match_number?: number
        }
        let matchesList = ((matchesResponse.data?.matches || []) as MatchApi[]).map((m) => ({
          id: m.match_id,
          match_date: m.sunday_date,
          team_blue_score: m.team_black_score,
          team_orange_score: m.team_orange_score,
          winning_team: m.winner_team,
          tie_decider_winner: m.tie_decider_winner || null,
          status: m.status,
          match_number: typeof m.match_number === 'number' ? m.match_number : undefined,
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
      } catch (error: unknown) {
        toast.error('Erro ao carregar histórico')
        const err = error as { response?: { status?: number }, message?: string }
        logError('history_load_error', { status: err?.response?.status, message: err?.message })
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (winnerFilter !== 'all') {
        const wt = m.winning_team || 'draw'
        if (winnerFilter === 'draw') {
          if (wt !== 'draw') return false
        } else {
          if (wt === 'draw') {
            if (m.tie_decider_winner !== winnerFilter) return false
          } else if (wt !== winnerFilter) return false
        }
      }
      if (dateFrom) {
        const d = new Date(m.match_date).getTime()
        const f = new Date(dateFrom).getTime()
        if (Number.isFinite(d) && Number.isFinite(f) && d < f) return false
      }
      if (dateTo) {
        const d = new Date(m.match_date).getTime()
        const t = new Date(dateTo).getTime()
        if (Number.isFinite(d) && Number.isFinite(t) && d > t) return false
      }
      return true
    })
  }, [matches, statusFilter, winnerFilter, dateFrom, dateTo])

  const openMatchDetails = async (match: Match) => {
    try {
      setDetailsModal({
        open: true,
        matchId: match.id,
        loading: true,
        stats: [],
        black_ids: [],
        orange_ids: [],
        match_date: match.match_date,
        black_score: match.team_blue_score,
        orange_score: match.team_orange_score,
      })
      const statsResp = await api.get(`/api/matches/${match.id}/stats`)
      const stats = (statsResp.data?.stats || []) as StatEvent[]
      const detResp = await api.get(`/api/matches/${match.id}`)
      const parts: Array<{ team: TeamColor; player_id: number }> = Array.isArray(detResp.data?.match?.participants)
        ? detResp.data.match.participants
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

  const filteredEvents = useMemo(() => {
    let list = detailsModal.stats
    const typesKeys = Object.keys(eventFilters.types) as Array<keyof typeof eventFilters.types>
    const typesEnabled = typesKeys.filter(k => eventFilters.types[k]) as Array<'goal' | 'substitution' | 'tie_decider'>
    list = list.filter(ev => typesEnabled.includes(ev.event_type))
    if (eventFilters.team !== 'all') {
      list = list.filter(ev => ev.team_scored === eventFilters.team)
    }
    const q = eventFilters.playerQ.trim().toLowerCase()
    if (q.length > 0) {
      list = list.filter(ev => {
        const scorer = players.find(p => p.id === (ev.player_scorer_id ?? -1))
        const assist = players.find(p => p.id === (ev.player_assist_id ?? -1))
        const sname = (scorer?.name || '').toLowerCase()
        const aname = (assist?.name || '').toLowerCase()
        return sname.includes(q) || aname.includes(q)
      })
    }
    return list
  }, [detailsModal.stats, eventFilters, players])

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
        <h1 className="text-3xl font-bold text-gray-900">Histórico</h1>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ('all' | MatchStatus))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="all">Todos</option>
              <option value="finished">Finalizadas</option>
              <option value="in_progress">Em andamento</option>
              <option value="scheduled">Agendadas</option>
            </select>
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Vencedor</label>
            <select
              value={winnerFilter}
              onChange={(e) => setWinnerFilter(e.target.value as ('all' | TeamColor | 'draw'))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="all">Todos</option>
              <option value="black">Preto</option>
              <option value="orange">Laranja</option>
              <option value="draw">Empate</option>
            </select>
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">De</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Até</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Todas as partidas</h2>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {filteredMatches.length > 0 ? (
              filteredMatches.map((match) => (
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
                  <div className="text-sm text-gray-500">
                    {new Date(match.match_date).toLocaleDateString('pt-BR')}
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
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto">
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
                          <span className="text-gray-600">{p?.is_goalkeeper ? 'Goleiro' : 'Jogador'}</span>
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
                          <span className="text-gray-600">{p?.is_goalkeeper ? 'Goleiro' : 'Jogador'}</span>
                        </div>
                      )
                    })}
                    {detailsModal.orange_ids.length === 0 && <div className="text-xs text-gray-500">Não disponível</div>}
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg p-4 border">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-700">Eventos:</label>
                    <label className="inline-flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={eventFilters.types.goal}
                        onChange={(e) => setEventFilters(prev => ({ ...prev, types: { ...prev.types, goal: e.target.checked } }))}
                      />
                      Gol
                    </label>
                    <label className="inline-flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={eventFilters.types.substitution}
                        onChange={(e) => setEventFilters(prev => ({ ...prev, types: { ...prev.types, substitution: e.target.checked } }))}
                      />
                      Substituição
                    </label>
                    <label className="inline-flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={eventFilters.types.tie_decider}
                        onChange={(e) => setEventFilters(prev => ({ ...prev, types: { ...prev.types, tie_decider: e.target.checked } }))}
                      />
                      Desempate
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-700">Time:</label>
                    <select
                      value={eventFilters.team}
                      onChange={(e) => setEventFilters(prev => ({ ...prev, team: e.target.value as ('all' | TeamColor) }))}
                      className="px-2 py-1 border border-gray-300 rounded-md text-xs"
                    >
                      <option value="all">Todos</option>
                      <option value="black">Preto</option>
                      <option value="orange">Laranja</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-700">Jogador:</label>
                    <input
                      type="text"
                      value={eventFilters.playerQ}
                      onChange={(e) => setEventFilters(prev => ({ ...prev, playerQ: e.target.value }))}
                      className="px-2 py-1 border border-gray-300 rounded-md text-xs"
                      placeholder="Nome do jogador"
                    />
                  </div>
                </div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Histórico de eventos</h4>
                {detailsModal.loading ? (
                  <div className="text-xs text-gray-500">Carregando...</div>
                ) : (
                  <div className="space-y-2">
                    {filteredEvents.length === 0 && (
                      <div className="text-xs text-gray-500">Sem eventos</div>
                    )}
                    {filteredEvents.map(ev => {
                      const scorer = players.find(p => p.id === (ev.player_scorer_id ?? -1))
                      const assist = players.find(p => p.id === (ev.player_assist_id ?? -1))
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
                            ) : ev.event_type === 'substitution' ? (
                              <span className="text-sm font-medium text-gray-900">
                                Substituição: sai {assist?.name || '—'}, entra {scorer?.name || '—'}
                              </span>
                            ) : (
                              <span className="text-sm font-medium text-gray-900">Desempate (par/ímpar)</span>
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
    </div>
  )
}

export default History
