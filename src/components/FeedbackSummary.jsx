// src/components/FeedbackSummary.jsx
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_LABEL = { judge: 'กรรมการ', admin: 'Admin', participant: 'ผู้เข้าแข่งขัน', other: 'อื่นๆ' }

export default function FeedbackSummary() {
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase
      .from('feedback_responses').select('*').order('submitted_at', { ascending: false })
    setResponses(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function avg(field) {
    if (responses.length === 0) return '—'
    const sum = responses.reduce((s, r) => s + (r[field] || 0), 0)
    return (sum / responses.length).toFixed(1)
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>กำลังโหลด...</p>

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 12, marginBottom: 20 }}>
        {[
          ['จำนวนผู้ตอบ', responses.length, ''],
          ['ความง่ายในการใช้งาน', avg('ease_of_use'), '/5'],
          ['ความรวดเร็ว', avg('responsiveness'), '/5'],
          ['ความชัดเจน', avg('clarity'), '/5'],
          ['ความพึงพอใจโดยรวม', avg('overall_rating'), '/5'],
        ].map(([label, val, suffix]) => (
          <div key={label} className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--ecg)' }}>{val}<span style={{ fontSize: 14, color: 'var(--muted)' }}>{suffix}</span></div>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
          ความคิดเห็นทั้งหมด ({responses.length} รายการ)
        </div>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {responses.map(r => (
            <div key={r.response_id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span><b>{ROLE_LABEL[r.role]}</b> {r.station_used && `· ${r.station_used}`}</span>
                <span style={{ color: 'var(--ecg)', fontFamily: 'JetBrains Mono,monospace' }}>
                  รวม {r.overall_rating}/5
                </span>
              </div>
              {r.comment && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{r.comment}</div>}
            </div>
          ))}
          {responses.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีผู้ตอบแบบประเมิน</p>}
        </div>
      </div>
    </div>
  )
}
