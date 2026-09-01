import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import 'katex/dist/katex.min.css'
import './styles.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

/*
 * Register the service worker, in a built app only.
 *
 * Not in dev: it would sit in front of Vite's module graph and serve yesterday's
 * modules over today's edits, which is a confusing hour to spend. Not in jsdom
 * either, which has no serviceWorker at all — hence the capability check rather
 * than a mode check alone.
 *
 * It needs a secure context, which over a tailnet means `tailscale serve` and
 * its certificate. On plain http the registration simply never happens and the
 * app works exactly as before.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An insecure origin, or a browser that refuses. Nothing here depends on
      // it: the worker adds offline and installability, not function.
    })
  })
}
