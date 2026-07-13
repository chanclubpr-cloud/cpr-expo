// src/screens/EventHome.jsx
// ============================================================
// หน้าแรกสำหรับจัดการ "งานแข่งขัน" — สร้างงานใหม่ (=รีเซ็ตทั้งกระดาน
// แบบไม่ทำลายข้อมูลเก่า) และสลับกลับไปดู/ใช้งานงานเก่าได้
// เข้าถึงที่ /events (ยังไม่ผูกรหัสผ่าน — จะเพิ่มในเฟสถัดไป)
// ============================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function EventHome() {
  const [events,   setEvents]   = useState([])
  const [newName,  setNewName]  = useState('')
  const [creating, setCreating] = useState(false)
  const [error,    setError]    = useState('')

  async function load() {
    const { data } = await supabase.from('events').select('*').order('created_at', { ascending: false })
    setEvents(data || [])
  }
  useEffect(() => { load() }, [])

  async function createEvent() {
    setError('')
    if (!newName.trim()) { setError('กรุณาตั้งชื่องานแข่งขัน'); return }
    setCreating(true)

    // ปิดงานเดิมทั้งหมดก่อน (is_current = false ให้หมด)
    await supabase.from('events').update({ is_current: false }).neq('event_id', '00000000-0000-0000-0000-000000000000')

    // สร้างงานใหม่ ตั้งเป็นงานปัจจุบัน
    const { data: newEvent, error: insErr } = await supabase
      .from('events').insert({ event_name: newName.trim(), is_current: true })
      .select().single()

    if (insErr) { setError(`สร้างงานไม่สำเร็จ: ${insErr.message}`); setCreating(false); return }

    // สร้างแถว event_state เริ่มต้นให้งานใหม่ (ทีม/กรรมการ/ผลคะแนน จะว่างเปล่าโดยธรรมชาติ
    // เพราะทุกอย่างอ้างอิงผ่าน event_id ของทีม ซึ่งยังไม่มีทีมของงานนี้เลย)
    await supabase.from('event_state').insert({
      event_id: newEvent.event_id,
      active_station: 'IDLE',
      total_teams_registered: 5,
      registration_open: true,
      megacode_mode: 'separate',
    })

    setNewName('')
    setCreating(false)
    load()
    alert(`สร้างงาน "${newEvent.event_name}" เรียบร้อยแล้ว และตั้งเป็นงานปัจจุบันแล้ว`)
  }

  async function switchToEvent(eventId) {
    if (!confirm('ยืนยันสลับไปใช้งานนี้เป็นงานปัจจุบัน? กรรมการ/ผู้แข่งขันทุกคนจะเห็นข้อมูลของงานนี้ทันที')) return
    await supabase.from('events').update({ is_current: false }).neq('event_id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('events').update({ is_current: true }).eq('event_id', eventId)
    load()
  }

  return (
    <div className="screen-wide" style={{ paddingTop: 30 }}>
      <h1 className="page-title">จัดการงานแข่งขัน</h1>
      <p className="page-sub">สร้างงานใหม่ = เริ่มต้นทีม/กรรมการ/คะแนนใหม่หมด โดยไม่ลบข้อมูลงานเก่าทิ้งเลย</p>

      <div className="card-highlight" style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
          ➕ สร้างงานแข่งขันใหม่
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="text" placeholder='เช่น "QSHC CPR Master 2027"' value={newName}
            onChange={e => setNewName(e.target.value)} style={{ flex: 1 }} />
          <button className="btn-primary" onClick={createEvent} disabled={creating} style={{ width: 'auto', padding: '0 20px' }}>
            {creating ? 'กำลังสร้าง...' : '+ สร้างงานใหม่'}
          </button>
        </div>
        {error && <p style={{ color: 'var(--alert)', fontSize: 13, marginTop: 8 }}>{error}</p>}
      </div>

      <div className="card">
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
          📅 งานแข่งขันทั้งหมด (คลิก "เปิดใช้งาน" เพื่อสลับกลับไปงานเก่าได้)
        </div>
        {events.map(ev => (
          <div key={ev.event_id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 0', borderBottom: '1px solid var(--line)',
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>
                {ev.event_name}
                {ev.is_current && <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--ecg)', border: '1px solid var(--ecg)', borderRadius: 10, padding: '2px 8px' }}>กำลังใช้งานอยู่</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace' }}>
                สร้างเมื่อ {new Date(ev.created_at).toLocaleString('th-TH')}
              </div>
            </div>
            {!ev.is_current && (
              <button onClick={() => switchToEvent(ev.event_id)} style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid var(--line)',
                background: 'none', color: 'var(--text)', cursor: 'pointer',
              }}>เปิดใช้งาน</button>
            )}
          </div>
        ))}
        {events.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีงานแข่งขัน</p>}
      </div>

      <p className="note" style={{ marginTop: 20 }}>
        หลังสร้าง/สลับงานแล้ว ไปที่ <a href="/master" style={{ color: 'var(--ecg)' }}>/master</a> เพื่อตั้งค่าทีม กรรมการ และเริ่มการแข่งขันตามปกติ
      </p>
    </div>
  )
}
