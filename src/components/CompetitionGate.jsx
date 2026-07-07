// src/components/CompetitionGate.jsx
// ============================================================
// ใช้ครอบหน้าจอกรรมการและผู้แข่งขัน — ถ้า Master กด "ปิดการแข่งขัน"
// ทุกคนที่พยายามเข้าหน้าจอเหล่านี้จะเห็นข้อความปิดกั้น เข้าใช้งานไม่ได้
// (หน้า Master/Admin และ Leaderboard ไม่ถูกบล็อก เพื่อให้ Admin จัดการต่อได้)
// ============================================================

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function CompetitionGate({ children }) {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('event_state').select('registration_open').single()
      setOpen(data?.registration_open ?? true)
      setLoading(false)
    }
    load()

    const sub = supabase.channel('gate-state')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'event_state' },
        (payload) => setOpen(payload.new.registration_open))
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [])

  if (loading) return null

  if (!open) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-deep)', textAlign: 'center', padding: 24,
      }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
          การแข่งขันปิดชั่วคราว
        </div>
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 13, color: 'var(--muted)' }}>
          กรุณารอทีมงานเปิดใช้งานอีกครั้ง
        </div>
      </div>
    )
  }

  return children
}
