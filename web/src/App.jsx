import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Icon from './components/Icon.jsx'
import Wordmark from './components/Wordmark.jsx'
import DayNight from './components/DayNight.jsx'
import { Modal } from './components/ui.jsx'
import { ToastHost } from './components/Toast.jsx'
import { UndoButtons, UndoProvider } from './lib/undo.jsx'
import { refreshAll } from './lib/api.js'
import { addDays, addMonths, today } from './lib/dates.js'
import Day from './pages/Day.jsx'
import Week from './pages/Week.jsx'
import Month from './pages/Month.jsx'
import Notes from './pages/Notes.jsx'
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
  { to: '/people', icon: 'people', label: 'People' },
  { to: '/uploads', icon: 'paperclip', label: 'Uploads' },
  { to: '/settings', icon: 'gear', label: 'Settings' },
]

export default function App() {
  const [accent, setAccent] = useState(() => localStorage.getItem('accent') || 'blue')
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system')
  // What the theme actually resolved to. `theme` may be 'system', and the
  // switch has to show the opposite of what is on screen, not of the setting.
  const [isDark, setIsDark] = useState(false)

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
    <ToastHost>
    <div className="app">
      <nav className="sidebar">
        <UndoButtons />

        <div className="sb-section">Calendar</div>
        {NAV.map((n) => (
          <SideLink key={n.label} {...n} />
        ))}

        <div className="sb-section">Workspace</div>
        {NAV_2.map((n) => (
          <SideLink key={n.label} {...n} />
        ))}

        {/* The mark signs the foot of the rail, with the day/night switch
            centred beneath it. Both sit in one block so the spare height goes
            above the pair rather than between them. */}
        <div className="sb-foot">
          <NavLink to="/dashboard" className="brand" title="Dashboard">
            <Wordmark />
          </NavLink>
          <DayNight dark={isDark} onToggle={() => setTheme(isDark ? 'light' : 'dark')} />
        </div>
      </nav>

      <main className="main">
        <Shortcuts />
        <InternalLinks />
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
      </main>
    </div>
    </ToastHost>
    </UndoProvider>
  )
}

const VIEW_KEYS = { d: 'day', w: 'week', m: 'month', n: 'notes' }

const HELP = [
  ['d / w / m / n', 'Day, Week, Month, Notes — keeping the date you are on'],
  ['t', 'Jump to today'],
  ['j / k', 'Next / previous day, week or month, depending on the view'],
  ['g then p / e / a', 'Go to Projects, People, All tasks'],
  ['?', 'This list'],
  ['Esc', 'Close'],
]

/**
 * Global keys, following the convention shared by Google Calendar, Linear and
 * Todoist. Ignored while typing, so they never eat text.
 */
function Shortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const [help, setHelp] = useState(false)
  const [pendingG, setPendingG] = useState(false)

  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return

      const [, view, date] = location.pathname.split('/')
      const anchor = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today()

      if (pendingG) {
        setPendingG(false)
        if (e.key === 'p') return navigate('/projects')
        if (e.key === 'e') return navigate('/people')
        if (e.key === 'a') return navigate('/tasks')
        return
      }

      if (e.key === '?') { setHelp((v) => !v); return }
      if (e.key === 'g') { setPendingG(true); return }
      if (e.key === 't') { navigate(`/${VIEW_KEYS[view?.[0]] ? view : 'day'}/${today()}`); return }

      if (VIEW_KEYS[e.key]) { navigate(`/${VIEW_KEYS[e.key]}/${anchor}`); return }

      if (e.key === 'j' || e.key === 'k') {
        const step = e.key === 'j' ? 1 : -1
        if (view === 'month') navigate(`/month/${addMonths(anchor, step)}`)
        else if (view === 'week') navigate(`/week/${addDays(anchor, 7 * step)}`)
        else if (view === 'day' || view === 'notes') navigate(`/${view}/${addDays(anchor, step)}`)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [location.pathname, navigate, pendingG])

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
