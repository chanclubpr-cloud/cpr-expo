// src/components/TeamJudgeManager.jsx
// ============================================================
// ฟอร์มเพิ่ม "ทีม" และ "กรรมการ" ในหน้า Admin โดยตรง
// ไม่ต้องเข้า Supabase Table Editor อีกต่อไป
// ============================================================

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function TeamJudgeManager({ teams, judges, onReload, eventId }) {
  const [teamName,  setTeamName]  = useState('')
  const [savingTeam, setSavingTeam] = useState(false)

  const [judgeName,   setJudgeName]   = useState('')
  const [savingJudge, setSavingJudge] = useState(false)

  async function addTeam() {
    if (!teamName.trim()) return
    if (!eventId) { alert('ยังไม่มีงานแข่งขันที่เปิดอยู่ — ไปที่แท็บ "งานแข่งขัน" เพื่อเปิดงานก่อน'); return }
    setSavingTeam(true)
    const { error } = await supabase.from('teams').insert({ team_name: teamName.trim(), event_id: eventId })
    if (error) alert(`เพิ่มทีมไม่สำเร็จ: ${error.message}`)
    setTeamName('')
    setSavingTeam(false)
    onReload()
  }

  async function deleteTeam(teamId) {
    if (!confirm('ยืนยันลบทีมนี้? ข้อมูลสมาชิก การจับคู่เครื่อง และประวัติการแข่งขันของทีมนี้จะถูกลบไปด้วยทั้งหมด')) return

    // ต้องลบข้อมูลที่ "ผูกอยู่" กับทีมนี้ก่อน ไม่งั้นฐานข้อมูลจะปฏิเสธการลบทีม
    // (เพราะป้องกันไม่ให้เกิดข้อมูลกำพร้าที่ยังอ้างอิงถึงทีมที่ไม่มีอยู่แล้ว)
    const { data: participants } = await supabase
      .from('participants').select('participant_id').eq('team_id', teamId)
    const participantIds = (participants || []).map(p => p.participant_id)

    if (participantIds.length > 0) {
      await supabase.from('attempts').delete().in('participant_id', participantIds)
    }
    await supabase.from('device_assignments').delete().eq('team_id', teamId)
    await supabase.from('judge_assignments').delete().eq('team_id', teamId)
    await supabase.from('station_results').delete().eq('team_id', teamId)
    await supabase.from('megacode_qualifiers').delete().eq('team_id', teamId)
    // participants จะถูกลบอัตโนมัติเมื่อลบทีม (ตั้งค่า CASCADE ไว้ในฐานข้อมูลแล้ว)

    const { error } = await supabase.from('teams').delete().eq('team_id', teamId)
    if (error) {
      alert(`ลบทีมไม่สำเร็จ: ${error.message}`)
      return
    }
    onReload()
  }

  async function addJudge() {
    if (!judgeName.trim()) return
    if (!eventId) { alert('ยังไม่มีงานแข่งขันที่เปิดอยู่ — ไปที่แท็บ "งานแข่งขัน" เพื่อเปิดงานก่อน'); return }
    setSavingJudge(true)
    // ฐาน/จุด ไม่มีผลต่อการทำงานจริง (การจับคู่จริงอยู่ที่ตาราง "จับคู่เครื่อง")
    // ใส่ค่า default เงียบๆ เพื่อให้ผ่านเงื่อนไขฐานข้อมูล โดยไม่ต้องให้ผู้ใช้กรอก
    const { error } = await supabase.from('judges').insert({
      full_name: judgeName.trim(),
      station_type: 'BLS',
      station_number: 1,
      event_id: eventId,
    })
    if (error) alert(`เพิ่มกรรมการไม่สำเร็จ: ${error.message}`)
    setJudgeName('')
    setSavingJudge(false)
    onReload()
  }

  async function deleteJudge(judgeId) {
    if (!confirm('ยืนยันลบกรรมการคนนี้? การจับคู่เครื่องและประวัติที่เกี่ยวข้องจะถูกลบไปด้วย')) return

    await supabase.from('device_assignments').delete().eq('judge_id', judgeId)
    await supabase.from('judge_assignments').delete().eq('judge_id', judgeId)
    await supabase.from('attempts').update({ judged_by: null }).eq('judged_by', judgeId)

    const { error } = await supabase.from('judges').delete().eq('judge_id', judgeId)
    if (error) {
      alert(`ลบกรรมการไม่สำเร็จ: ${error.message}`)
      return
    }
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input type="text" placeholder="ชื่อกรรมการ" value={judgeName}
            onChange={e => setJudgeName(e.target.value)} style={{ flex: 1 }} />
          <button onClick={addJudge} disabled={savingJudge} className="btn-primary" style={{ width: 'auto', padding: '0 18px', fontSize: 14 }}>
            {savingJudge ? '...' : '+ เพิ่ม'}
          </button>
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {judges.map(j => (
            <div key={j.judge_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{j.full_name}</span>
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
