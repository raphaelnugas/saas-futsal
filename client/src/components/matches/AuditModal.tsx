import React from 'react'

interface Player {
  id: number
  name: string
  // Outros campos podem ser adicionados conforme necessidade, mas para o modal só usamos id e name
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

interface AuditModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  currentMatch: {
    blackScore: number
    orangeScore: number
  } | null
  tick: number
  matchStats: StatEvent[]
  players: Player[]
  manyPresentRuleEnabled: boolean
}

const AuditModal: React.FC<AuditModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  currentMatch,
  tick,
  matchStats,
  players,
  manyPresentRuleEnabled
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-lg max-w-md w-full p-6 my-auto">
        <h3 className="text-xl font-bold text-gray-900 mb-4 text-center">Auditoria da Partida</h3>
        
        <div className="mb-6 text-center">
          <div className="flex justify-center items-center space-x-4 mb-2">
            <div className="flex flex-col items-center">
               <span className="text-sm font-bold text-gray-700">PRETO</span>
               <span className="text-4xl font-extrabold text-black">{currentMatch?.blackScore}</span>
            </div>
            <span className="text-2xl font-bold text-gray-400">X</span>
            <div className="flex flex-col items-center">
               <span className="text-sm font-bold text-orange-600">LARANJA</span>
               <span className="text-4xl font-extrabold text-orange-600">{currentMatch?.orangeScore}</span>
            </div>
          </div>
          <div className="text-lg font-mono text-gray-600">
             Tempo: {String(Math.floor(tick / 60)).padStart(2, '0')}:{String(tick % 60).padStart(2, '0')}
          </div>
          {manyPresentRuleEnabled && (
            <div className="mt-2 text-sm text-red-600 font-bold italic">
              Regra de sair os dois está ativa!
            </div>
          )}
        </div>

        <div className="mb-6 border-t border-b border-gray-200 py-4 max-h-48 overflow-y-auto">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Histórico de Eventos:</h4>
          {matchStats.length === 0 ? (
            <p className="text-xs text-gray-500 italic">Nenhum evento registrado.</p>
          ) : (
            <ul className="space-y-1">
               {matchStats.filter(ev => ev.event_type !== 'tie_decider').map(ev => {
                   const scorer = players.find(p => p.id === ev.player_scorer_id)
                   const assist = players.find(p => p.id === ev.player_assist_id)
                   const minute = typeof ev.goal_minute === 'number' ? ev.goal_minute : 0
                   return (
                     <li key={ev.stat_id} className="text-xs flex justify-between items-start py-1">
                       <span className="w-1/3 text-left">{String(minute).padStart(2, '0')}' - {ev.event_type === 'goal' ? 'Gol' : 'Substituição'} ({ev.team_scored === 'black' ? 'Preto' : 'Laranja'})</span>
                       <span className="w-2/3 text-right font-medium break-words">
                          {ev.event_type === 'goal' 
                             ? (
                                <>
                                  {ev.is_own_goal ? 'Contra' : scorer?.name || '?'}
                                  {assist ? <span className="text-gray-500 font-normal"> (assist: {assist.name})</span> : ''}
                                </>
                             )
                             : `Sai: ${assist?.name || '?'} / Entra: ${scorer?.name || '?'}`}
                       </span>
                     </li>
                   )
               })}
            </ul>
          )}
        </div>

        <p className="text-sm text-center text-gray-800 font-medium mb-6">
          Deseja realmente terminar a partida assim? <br/>
          <span className="text-red-600 font-bold">Confirme com os capitães da partida!</span>
        </p>

        <div className="flex justify-between space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-md shadow-sm text-sm font-bold text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            CANCELAR
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-3 rounded-md shadow-sm text-sm font-bold text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            CONFIRMAR
          </button>
        </div>
      </div>
    </div>
  )
}

export default AuditModal
