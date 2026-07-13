// src/components/BLSRankingManager.jsx
// ============================================================
// แทนที่หน้าจอกรรมการ BLS แบบเดิมทั้งหมด — เปลี่ยนเป็นให้กรรมการ/Admin
// กรอกอันดับ 1-5 เอง (ตัดสินจาก "ทีมไหนทำครบ 5 คนก่อน" ด้วยสายตา/นาฬิกาจับเวลาแยก)
// แต้มคิดจากตารางคงที่เดียวกับฐานอื่น (1=5, 2=4, 3=3, 4=2, 5=1)
// ============================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { pointsForRank } from '../lib/scoring'

export default function BLSRankingManager({ teams, eventId }) {
  const [ranks, setRanks] = useState({}) // { team_id: rankNumber }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [currentResults, setCurrentResults] = useState([])
  const [blsMode, setBlsMode] = useState('manual') // 'manual' | 'judged'

  async function loadMode() {
    if (!eventId) return
    const { data } = await supabase.from('event_state').select('bls_mode').eq('event_id', eventId).maybeSingle()
    if (data?.bls_mode) setBlsMode(data.bls_mode)
  }
  async function saveMode(mode) {
    if (!eventId) return
    setBlsMode(mode)
    const { error } = await supabase.from('event_state').update({ bls_mode: mode }).eq('event_id', eventId)
    if (error) alert(`บันทึกโหมดไม่สำเร็จ: ${error.message}`)
  }
  useEffect(() => { loadMode() }, [eventId])

  async function loadCurrent() {
    const teamIds = teams.map(t => t.team_id)
    if (teamIds.length === 0) { setCurrentResults([]); return }
    const { data } = await supabase
      .from('station_results').select('team_id, rank').eq('station_type', 'BLS').in('team_id', teamIds)
    setCurrentResults(data || [])
    const init = {}
    ;(data || []).forEach(r => { init[r.team_id] = String(r.rank) })
    setRanks(init)
  }
  useEffect(() => { loadCurrent() }, [teams])

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
    // ล้างผล BLS เดิมของ "ทีมในงานปัจจุบัน" เท่านั้น ไม่แตะงานอื่น
    const currentTeamIds = teams.map(t => t.team_id)
    await supabase.from('station_results').delete().eq('station_type', 'BLS').in('team_id', currentTeamIds)

    const rows = entries.map(e => ({
      team_id: e.team_id,
      station_type: 'BLS',
      total_time_seconds: null,
      total_retry_count: 0,
      rank: Number(e.rank),
      points: pointsForRank(Number(e.rank)),
      calculated_at: new Date().toISOString(),
      event_id: eventId,
    }))
    const { error: insErr } = await supabase.from('station_results').insert(rows)
    setSaving(false)
    if (insErr) { setError(`บันทึกไม่สำเร็จ: ${insErr.message}`); return }
    alert('บันทึกอันดับ BLS เรียบร้อยแล้ว')
    loadCurrent()
  }

  return (
    <div>
      <div className="card-highlight" style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12, letterSpacing: '.06em' }}>
          ⚙ วิธีตัดสินฐาน BLS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{
            display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${blsMode === 'manual' ? 'var(--ecg)' : 'var(--line)'}`,
            background: blsMode === 'manual' ? 'rgba(51,255,156,.06)' : 'var(--bg-panel-2)',
          }}>
            <input type="radio" name="blsMode" checked={blsMode === 'manual'} onChange={() => saveMode('manual')} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>3.1 กรอกอันดับเอง (Manual)</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                ไม่มีหน้าจอกรรมการ — Admin/กรรมการกรอกอันดับ 1-5 เองด้านล่างนี้ (ตัดสินจากทีมที่ทำครบ 5 คนก่อนด้วยสายตา)
              </div>
            </div>
          </label>
          <label style={{
            display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${blsMode === 'judged' ? 'var(--ecg)' : 'var(--line)'}`,
            background: blsMode === 'judged' ? 'rgba(51,255,156,.06)' : 'var(--bg-panel-2)',
          }}>
            <input type="radio" name="blsMode" checked={blsMode === 'judged'} onChange={() => saveMode('judged')} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>3.2 กรรมการกรอกคะแนน + จับเวลา (Judged)</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                เปิดหน้าจอกรรมการแบบเดิม — กรรมการกด "เริ่ม" ต่อคน กรอกคะแนน ระบบจับเวลาและคำนวณคะแนนให้อัตโนมัติ
              </div>
            </div>
          </label>
        </div>
      </div>

      {blsMode === 'manual' ? (
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
      ) : (
        <div className="card-highlight">
          <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
            🫀 ผลคะแนน BLS ปัจจุบัน (จากหน้าจอกรรมการ)
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
            โหมดนี้ไม่ต้องกรอกอะไรที่นี่ — กรรมการแต่ละเครื่องจะเห็นหน้าจอ BLS แบบเดิม (กด "เริ่ม" ต่อคน กรอกคะแนน) เองอัตโนมัติ
            เมื่อ Master เปลี่ยนฐานเป็น BLS ผลคะแนนจะคำนวณและขึ้น Leaderboard ให้เองทันทีที่ทีมทำครบ 5 คน
          </p>
          {teams.map(t => {
            const res = currentResults.find(r => r.team_id === t.team_id)
            return (
              <div key={t.team_id} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '10px 0', borderBottom: '1px solid var(--line)',
              }}>
                <span style={{ fontWeight: 700 }}>{t.team_name}</span>
                <span style={{ fontFamily: 'JetBrains Mono,monospace', color: res ? 'var(--ecg)' : 'var(--muted)' }}>
                  {res ? `อันดับ ${res.rank} (${pointsForRank(res.rank)} แต้ม)` : 'ยังไม่มีผล'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
