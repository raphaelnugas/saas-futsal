import { useState, useEffect, useRef } from 'react'

type WebAudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }

interface UseMatchTimerProps {
  matchInProgress: boolean
  matchDurationMin: number
  startTime: Date | undefined
  alarmMuted: boolean
}

export const useMatchTimer = ({
  matchInProgress,
  matchDurationMin,
  startTime,
  alarmMuted
}: UseMatchTimerProps) => {
  const [tick, setTick] = useState(0)
  const beepIntervalRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!matchInProgress || !startTime) return
    const now = new Date()
    const diff = Math.max(0, Math.floor((now.getTime() - new Date(startTime).getTime()) / 1000))
    setTick(diff)
    
    const i = setInterval(() => {
      setTick(t => t + 1)
    }, 1000)
    return () => clearInterval(i)
  }, [matchInProgress, startTime])

  useEffect(() => {
    const overtime = matchInProgress && tick >= matchDurationMin * 60 && !alarmMuted
    const startBeeping = () => {
      if (beepIntervalRef.current) return
      if (!audioCtxRef.current) {
        try {
          const W = window as WebAudioWindow
          audioCtxRef.current = new (W.AudioContext || W.webkitAudioContext)()
        } catch { audioCtxRef.current = null }
      }
      const playBeepOnce = () => {
        const ctx = audioCtxRef.current
        if (!ctx) return
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = 900
        gain.gain.value = 0.15
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        setTimeout(() => {
          osc.stop()
          osc.disconnect()
          gain.disconnect()
        }, 350)
      }
      playBeepOnce()
      beepIntervalRef.current = window.setInterval(playBeepOnce, 1200)
    }
    const stopBeeping = () => {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current)
        beepIntervalRef.current = null
      }
    }
    if (overtime) {
      startBeeping()
    } else {
      stopBeeping()
    }
    return () => {
      stopBeeping()
    }
  }, [matchInProgress, tick, matchDurationMin, alarmMuted])

  return { tick, setTick }
}
