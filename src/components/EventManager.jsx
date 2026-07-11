// src/components/EventManager.jsx
// ============================================================
// หน้าแรกของระบบหลายงานแข่งขัน — สร้างงานใหม่ / ดูงานเก่าที่ผ่านมา
// ============================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { listAllEvents, createNewEvent } from '../lib/currentEvent'

export default function EventManager({ onEventChanged }) {
  const [events, setEvents] = useState([])
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setEvents(await listAllEvents())
  }
  useEffect(() => { load() }, [])

  async function handleCreate() {
    setError('')
    if (!newName.trim()) { setError('กรุณาตั้งชื่องานแข่งขัน'); return }
    if (!confirm(`ยืนยันเปิดงานใหม่ "${newName.trim()}"?\n\nงานที่กำลังเปิดอยู่ตอนนี้จะถูกเก็บเป็นประวัติ (ดูย้อนหลังได้ แต่แก้ไขไม่ได้แล้ว)`)) return

    setCreating(true)
    const { error: err } = await createNewEvent(newName)
    setCreating(false)
    if (err) { setError(`สร้างงานไม่สำเร็จ: ${err.message}`); return }
    setNewName('')
    load()
    onEventChanged?.()
  }

  return (
    <div>
      <div className="card-highlight" style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12, letterSpacing: '.06em' }}>
          🆕 เปิดงานแข่งขันใหม่
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="text" placeholder="เช่น QSHC CPR EXPO 2027" value={newName}
            onChange={e => setNewName(e.target.value)} style={{ flex: 1 }} />
          <button className="btn-primary" onClick={handleCreate} disabled={creating} style={{ width: 'auto', padding: '0 20px' }}>
            {creating ? 'กำลังสร้าง...' : '+ เปิดงานใหม่'}
          </button>
        </div>
        {error && <p style={{ color: 'var(--alert)', fontSize: 13, marginTop: 10 }}>{error}</p>}
        <p className="note">
          ⚠️ เปิดงานใหม่แล้ว ทีม/กรรมการ/ผู้เข้าแข่งขัน/ผลคะแนนของงานเดิมจะถูก "ปิด" (ดูย้อนหลังได้ที่ตารางด้านล่าง แต่แก้ไขไม่ได้แล้ว)<br/>
          คลังโจทย์ (ECG/Algorithm) ใช้ร่วมกันทุกงาน ไม่ต้องสร้างใหม่
        </p>
      </div>

      <div className="card">
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
          📚 ประวัติงานแข่งขันทั้งหมด
        </div>
        {events.map(ev => (
          <div key={ev.event_id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 0', borderBottom: '1px solid var(--line)',
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {ev.event_name}
                {ev.is_current && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ecg)', border: '1px solid var(--ecg)', borderRadius: 10, padding: '2px 8px' }}>กำลังใช้งาน</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                สร้างเมื่อ {new Date(ev.created_at).toLocaleString('th-TH')}
              </div>
            </div>
            {!ev.is_current && (
              <a href={`/leaderboard?event=${ev.event_id}`} target="_blank" rel="noreferrer" style={{
                fontFamily: 'JetBrains Mono,monospace', fontSize: 12, color: 'var(--ecg)',
                border: '1px solid var(--ecg)', borderRadius: 6, padding: '4px 10px', textDecoration: 'none',
              }}>ดูผลย้อนหลัง</a>
            )}
          </div>
        ))}
        {events.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีงานแข่งขันในระบบ</p>}
      </div>
    </div>
  )
}
