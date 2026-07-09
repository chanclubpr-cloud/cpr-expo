// src/components/BLSRankingManager.jsx
// ============================================================
// แทนที่หน้าจอกรรมการ BLS แบบเดิมทั้งหมด — เปลี่ยนเป็นให้กรรมการ/Admin
// กรอกอันดับ 1-5 เอง (ตัดสินจาก "ทีมไหนทำครบ 5 คนก่อน" ด้วยสายตา/นาฬิกาจับเวลาแยก)
// แต้มคิดจากตารางคงที่เดียวกับฐานอื่น (1=5, 2=4, 3=3, 4=2, 5=1)
// ============================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { pointsForRank } from '../lib/scoring'

export default function BLSRankingManager({ teams }) {
  const [ranks, setRanks] = useState({}) // { team_id: rankNumber }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [currentResults, setCurrentResults] = useState([])

  async function loadCurrent() {
    const { data } = await supabase
      .from('station_results').select('team_id, rank').eq('station_type', 'BLS')
    setCurrentResults(data || [])
    const init = {}
    ;(data || []).forEach(r => { init[r.team_id] = String(r.rank) })
    setRanks(init)
  }
  useEffect(() => { loadCurrent() }, [])

  function setRank(teamId, value) {
    setRanks(prev => ({ ...prev, [teamId]: value }))
  }

  async function handleSave() {
    setError('')
    const entries = teams
      .map(t => ({ team_id: t.team_id, rank: ranks[t.team_id] }))
      .filter(e => e.rank)

    if (entries.length === 0) { setError('กรุณาเลือกอันดับอย่างน้อย 1 ทีม'); return }

    // ตรวจสอบว่าไม่มีอันดับซ้ำกัน
    const rankValues = entries.map(e => e.rank)
    if (new Set(rankValues).size !== rankValues.length) {
      setError('มีอันดับซ้ำกัน — แต่ละทีมต้องได้อันดับไม่ซ้ำกัน')
      return
    }

    setSaving(true)
    // ล้างผล BLS เดิมทั้งหมดก่อน แล้วบันทึกใหม่
    await supabase.from('station_results').delete().eq('station_type', 'BLS')

    const rows = entries.map(e => ({
      team_id: e.team_id,
      station_type: 'BLS',
      total_time_seconds: null,
      total_retry_count: 0,
      rank: Number(e.rank),
      points: pointsForRank(Number(e.rank)),
      calculated_at: new Date().toISOString(),
    }))
    const { error: insErr } = await supabase.from('station_results').insert(rows)
    setSaving(false)
    if (insErr) { setError(`บันทึกไม่สำเร็จ: ${insErr.message}`); return }
    alert('บันทึกอันดับ BLS เรียบร้อยแล้ว')
    loadCurrent()
  }

  return (
    <div className="card-highlight">
      <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12, letterSpacing: '.06em' }}>
        🫀 กรอกอันดับฐาน BLS (ตัดสินจากทีมที่ทำครบ 5 คนก่อน)
      </div>

      {teams.map(t => (
        <div key={t.team_id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 0', borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{t.team_name}</div>
          <select
            value={ranks[t.team_id] || ''}
            onChange={e => setRank(t.team_id, e.target.value)}
            style={{ width: 140 }}
          >
            <option value="">— ยังไม่เลือก —</option>
            {[1, 2, 3, 4, 5].map(n => (
              <option key={n} value={n}>อันดับ {n} ({pointsForRank(n)} แต้ม)</option>
            ))}
          </select>
        </div>
      ))}

      {error && <p style={{ color: 'var(--alert)', fontSize: 13, marginTop: 10 }}>{error}</p>}

      <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ marginTop: 16 }}>
        {saving ? 'กำลังบันทึก...' : 'บันทึกอันดับ BLS'}
      </button>

      <p className="note">
        แต้มคำนวณจากอันดับที่เลือกทันที (อันดับ 1=5, 2=4, 3=3, 4=2, 5=1 แต้ม) — บันทึกแล้วขึ้น Leaderboard ทันที<br/>
        การบันทึกใหม่จะล้างอันดับเดิมทั้งหมดทิ้งก่อนเสมอ
      </p>
    </div>
  )
}
