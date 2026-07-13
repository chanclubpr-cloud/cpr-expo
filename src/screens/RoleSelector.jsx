// src/screens/RoleSelector.jsx
// ============================================================
// หน้าแรกของระบบ — เลือกว่าจะเข้าเป็นกรรมการคนไหน / ผู้เข้าแข่งขันคนไหน / Admin+Master
// แทนที่การต้องจำ URL คนละแบบ (/judge?device=1, /participant?device=2, /master)
// ============================================================

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCurrentEvent } from '../lib/currentEvent'

export default function RoleSelector() {
  const [eventName, setEventName] = useState('')
  const [devices,   setDevices]   = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    async function load() {
      const ev = await getCurrentEvent()
      if (!ev) { setLoading(false); return }
      setEventName(ev.event_name)

      const { data } = await supabase
        .from('device_assignments')
        .select('device_number, teams(team_name), judges(full_name)')
        .eq('event_id', ev.event_id)
        .order('device_number')
      setDevices(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const cardStyle = {
    background: 'var(--bg-panel)', border: '1px solid var(--line)', borderRadius: 16,
    padding: 20, marginBottom: 20,
  }
  const linkRowStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 14px', borderRadius: 10, marginBottom: 8,
    border: '1px solid var(--line)', background: 'var(--bg-panel-2)',
    textDecoration: 'none', color: 'var(--text)',
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', padding: '32px 20px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12, color: 'var(--muted)', letterSpacing: '.12em' }}>QSHC</div>
          <div style={{ fontFamily: 'Sarabun,sans-serif', fontWeight: 800, fontSize: 28 }}>
            CPR <span style={{ color: 'var(--ecg)' }}>EXPO</span>
          </div>
          {eventName && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{eventName}</div>}
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</p>
        ) : devices.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            ยังไม่มีการจับคู่เครื่อง — กรุณาแจ้ง Admin
          </p>
        ) : (
          <>
            <div style={cardStyle}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>👨‍⚕️ กรรมการ</div>
              {devices.filter(d => d.judges).map(d => (
                <Link key={`j-${d.device_number}`} to={`/judge?device=${d.device_number}`} style={linkRowStyle}>
                  <span>เครื่อง #{d.device_number} — {d.judges?.full_name}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{d.teams?.team_name}</span>
                </Link>
              ))}
            </div>

            <div style={cardStyle}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>🏃 ผู้เข้าแข่งขัน</div>
              {devices.map(d => (
                <Link key={`p-${d.device_number}`} to={`/participant?device=${d.device_number}`} style={linkRowStyle}>
                  <span>เครื่อง #{d.device_number}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{d.teams?.team_name}</span>
                </Link>
              ))}
            </div>
          </>
        )}

        <div style={cardStyle}>
          <Link to="/master" style={{
            display: 'block', textAlign: 'center', padding: '14px', borderRadius: 10,
            background: 'var(--ecg)', color: '#04170D', fontWeight: 800, textDecoration: 'none',
          }}>
            🔐 Admin + Master
          </Link>
        </div>

        <div style={{ textAlign: 'center' }}>
          <Link to="/leaderboard" style={{ color: 'var(--muted)', fontSize: 13 }}>ดู Leaderboard →</Link>
        </div>
      </div>
    </div>
  )
}
