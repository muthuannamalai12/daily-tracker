import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ikodxybhpyzafyfibijd.supabase.co',
  'sb_publishable_IC3yk192qauezDgQeNNaUA_cdTzrV8o'
)

const STORAGE_KEY = 'daily-tracker-v1'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const EMPTY_DAY = { office: false, gym: false, home: false, pg: false, park_gym: false }

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

// ─── Cell colour logic ────────────────────────────────────────────────────────
// Priority: specific requested combos first, then singles, then generic fallback
function getCellClass(d) {
  const { office, gym, home, pg, park_gym } = d

  // ── 6 requested combos (exact match) ──
  if (home && park_gym && !office && !gym && !pg)           return 'has-home-parkgym'   // teal
  if (pg && office && gym && !home && !park_gym)            return 'has-pg-office-gym'  // cyan
  if (pg && gym && !office && !home && !park_gym)           return 'has-pg-gym'         // deep orange
  if (pg && office && !gym && !home && !park_gym)           return 'has-pg-office'      // lime

  // ── Singles (exact) ──
  if (home && !office && !gym && !pg && !park_gym)          return 'has-home'
  if (pg   && !office && !gym && !home && !park_gym)        return 'has-pg'
  if (office && !gym && !home && !pg && !park_gym)          return 'has-office'
  if (gym    && !office && !home && !pg && !park_gym)       return 'has-gym'
  if (park_gym && !office && !gym && !home && !pg)          return 'has-parkgym'

  // ── Other combos ──
  if (office && gym && !home && !pg && !park_gym)           return 'has-both'           // purple
  if (office && home && !gym && !pg && !park_gym)           return 'has-office-home'
  if (gym && home && !office && !pg && !park_gym)           return 'has-gym-home'
  if (office && park_gym && !gym && !home && !pg)           return 'has-office-parkgym'
  if (pg && park_gym && !office && !gym && !home)           return 'has-pg-parkgym'

  const count = [office, gym, home, pg, park_gym].filter(Boolean).length
  if (count >= 3) return 'has-all'
  if (count > 0)  return 'has-mixed'
  return ''
}

