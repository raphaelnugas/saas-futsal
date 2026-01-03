import React, { useEffect, useState } from 'react'
import api from '../services/api'
import { toast } from 'sonner'

interface PlayerDetail {
  player_id: number
  name: string
  attr_ofe: number
  attr_def: number
  attr_vel: number
  attr_tec: number
  attr_for: number
  attr_pot: number
  total_games_played?: number
  total_goals_scored?: number
  total_assists?: number
  total_goals_conceded?: number
}

interface Match {
  match_id: number
  sunday_id: number
  match_number: number
  status: string
  team_orange_score: number | null
  team_black_score: number | null
}

interface StatLog {
  stat_id: number
  match_id: number
  player_scorer_id: number | null
  player_assist_id: number | null
  team_scored: 'orange' | 'black'
  goal_minute: number | null
  is_own_goal: boolean
}

const Admin: React.FC = () => {
  const [players, setPlayers] = useState<PlayerDetail[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null)
  const [stats, setStats] = useState<StatLog[]>([])
  const [goalForm, setGoalForm] = useState({ scorer_id: '', assist_id: '', team_scored: 'orange', goal_minute: '', is_own_goal: false })

  useEffect(() => {
    loadPlayers()
    loadMatches()
  }, [])

  useEffect(() => {
    if (selectedMatchId) {
      loadMatchStats(selectedMatchId)
    } else {
      setStats([])
    }
  }, [selectedMatchId])

  const loadPlayers = async () => {
    try {
      const resp = await api.get('/api/players')
      const list = (resp.data?.players || []) as any[]
      const details: PlayerDetail[] = list.map((pl: any) => ({
        player_id: pl.player_id,
        name: pl.name,
        attr_ofe: pl.attr_ofe || 50,
        attr_def: pl.attr_def || 50,
        attr_vel: pl.attr_vel || 50,
        attr_tec: pl.attr_tec || 50,
        attr_for: pl.attr_for || 50,
        attr_pot: pl.attr_pot || 50,
        total_games_played: pl.total_games_played || 0,
        total_goals_scored: pl.total_goals_scored || 0,
        total_assists: pl.total_assists || 0,
        total_goals_conceded: pl.total_goals_conceded || 0,
      }))
      setPlayers(details)
    } catch {
      toast.error('Erro ao carregar jogadores')
    }
  }

  const savePlayerAttrs = async (p: PlayerDetail) => {
    try {
      await api.put(`/api/players/${p.player_id}`, {
        attr_ofe: p.attr_ofe,
        attr_def: p.attr_def,
        attr_vel: p.attr_vel,
        attr_tec: p.attr_tec,
        attr_for: p.attr_for,
        attr_pot: p.attr_pot,
      })
      toast.success(`Atributos de ${p.name} atualizados`)
    } catch {
      toast.error(`Erro ao atualizar atributos de ${p.name}`)
    }
  }

  const resetPlayerStats = async (p: PlayerDetail) => {
    try {
      await api.post(`/api/players/${p.player_id}/reset-stats`)
      toast.success(`Estatísticas de ${p.name} zeradas`)
      loadPlayers()
    } catch {
      toast.error(`Erro ao zerar estatísticas de ${p.name}`)
    }
  }
  const resetPlayerConceded = async (p: PlayerDetail) => {
    try {
      await api.post(`/api/players/${p.player_id}/reset-stats`, { reset_conceded: true })
      toast.success(`Gols sofridos de ${p.name} zerados`)
      loadPlayers()
    } catch {
      toast.error(`Erro ao zerar gols sofridos de ${p.name}`)
    }
  }

  const loadMatches = async () => {
    try {
      const resp = await api.get('/api/matches')
      setMatches(resp.data?.matches || [])
    } catch {
      toast.error('Erro ao carregar partidas')
    }
  }

  const loadMatchStats = async (matchId: number) => {
    try {
      const statsResp = await api.get(`/api/matches/${matchId}/stats`)
      setStats(statsResp.data?.stats || [])
    } catch {
      toast.error('Erro ao carregar detalhes da partida')
    }
  }

  const addGoal = async () => {
    if (!selectedMatchId) return
    try {
      const payload = {
        scorer_id: goalForm.scorer_id ? Number(goalForm.scorer_id) : undefined,
        assist_id: goalForm.assist_id ? Number(goalForm.assist_id) : undefined,
        team_scored: goalForm.team_scored,
        goal_minute: goalForm.goal_minute ? Number(goalForm.goal_minute) : undefined,
        is_own_goal: goalForm.is_own_goal
      }
      await api.post(`/api/matches/${selectedMatchId}/stats-goal`, payload)
      toast.success('Gol/assistência registrada')
      setGoalForm({ scorer_id: '', assist_id: '', team_scored: 'orange', goal_minute: '', is_own_goal: false })
      loadMatchStats(selectedMatchId)
    } catch {
      toast.error('Erro ao registrar gol/assistência')
    }
  }

  const removeStat = async (statId: number) => {
    try {
      await api.delete(`/api/matches/stats/${statId}`)
      toast.success('Registro removido')
      if (selectedMatchId) loadMatchStats(selectedMatchId)
    } catch {
      toast.error('Erro ao remover registro')
    }
  }

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-gray-900">Admin</h2>

      <section>
        <h3 className="text-lg font-semibold mb-3">Editar Atributos de Jogadores</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {players.map((p) => (
            <div key={p.player_id} className="bg-white rounded-lg shadow p-4">
              <div className="font-semibold mb-2">{p.name}</div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                {(['attr_ofe','attr_def','attr_vel','attr_tec','attr_for','attr_pot'] as const).map((k) => (
                  <div key={k} className="flex items-center space-x-2">
                    <label className="w-16 uppercase text-gray-500">{k.replace('attr_','')}</label>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={p[k]}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setPlayers(prev => prev.map(pp => pp.player_id === p.player_id ? { ...pp, [k]: v } : pp))
                      }}
                      className="w-16 border-gray-300 rounded-md"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-gray-600">
                  Jogos: {p.total_games_played} • Gols: {p.total_goals_scored} • Assist.: {p.total_assists} • Sofridos: {p.total_goals_conceded}
                </div>
                <button
                  onClick={() => savePlayerAttrs(p)}
                  className="px-3 py-1.5 rounded-md bg-primary-600 text-white text-sm"
                >
                  Salvar
                </button>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => resetPlayerStats(p)}
                  className="px-3 py-1.5 rounded-md bg-red-600 text-white text-xs"
                  title="Zerar jogos, gols e assistências"
                >
                  Zerar estatísticas
                </button>
                <button
                  onClick={() => resetPlayerConceded(p)}
                  className="ml-2 px-3 py-1.5 rounded-md bg-red-600 text-white text-xs"
                  title="Zerar gols sofridos"
                >
                  Zerar sofridos
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-3">Editar Gols/Assistências por Partida</h3>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="mb-3">
            <label className="block text-sm text-gray-700">Selecionar partida</label>
            <select
              value={selectedMatchId || ''}
              onChange={(e) => setSelectedMatchId(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 block w-full border-gray-300 rounded-md"
            >
              <option value="">Selecione</option>
              {matches.map(m => (
                <option key={m.match_id} value={m.match_id}>
                  Domingo {m.sunday_id} — Jogo {m.match_number} — {m.status}
                </option>
              ))}
            </select>
          </div>

          {selectedMatchId && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                <div>
                  <label className="block text-sm text-gray-700">Autor do gol (ID)</label>
                  <input
                    type="number"
                    value={goalForm.scorer_id}
                    onChange={(e) => setGoalForm({ ...goalForm, scorer_id: e.target.value })}
                    className="mt-1 block w-full border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700">Assistência (ID)</label>
                  <input
                    type="number"
                    value={goalForm.assist_id}
                    onChange={(e) => setGoalForm({ ...goalForm, assist_id: e.target.value })}
                    className="mt-1 block w-full border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700">Time</label>
                  <select
                    value={goalForm.team_scored}
                    onChange={(e) => setGoalForm({ ...goalForm, team_scored: e.target.value as 'orange'|'black' })}
                    className="mt-1 block w-full border-gray-300 rounded-md"
                  >
                    <option value="orange">Orange</option>
                    <option value="black">Black</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-700">Minuto</label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={goalForm.goal_minute}
                    onChange={(e) => setGoalForm({ ...goalForm, goal_minute: e.target.value })}
                    className="mt-1 block w-full border-gray-300 rounded-md"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    id="own_goal"
                    type="checkbox"
                    checked={goalForm.is_own_goal}
                    onChange={(e) => setGoalForm({ ...goalForm, is_own_goal: e.target.checked })}
                    className="h-4 w-4 text-primary-600 border-gray-300 rounded"
                  />
                  <label htmlFor="own_goal" className="text-sm text-gray-700">Gol contra</label>
                </div>
              </div>
              <div className="mt-3">
                <button
                  onClick={addGoal}
                  className="px-3 py-1.5 rounded-md bg-primary-600 text-white text-sm"
                >
                  Adicionar registro
                </button>
              </div>
              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-2">Registros</h4>
                <div className="space-y-2">
                  {stats.length === 0 && <div className="text-sm text-gray-500">Sem registros</div>}
                  {stats.map(s => (
                    <div key={s.stat_id} className="flex items-center justify-between bg-gray-50 rounded p-2">
                      <div className="text-sm text-gray-700">
                        #{s.stat_id} — {s.team_scored} — autor {s.player_scorer_id ?? '-'} — assistência {s.player_assist_id ?? '-'} — minuto {s.goal_minute ?? '-'} {s.is_own_goal ? '(contra)' : ''}
                      </div>
                      <button
                        onClick={() => removeStat(s.stat_id)}
                        className="px-2 py-1 text-sm rounded bg-red-600 text-white"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

export default Admin
