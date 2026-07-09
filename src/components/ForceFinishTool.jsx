// src/components/ForceFinishTool.jsx
// ============================================================
// เครื่องมือฉุกเฉิน — ใช้เมื่อทีมทำครบทุกคนจริง แต่ระบบไม่ปิดฐานให้อัตโนมัติ
// (มักเกิดจากกรรมการรีเฟรชหน้าจอกลางคัน ทำให้ระบบนับใหม่จากคนที่ 1)
//
// ปุ่มนี้จะ "บังคับปิดฐาน" ให้ทีม+ฐานที่เลือก แล้วคำนวณคะแนนให้ทันที
// ============================================================

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { finalizeStationResult } from '../lib/scoring'

export default function ForceFinishTool({ teams }) {
  const [teamId,  setTeamId]  = useState('')
  const [station, setStation] = useState('ECG')
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState('')

  async function handleForceFinish() {
    if (!teamId) { setMsg('กรุณาเลือกทีมก่อน'); return }
    if (!confirm(`ยืนยันบังคับปิดฐาน ${station} ให้ทีมนี้?\n\nใช้เมื่อทีมทำครบทุกคนจริงแล้ว แต่ระบบไม่ปิดฐานให้อัตโนมัติเท่านั้น`)) return

    setSaving(true)
    setMsg('')

    const { data: asgn, error: findErr } = await supabase
      .from('judge_assignments')
      .select('assignment_id')
      .eq('team_id', teamId).eq('station_type', station).eq('status', 'active')
      .maybeSingle()

    if (findErr || !asgn) {
      setMsg('ไม่พบรายการที่กำลังทำอยู่ (active) ของทีม+ฐานนี้ — อาจปิดไปแล้ว หรือยังไม่เคยเริ่ม')
      setSaving(false)
      return
    }

    // หาเวลาจริงที่ทีมนี้ "จบฐาน" จากบันทึกการตอบครั้งล่าสุด (แม่นยำกว่าใช้เวลาตอนกดปุ่ม)
    // เพราะถ้ากรรมการมากดปุ่มนี้ช้ากว่าที่ทีมทำเสร็จจริง เวลาจะคลาดเคลื่อน กระทบการจัดอันดับ
    const { data: participants } = await supabase
      .from('participants').select('participant_id').eq('team_id', teamId)
    const participantIds = (participants || []).map(p => p.participant_id)

    const { data: lastAttempt } = await supabase
      .from('attempts')
      .select('created_at')
      .eq('station_type', station)
      .in('participant_id', participantIds)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const realFinishedAt = lastAttempt?.created_at || new Date().toISOString()

    const { error: updErr } = await supabase.from('judge_assignments')
      .update({ status: 'finished', finished_at: realFinishedAt })
      .eq('assignment_id', asgn.assignment_id)

    if (updErr) {
      setMsg(`บังคับปิดไม่สำเร็จ: ${updErr.message}`)
      setSaving(false)
      return
    }

    await finalizeStationResult(station)
    setSaving(false)
    const timeUsedNote = lastAttempt?.created_at
      ? `ใช้เวลาที่บันทึกจริงจากการตอบครั้งสุดท้าย (${new Date(realFinishedAt).toLocaleTimeString('th-TH')})`
      : `⚠ ไม่พบประวัติการตอบเลย ใช้เวลาปัจจุบันแทน — เวลาอาจคลาดเคลื่อน ควรตรวจสอบ Audit Trail`
    setMsg(`✅ บังคับปิดฐานและคำนวณคะแนนเรียบร้อยแล้ว (${timeUsedNote}) — เช็คที่ Leaderboard ได้เลย`)
  }

  return (
    <div className="card-highlight" style={{ marginTop: 20, borderColor: 'var(--amber)' }}>
      <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--amber)', marginBottom: 10, letterSpacing: '.06em' }}>
        🚨 เครื่องมือฉุกเฉิน — บังคับปิดฐาน (ใช้เมื่อทำครบทุกคนแล้วแต่คะแนนไม่ขึ้น)
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
        ใช้เฉพาะกรณี: ทีมทำครบ 5 คนจริงแล้ว (ตรวจสอบใน "ตรวจสอบย้อนหลัง" ก่อนว่ามีผลผ่านครบ 5 คนแล้วจริง)
        แต่ Leaderboard ยังขึ้น 0 คะแนน — มักเกิดจากกรรมการรีเฟรชหน้าจอกลางคัน<br/>
        <b style={{ color: 'var(--ecg)' }}>ระบบจะใช้เวลาจริงจากบันทึกการตอบครั้งสุดท้าย (ไม่ใช่เวลาที่กดปุ่มนี้)</b> เพื่อให้การจัดอันดับตามเวลายังคงถูกต้อง
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={teamId} onChange={e => setTeamId(e.target.value)} style={{ flex: '1 1 180px' }}>
          <option value="">— เลือกทีม —</option>
          {teams.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
        </select>
        <select value={station} onChange={e => setStation(e.target.value)} style={{ flex: '1 1 140px' }}>
          <option value="ECG">ECG</option>
          <option value="ALGORITHM">Algorithm</option>
        </select>
        <button onClick={handleForceFinish} disabled={saving} style={{
          padding: '0 20px', borderRadius: 10, border: '1px solid var(--amber)',
          background: 'var(--amber)', color: '#2B1B00', fontWeight: 700, cursor: 'pointer',
        }}>
          {saving ? 'กำลังดำเนินการ...' : 'บังคับปิดฐาน'}
        </button>
      </div>
      {msg && <p style={{ fontSize: 13, color: msg.startsWith('✅') ? 'var(--ecg)' : 'var(--alert)' }}>{msg}</p>}
    </div>
  )
}
