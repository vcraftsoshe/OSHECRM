import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import SignupForm from './SignupForm.jsx'
import AuthGate from './AuthGate.jsx'
import './index.css'

// Both oshe.tech and signup.oshe.co.nz point at this same deployed app.
// On the dedicated signup subdomain, every path is the sign-up form — no
// "/signup/" prefix needed, so the link people get is just signup.oshe.co.nz/[id].
// On oshe.tech (or anywhere else), only /signup and /signup/:leadId are public;
// everything else is the internal team app, behind login.
const isSignupHost = window.location.hostname.startsWith('signup.')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {isSignupHost ? (
        <Routes>
          <Route path="/:leadId" element={<SignupForm />} />
          <Route path="/" element={<SignupForm />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/signup" element={<SignupForm />} />
          <Route path="/signup/:leadId" element={<SignupForm />} />
          <Route
            path="/*"
            element={
              <AuthGate>
                <App />
              </AuthGate>
            }
          />
        </Routes>
      )}
    </BrowserRouter>
  </React.StrictMode>,
)
