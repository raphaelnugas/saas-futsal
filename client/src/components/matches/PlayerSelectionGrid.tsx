import React from 'react'

interface Player {
  id: number
  name: string
  position: string
  total_goals_scored: number
  win_rate: number
}

interface PlayerSelectionGridProps {
  players: Player[]
  teams: { black: Player[]; orange: Player[] }
  selectedPlayers: number[]
  presentMap: Record<number, boolean>
  rodizioMode: boolean
  rodizioWinnerColor: 'black' | 'orange' | null
  isFirstMatchToday: boolean
  onPlayerSelection: (playerId: number) => void
  onAddToTeam: (team: 'black' | 'orange', playerId: number) => void
}

const PlayerSelectionGrid: React.FC<PlayerSelectionGridProps> = ({
  players,
  teams,
  selectedPlayers,
  presentMap,
  rodizioMode,
  rodizioWinnerColor,
  isFirstMatchToday,
  onPlayerSelection,
  onAddToTeam
}) => {
  const sortedPlayers = [...players].sort((a, b) => {
    const pa = presentMap[a.id] ? 1 : 0
    const pb = presentMap[b.id] ? 1 : 0
    if (pb !== pa) return pb - pa
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {sortedPlayers.map((player) => (
        <div
          key={player.id}
          onClick={() => {
            if (!(rodizioMode && rodizioWinnerColor && teams[rodizioWinnerColor].some(p => p.id === player.id))) {
              onPlayerSelection(player.id)
            }
          }}
          className={`p-3 rounded-lg border-2 text-left transition-colors cursor-pointer relative ${(teams.black.some(p => p.id === player.id))
              ? 'bg-gray-200 text-gray-900 border-gray-600'
              : (teams.orange.some(p => p.id === player.id))
                ? 'bg-orange-50 text-orange-900 border-orange-400'
                : (isFirstMatchToday && selectedPlayers.includes(player.id))
                  ? 'bg-blue-100 text-blue-900 border-blue-500'
                  : (presentMap[player.id])
                    ? 'bg-green-50 border-green-500'
                    : 'bg-gray-50 border-gray-200 hover:border-gray-300'
            } ${(rodizioMode && rodizioWinnerColor && teams[rodizioWinnerColor].some(p => p.id === player.id)) ? 'opacity-50 cursor-not-allowed' : ''
            }`}
        >
          <div className="font-medium text-sm">{player.name}</div>
          <div className="text-xs text-gray-500">{player.position}</div>
          <div className={`mt-1 inline-flex items-center px-2 py-0.5 rounded text-[10px] ${(teams.black.some(p => p.id === player.id)) ? 'bg-gray-200 text-gray-800' :
              (teams.orange.some(p => p.id === player.id)) ? 'bg-orange-200 text-orange-900' :
                (isFirstMatchToday && selectedPlayers.includes(player.id)) ? 'bg-blue-200 text-blue-900' :
                  presentMap[player.id] ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>
            {(isFirstMatchToday && selectedPlayers.includes(player.id)) ? 'Selecionado' : (presentMap[player.id] ? 'Presente' : 'Ausente')}
          </div>
          <div className="text-xs text-gray-400">
            {player.total_goals_scored} gols • {player.win_rate.toFixed(0)}% vit.
          </div>
          <div className="mt-2 flex items-center space-x-1">
            <button
              onClick={(e) => { e.stopPropagation(); onAddToTeam('black', player.id) }}
              disabled={teams.black.some(p => p.id === player.id) || !presentMap[player.id]}
              className="px-2 py-1 rounded bg-black text-white text-xs disabled:opacity-50"
            >
              Preto
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAddToTeam('orange', player.id) }}
              disabled={teams.orange.some(p => p.id === player.id) || !presentMap[player.id]}
              className="px-2 py-1 rounded bg-orange-500 text-white text-xs disabled:opacity-50"
            >
              Laranja
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default PlayerSelectionGrid
