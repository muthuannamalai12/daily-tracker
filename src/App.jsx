import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  'https://ikodxybhpyzafyfibijd.supabase.co',
  'sb_publishable_IC3yk192qauezDgQeNNaUA_cdTzrV8o'
)

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ─── useData (Supabase) ───────────────────────────────────────────────────────
function useData() {
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  // Load all rows from Supabase on mount
  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: rows, error } = await supabase
        .from('tracker')
        .select('date, office, gym')

      if (!error && rows) {
        const map = {}
        for (const row of rows) {
          map[row.date] = { office: row.office, gym: row.gym }
        }
        setData(map)
      }
      setLoading(false)
    }
    load()
  }, [])

  const toggle = useCallback(async (key, type) => {
    // Optimistically update UI immediately
    let newData
    setData(prev => {
      newData = {
        ...prev,
        [key]: { office: prev[key]?.office ?? false, gym: prev[key]?.gym ?? false, [type]: !prev[key]?.[type] },
      }
      return newData
    })

    setSyncing(true)

    // Upsert the toggled row to Supabase
    setData(prev => {
      const row = prev[key] ?? { office: false, gym: false }
      supabase
        .from('tracker')
        .upsert({ date: key, office: row.office, gym: row.gym }, { onConflict: 'date' })
        .then(({ error }) => {
          if (error) console.error('Supabase sync error:', error)
          setSyncing(false)
        })
      return prev
    })
  }, [])

  return { data, toggle, loading, syncing }
}

function getMonthStats(data, year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
  let office = 0, gym = 0
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith(prefix)) {
      if (v.office) office++
      if (v.gym) gym++
    }
  }
  return { office, gym }
}

