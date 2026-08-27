import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Icon from './components/Icon.jsx'
import Wordmark from './components/Wordmark.jsx'
import DayNight from './components/DayNight.jsx'
import Pomodoro from './components/Pomodoro.jsx'
import Crash from './components/Crash.jsx'
import { Modal } from './components/ui.jsx'
import { ToastHost } from './components/Toast.jsx'
import { UndoButtons, UndoProvider } from './lib/undo.jsx'
import { refreshAll } from './lib/api.js'
import { addDays, addMonths, today } from './lib/dates.js'
import Day from './pages/Day.jsx'
import Week from './pages/Week.jsx'
import Month from './pages/Month.jsx'
import Notes from './pages/Notes.jsx'
import Notebook from './pages/Notebook.jsx'
import AllTasks from './pages/AllTasks.jsx'
import Projects from './pages/Projects.jsx'
import ProjectDetail from './pages/ProjectDetail.jsx'
import People from './pages/People.jsx'
import PersonDetail from './pages/PersonDetail.jsx'
import Routines from './pages/Routines.jsx'
import Uploads from './pages/Uploads.jsx'
import Settings from './pages/Settings.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Resolver, { InternalLinks } from './components/Resolver.jsx'
import Search from './components/Search.jsx'
import VimLayer from './components/VimLayer.jsx'
import { VimProvider, useVim } from './lib/vim.jsx'
import { GO_TO, GO_DATED } from './lib/nav.js'

/** Wide enough for the mark, narrow enough to leave the page most of the screen. */
const clampRail = (px) => Math.min(420, Math.max(168, Math.round(px)))

const NAV = [
  { to: `/day/${today()}`, match: '/day', icon: 'today', label: 'Today' },
  { to: `/week/${today()}`, match: '/week', icon: 'week', label: 'Week' },
  { to: `/month/${today()}`, match: '/month', icon: 'month', label: 'Month' },
  { to: `/notes/${today()}`, match: '/notes', icon: 'templates', label: 'Notes' },
]

const NAV_2 = [
  { to: '/tasks', icon: 'check', label: 'All tasks' },
  { to: '/projects', icon: 'projects', label: 'Projects' },
  { to: '/routines', icon: 'today', label: 'Routines' },
  // People, Uploads and the Notebook live on the dashboard instead. None is
  // somewhere you go to plan — they are places you look something up — and the
  // rail is for the handful of views the day actually moves between. Keeping
  // the list short is what stops it scrolling, which was hiding the mark at
  // its foot.
  { to: '/settings', icon: 'gear', label: 'Settings' },
]

export default function App() {
  // App sits inside the BrowserRouter, so this is safe here — and it is what
  // lets the error boundary below reset itself when you navigate away.
  const location = useLocation()
  const [accent, setAccent] = useState(() => localStorage.getItem('accent') || 'blue')
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system')
  // What the theme actually resolved to. `theme` may be 'system', and the
  // switch has to show the opposite of what is on screen, not of the setting.
  const [isDark, setIsDark] = useState(false)
  const [railWidth, setRailWidth] = useState(
    () => clampRail(Number(localStorage.getItem('rail_width')) || 216)
  )

  // The width is written on pointerup rather than on every move, so a drag is
  // one entry in storage rather than a hundred.
  useEffect(() => { localStorage.setItem('rail_width', String(railWidth)) }, [railWidth])

  useEffect(() => {
    document.documentElement.dataset.accent = accent
    localStorage.setItem('accent', accent)
  }, [accent])

  useEffect(() => {
    // matchMedia is absent outside a real browser; fall back to the light theme
    // rather than letting the whole app fail to mount.
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && !!media?.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      setIsDark(dark)
    }
    apply()
    localStorage.setItem('theme', theme)
    // Only follow the OS while the user has not pinned a theme.
    if (theme !== 'system' || !media?.addEventListener) return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  return (
    <UndoProvider onChange={refreshAll}>
    <VimProvider>
    <ToastHost>
    <div className="app">
      <nav className="sidebar" style={{ width: railWidth, flexBasis: railWidth }}>
        <UndoButtons />

        {/* Above the navigation, because it is how you get to anything that is
            not one of the dozen places below. Ctrl-K from anywhere. */}
        <Search />

        <div className="sb-section">Calendar</div>
        {NAV.map((n) => (
          <SideLink key={n.label} {...n} />
        ))}

        <div className="sb-section">Workspace</div>
        {NAV_2.map((n) => (
          <SideLink key={n.label} {...n} />
        ))}

        {/* Between the last nav entry and the mark, as its own thing: it is
            neither navigation nor branding. */}
        <Pomodoro />

        {/* The mark signs the foot of the rail, with the day/night switch
            centred beneath it. Both sit in one block so the spare height goes
            above the pair rather than between them. */}
        <div className="sb-foot">
          <NavLink to="/dashboard" className="brand" title="Dashboard">
            <Wordmark />
          </NavLink>
          <div className="sb-foot-row">
            <DayNight dark={isDark} onToggle={() => setTheme(isDark ? 'light' : 'dark')} />
            <VimToggle />
          </div>
        </div>
      </nav>

      {/* The rail's inner edge, as a handle. Dragging it is a pointer gesture
          rather than a native drag, so nothing is being carried and no drop
          target lights up on the way past. */}
      <div
        className="rail-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the sidebar"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const from = e.clientX
          const start = railWidth
          const move = (ev) => setRailWidth(clampRail(start + ev.clientX - from))
          const done = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', done)
            localStorage.setItem('rail_width', String(railWidth))
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', done)
        }}
        onDoubleClick={() => { setRailWidth(216); localStorage.setItem('rail_width', '216') }}
      />

      <main className="main">
        <Shortcuts />
        <InternalLinks />
        {/* Keyed on the path so leaving a broken page clears the error: without
            that, one crash would hold the message up over every later view. */}
        <Crash key={location.pathname}>
        <Routes>
          <Route path="/" element={<Navigate to={`/day/${today()}`} replace />} />
          <Route path="/day" element={<Navigate to={`/day/${today()}`} replace />} />
          <Route path="/day/:date" element={<Day />} />
          <Route path="/week" element={<Navigate to={`/week/${today()}`} replace />} />
          <Route path="/week/:date" element={<Week />} />
          <Route path="/month" element={<Navigate to={`/month/${today()}`} replace />} />
          <Route path="/month/:date" element={<Month />} />
          <Route path="/notes" element={<Navigate to={`/notes/${today()}`} replace />} />
          <Route path="/notes/:date" element={<Notes />} />
          <Route path="/tasks" element={<AllTasks />} />
          <Route path="/notebook" element={<Notebook />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/people" element={<People />} />
          <Route path="/people/:id" element={<PersonDetail />} />
          <Route path="/routines" element={<Routines />} />
          <Route path="/uploads" element={<Uploads />} />
          <Route path="/dashboard" element={<Dashboard />} />
          {/*
            Theme and accent are edited on Settings but owned here, because the
            effects above are what put data-theme/data-accent on <html>. Settings
            is the only consumer, so they ride in as props rather than a context.
          */}
          <Route
            path="/settings"
            element={
              <Settings
                theme={theme}
                onTheme={setTheme}
                accent={accent}
                onAccent={setAccent}
              />
            }
          />
          <Route path="/go/:kind/:value" element={<Resolver />} />
          <Route path="*" element={<div className="page"><p className="muted">Not found.</p></div>} />
        </Routes>
        </Crash>
      </main>
    </div>
    <VimLayer />
    </ToastHost>
    </VimProvider>
    </UndoProvider>
  )
}

