import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './styles/global.css'
import './i18n'

import App from './App'
import { LibraryPresenceProvider } from './hooks/useLibraryPresence'
import { QueueProvider } from './hooks/useQueue'
import { startSeasons } from './lib/seasons'

startSeasons()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LibraryPresenceProvider>
      <QueueProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueueProvider>
    </LibraryPresenceProvider>
  </React.StrictMode>,
)
