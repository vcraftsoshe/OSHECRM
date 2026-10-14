import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import SignupForm from './SignupForm.jsx'
import SiteReviewForm from './SiteReviewForm.jsx'
import AuthGate from './AuthGate.jsx'
import './index.css'

// oshe.tech, signup.oshe.co.nz and sitereviews.oshe.co.nz all point at this same deployed app.
// On the dedicated signup subdomain, every path is the sign-up form, so the link people get is
// just signup.oshe.co.nz/[id]. On the site reviews subdomain, every path is the request form.
// On oshe.tech (or anywhere else), only /signup, /signup/:leadId and /sitereviews are public;
// everything else is the internal team app, behind login.
const isSignupHost = window.location.hostname.startsWith('signup.')
const isSiteReviewsHost = window.location.hostname.startsWith('sitereviews.')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {isSignupHost ? (
        <Routes>
          <Route path="/:leadId" element={<SignupForm />} />
          <Route path="/" element={<SignupForm />} />
        </Routes>
      ) : isSiteReviewsHost ? (
        <Routes>
          <Route path="/*" element={<SiteReviewForm />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/signup" element={<SignupForm />} />
          <Route path="/signup/:leadId" element={<SignupForm />} />
          <Route path="/sitereviews" element={<SiteReviewForm />} />
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
