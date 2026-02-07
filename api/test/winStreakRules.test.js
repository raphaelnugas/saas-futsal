const test = require('node:test')
const assert = require('node:assert/strict')
const { computeNextWinStreak } = require('../utils/winStreakRules')

test('Regra desligada: empate usa vencedor do par/ímpar para manter sequência', () => {
  const next = computeNextWinStreak({
    manyPresentRuleEnabled: false,
    prevWinnerTeam: 'draw',
    prevTieDeciderWinner: 'black',
    prevBlackWinStreak: 0,
    prevOrangeWinStreak: 0,
    threshold: 3
  })
  assert.deepEqual(next, { nextBlack: 1, nextOrange: 0 })
})

test('Regra ligada: empate ignora par/ímpar (sair os dois)', () => {
  const next = computeNextWinStreak({
    manyPresentRuleEnabled: true,
    prevWinnerTeam: 'draw',
    prevTieDeciderWinner: 'black',
    prevBlackWinStreak: 2,
    prevOrangeWinStreak: 0,
    threshold: 3
  })
  assert.deepEqual(next, { nextBlack: 0, nextOrange: 0 })
})

test('Regra ligada: vitória normal segue comportamento padrão', () => {
  const next = computeNextWinStreak({
    manyPresentRuleEnabled: true,
    prevWinnerTeam: 'black',
    prevTieDeciderWinner: 'orange',
    prevBlackWinStreak: 1,
    prevOrangeWinStreak: 0,
    threshold: 3
  })
  assert.deepEqual(next, { nextBlack: 2, nextOrange: 0 })
})
