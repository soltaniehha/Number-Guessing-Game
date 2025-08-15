import { useEffect, useRef, useState } from 'react'

function generateRandomNumber(min = 1, max = 100) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export default function GuessGame() {
  const [targetNumber, setTargetNumber] = useState(() => generateRandomNumber())
  const [currentGuess, setCurrentGuess] = useState('')
  const [attemptCount, setAttemptCount] = useState(0)
  const [feedback, setFeedback] = useState('Make a guess!')
  const [gameStatus, setGameStatus] = useState('playing') // 'playing' | 'won' | 'gaveup'
  const [guessHistory, setGuessHistory] = useState([]) // [{ value: number, relation: 'low'|'high'|'correct' }]

  const inputRef = useRef(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [gameStatus])

  const startNewGame = () => {
    setTargetNumber(generateRandomNumber())
    setCurrentGuess('')
    setAttemptCount(0)
    setFeedback('Make a guess!')
    setGameStatus('playing')
    setGuessHistory([])
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (gameStatus !== 'playing') return

    const parsed = Number.parseInt(currentGuess, 10)
    if (Number.isNaN(parsed)) {
      setFeedback('Please enter a whole number between 1 and 100.')
      return
    }
    if (parsed < 1 || parsed > 100) {
      setFeedback('Your guess must be between 1 and 100.')
      return
    }

    const nextAttempt = attemptCount + 1
    setAttemptCount(nextAttempt)

    if (parsed < targetNumber) {
      setFeedback('Too low. Try a higher number.')
      setGuessHistory((prev) => [{ value: parsed, relation: 'low' }, ...prev])
    } else if (parsed > targetNumber) {
      setFeedback('Too high. Try a lower number.')
      setGuessHistory((prev) => [{ value: parsed, relation: 'high' }, ...prev])
    } else {
      setFeedback(`Correct! You guessed it in ${nextAttempt} attempts.`)
      setGuessHistory((prev) => [{ value: parsed, relation: 'correct' }, ...prev])
      setGameStatus('won')
    }

    setCurrentGuess('')
  }

  const giveUp = () => {
    if (gameStatus !== 'playing') return
    setGameStatus('gaveup')
    setFeedback(`You gave up. The number was ${targetNumber}.`)
  }

  const isDisabled = gameStatus !== 'playing'

  // Visual hint: derive narrowing bounds from guess history
  const bounds = (() => {
    let lower = 1
    let upper = 100
    for (const g of guessHistory) {
      if (g.relation === 'low') lower = Math.max(lower, g.value + 1)
      if (g.relation === 'high') upper = Math.min(upper, g.value - 1)
      if (g.relation === 'correct') {
        lower = g.value
        upper = g.value
        break
      }
    }
    return { lower, upper }
  })()

  const lastGuess = guessHistory[0]?.value
  const toPercent = (num) => ((num - 1) / 99) * 100

  return (
    <div className="game-container">
      <header className="game-header">
        <h1 className="title">Number Guessing Game</h1>
        <p className="subtitle">Guess the secret number between 1 and 100</p>
      </header>

      <section className="status-panel">
        <div className="status-card">
          <div className="status-label">Attempts</div>
          <div className="status-value">{attemptCount}</div>
        </div>
        <div className={`status-card ${gameStatus}`}>
          <div className="status-label">Status</div>
          <div className="status-value">
            {gameStatus === 'playing' && 'Playing'}
            {gameStatus === 'won' && 'You won!'}
            {gameStatus === 'gaveup' && 'Gave up'}
          </div>
        </div>
      </section>

      <section className="card">
        <div className={`feedback ${gameStatus}`} role="status" aria-live="polite">{feedback}</div>

        <div className="range-card">
          <div className="range-labels">
            <span className="end">1</span>
            <span className="hint">{bounds.lower} – {bounds.upper}</span>
            <span className="end">100</span>
          </div>
          <div className="range-track">
            <div
              className="range-fill"
              style={{ left: `${toPercent(bounds.lower)}%`, width: `${Math.max(0, toPercent(bounds.upper) - toPercent(bounds.lower))}%` }}
            />
            {lastGuess !== undefined && (
              <div className="range-marker" style={{ left: `${toPercent(lastGuess)}%` }} />
            )}
          </div>
        </div>
        <form className="guess-form" onSubmit={handleSubmit}>
          <label htmlFor="guess" className="sr-only">Enter your guess</label>
          <input
            id="guess"
            ref={inputRef}
            className="guess-input"
            type="number"
            min={1}
            max={100}
            placeholder="Enter a number (1-100)"
            value={currentGuess}
            onChange={(e) => setCurrentGuess(e.target.value)}
            disabled={isDisabled}
          />
          <div className="actions">
            <button type="submit" className="btn primary" disabled={isDisabled}>Guess</button>
            <button type="button" className="btn" onClick={giveUp} disabled={isDisabled}>Give up</button>
            <button type="button" className="btn ghost" onClick={startNewGame}>Play again</button>
          </div>
        </form>
      </section>

      {guessHistory.length > 0 && (
        <section className="history card">
          <h2 className="history-title">Recent guesses</h2>
          <ul className="history-list">
            {guessHistory.map((g, idx) => (
              <li key={idx} className={`history-item ${g.relation}`}>
                <span className="guess-value">{g.value}</span>
                <span className="guess-relation">
                  {g.relation === 'low' && 'Too low'}
                  {g.relation === 'high' && 'Too high'}
                  {g.relation === 'correct' && 'Correct'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}


