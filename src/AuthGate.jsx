import React, { useState, useEffect } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";

const T = {
  charcoal: "#1A2C2E",
  teal: "#13DCCC",
  tealDark: "#0AADA0",
  ink: "#152423",
  slate: "#5C7274",
  border: "#DCE6E4",
  coral: "#C25B4E",
  paperAlt: "#EBF2F0",
};

// Wraps the whole app. Nobody gets past this without a real email + password
// that you created for them in the Firebase console (Authentication > Users).
// There is no public sign-up here on purpose — accounts are added by you, not self-served.
export default function AuthGate({ children }) {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out, object = logged in
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError("Incorrect email or password.");
    } finally {
      setSubmitting(false);
    }
  };

  if (user === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", color: T.slate }}>
        Loading…
      </div>
    );
  }

  if (user === null) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.charcoal, fontFamily: "system-ui, sans-serif" }}>
        <form onSubmit={handleLogin} style={{ background: "#fff", padding: 32, borderRadius: 16, width: 320, display: "flex", flexDirection: "column", gap: 12 }}>
          <img src="/logo-full.png" alt="OSHE" style={{ height: 56, width: "auto", maxWidth: "100%", objectFit: "contain", alignSelf: "flex-start", marginBottom: 8 }} />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 14 }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 14 }}
          />
          {error && <div style={{ color: T.coral, fontSize: 13 }}>{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            style={{ background: T.tealDark, color: "#fff", padding: "10px 12px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? "Signing in…" : "Log in"}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
