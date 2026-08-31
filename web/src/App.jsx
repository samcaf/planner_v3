import { useEffect, useRef, useState } from 'react'
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
import { installShiftOpen } from './lib/openIn.js'
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
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Resolver, { InternalLinks } from './components/Resolver.jsx'
import Search from './components/Search.jsx'
import VimLayer from './components/VimLayer.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { VimProvider, useVim } from './lib/vim.jsx'
import { goTarget } from './lib/nav.js'
import { GENERAL } from './lib/shortcuts.js'
// The `?` sheet draws the key table, so its styles have to be here rather than
// on the one page that used to own them.
import './styles/keys.css'

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

/**
 * The app, or the door to it.
 *
 * The theme and accent effects live inside `App`, below, and they are what put
 * data-theme and data-accent on <html> — so the login page has to render inside
 * the same component to come up in the right colours rather than flashing the
 * default ones and correcting itself.
 */
export default function App() {
  return (
    <AuthProvider>
      <Planner />
    </AuthProvider>
  )
}

function Planner() {
  // App sits inside the BrowserRouter, so this is safe here — and it is what
  // lets the error boundary below reset itself when you navigate away.
  const location = useLocation()
  const auth = useAuth()
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

  // Shift-click means "open in a new tab", for links and for cards alike.
  // Installed once, at the root, because it is a property of the whole app
  // rather than of any page.
  useEffect(installShiftOpen, [])

  // No waiting. `auth.in` is optimistic — this browser was signed in last time,
  // so the app draws now and its data loads in parallel with the check. See
  // lib/auth.jsx for why blocking here was worth removing.
  if (!auth?.in) return <Login />

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

        {/* Directly under Settings, centred and wordless. It is a mode rather
            than a place, so it does not belong in the list of places — but it
            is reached often enough that it should not be at the far foot of
            the rail either. */}
        <VimToggle />

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
  /**
   * The `g` of `gt`, held in a ref rather than in state.
   *
   * Two keys of a sequence can arrive in one tick — from a key repeat, from
   * typing fast, from a test — and a handler reading state still sees the value
   * from the render it was built in. As state, the second key of `gt` saw no
   * pending `g` and did nothing. Keyboard control learned this the same way and
   * uses a ref for exactly this reason.
   */
  const pendingG = useRef(false)
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

      if (pendingG.current) {
        pendingG.current = false
        // The same table keyboard control reads, so `gt` is today and `gp` is
        // projects in both — there is one set of destinations, not two.
        const to = goTarget(e.key, { pathname: location.pathname, today: today() })
        if (to) return navigate(to)
        return
      }

      if (e.key === '?') { setHelp((v) => !v); return }
      if (e.key === 'g') { pendingG.current = true; return }

      // Every destination is under g now, including today — a bare letter
      // cannot be a shortcut here and something else with keyboard control on
      // without meaning two things depending on a mode you cannot see.

      // j and k are deliberately not bound here any more. The arrow keys already
      // walk the calendar, and leaving these free means they mean one thing —
      // move down and up a list of tasks — rather than something different
      // depending on whether keyboard control happens to be on.
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [location.pathname, navigate, vim?.enabled])

  if (!help) return null

  return (
    <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
      {/* The same table the Settings page draws. One sheet cannot fall behind
          the other when there is only one of them. */}
      <div className="st-keys">
        {GENERAL.map(([group, pairs]) => (
          <section key={group}>
            <h4>{group}</h4>
            <dl>
              {pairs.map(([keys, what]) => (
                <div key={keys}><dt>{keys}</dt><dd>{what}</dd></div>
              ))}
            </dl>
          </section>
        ))}
      </div>
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
