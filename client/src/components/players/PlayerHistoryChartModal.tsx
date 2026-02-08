import React, { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts'
import { X } from 'lucide-react'
import api from '../../services/api'
import { toast } from 'sonner'

interface PlayerHistoryChartModalProps {
  isOpen: boolean
  onClose: () => void
  playerId: number | null
  playerName: string
}

interface HistoryData {
  date: string
  sunday_id: number
  goals: number
  assists: number
  wins: number
  goals_conceded_avg: number
}

const PlayerHistoryChartModal: React.FC<PlayerHistoryChartModalProps> = ({ isOpen, onClose, playerId, playerName }) => {
  const [data, setData] = useState<HistoryData[]>([])
  const [loading, setLoading] = useState(false)
  
  // Estados para controlar a visibilidade das linhas
  const [showWins, setShowWins] = useState(true)
  const [showGoals, setShowGoals] = useState(true)
  const [showAssists, setShowAssists] = useState(true)
  const [showConceded, setShowConceded] = useState(true)

  useEffect(() => {
    if (isOpen && playerId) {
      fetchHistory(playerId)
    }
  }, [isOpen, playerId])

  const fetchHistory = async (id: number) => {
    setLoading(true)
    try {
      const response = await api.get(`/api/players/${id}/history`)
      type ApiHistoryItem = {
        date: string
        sunday_id?: number
        goals?: number | string
        assists?: number | string
        wins?: number | string
        goals_conceded_avg?: number | string
      }
      const history = response.data.history.map((item: ApiHistoryItem) => ({
        ...item,
        // Formata a data para exibir DD/MM
        displayDate: new Date(item.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        goals: Number(item.goals),
        assists: Number(item.assists),
        wins: Number(item.wins),
        goals_conceded_avg: Number(item.goals_conceded_avg)
      }))
      setData(history)
    } catch (error) {
      toast.error('Erro ao carregar histórico do jogador')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-lg max-w-4xl w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
        >
          <X className="w-6 h-6" />
        </button>

        <h3 className="text-xl font-bold text-gray-900 mb-6 pr-8">
          Evolução por Domingo - {playerName}
        </h3>

        {loading ? (
          <div className="h-80 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          </div>
        ) : data.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-gray-500">
            Nenhum histórico disponível para este jogador.
          </div>
        ) : (
          <>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="displayDate" />
                  <YAxis allowDecimals={false} />
                  <Tooltip 
                    labelStyle={{ color: '#333' }}
                    itemStyle={{ fontSize: '14px' }}
                    formatter={(value: number, name: string) => {
                       const mapNames: Record<string, string> = {
                         goals: 'Gols',
                         assists: 'Assistências',
                         wins: 'Vitórias',
                         goals_conceded_avg: 'Média Gols Sofridos'
                       }
                       return [value, mapNames[name] || name]
                    }}
                  />
                  {showWins && (
                    <Line 
                      type="monotone" 
                      dataKey="wins" 
                      name="wins"
                      stroke="#16a34a" // green-600
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  )}
                  {showGoals && (
                    <Line 
                      type="monotone" 
                      dataKey="goals" 
                      name="goals"
                      stroke="#ca8a04" // yellow-600 (mais legível que pure yellow)
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  )}
                  {showAssists && (
                    <Line 
                      type="monotone" 
                      dataKey="assists" 
                      name="assists"
                      stroke="#2563eb" // blue-600
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  )}
                  {showConceded && (
                    <Line 
                      type="monotone" 
                      dataKey="goals_conceded_avg" 
                      name="goals_conceded_avg"
                      stroke="#dc2626" // red-600
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Legenda Customizada com Toggle */}
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              <button 
                onClick={() => setShowWins(!showWins)}
                className={`flex items-center space-x-2 px-3 py-1 rounded-full border transition-colors ${showWins ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200 opacity-50'}`}
              >
                <div className="w-3 h-3 rounded-full bg-green-600"></div>
                <span className="text-sm font-medium text-gray-700">Vitórias</span>
              </button>
              
              <button 
                onClick={() => setShowGoals(!showGoals)}
                className={`flex items-center space-x-2 px-3 py-1 rounded-full border transition-colors ${showGoals ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200 opacity-50'}`}
              >
                <div className="w-3 h-3 rounded-full bg-yellow-600"></div>
                <span className="text-sm font-medium text-gray-700">Gols Marcados</span>
              </button>
              
              <button 
                onClick={() => setShowAssists(!showAssists)}
                className={`flex items-center space-x-2 px-3 py-1 rounded-full border transition-colors ${showAssists ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200 opacity-50'}`}
              >
                <div className="w-3 h-3 rounded-full bg-blue-600"></div>
                <span className="text-sm font-medium text-gray-700">Assistências</span>
              </button>

              <button 
                onClick={() => setShowConceded(!showConceded)}
                className={`flex items-center space-x-2 px-3 py-1 rounded-full border transition-colors ${showConceded ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200 opacity-50'}`}
              >
                <div className="w-3 h-3 rounded-full bg-red-600"></div>
                <span className="text-sm font-medium text-gray-700">Média Gols Sofridos</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default PlayerHistoryChartModal
