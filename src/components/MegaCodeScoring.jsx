// src/components/MegaCodeScoring.jsx
// ============================================================
// แยกออกมาจาก MegaCodeManager เดิม — ส่วนนี้ยังอยู่แท็บ "Mega Code"
// (การตั้งค่าทีมย้ายไปหน้า Admin แล้ว ที่นี่เหลือแค่กรอกคะแนน)
// ============================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function MegaCodeScoring({ eventId }) {
  const [qualifiers,  setQualifiers]  = useState([])
  const [scores,      setScores]      = useState({})
  const [savingScore, setSavingScore] = useState(false)
  const [enteredBy,   setEnteredBy]   = useState('')

  async function loadQualifiers() {
    if (!eventId) { setQualifiers([]); return }
    const { data } = await supabase
      .from('megacode_qualifiers')
      .select('*, teams(team_name), megacode_results(checklist_score, final_rank, entered_by)')
      .eq('event_id', eventId)
      .order('qualified_rank')
    setQualifiers(data || [])
    const initScores = {}
    ;(data || []).forEach(q => {
      const res = Array.isArray(q.megacode_results) ? q.megacode_results[0] : q.megacode_results
      if (res?.checklist_score != null) initScores[q.team_id] = String(res.checklist_score)
    })
    setScores(initScores)
  }
  useEffect(() => { loadQualifiers() }, [eventId])

  async function saveAllScores() {
    if (!enteredBy.trim()) { alert('กรุณากรอกชื่อผู้บันทึกคะแนนก่อน'); return }
    if (!eventId) { alert('ยังไม่มีงานแข่งขันที่เปิดอยู่'); return }
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
        event_id: eventId,
      }, { onConflict: 'team_id' })
      if (error) { alert(`บันทึกคะแนนไม่สำเร็จ (ทีม ${i+1}): ${error.message}`); setSavingScore(false); return }
    }

    setSavingScore(false)
    alert('บันทึกคะแนนและจัดอันดับเรียบร้อยแล้ว')
    loadQualifiers()
  }

  return (
    <div>
      <div className="card-highlight">
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12, letterSpacing: '.06em' }}>
          🏅 กรอกคะแนนรวมจาก Checklist (ต่อทีม) — ระบบจัดอันดับให้อัตโนมัติ
        </div>

        {qualifiers.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีทีมที่เข้ารอบ — ไปตั้งค่าที่หน้า Admin → คัดเลือกทีมเข้ารอบ Mega Code ก่อน</p>
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