// ─── useData ──────────────────────────────────────────────────────────────────
function useData() {
  const [data, setData] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : {} }
    catch { return {} }
  })
  const [syncing, setSyncing] = useState(false)
  const [synced,  setSynced]  = useState(false)
  const pendingRef  = useRef({})
  const timerRef    = useRef(null)
  const flushingRef = useRef(false)

  useEffect(() => {
    async function revalidate() {
      try {
        const year = new Date().getFullYear()
        const { data: rows, error } = await supabase
          .from('tracker')
          .select('date, office, gym, home, pg, park_gym')
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`)
        if (!error && rows) {
          const existing = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} } })()
          const merged = { ...existing }
          for (const row of rows) {
            merged[row.date] = { office: !!row.office, gym: !!row.gym, home: !!row.home, pg: !!row.pg, park_gym: !!row.park_gym }
          }
          setData(merged)
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)) } catch {}
        }
      } catch (e) { console.error('Revalidate error:', e) }
      finally { setSynced(true) }
    }
    revalidate()
  }, [])

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    const entries = Object.entries(pendingRef.current)
    if (!entries.length) return
    const rows = entries.map(([date, v]) => ({ date, office: !!v.office, gym: !!v.gym, home: !!v.home, pg: !!v.pg, park_gym: !!v.park_gym }))
    pendingRef.current  = {}
    flushingRef.current = true
    setSyncing(true)
    try {
      const { error } = await supabase.from('tracker').upsert(rows, { onConflict: 'date' })
      if (error) { console.error('Supabase error:', error); entries.forEach(([d,v]) => { pendingRef.current[d] = v }) }
      else setSynced(true)
    } catch (e) { console.error('Flush error:', e); entries.forEach(([d,v]) => { pendingRef.current[d] = v }) }
    finally { flushingRef.current = false; setSyncing(false) }
  }, [])

  const toggle = useCallback((key, type) => {
    setData(prev => {
      const current = prev[key] ?? { ...EMPTY_DAY }
      const updated  = { ...prev, [key]: { ...current, [type]: !current[type] } }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)) } catch {}
      pendingRef.current[key] = updated[key]
      return updated
    })
    setSynced(false)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 2000)
  }, [flush])

  useEffect(() => {
    const onUnload     = () => flush()
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('beforeunload', onUnload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.removeEventListener('beforeunload', onUnload); document.removeEventListener('visibilitychange', onVisibility) }
  }, [flush])

  return { data, toggle, syncing, synced }
}

// ─── Stats helpers ─────────────────────────────────────────────────────────────
function getMonthStats(data, year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2,'0')}`
  let office=0, gym=0, home=0, pg=0, park_gym=0
  for (const [k,v] of Object.entries(data)) {
    if (k.startsWith(prefix)) { if(v.office)office++; if(v.gym)gym++; if(v.home)home++; if(v.pg)pg++; if(v.park_gym)park_gym++ }
  }
  return { office, gym, home, pg, park_gym }
}

function getYearStats(data, year) {
  let office=0, gym=0, home=0, pg=0, park_gym=0
  for (const [k,v] of Object.entries(data)) {
    if (k.startsWith(`${year}-`)) { if(v.office)office++; if(v.gym)gym++; if(v.home)home++; if(v.pg)pg++; if(v.park_gym)park_gym++ }
  }
  return { office, gym, home, pg, park_gym }
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ type, icon, label, monthly, yearly }) {
  return (
    <div className={`stat-card stat-${type}`}>
      <div className="stat-icon-wrap"><span className="stat-icon">{icon}</span></div>
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
  const firstDay    = new Date(year, month, 1).getDay()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <>
      <div className="day-names">{DAYS.map(d => <div key={d} className="day-name">{d}</div>)}</div>
      <div className="cal-grid">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="day-cell empty" />
          const key       = dateKey(year, month, day)
          const d         = data[key] || {}
          const isToday   = key === todayStr
          const cellClass = getCellClass(d)
          return (
            <div key={i} className={['day-cell', isToday ? 'is-today' : '', cellClass].filter(Boolean).join(' ')}>
              <span className="day-num">{day}</span>
              {/* Row 1: Office · Home · PG */}
              <div className="day-btns-row">
                <button className={`day-btn ${d.office   ? 'btn-office'  : ''}`} onClick={() => toggle(key,'office')}   title="Office">🏢</button>
                <button className={`day-btn ${d.home     ? 'btn-home'    : ''}`} onClick={() => toggle(key,'home')}     title="Home">🏠</button>
                <button className={`day-btn ${d.pg       ? 'btn-pg'      : ''}`} onClick={() => toggle(key,'pg')}       title="PG">🛏️</button>
              </div>
              {/* Row 2: Gym · Park Gym */}
              <div className="day-btns-row">
                <button className={`day-btn ${d.gym      ? 'btn-gym'     : ''}`} onClick={() => toggle(key,'gym')}      title="Gym">💪</button>
                <button className={`day-btn ${d.park_gym ? 'btn-parkgym' : ''}`} onClick={() => toggle(key,'park_gym')} title="Park Gym">🏞️</button>
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
  const months = MONTHS_SHORT.map((name, m) => ({ name, m, ...getMonthStats(data, year, m) }))
  const maxVal = Math.max(...months.flatMap(({ office,gym,home,pg,park_gym }) => [office,gym,home,pg,park_gym]), 1)
  const pct = v => `${Math.round((v / maxVal) * 100)}%`

  return (
    <div className="year-grid">
      {months.map(({ name, m, office, gym, home, pg, park_gym }) => {
        const isCurrent = year === today.getFullYear() && m === today.getMonth()
        return (
          <button key={m} className={`month-tile ${isCurrent ? 'month-tile-current' : ''}`} onClick={() => onMonthClick(m)}>
            <span className="month-tile-name">{name}</span>
            <div className="month-bars">
              <div className="month-bar-row"><div className="month-bar office-bar"  style={{ width: pct(office)   }} /><span className="month-bar-val">{office}</span></div>
              <div className="month-bar-row"><div className="month-bar home-bar"    style={{ width: pct(home)     }} /><span className="month-bar-val">{home}</span></div>
              <div className="month-bar-row"><div className="month-bar pg-bar"      style={{ width: pct(pg)       }} /><span className="month-bar-val">{pg}</span></div>
              <div className="month-bar-row"><div className="month-bar gym-bar"     style={{ width: pct(gym)      }} /><span className="month-bar-val">{gym}</span></div>
              <div className="month-bar-row"><div className="month-bar parkgym-bar" style={{ width: pct(park_gym) }} /><span className="month-bar-val">{park_gym}</span></div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const today    = new Date()
  const todayStr = dateKey(today.getFullYear(), today.getMonth(), today.getDate())
  const [view,  setView]  = useState('month')
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const { data, toggle, syncing, synced } = useData()

  const monthStats = getMonthStats(data, year, month)
  const yearStats  = getYearStats(data, year)
  const prevMonth  = () => { if (month===0){setYear(y=>y-1);setMonth(11)} else setMonth(m=>m-1) }
  const nextMonth  = () => { if (month===11){setYear(y=>y+1);setMonth(0)} else setMonth(m=>m+1) }
  const goToday    = () => { setYear(today.getFullYear()); setMonth(today.getMonth()) }
  const isCurrentMonth = year===today.getFullYear() && month===today.getMonth()

  return (
    <div className="app">
      <div className="ambient"><div className="orb orb-a"/><div className="orb orb-b"/><div className="orb orb-c"/></div>
      <div className="page">
        <header className="header">
          <div className="logo"><span className="logo-emoji">📅</span><h1>Daily <span className="grad">Tracker</span></h1></div>
          <p className="tagline">Office · Home · PG · Gym · Park Gym</p>
          <p className="tagline sync-line">
            <span className={`sync-dot ${syncing ? 'sync-dot-saving' : synced ? 'sync-dot-ok' : 'sync-dot-loading'}`} />
            {syncing ? 'Saving...' : synced ? 'Synced' : 'Syncing...'}
          </p>
        </header>

        <div className="stats-row stats-row-3">
          <StatCard type="office"  icon="🏢" label="Office Days"   monthly={monthStats.office}   yearly={yearStats.office} />
          <StatCard type="home"    icon="🏠" label="Home Days"     monthly={monthStats.home}     yearly={yearStats.home} />
          <StatCard type="pg"      icon="🛏️" label="PG Days"       monthly={monthStats.pg}       yearly={yearStats.pg} />
        </div>
        <div className="stats-row stats-row-3">
          <StatCard type="gym"          icon="💪" label="Gym Days"        monthly={monthStats.gym}                              yearly={yearStats.gym} />
          <StatCard type="parkgym"      icon="🏞️" label="Park Gym Days"   monthly={monthStats.park_gym}                         yearly={yearStats.park_gym} />
          <StatCard type="totalworkout" icon="🏋️" label="Total Workout"   monthly={monthStats.gym + monthStats.park_gym}        yearly={yearStats.gym + yearStats.park_gym} />
        </div>

        <div className="tabs">
          <button className={`tab ${view==='month'?'tab-active':''}`} onClick={() => setView('month')}>Month View</button>
          <button className={`tab ${view==='year' ?'tab-active':''}`} onClick={() => setView('year')}>Year Overview</button>
        </div>

        <div className="card">
          {view === 'month' ? (
            <>
              <div className="cal-header">
                <button className="nav-btn" onClick={prevMonth}>‹</button>
                <div className="cal-title">
                  <h2>{MONTHS[month]} {year}</h2>
                  {!isCurrentMonth && <button className="today-chip" onClick={goToday}>Today</button>}
                </div>
                <button className="nav-btn" onClick={nextMonth}>›</button>
              </div>
              <MonthCalendar year={year} month={month} data={data} toggle={toggle} todayStr={todayStr} />
            </>
          ) : (
            <>
              <div className="cal-header">
                <button className="nav-btn" onClick={() => setYear(y=>y-1)}>‹</button>
                <h2>{year}</h2>
                <button className="nav-btn" onClick={() => setYear(y=>y+1)}>›</button>
              </div>
              <YearOverview data={data} year={year} today={today} onMonthClick={m => { setMonth(m); setView('month') }} />
            </>
          )}
        </div>

        <div className="legend">
          <span className="legend-item"><span className="dot dot-home"/>Home</span>
          <span className="legend-item"><span className="dot dot-home-parkgym"/>Home+Park</span>
          <span className="legend-item"><span className="dot dot-pg"/>PG</span>
          <span className="legend-item"><span className="dot dot-pg-gym"/>PG+Gym</span>
          <span className="legend-item"><span className="dot dot-pg-office"/>PG+Office</span>
          <span className="legend-item"><span className="dot dot-pg-office-gym"/>PG+Off+Gym</span>
          <span className="legend-item"><span className="dot dot-office"/>Office</span>
          <span className="legend-item"><span className="dot dot-gym"/>Gym</span>
          <span className="legend-item"><span className="dot dot-parkgym"/>Park Gym</span>
          <span className="legend-item"><span className="dot dot-both"/>Off+Gym</span>
        </div>

        <p className="footer">Data synced across all your devices</p>
      </div>
    </div>
  )
}
