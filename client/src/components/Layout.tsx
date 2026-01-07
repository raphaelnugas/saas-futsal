import React from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { 
  Home, 
  Users, 
  Calendar, 
  Trophy, 
  LogOut,
  Menu,
  X,
  BookOpen
} from 'lucide-react'
import api from '../services/api'
import type { AxiosInstance } from 'axios'

interface LayoutProps {
  children: React.ReactNode
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { logout, isAdmin } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [isMenuOpen, setIsMenuOpen] = React.useState(false)
  const [ticker, setTicker] = React.useState<{ startTime: string; blackScore: number; orangeScore: number } | null>(null)
  const [now, setNow] = React.useState<number>(Date.now())
  const lastStartRef = React.useRef<string | null>(null)
  const lastBeepAtRef = React.useRef<number>(0)
  const sseRef = React.useRef<EventSource | null>(null)
  const pollIntervalRef = React.useRef<number | null>(null)
  const serverOffsetRef = React.useRef<number>(0)
  const [alarmMuted, setAlarmMuted] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem('matchAlarmMuted') === '1'
    } catch {
      return false
    }
  })

  const navigation = [
    { name: 'Dashboard', href: '/', icon: Home },
    { name: 'Jogadores', href: '/players', icon: Users },
    { name: 'Partidas', href: '/matches', icon: Trophy },
    { name: 'Domingos', href: '/sundays', icon: Calendar },
    { name: 'Regras', href: '/regras', icon: BookOpen },
  ]

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const playAlarm = React.useCallback(() => {
    try {
      const Ctx =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      const ctx = new (Ctx as typeof AudioContext)()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(880, ctx.currentTime)
      g.gain.setValueAtTime(0, ctx.currentTime)
      g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2)
      o.connect(g)
      g.connect(ctx.destination)
      o.start()
      o.stop(ctx.currentTime + 1.25)
      setTimeout(() => {
        const o2 = ctx.createOscillator()
        const g2 = ctx.createGain()
        o2.type = 'sine'
        o2.frequency.setValueAtTime(660, ctx.currentTime)
        g2.gain.setValueAtTime(0, ctx.currentTime)
        g2.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05)
        g2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2)
        o2.connect(g2)
        g2.connect(ctx.destination)
        o2.start()
        o2.stop(ctx.currentTime + 1.25)
      }, 200)
    } catch { void 0 }
  }, [])

  React.useEffect(() => {
    try {
      const base = ((api as AxiosInstance).defaults.baseURL) || ''
      const token = localStorage.getItem('token') || ''
      const sseUrl = base.endsWith('/api')
        ? `${base}/matches/ticker/stream?token=${encodeURIComponent(token)}`
        : `${base}/api/matches/ticker/stream?token=${encodeURIComponent(token)}`
      const es = new EventSource(sseUrl)
      sseRef.current = es
      const startPolling = async () => {
        try {
          const resp = await api.get('/api/matches?status=in_progress')
          const list = (resp.data?.matches || []) as Array<{ match_id: number; start_time?: string }>
          if (!list.length) {
            setTicker(null)
            return
          }
          const mid = list[0].match_id
          let startTime = list[0].start_time || ''
          if (!startTime) {
            try {
              const det = await api.get(`/api/matches/${mid}`)
              startTime = det.data?.match?.start_time || ''
            } catch { void 0 }
          }
          let black = 0
          let orange = 0
          try {
            const statsResp = await api.get(`/api/matches/${mid}/stats`)
            const stats = (statsResp.data?.stats || []) as Array<{ team_scored: 'black' | 'orange' }>
            black = stats.filter(s => s.team_scored === 'black').length
            orange = stats.filter(s => s.team_scored === 'orange').length
          } catch { void 0 }
          if (startTime) {
            setTicker({ startTime, blackScore: black, orangeScore: orange })
          } else {
            setTicker(null)
          }
        } catch { void 0 }
      }
      es.onopen = () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
      }
      es.onerror = () => {
        if (!pollIntervalRef.current) {
          pollIntervalRef.current = window.setInterval(() => {
            startPolling()
          }, 15000)
        }
      }
      es.addEventListener('init', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { start_time?: string; blackGoals?: number; orangeGoals?: number; server_now?: string }
          if (data?.start_time) {
            setTicker({
              startTime: data.start_time,
              blackScore: Number(data.blackGoals || 0),
              orangeScore: Number(data.orangeGoals || 0)
            })
            if (data.server_now) {
              const srvMs = new Date(data.server_now).getTime()
              const offset = srvMs - Date.now()
              serverOffsetRef.current = Number.isFinite(offset) ? offset : 0
            }
            if (data.start_time !== lastStartRef.current) {
              lastStartRef.current = data.start_time
              lastBeepAtRef.current = 0
            }
          } else {
            setTicker(null)
          }
        } catch { setTicker(null) }
      })
      es.addEventListener('goal', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { start_time?: string; blackGoals?: number; orangeGoals?: number; server_now?: string }
          if (data?.start_time) {
            setTicker({
              startTime: data.start_time,
              blackScore: Number(data.blackGoals || 0),
              orangeScore: Number(data.orangeGoals || 0)
            })
          }
          if (data.server_now) {
            const srvMs = new Date(data.server_now).getTime()
            const offset = srvMs - Date.now()
            if (Number.isFinite(offset)) {
              serverOffsetRef.current = (serverOffsetRef.current * 0.8) + (offset * 0.2)
            }
          }
        } catch { void 0 }
      })
      es.addEventListener('ping', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { ts?: number }
          if (typeof data.ts === 'number') {
            const offset = data.ts - Date.now()
            if (Number.isFinite(offset)) {
              serverOffsetRef.current = (serverOffsetRef.current * 0.8) + (offset * 0.2)
            }
          }
        } catch { void 0 }
      })
      es.addEventListener('inactive', () => {
        setTicker(null)
        lastBeepAtRef.current = 0
      })
      return () => {
        try { es.close() } catch { void 0 }
        sseRef.current = null
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
      }
    } catch { void 0 }
  }, [])

  React.useEffect(() => {
    const i = setInterval(() => {
      setNow(Date.now() + serverOffsetRef.current)
      const muted = (() => {
        try {
          return localStorage.getItem('matchAlarmMuted') === '1'
        } catch {
          return alarmMuted
        }
      })()
      if (muted !== alarmMuted) setAlarmMuted(muted)
      if (ticker?.startTime) {
        const startMs = new Date(ticker.startTime).getTime()
        const seconds = Math.floor((Date.now() - startMs) / 1000)
        if (seconds >= 600 && !muted) {
          const nowMs = Date.now()
          if (nowMs - lastBeepAtRef.current >= 1200) {
            playAlarm()
            lastBeepAtRef.current = nowMs
          }
        } else {
          lastBeepAtRef.current = 0
        }
      }
    }, 1000)
    return () => clearInterval(i)
  }, [ticker, alarmMuted, playAlarm])

  const elapsedLabel = React.useMemo(() => {
    if (!ticker) return ''
    const start = new Date(ticker.startTime).getTime()
    const diff = Math.max(0, now - start)
    const totalSeconds = Math.floor(diff / 1000)
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
    const ss = String(totalSeconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }, [ticker, now])

  return (
    <div className="min-h-screen bg-gray-50">
      {ticker && (
        <div
          className={`cursor-pointer text-white ${(() => {
            const start = new Date(ticker.startTime).getTime()
            const secs = Math.floor((now - start) / 1000)
            return secs >= 600 ? 'bg-gradient-to-r from-red-700 via-red-600 to-red-500' : 'bg-gradient-to-r from-black via-gray-800 to-orange-600'
          })()}`}
          onClick={() => navigate('/matches')}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
            <div className="grid grid-cols-3 items-center">
              <div className="text-left">
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-black text-white text-sm sm:text-base font-extrabold tracking-wider shadow">
                  PRETO
                </span>
              </div>
              <div className="text-center">
                <span className="inline-flex items-center justify-center px-3 py-1 rounded-md bg-white/90 ring-2 ring-black text-2xl sm:text-3xl font-extrabold text-black mx-1">
                  {ticker.blackScore}
                </span>
                <span className="text-sm sm:text-base font-bold mx-1">x</span>
                <span className="inline-flex items-center justify-center px-3 py-1 rounded-md bg-white/90 ring-2 ring-orange-500 text-2xl sm:text-3xl font-extrabold text-orange-600 mx-1">
                  {ticker.orangeScore}
                </span>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-orange-500 text-white text-sm sm:text-base font-extrabold tracking-wider shadow">
                  LARANJA
                </span>
                {(() => {
                  const start = ticker?.startTime ? new Date(ticker.startTime).getTime() : 0
                  const secs = start ? Math.floor((now - start) / 1000) : 0
                  return secs >= 600 ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = !alarmMuted
                        setAlarmMuted(next)
                        try {
                          if (next) localStorage.setItem('matchAlarmMuted', '1')
                          else localStorage.removeItem('matchAlarmMuted')
                        } catch { void 0 }
                      }}
                      className={`ml-2 inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold shadow ${
                        alarmMuted ? 'bg-gray-200 text-gray-800 hover:bg-gray-300' : 'bg-red-600 text-white hover:bg-red-700'
                      }`}
                      title={alarmMuted ? 'Reativar alarme' : 'Silenciar alarme'}
                    >
                      {alarmMuted ? 'Reativar' : 'Silenciar'}
                    </button>
                  ) : null
                })()}
              </div>
            </div>
            <div className="text-center text-[10px] sm:text-xs opacity-80 mt-1">Tempo: {elapsedLabel}</div>
          </div>
        </div>
      )}
      {/* Navigation */}
      <nav className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-primary-600">Futsal Náutico</h1>
              </div>
              
              {/* Desktop Navigation */}
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {navigation.map((item) => {
                  const isActive = location.pathname === item.href
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      className={`${
                        isActive
                          ? 'border-primary-500 text-gray-900'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                    >
                      <item.icon className="w-4 h-4 mr-2" />
                      {item.name}
                    </Link>
                  )
                })}
                {isAdmin && (
                  <Link
                    to="/admin"
                    className={`${
                      location.pathname === '/admin'
                        ? 'border-primary-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                  >
                    <span className="w-4 h-4 mr-2 inline-block rounded bg-primary-500"></span>
                    Admin
                  </Link>
                )}
              </div>
            </div>

            <div className="hidden sm:ml-6 sm:flex sm:items-center">
              <button
                onClick={handleLogout}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sair
              </button>
            </div>

            {/* Mobile menu button */}
            <div className="sm:hidden flex items-center">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
              >
                {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="sm:hidden">
            <div className="pt-2 pb-3 space-y-1">
              {navigation.map((item) => {
                const isActive = location.pathname === item.href
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onClick={() => setIsMenuOpen(false)}
                    className={`${
                      isActive
                        ? 'bg-primary-50 border-primary-500 text-primary-700'
                        : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                    } block pl-3 pr-4 py-2 border-l-4 text-base font-medium`}
                  >
                    <div className="flex items-center">
                      <item.icon className="w-5 h-5 mr-3" />
                      {item.name}
                    </div>
                  </Link>
                )
              })}
              {isAdmin && (
                <Link
                  to="/admin"
                  onClick={() => setIsMenuOpen(false)}
                  className={`${
                    location.pathname === '/admin'
                      ? 'bg-primary-50 border-primary-500 text-primary-700'
                      : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                  } block pl-3 pr-4 py-2 border-l-4 text-base font-medium`}
                >
                  <div className="flex items-center">
                    <span className="w-5 h-5 mr-3 inline-block rounded bg-primary-500"></span>
                    Admin
                  </div>
                </Link>
              )}
              <button
                onClick={() => {
                  handleLogout()
                  setIsMenuOpen(false)
                }}
                className="block w-full text-left pl-3 pr-4 py-2 border-l-4 border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 text-base font-medium"
              >
                <div className="flex items-center">
                  <LogOut className="w-5 h-5 mr-3" />
                  Sair
                </div>
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Main content */}
      <main className="py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}

export default Layout
