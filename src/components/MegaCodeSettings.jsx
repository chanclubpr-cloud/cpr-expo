// src/components/MegaCodeSettings.jsx
// ============================================================
// แยกออกมาจาก MegaCodeManager เดิม — ส่วนนี้ย้ายไปอยู่หน้า Admin
// (ใต้ผู้เข้าแข่งขัน) เพราะเป็นการ "ตั้งค่าล่วงหน้า" ไม่ใช่งานที่ทำระหว่างแข่ง
// ============================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function MegaCodeSettings({ teams }) {
  const [selected,    setSelected]    = useState(new Set())
  const [savingSel,   setSavingSel]   = useState(false)
  const [scoringMode, setScoringMode] = useState('separate')

  async function loadMode() {
    const { data } = await supabase.from('event_state').select('megacode_mode').single()
    if (data?.megacode_mode) setScoringMode(data.megacode_mode)
  }
  async function saveMode(mode) {
    setScoringMode(mode)
    const { error } = await supabase.from('event_state').update({ megacode_mode: mode }).eq('id', 1)
    if (error) alert(`บันทึกโหมดไม่สำเร็จ: ${error.message}`)
  }
  useEffect(() => { loadMode() }, [])

  async function loadSelected() {
    const { data } = await supabase.from('megacode_qualifiers').select('team_id')
    setSelected(new Set((data || []).map(q => q.team_id)))
  }
  useEffect(() => { loadSelected() }, [])

  function toggleTeam(teamId) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(teamId) ? next.delete(teamId) : next.add(teamId)
      return next
    })
  }

  async function saveQualifiers() {
    setSavingSel(true)
    await supabase.from('megacode_results').delete().neq('result_id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('megacode_qualifiers').delete().neq('team_id', '00000000-0000-0000-0000-000000000000')

    const rows = Array.from(selected).map((teamId, idx) => ({
      team_id: teamId, total_points: 0, qualified_rank: idx + 1,
    }))
    if (rows.length > 0) {
      const { error } = await supabase.from('megacode_qualifiers').insert(rows)
      if (error) { alert(`บันทึกไม่สำเร็จ: ${error.message}`); setSavingSel(false); return }
    }
    setSavingSel(false)
    alert('บันทึกทีมที่เข้ารอบเรียบร้อยแล้ว')
  }

  return (
    <div>
      <div className="card-highlight" style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12, letterSpacing: '.06em' }}>
          ⚙ วิธีคิดคะแนน Mega Code
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{
            display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${scoringMode === 'combined' ? 'var(--ecg)' : 'var(--line)'}`,
            background: scoringMode === 'combined' ? 'rgba(51,255,156,.06)' : 'var(--bg-panel-2)',
          }}>
            <input type="radio" name="megacodeMode" checked={scoringMode === 'combined'} onChange={() => saveMode('combined')} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>จัดลำดับร่วมกับ BLS/ECG/Algorithm</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                แปลงอันดับ Mega Code เป็นแต้ม แล้วบวกเข้ากับแต้มรวม 3 ฐานแรก — ทีมที่ชนะคือแต้มรวมทั้งหมดสูงสุด
              </div>
            </div>
          </label>
          <label style={{
            display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${scoringMode === 'separate' ? 'var(--ecg)' : 'var(--line)'}`,
            background: scoringMode === 'separate' ? 'rgba(51,255,156,.06)' : 'var(--bg-panel-2)',
          }}>
            <input type="radio" name="megacodeMode" checked={scoringMode === 'separate'} onChange={() => saveMode('separate')} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>จัดลำดับแยกเฉพาะ Mega Code</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                ใช้คะแนนดิบของรอบ Mega Code ตัดสินอันดับของรอบนี้เท่านั้น ไม่ปนกับแต้มจาก 3 ฐานแรก
              </div>
            </div>
          </label>
        </div>
      </div>

      <div className="card-highlight">
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12, letterSpacing: '.06em' }}>
          🏆 คัดเลือกทีมเข้ารอบ Mega Code (เลือกได้หลายทีม)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
          {teams.map(t => (
            <label key={t.team_id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
              borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${selected.has(t.team_id) ? 'var(--ecg)' : 'var(--line)'}`,
              background: selected.has(t.team_id) ? 'rgba(51,255,156,.08)' : 'var(--bg-panel-2)',
            }}>
              <input type="checkbox" checked={selected.has(t.team_id)} onChange={() => toggleTeam(t.team_id)} />
              <span>{t.team_name}</span>
            </label>
          ))}
        </div>
        <button className="btn-primary" onClick={saveQualifiers} disabled={savingSel}>
          {savingSel ? 'กำลังบันทึก...' : `บันทึกทีมที่เข้ารอบ (${selected.size} ทีม)`}
        </button>
        <p className="note">
          ระบบจะล้างคะแนน Mega Code เดิมทิ้งทุกครั้งที่กดบันทึกทีมใหม่ — ถ้าเคยกรอกคะแนนไว้แล้วและแค่จะแก้ทีม ให้ระวังจุดนี้
        </p>
      </div>
    </div>
  )
}
