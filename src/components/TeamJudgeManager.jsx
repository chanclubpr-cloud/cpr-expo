// src/components/TeamJudgeManager.jsx
// ============================================================
// ฟอร์มเพิ่ม "ทีม" และ "กรรมการ" ในหน้า Admin โดยตรง
// ไม่ต้องเข้า Supabase Table Editor อีกต่อไป
// ============================================================

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function TeamJudgeManager({ teams, judges, onReload }) {
  const [teamName,  setTeamName]  = useState('')
  const [savingTeam, setSavingTeam] = useState(false)

  const [judgeName,   setJudgeName]   = useState('')
  const [stationType, setStationType] = useState('BLS')
  const [stationNum,  setStationNum]  = useState(1)
  const [savingJudge, setSavingJudge] = useState(false)

  async function addTeam() {
    if (!teamName.trim()) return
    setSavingTeam(true)
    await supabase.from('teams').insert({ team_name: teamName.trim() })
    setTeamName('')
    setSavingTeam(false)
    onReload()
  }

  async function deleteTeam(teamId) {
    if (!confirm('ยืนยันลบทีมนี้? ข้อมูลสมาชิกในทีมจะถูกลบไปด้วย')) return
    await supabase.from('teams').delete().eq('team_id', teamId)
    onReload()
  }

  async function addJudge() {
    if (!judgeName.trim()) return
    setSavingJudge(true)
    await supabase.from('judges').insert({
      full_name: judgeName.trim(),
      station_type: stationType,
      station_number: Number(stationNum),
    })
    setJudgeName('')
    setSavingJudge(false)
    onReload()
  }

  async function deleteJudge(judgeId) {
    if (!confirm('ยืนยันลบกรรมการคนนี้?')) return
    await supabase.from('judges').delete().eq('judge_id', judgeId)
    onReload()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
      {/* ===== เพิ่มทีม ===== */}
      <div className="card-highlight">
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 10, letterSpacing: '.06em' }}>
          👥 ทีม
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input type="text" placeholder="ชื่อทีมใหม่ เช่น เหยี่ยว" value={teamName}
            onChange={e => setTeamName(e.target.value)} style={{ flex: 1 }} />
          <button onClick={addTeam} disabled={savingTeam} className="btn-primary" style={{ width: 'auto', padding: '0 18px', fontSize: 14 }}>
            {savingTeam ? '...' : '+ เพิ่ม'}
          </button>
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {teams.map(t => (
            <div key={t.team_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                           padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{t.team_name}</span>
              <button onClick={() => deleteTeam(t.team_id)} style={{
                fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
                border: '1px solid var(--alert)', color: 'var(--alert)', borderRadius: 5,
                padding: '3px 8px', cursor: 'pointer',
              }}>ลบ</button>
            </div>
          ))}
          {teams.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีทีม</p>}
        </div>
      </div>

      {/* ===== เพิ่มกรรมการ ===== */}
      <div className="card-highlight">
        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 10, letterSpacing: '.06em' }}>
          🧑‍⚕️ กรรมการ
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <input type="text" placeholder="ชื่อกรรมการ" value={judgeName}
            onChange={e => setJudgeName(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <select value={stationType} onChange={e => setStationType(e.target.value)} style={{ flex: 1 }}>
            <option value="BLS">BLS</option>
            <option value="ECG">ECG</option>
            <option value="ALGORITHM">Algorithm</option>
          </select>
          <select value={stationNum} onChange={e => setStationNum(e.target.value)} style={{ width: 100 }}>
            {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>จุด {n}</option>)}
          </select>
          <button onClick={addJudge} disabled={savingJudge} className="btn-primary" style={{ width: 'auto', padding: '0 18px', fontSize: 14 }}>
            {savingJudge ? '...' : '+ เพิ่ม'}
          </button>
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {judges.map(j => (
            <div key={j.judge_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{j.full_name} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({j.station_type} จุด {j.station_number})</span></span>
              <button onClick={() => deleteJudge(j.judge_id)} style={{
                fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
                border: '1px solid var(--alert)', color: 'var(--alert)', borderRadius: 5,
                padding: '3px 8px', cursor: 'pointer',
              }}>ลบ</button>
            </div>
          ))}
          {judges.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีกรรมการ</p>}
        </div>
      </div>
    </div>
  )
}