function getYearStats(data, year) {
  let office = 0, gym = 0
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith(`${year}-`)) {
      if (v.office) office++
      if (v.gym) gym++
    }
  }
  return { office, gym }
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ type, icon, label, monthly, yearly }) {
  return (
    <div className={`stat-card stat-${type}`}>
      <div className="stat-icon-wrap">
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-body">
        <p className="stat-label">{label}</p>
        <div className="stat-nums">
          <div className="stat-num-block">
            <span className={`stat-num ${type}-text`}>{monthly}</span>
            <span className="stat-sub">this month</span>
          </div>
          <div className="stat-sep" />
          <div className="stat-num-block">
            <span className={`stat-num ${type}-text`}>{yearly}</span>
            <span className="stat-sub">this year</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Month Calendar ────────────────────────────────────────────────────────────
function MonthCalendar({ year, month, data, toggle, todayStr }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <>
      <div className="day-names">
        {DAYS.map(d => <div key={d} className="day-name">{d}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="day-cell empty" />
          const key = dateKey(year, month, day)
          const d = data[key] || {}
          const isToday = key === todayStr
          const both = d.office && d.gym
          return (
            <div
              key={i}
              className={[
                'day-cell',
                isToday ? 'is-today' : '',
                d.office && !d.gym ? 'has-office' : '',
                d.gym && !d.office ? 'has-gym' : '',
                both ? 'has-both' : '',
              ].join(' ')}
            >
              <span className="day-num">{day}</span>
              <div className="day-btns">
                <button
                  className={`day-btn ${d.office ? 'btn-office' : ''}`}
                  onClick={() => toggle(key, 'office')}
                  title="Toggle office"
                >
                  🏢
                </button>
                <button
                  className={`day-btn ${d.gym ? 'btn-gym' : ''}`}
                  onClick={() => toggle(key, 'gym')}
                  title="Toggle gym"
                >
                  💪
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ─── Year Overview ────────────────────────────────────────────────────────────
function YearOverview({ data, year, today, onMonthClick }) {
  const months = MONTHS_SHORT.map((name, m) => ({
    name,
    m,
    ...getMonthStats(data, year, m),
  }))
  const maxVal = Math.max(...months.flatMap(({ office, gym }) => [office, gym]), 1)

  return (
    <div className="year-grid">
      {months.map(({ name, m, office, gym }) => {
        const isCurrent = year === today.getFullYear() && m === today.getMonth()
        return (
          <button
            key={m}
            className={`month-tile ${isCurrent ? 'month-tile-current' : ''}`}
            onClick={() => onMonthClick(m)}
          >
            <span className="month-tile-name">{name}</span>
            <div className="month-bars">
              <div className="month-bar-row">
                <div
                  className="month-bar office-bar"
                  style={{ width: `${Math.round((office / maxVal) * 100)}%` }}
                />
                <span className="month-bar-val">{office}</span>
              </div>
              <div className="month-bar-row">
                <div
                  className="month-bar gym-bar"
                  style={{ width: `${Math.round((gym / maxVal) * 100)}%` }}
                />
                <span className="month-bar-val">{gym}</span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const today = new Date()
  const todayStr = dateKey(today.getFullYear(), today.getMonth(), today.getDate())

  const [view, setView] = useState('month')
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const { data, toggle, loading, syncing } = useData()

  const monthStats = getMonthStats(data, year, month)
  const yearStats = getYearStats(data, year)

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()) }
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth()

  return (
    <div className="app">
      {/* Ambient background */}
      <div className="ambient">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="orb orb-c" />
      </div>

      <div className="page">
        {/* Header */}
        <header className="header">
          <div className="logo">
            <span className="logo-emoji">📅</span>
            <h1>
              Daily <span className="grad">Tracker</span>
            </h1>
          </div>
          <p className="tagline">Office · Gym · Every day counts</p>
          <p className="tagline sync-line">
            <span className={`sync-dot ${loading ? 'sync-dot-loading' : syncing ? 'sync-dot-saving' : 'sync-dot-ok'}`} />
            {loading ? 'Loading...' : syncing ? 'Saving...' : 'Synced'}
          </p>
        </header>

        {loading ? (
          <div className="loading-screen">
            <div className="loading-ring" />
            <p className="tagline">Loading your data...</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="stats-row">
              <StatCard
                type="office"
                icon="🏢"
                label="Office Days"
                monthly={monthStats.office}
                yearly={yearStats.office}
              />
              <StatCard
                type="gym"
                icon="💪"
                label="Gym Days"
                monthly={monthStats.gym}
                yearly={yearStats.gym}
              />
            </div>

            {/* View tabs */}
            <div className="tabs">
              <button
                className={`tab ${view === 'month' ? 'tab-active' : ''}`}
                onClick={() => setView('month')}
              >
                Month View
              </button>
              <button
                className={`tab ${view === 'year' ? 'tab-active' : ''}`}
                onClick={() => setView('year')}
              >
                Year Overview
              </button>
            </div>

            {/* Main card */}
            <div className="card">
              {view === 'month' ? (
                <>
                  <div className="cal-header">
                    <button className="nav-btn" onClick={prevMonth}>‹</button>
                    <div className="cal-title">
                      <h2>{MONTHS[month]} {year}</h2>
                      {!isCurrentMonth && (
                        <button className="today-chip" onClick={goToday}>Today</button>
                      )}
                    </div>
                    <button className="nav-btn" onClick={nextMonth}>›</button>
                  </div>
                  <MonthCalendar
                    year={year}
                    month={month}
                    data={data}
                    toggle={toggle}
                    todayStr={todayStr}
                  />
                </>
              ) : (
                <>
                  <div className="cal-header">
                    <button className="nav-btn" onClick={() => setYear(y => y - 1)}>‹</button>
                    <h2>{year}</h2>
                    <button className="nav-btn" onClick={() => setYear(y => y + 1)}>›</button>
                  </div>
                  <YearOverview
                    data={data}
                    year={year}
                    today={today}
                    onMonthClick={m => { setMonth(m); setView('month') }}
                  />
                </>
              )}
            </div>

            {/* Legend */}
            <div className="legend">
              <span className="legend-item">
                <span className="dot dot-office" />Office
              </span>
              <span className="legend-item">
                <span className="dot dot-gym" />Gym
              </span>
              <span className="legend-item">
                <span className="dot dot-both" />Both
              </span>
            </div>

            <p className="footer">Data synced across all your devices</p>
          </>
        )}
      </div>
    </div>
  )
}