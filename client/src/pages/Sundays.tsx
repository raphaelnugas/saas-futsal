import React, { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Plus, Calendar, Users, CheckCircle, XCircle, Clock, Trash2 } from 'lucide-react'
import api from '../services/api'
import { logError } from '../services/logger'

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
}

interface Attendance {
  player_id: number
  is_present: boolean
  arrival_time?: string
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

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [sundaysResponse, playersResponse] = await Promise.all([
        api.get('/api/sundays'),
        api.get('/api/players')
      ])
      const apiSundays = (sundaysResponse.data?.sundays || [])
      const sundaysList = apiSundays.map((s: any, index: number) => {
        const isMostRecent = index === 0
        const hasMatches = Number(s.total_matches || 0) > 0
        const status = isMostRecent
          ? (hasMatches ? 'in_progress' : 'scheduled')
          : 'completed'
        return {
          id: s.sunday_id,
          sunday_date: s.date,
          status,
          total_players: Number(s.total_attendees || 0),
          created_at: s.created_at
        }
      })
      const playersList = (playersResponse.data?.players || []).map((p: any) => ({
        id: p.player_id,
        name: p.name,
        position: p.is_goalkeeper ? 'Goleiro' : 'Jogador'
      }))
      setSundays(sundaysList)
      setPlayers(playersList)
    } catch (error: any) {
      toast.error('Erro ao carregar dados')
      logError('sundays_load_error', { status: error?.response?.status, message: error?.message })
    } finally {
      setLoading(false)
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
      const rows = Array.isArray(response.data?.attendances)
        ? response.data.attendances
        : Array.isArray(response.data)
          ? response.data
          : []
      const normalized = rows.map((a: any) => ({
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
          <div key={sunday.id} className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Calendar className="w-5 h-5 text-primary-600 mr-2" />
                <h3 className="text-lg font-medium text-gray-900">
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
            </div>

            <div className="mt-4 flex space-x-2">
              <button
                onClick={() => handleManageAttendance(sunday)}
                className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <Users className="w-4 h-4 mr-2" />
                Gerenciar Presenças
              </button>
              <button
                onClick={() => setConfirmDeleteSunday(sunday)}
                disabled={deletingSundayId === sunday.id}
                className={`inline-flex items-center justify-center px-3 py-2 border shadow-sm text-sm font-medium rounded-md ${
                  deletingSundayId === sunday.id
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'text-white bg-red-600 border-transparent hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500'
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
    </div>
  )
}

export default Sundays
