// src/components/MegaCodeManager.jsx
// ============================================================
// 2 ส่วนหลัก:
//   1) คัดเลือกทีมที่จะเข้ารอบ Mega Code (เลือกได้หลายทีม อิสระจากระบบคำนวณอัตโนมัติ)
//   2) กรอกคะแนนรวมจาก Checklist กระดาษ ทีละทีม → ระบบจัดอันดับให้อัตโนมัติ
// ============================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function MegaCodeManager({ teams }) {
  const [selected,    setSelected]    = useState(new Set())
  const [qualifiers,  setQualifiers]  = useState([])
  const [scores,      setScores]      = useState({})
  const [savingSel,   setSavingSel]   = useState(false)
  const [savingScore, setSavingScore] = useState(false)
  const [enteredBy,   setEnteredBy]   = useState('')
  const [scoringMode, setScoringMode] = useState('separate') // 'combined' | 'separate'

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

  async function loadQualifiers() {
    const { data } = await supabase
      .from('megacode_qualifiers')
      .select('*, teams(team_name), megacode_results(checklist_score, final_rank, entered_by)')
      .order('qualified_rank')
    setQualifiers(data || [])
    setSelected(new Set((data || []).map(q => q.team_id)))
    const initScores = {}
    ;(data || []).forEach(q => {
      const res = Array.isArray(q.megacode_results) ? q.megacode_results[0] : q.megacode_results
      if (res?.checklist_score != null) initScores[q.team_id] = String(res.checklist_score)
    })
    setScores(initScores)
  }
  useEffect(() => { loadQualifiers() }, [])

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
      team_id: teamId,
      total_points: 0,
      qualified_rank: idx + 1,
    }))
    if (rows.length > 0) {
      const { error } = await supabase.from('megacode_qualifiers').insert(rows)
      if (error) { alert(`บันทึกไม่สำเร็จ: ${error.message}`); setSavingSel(false); return }
    }
    setSavingSel(false)
    loadQualifiers()
  }

  async function saveAllScores() {
    if (!enteredBy.trim()) { alert('กรุณากรอกชื่อผู้บันทึกคะแนนก่อน'); return }
    setSavingScore(true)

    const entries = qualifiers
      .map(q => ({ team_id: q.team_id, score: scores[q.team_id] }))
      .filter(e => e.score !== undefined && e.score !== '')

    if (entries.length === 0) { alert('กรุณากรอกคะแนนอย่างน้อย 1 ทีม'); setSavingScore(false); return }

    const ranked = [...entries].sort((a, b) => Number(b.score) - Number(a.score))

    for (let i = 0; i < ranked.length; i++) {
      const { error } = await supabase.from('megacode_results').upsert({
        team_id: ranked[i].team_id,
        checklist_score: Number(ranked[i].score),
        entered_by: enteredBy.trim(),
        entered_at: new Date().toISOString(),
        final_rank: i + 1,
      }, { onConflict: 'team_id' })
      if (error) { alert(`บันทึกคะแนนไม่สำเร็จ (ทีม ${i+1}): ${error.message}`); setSavingScore(false); return }
    }

    setSavingScore(false)
    alert('บันทึกคะแนนและจัดอันดับเรียบร้อยแล้ว')
    loadQualifiers()
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
                แปลงอันดับ Mega Code เป็นแต้ม แล้วบวกเข้ากับแต้มรวม 3 ฐานแรก — ทีมที่ชนะคือแต้มรวมทั้งหมดสูงสุด (เหมาะกับทีมน้อย/ทีมเก่งใกล้เคียงกันมาก)
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

      <div className="card-highlight" style={{ marginBottom: 20 }}>
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

      <div className="card-highlight">
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12, letterSpacing: '.06em' }}>
          🏅 กรอกคะแนนรวมจาก Checklist (ต่อทีม) — ระบบจัดอันดับให้อัตโนมัติ
        </div>

        {qualifiers.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีทีมที่เข้ารอบ — เลือกทีมในส่วนด้านบนก่อน</p>
        ) : (
          <>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>ชื่อผู้บันทึกคะแนน (กรรมการ/Admin)</label>
              <input type="text" value={enteredBy} onChange={e => setEnteredBy(e.target.value)} placeholder="เช่น พว.สมหญิง" />
            </div>

            {qualifiers.map(q => (
              <div key={q.team_id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 0', borderBottom: '1px solid var(--line)',
              }}>
                <div style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{q.teams?.team_name}</div>
                <input
                  type="text" inputMode="decimal" placeholder="คะแนนรวม"
                  value={scores[q.team_id] || ''}
                  onChange={e => setScores({ ...scores, [q.team_id]: e.target.value })}
                  style={{ width: 120, textAlign: 'center', fontFamily: 'JetBrains Mono,monospace', fontSize: 16 }}
                />
              </div>
            ))}

            <button className="btn-primary" onClick={saveAllScores} disabled={savingScore} style={{ marginTop: 16 }}>
              {savingScore ? 'กำลังบันทึก...' : 'บันทึกคะแนนทั้งหมด และจัดอันดับ'}
            </button>
          </>
        )}
      </div>

      {qualifiers.some(q => {
        const res = Array.isArray(q.megacode_results) ? q.megacode_results[0] : q.megacode_results
        return res?.final_rank
      }) && (
        <div className="card" style={{ marginTop: 20 }}>
          <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
            🥇 ผลการจัดอันดับ Mega Code ล่าสุด
          </div>
          <table className="lb">
            <thead><tr><th>อันดับ</th><th>ทีม</th><th>คะแนนรวม</th></tr></thead>
            <tbody>
              {qualifiers
                .map(q => ({ ...q, res: Array.isArray(q.megacode_results) ? q.megacode_results[0] : q.megacode_results }))
                .filter(q => q.res?.final_rank)
                .sort((a, b) => a.res.final_rank - b.res.final_rank)
                .map((q, i) => (
                  <tr key={q.team_id} className={i === 0 ? 'rank-1' : ''}>
                    <td>{['🥇','🥈','🥉'][i] || q.res.final_rank}</td>
                    <td style={{ fontWeight: 700 }}>{q.teams?.team_name}</td>
                    <td style={{ fontFamily: 'JetBrains Mono,monospace' }}>{q.res.checklist_score}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
