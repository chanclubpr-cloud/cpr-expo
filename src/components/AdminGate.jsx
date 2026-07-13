// src/components/AdminGate.jsx
import { useState } from 'react'
import { isAdminAuthed, tryAdminLogin } from '../lib/adminAuth'

export default function AdminGate({ children }) {
  const [authed,   setAuthed]   = useState(isAdminAuthed())
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (tryAdminLogin(password)) {
      setAuthed(true)
    } else {
      setError('รหัสผ่านไม่ถูกต้อง')
      setPassword('')
    }
  }

  if (authed) return children

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-deep)', padding: 24 }}>
      <form onSubmit={handleSubmit} style={{
        background: 'var(--bg-panel)', border: '1px solid var(--line)', borderRadius: 16,
        padding: 32, width: '100%', maxWidth: 360, textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 20 }}>Admin + Master</div>
        <input
          type="password" autoFocus placeholder="รหัสผ่าน" value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', textAlign: 'center', fontSize: 18, marginBottom: 14 }}
        />
        {error && <p style={{ color: 'var(--alert)', fontSize: 13, marginBottom: 14 }}>{error}</p>}
        <button type="submit" className="btn-primary">เข้าสู่ระบบ</button>
      </form>
    </div>
  )
}
