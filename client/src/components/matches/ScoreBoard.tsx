import React from 'react'
import { Clock, Trophy } from 'lucide-react'

interface ScoreBoardProps {
  blackScore: number
  orangeScore: number
  tick: number
  matchDurationMin: number
  matchInProgress: boolean
  consecutiveUnchanged: { black: number; orange: number }
  connectionStatus: 'online' | 'reconnecting' | 'offline'
  manyPresentRuleEnabled: boolean
  alarmMuted: boolean
  blackTeamAvg: number
  orangeTeamAvg: number
  onUpdateScore: (team: 'black' | 'orange', increment: boolean) => void
  onAdjustStreak: (team: 'black' | 'orange', delta: number) => void
  onFinishMatch: () => void
  onToggleManyRule: () => void
  onToggleAlarm: () => void
}

const ScoreBoard: React.FC<ScoreBoardProps> = ({
  blackScore,
  orangeScore,
  tick,
  matchDurationMin,
  matchInProgress,
  consecutiveUnchanged,
  connectionStatus,
  manyPresentRuleEnabled,
  alarmMuted,
  blackTeamAvg,
  orangeTeamAvg,
  onUpdateScore,
  onAdjustStreak,
  onFinishMatch,
  onToggleManyRule,
  onToggleAlarm
}) => {
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const renderStreakDots = (n: number) => {
    const c = Math.max(0, Math.floor(Number(n || 0)))
    const d = c <= 0 ? 0 : (c === 1 ? 2 : 3)
    const dots = Array.from({ length: d })
    return (
      <div className="flex space-x-1 mt-0.5 h-2 md:h-2.5 justify-center">
        {dots.map((_, i) => (
          <span key={`st-${i}`} className="inline-block w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-green-500 ring-2 ring-white"></span>
        ))}
      </div>
    )
  }

  const isOvertime = tick >= matchDurationMin * 60

  return (
    <div className={`rounded-none md:rounded-2xl ${isOvertime ? 'bg-gradient-to-r from-red-700 via-red-600 to-red-500' : 'bg-gradient-to-r from-black via-gray-800 to-orange-600'} p-3 md:p-4 text-white shadow md:shadow-xl`}>
      <div className="grid grid-cols-3 items-center">
        {/* Lado Preto */}
        <div className="flex items-center justify-start ml-2 md:ml-4">
          <button
            onClick={() => onUpdateScore('black', true)}
            className="bg-black hover:bg-gray-900 text-white border-2 border-white px-3 py-1 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-bold shadow-md uppercase min-w-[100px] md:min-w-[120px] text-center"
          >
            Gol Preto
          </button>
        </div>

        {/* Centro (Placar, Timer, Status) */}
        <div className="text-center">
          {/* Top Row: Média Preto | Placar | Média Laranja */}
          <div className="flex items-center justify-center space-x-2 md:space-x-3 mb-1">
            <span className="inline-flex items-center justify-center px-2 md:px-3 py-1 rounded-full bg-white ring-2 ring-black text-xs md:text-sm font-bold text-black shadow-sm">
              {blackTeamAvg}
            </span>
            
            <div className="flex flex-col items-center">
              <span className="inline-flex items-center px-2 md:px-3 py-1 rounded-full bg-black text-white text-xs md:text-sm font-extrabold tracking-wider shadow">
                PRETO
              </span>
              {renderStreakDots(consecutiveUnchanged.black)}
              <div className="flex items-center space-x-1 mt-1 justify-center">
                <button onClick={() => onAdjustStreak('black', -1)} className="px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white text-[10px]" title="Diminuir sequência">−</button>
                <button onClick={() => onAdjustStreak('black', 1)} className="px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white text-[10px]" title="Aumentar sequência">+</button>
              </div>
            </div>

            <span className="inline-flex items-center justify-center px-4 md:px-6 py-2 md:py-3 rounded-xl bg-white ring-2 md:ring-4 ring-black text-4xl md:text-7xl font-extrabold text-black shadow-sm">
              {blackScore}
            </span>
            
            <span className="text-xl md:text-3xl font-extrabold text-white/80">x</span>
            
            <span className="inline-flex items-center justify-center px-4 md:px-6 py-2 md:py-3 rounded-xl bg-white ring-2 md:ring-4 ring-orange-500 text-4xl md:text-7xl font-extrabold text-orange-600 shadow-sm">
              {orangeScore}
            </span>

            <div className="flex flex-col items-center">
              <span className="inline-flex items-center px-2 md:px-3 py-1 rounded-full bg-orange-500 text-white text-xs md:text-sm font-extrabold tracking-wider shadow">
                LARANJA
              </span>
              {renderStreakDots(consecutiveUnchanged.orange)}
              <div className="flex items-center space-x-1 mt-1 justify-center">
                <button onClick={() => onAdjustStreak('orange', -1)} className="px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white text-[10px]" title="Diminuir sequência">−</button>
                <button onClick={() => onAdjustStreak('orange', 1)} className="px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white text-[10px]" title="Aumentar sequência">+</button>
              </div>
            </div>

            <span className="inline-flex items-center justify-center px-2 md:px-3 py-1 rounded-full bg-white ring-2 ring-orange-500 text-xs md:text-sm font-bold text-orange-600 shadow-sm">
              {orangeTeamAvg}
            </span>
          </div>

          {/* Connection Status */}
          <div className="text-[10px] md:text-xs opacity-80">
            {connectionStatus === 'online' ? 'Conexão: Online' : connectionStatus === 'reconnecting' ? 'Conexão: Reconectando…' : 'Conexão: Offline'}
          </div>

          {/* Toggle Rule */}
          <div className="mt-1">
            <button
              onClick={onToggleManyRule}
              className={`inline-flex items-center px-2 py-1 rounded-md text-xs md:text-sm font-semibold shadow ${
                manyPresentRuleEnabled ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
              title="Alternar regra de sair os dois"
            >
              Regra de sair os dois: {manyPresentRuleEnabled ? 'Ligado' : 'Desligado'}
            </button>
          </div>

          {/* Timer */}
          <div className={`text-[10px] md:text-xs ${isOvertime ? 'text-red-200' : 'opacity-80'}`}>
            {isOvertime ? 'Tempo esgotado' : 'Duração'}
          </div>
          <div className="text-xl md:text-3xl font-extrabold flex items-center justify-center space-x-2">
            <Clock className="w-4 h-4 md:w-6 md:h-6" />
            <span>{formatTime(tick)}</span>
          </div>

          {/* Alarm Toggle */}
          {isOvertime && (
            <div className="mt-2">
              <button
                onClick={onToggleAlarm}
                className={`inline-flex items-center px-3 py-1 rounded-md text-xs md:text-sm font-semibold shadow ${
                  alarmMuted ? 'bg-gray-200 text-gray-800 hover:bg-gray-300' : 'bg-red-600 text-white hover:bg-red-700'
                }`}
                title={alarmMuted ? 'Reativar alarme' : 'Silenciar alarme'}
              >
                {alarmMuted ? 'Reativar alarme' : 'Silenciar alarme'}
              </button>
            </div>
          )}

          {/* Finish Match Button (New) */}
          {matchInProgress && (
            <div className="mt-2">
              <button
                onClick={onFinishMatch}
                className="inline-flex items-center px-4 py-1 border border-transparent text-xs md:text-sm font-medium rounded-full text-white bg-red-600 hover:bg-red-700 shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                <Trophy className="w-3 h-3 mr-1" />
                Finalizar
              </button>
            </div>
          )}
        </div>

        {/* Lado Laranja */}
        <div className="flex items-center justify-end mr-2 md:mr-4">
          <button
            onClick={() => onUpdateScore('orange', true)}
            className="bg-orange-500 hover:bg-orange-600 text-white border-2 border-white px-3 py-1 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-bold shadow-md uppercase min-w-[100px] md:min-w-[120px] text-center"
          >
            Gol Laranja
          </button>
        </div>
      </div>
    </div>
  )
}

export default ScoreBoard
