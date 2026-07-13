// src/components/CompetitionGate.jsx
// ============================================================
// ใช้ครอบหน้าจอกรรมการและผู้แข่งขัน — ถ้า Master กด "ปิดการแข่งขัน"
// ทุกคนที่พยายามเข้าหน้าจอเหล่านี้จะเห็นข้อความปิดกั้น เข้าใช้งานไม่ได้
// (หน้า Master/Admin และ Leaderboard ไม่ถูกบล็อก เพื่อให้ Admin จัดการต่อได้)
//
// แก้ไข: เดิมอ่าน event_state โดยไม่กรอง event_id (ใช้ .single() ตรงๆ)
// พอมีหลายงานในระบบ จะเจอ error PGRST116 (พบมากกว่า 1 แถว) แล้ว
// default เป็น "เปิด" (?? true) อย่างไม่ปลอดภัย — แก้ให้กรองงานปัจจุบัน
// และ default เป็น "ปิด" เสมอเมื่อเกิดข้อผิดพลาด (fail-safe)
// ============================================================

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentEvent } from '../lib/currentEvent'

export default function CompetitionGate({ children }) {
  const [open, setOpen] = useState(false) // ค่าเริ่มต้นปลอดภัยไว้ก่อน = "ปิด" ไม่ใช่ "เปิด"
  const [loading, setLoading] = useState(true)
  const [eventId, setEventId] = useState(null)

  useEffect(() => {
    async function load() {
      const ev = await getCurrentEvent()
      if (!ev) {
        // ไม่มีงานเปิดอยู่เลย — ปิดกั้นไว้ก่อนเสมอ (ปลอดภัยกว่าปล่อยผ่าน)
        setOpen(false)
        setLoading(false)
        return
      }
      setEventId(ev.event_id)

      const { data, error } = await supabase
        .from('event_state').select('registration_open').eq('event_id', ev.event_id).maybeSingle()

      // ถ้าอ่านค่าไม่ได้ (error หรือไม่พบแถว) ให้ "ปิดกั้นไว้ก่อน" แทนการปล่อยผ่านโดยปริยาย
      setOpen(!error && data ? data.registration_open : false)
      setLoading(false)
    }
    load()

    const sub = supabase.channel('gate-state')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'event_state' },
        (payload) => {
          if (payload.new.event_id !== eventId) return // ไม่ใช่งานปัจจุบัน ไม่สนใจ
          setOpen(payload.new.registration_open)
        })
      .subscribe()
    return () => supabase.removeChannel(sub)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
