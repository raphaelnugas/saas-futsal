function computeNextWinStreak({
  manyPresentRuleEnabled,
  prevWinnerTeam,
  prevTieDeciderWinner,
  prevBlackWinStreak,
  prevOrangeWinStreak,
  threshold = 3
}) {
  const blackPrev = Number(prevBlackWinStreak || 0)
  const orangePrev = Number(prevOrangeWinStreak || 0)
  const ruleOn = !!manyPresentRuleEnabled
  const t = Math.max(1, Math.floor(Number(threshold || 3)))
  const winner = prevWinnerTeam === 'black' || prevWinnerTeam === 'orange' || prevWinnerTeam === 'draw'
    ? prevWinnerTeam
    : null
  const tieWinner =
    prevTieDeciderWinner === 'black' || prevTieDeciderWinner === 'orange'
      ? prevTieDeciderWinner
      : null

  if (winner === 'draw') {
    if (ruleOn) return { nextBlack: 0, nextOrange: 0 }
    if (tieWinner === 'black') {
      const next = blackPrev + 1
      if (next >= t) return { nextBlack: 0, nextOrange: 1 }
      return { nextBlack: next, nextOrange: 0 }
    }
    if (tieWinner === 'orange') {
      const next = orangePrev + 1
      if (next >= t) return { nextBlack: 1, nextOrange: 0 }
      return { nextBlack: 0, nextOrange: next }
    }
    return { nextBlack: 0, nextOrange: 0 }
  }

  if (winner === 'black') {
    const next = blackPrev + 1
    return { nextBlack: next >= t ? 0 : next, nextOrange: 0 }
  }

  if (winner === 'orange') {
    const next = orangePrev + 1
    return { nextBlack: 0, nextOrange: next >= t ? 0 : next }
  }

  return { nextBlack: 0, nextOrange: 0 }
}

module.exports = { computeNextWinStreak }
