import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  'https://ikodxybhpyzafyfibijd.supabase.co',
  'sb_publishable_IC3yk192qauezDgQeNNaUA_cdTzrV8o'
)

const STORAGE_KEY = 'daily-tracker-v1'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ─── useData ──────────────────────────────────────────────────────────────────
function useData() {
  const [data, setData] = useState(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY)
      return s ? JSON.parse(s) : {}
    } catch { return {} }
  })
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)

  const pendingRef = useRef({})
  const timerRef = useRef(null)
  const flushingRef = useRef(false)

  useEffect(() => {
    async function revalidate() {
      try {
        const year = new Date().getFullYear()
        const { data: rows, error } = await supabase
          .from('tracker')
          .select('date, office, gym, home')
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`)

        if (!error && rows) {
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
            catch { return {} }
          })()
          const merged = { ...existing }
          for (const row of rows) {
            merged[row.date] = { office: !!row.office, gym: !!row.gym, home: !!row.home }
          }
          setData(merged)
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)) } catch {}
        }
      } catch (e) {
        console.error('Revalidate error:', e)
      } finally {
        setSynced(true)
      }
    }
    revalidate()
  }, [])

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    const entries = Object.entries(pendingRef.current)
    if (!entries.length) return

    const rows = entries.map(([date, v]) => ({
      date, office: !!v.office, gym: !!v.gym, home: !!v.home,
    }))
    pendingRef.current = {}
    flushingRef.current = true
    setSyncing(true)

    try {
      const { error } = await supabase
        .from('tracker')
        .upsert(rows, { onConflict: 'date' })
      if (error) {
        console.error('Supabase upsert error:', error)
        entries.forEach(([date, v]) => { pendingRef.current[date] = v })
      } else {
        setSynced(true)
      }
    } catch (e) {
      console.error('Flush error:', e)
      entries.forEach(([date, v]) => { pendingRef.current[date] = v })
    } finally {
      flushingRef.current = false
      setSyncing(false)
    }
  }, [])

  const toggle = useCallback((key, type) => {
    setData(prev => {
      const current = prev[key] ?? { office: false, gym: false, home: false }
      const updated = {
        ...prev,
        [key]: { ...current, [type]: !current[type] },
      }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)) } catch {}
      pendingRef.current[key] = updated[key]
      return updated
    })

    setSynced(false)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 2000)
  }, [flush])

  useEffect(() => {
    const onUnload = () => flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', onUnload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flush])

  return { data, toggle, syncing, synced }
}

// ─── Stats helpers ─────────────────────────────────────────────────────────────
function getMonthStats(data, year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
  let office = 0, gym = 0, home = 0
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith(prefix)) {
      if (v.office) office++
      if (v.gym) gym++
      if (v.home) home++
    }
  }
  return { office, gym, home }
}

function getYearStats(data, year) {
  let office = 0, gym = 0, home = 0
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith(`${year}-`)) {
      if (v.office) office++
      if (v.gym) gym++
      if (v.home) home++
    }
  }
  return { office, gym, home }
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

// ─── Month Calendar ───────────────────────────────────────────────────────────
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

          // Cell colour priority: all three > office+gym > office+home > gym+home > single
          const activeCount = [d.office, d.gym, d.home].filter(Boolean).length
          const cellClass = (() => {
            if (activeCount === 3) return 'has-all'
            if (d.office && d.gym) return 'has-both'
            if (d.office && d.home) return 'has-office-home'
            if (d.gym && d.home) return 'has-gym-home'
            if (d.office) return 'has-office'
            if (d.gym) return 'has-gym'
            if (d.home) return 'has-home'
            return ''
          })()

          return (
            <div
              key={i}
              className={['day-cell', isToday ? 'is-today' : '', cellClass].join(' ')}
            >
              <span className="day-num">{day}</span>
              <div className="day-btns">
                <button
                  className={`day-btn ${d.office ? 'btn-office' : ''}`}
                  onClick={() => toggle(key, 'office')}
                  title="Toggle office"
                >🏢</button>
                <button
                  className={`day-btn ${d.home ? 'btn-home' : ''}`}
                  onClick={() => toggle(key, 'home')}
                  title="Toggle home"
                >🏠</button>
                <button
                  className={`day-btn ${d.gym ? 'btn-gym' : ''}`}
                  onClick={() => toggle(key, 'gym')}
                  title="Toggle gym"
                >💪</button>
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
    name, m, ...getMonthStats(data, year, m),
  }))
  const maxVal = Math.max(...months.flatMap(({ office, gym, home }) => [office, gym, home]), 1)

  return (
    <div className="year-grid">
      {months.map(({ name, m, office, gym, home }) => {
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
                <div className="month-bar office-bar" style={{ width: `${Math.round((office / maxVal) * 100)}%` }} />
                <span className="month-bar-val">{office}</span>
              </div>
              <div className="month-bar-row">
                <div className="month-bar home-bar" style={{ width: `${Math.round((home / maxVal) * 100)}%` }} />
                <span className="month-bar-val">{home}</span>
              </div>
              <div className="month-bar-row">
                <div className="month-bar gym-bar" style={{ width: `${Math.round((gym / maxVal) * 100)}%` }} />
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
  const { data, toggle, syncing, synced } = useData()

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
      <div className="ambient">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="orb orb-c" />
      </div>

      <div className="page">
        <header className="header">
          <div className="logo">
            <span className="logo-emoji">📅</span>
            <h1>Daily <span className="grad">Tracker</span></h1>
          </div>
          <p className="tagline">Office · Home · Gym · Every day counts</p>
          <p className="tagline sync-line">
            <span className={`sync-dot ${syncing ? 'sync-dot-saving' : synced ? 'sync-dot-ok' : 'sync-dot-loading'}`} />
            {syncing ? 'Saving...' : synced ? 'Synced' : 'Syncing...'}
          </p>
        </header>

        <div className="stats-row">
          <StatCard type="office" icon="🏢" label="Office Days" monthly={monthStats.office} yearly={yearStats.office} />
          <StatCard type="home"   icon="🏠" label="Home Days"   monthly={monthStats.home}   yearly={yearStats.home} />
          <StatCard type="gym"    icon="💪" label="Gym Days"    monthly={monthStats.gym}    yearly={yearStats.gym} />
        </div>

        <div className="tabs">
          <button className={`tab ${view === 'month' ? 'tab-active' : ''}`} onClick={() => setView('month')}>
            Month View
          </button>
          <button className={`tab ${view === 'year' ? 'tab-active' : ''}`} onClick={() => setView('year')}>
            Year Overview
          </button>
        </div>

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
              <MonthCalendar year={year} month={month} data={data} toggle={toggle} todayStr={todayStr} />
            </>
          ) : (
            <>
              <div className="cal-header">
                <button className="nav-btn" onClick={() => setYear(y => y - 1)}>‹</button>
                <h2>{year}</h2>
                <button className="nav-btn" onClick={() => setYear(y => y + 1)}>›</button>
              </div>
              <YearOverview data={data} year={year} today={today} onMonthClick={m => { setMonth(m); setView('month') }} />
            </>
          )}
        </div>

        <div className="legend">
          <span className="legend-item"><span className="dot dot-office" />Office</span>
          <span className="legend-item"><span className="dot dot-home" />Home</span>
          <span className="legend-item"><span className="dot dot-gym" />Gym</span>
          <span className="legend-item"><span className="dot dot-both" />Office+Gym</span>
        </div>

        <p className="footer">Data synced across all your devices</p>
      </div>
    </div>
  )
}
