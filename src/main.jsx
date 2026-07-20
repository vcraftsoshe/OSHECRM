import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import SignupForm from './SignupForm.jsx'
import AuthGate from './AuthGate.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public — no login required. This is the link sent to prospective clients. */}
        <Route path="/signup" element={<SignupForm />} />
        <Route path="/signup/:leadId" element={<SignupForm />} />

        {/* Everything else is the internal team app, behind login. */}
        <Route
          path="/*"
          element={
            <AuthGate>
              <App />
            </AuthGate>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
