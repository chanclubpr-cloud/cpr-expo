// src/screens/Feedback.jsx
// ============================================================
// แบบประเมินความพึงพอใจ — เปิดให้กรรมการ/Admin กรอกได้อิสระ
// ไม่ผูกกับ CompetitionGate (กรอกได้แม้งานปิดแล้ว)
// เข้าถึงได้ที่ /feedback
// ============================================================

import { useState } from 'react'
import { supabase } from '../lib/supabase'

const ROLES = [
  ['judge', 'กรรมการ'],
  ['admin', 'Admin / ทีมงานกลาง'],
  ['participant', 'ผู้เข้าแข่งขัน'],
  ['other', 'อื่นๆ'],
]
const STATIONS = ['BLS', 'ECG', 'ALGORITHM', 'MASTER/ADMIN', 'อื่นๆ']

function StarRating({ value, onChange, label }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" onClick={() => onChange(n)} style={{
            width: 44, height: 44, borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${value >= n ? 'var(--ecg)' : 'var(--line)'}`,
            background: value >= n ? 'var(--ecg)' : 'var(--bg-panel-2)',
            color: value >= n ? '#04170D' : 'var(--muted)',
            fontSize: 18, fontWeight: 700,
          }}>{n}</button>
        ))}
      </div>
    </div>
  )
}

export default function Feedback() {
  const [role,           setRole]           = useState('')
  const [stationUsed,    setStationUsed]    = useState('')
  const [easeOfUse,      setEaseOfUse]      = useState(0)
  const [responsiveness, setResponsiveness] = useState(0)
  const [clarity,        setClarity]        = useState(0)
  const [overall,        setOverall]        = useState(0)
  const [comment,        setComment]        = useState('')
  const [saving,         setSaving]         = useState(false)
  const [submitted,      setSubmitted]      = useState(false)
  const [error,          setError]          = useState('')

  async function handleSubmit() {
    setError('')
    if (!role || !easeOfUse || !responsiveness || !clarity || !overall) {
      setError('กรุณาให้คะแนนครบทุกหัวข้อ และเลือกบทบาทของท่านก่อนส่ง')
      return
    }
    setSaving(true)
    const { error: insErr } = await supabase.from('feedback_responses').insert({
      role, station_used: stationUsed || null,
      ease_of_use: easeOfUse, responsiveness, clarity, overall_rating: overall,
      comment: comment.trim() || null,
    })
    setSaving(false)
    if (insErr) { setError(`ส่งไม่สำเร็จ: ${insErr.message}`); return }
    setSubmitted(true)
  }

  if (submitted) return (
    <div className="screen" style={{ textAlign: 'center', marginTop: 60 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🙏</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ecg)' }}>ขอบคุณสำหรับความคิดเห็น</div>
      <p style={{ color: 'var(--muted)', marginTop: 8 }}>ข้อเสนอแนะของท่านจะถูกนำไปใช้ปรับปรุงระบบต่อไป</p>
    </div>
  )

  return (
    <div className="screen">
      <h1 className="page-title" style={{ marginTop: 20 }}>แบบประเมินความพึงพอใจ</h1>
      <p className="page-sub">ระบบ QSHC CPR EXPO — ใช้เวลาไม่เกิน 1 นาที ช่วยเราปรับปรุงระบบให้ดีขึ้น</p>

      <div className="card">
        <div className="field">
          <label>ท่านคือ?</label>
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="">— เลือก —</option>
            {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className="field">
          <label>ใช้งานฐานไหนเป็นหลัก (ถ้ามี)</label>
          <select value={stationUsed} onChange={e => setStationUsed(e.target.value)}>
            <option value="">— ไม่ระบุ —</option>
            {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <StarRating label="ความง่ายในการใช้งาน (1=ยากมาก, 5=ง่ายมาก)" value={easeOfUse} onChange={setEaseOfUse} />
        <StarRating label="ความรวดเร็ว/ตอบสนองของระบบ (1=ช้ามาก, 5=เร็วมาก)" value={responsiveness} onChange={setResponsiveness} />
        <StarRating label="ความชัดเจนของหน้าจอ/คำแนะนำ (1=สับสน, 5=ชัดเจนมาก)" value={clarity} onChange={setClarity} />
        <StarRating label="ความพึงพอใจโดยรวม (1=ไม่พอใจ, 5=พอใจมาก)" value={overall} onChange={setOverall} />

        <div className="field">
          <label>ข้อเสนอแนะเพิ่มเติม (ถ้ามี)</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={4}
            style={{ width: '100%', background: 'var(--bg-panel-2)', border: '1px solid var(--line)',
                     borderRadius: 8, color: 'var(--text)', padding: '10px 12px', fontFamily: 'Sarabun,sans-serif', fontSize: 15 }} />
        </div>

        {error && <p style={{ color: 'var(--alert)', fontSize: 13, marginBottom: 10 }}>{error}</p>}

        <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'กำลังส่ง...' : 'ส่งแบบประเมิน'}
        </button>
      </div>
    </div>
  )
}