const VIEW_KEYS = { d: 'day', w: 'week', m: 'month', n: 'notes' }

const HELP = [
  ['\u2190 / \u2192', 'The day, week or month before / after'],
  ['g then d / w / m / n', 'Day, Week, Month, Notes — keeping the date you are on'],
  ['g then a / p / e', 'All tasks, Projects, People'],
  ['g then r / u / b', 'Routines, Uploads, Notebook'],
  ['g then h / s', 'The dashboard, Settings'],
  ['t', 'Jump to today'],
  ['?', 'This list'],
  ['Esc', 'Close'],
]

/**
 * Keyboard control, on the rail rather than only in Settings.
 *
 * It was a switch three panels down a settings page, which is nowhere: the one
 * thing a mode needs is somewhere obvious to turn it on, and somewhere obvious
 * to turn it off again when it has taken over your letter keys.
 */
function VimToggle() {
  const vim = useVim()
  const on = !!vim?.enabled
  return (
    <button
      className={`sb-vim${on ? ' is-on' : ''}`}
      aria-pressed={on}
      title={`Keyboard control is ${on ? 'on' : 'off'} — Ctrl-Alt-V`}
      onClick={() => vim?.toggle()}
    >
      <Icon name="keyboard" size={15} />
    </button>
  )
}

/**
 * Global keys, following the convention shared by Google Calendar, Linear and
 * Todoist. Ignored while typing, so they never eat text.
 */
function Shortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const [help, setHelp] = useState(false)
  const [pendingG, setPendingG] = useState(false)
  const vim = useVim()

  useEffect(() => {
    function onKey(e) {
      // Keyboard control binds most of these letters to something else — j and
      // k move the cursor between tasks rather than between days — so while it
      // is on, this layer stands down entirely rather than the two fighting
      // over the same keys.
      if (vim?.enabled) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return

      const [, view, date] = location.pathname.split('/')
      const anchor = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today()

      if (pendingG) {
        setPendingG(false)
        const to = GO_TO[e.key]
        if (to) return navigate(to)
        const dated = GO_DATED[e.key]
        if (dated) return navigate(`/${dated}/${anchor}`)
        return
      }

      if (e.key === '?') { setHelp((v) => !v); return }
      if (e.key === 'g') { setPendingG(true); return }
      if (e.key === 't') { navigate(`/${VIEW_KEYS[view?.[0]] ? view : 'day'}/${today()}`); return }

      // d, w, m and n are only reachable through g now, so the bare letters
      // mean the same thing whether or not keyboard control is on.


      // j and k are deliberately not bound here any more. The arrow keys already
      // walk the calendar, and leaving these free means they mean one thing —
      // move down and up a list of tasks — rather than something different
      // depending on whether keyboard control happens to be on.
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [location.pathname, navigate, pendingG, vim?.enabled])

  if (!help) return null

  return (
    <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
      <dl className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
        {HELP.map(([keys, what]) => (
          <div key={keys} style={{ display: 'contents' }}>
            <dt><kbd>{keys}</kbd></dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}

/**
 * Calendar links carry a date, so `end` matching would drop the highlight as
 * soon as you navigate to another day. `match` opts those into prefix matching.
 */
function SideLink({ to, match, icon, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => {
        const active = match ? location.pathname.startsWith(match) : isActive
        return `sb-link ${active ? 'active' : ''}`
      }}
    >
      <span className="ico"><Icon name={icon} /></span>
      {label}
    </NavLink>
  )
}
