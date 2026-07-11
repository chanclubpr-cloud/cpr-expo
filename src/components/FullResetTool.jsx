// src/components/FullResetTool.jsx
// ============================================================
// รีเซ็ตทั้งกระดาน — ลบทีม/กรรมการ/ผู้เข้าแข่งขัน/ผลคะแนน/การจับคู่เครื่องทั้งหมด
// เก็บไว้เฉพาะ "คลังโจทย์" (ecg_questions, algo_questions) เพื่อใช้ซ้ำในงานครั้งถัดไป
//
// เป็นการลบถาวร กู้คืนไม่ได้ — จึงมีการป้องกันหลายชั้น:
//   1. confirm() เตือนก่อน
//   2. ต้องพิมพ์คำว่า "รีเซ็ต" ให้ตรงเป๊ะก่อนปุ่มจะกดได้
// ============================================================

import { useState } from 'react'
import { supabase } from '../lib/supabase'

const CONFIRM_WORD = 'รีเซ็ต'

export default function FullResetTool() {
  const [confirmText, setConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [msg, setMsg] = useState('')

  const canReset = confirmText.trim() === CONFIRM_WORD

  async function handleFullReset() {
    if (!canReset) return
    if (!confirm(
      '⚠️ ยืนยันครั้งสุดท้าย ⚠️\n\n' +
      'จะลบถาวร (กู้คืนไม่ได้): ทีม, ผู้เข้าแข่งขัน, กรรมการ, การจับคู่เครื่อง, ' +
      'ผลคะแนนทุกฐาน, ประวัติการตัดสินทั้งหมด, ผล Mega Code\n\n' +
      'จะเก็บไว้: คลังโจทย์ ECG และ Algorithm เท่านั้น\n\n' +
      'ใช้เมื่อจะเริ่มการแข่งขันครั้งใหม่ทั้งหมดเท่านั้น — พิมพ์ OK เพื่อยืนยันจริงๆ'
    )) return

    setResetting(true)
    setMsg('')

    // ลบตามลำดับที่ไม่ชนกับ Foreign Key (ตารางที่อ้างอิงตารางอื่นต้องลบก่อน)
    const steps = [
      ['attempts',             q => q.neq('attempt_id', '00000000-0000-0000-0000-000000000000')],
      ['judge_assignments',    q => q.neq('assignment_id', '00000000-0000-0000-0000-000000000000')],
      ['station_results',      q => q.neq('result_id', '00000000-0000-0000-0000-000000000000')],
      ['megacode_results',     q => q.neq('result_id', '00000000-0000-0000-0000-000000000000')],
      ['megacode_qualifiers',  q => q.neq('team_id', '00000000-0000-0000-0000-000000000000')],
      ['device_assignments',   q => q.neq('device_number', -1)],
      ['participants',         q => q.neq('participant_id', '00000000-0000-0000-0000-000000000000')],
      ['judges',                q => q.neq('judge_id', '00000000-0000-0000-0000-000000000000')],
      ['teams',                q => q.neq('team_id', '00000000-0000-0000-0000-000000000000')],
    ]

    for (const [table, applyFilter] of steps) {
      const { error } = await applyFilter(supabase.from(table).delete())
      if (error) {
        setMsg(`❌ ลบไม่สำเร็จที่ตาราง "${table}": ${error.message}`)
        setResetting(false)
        return
      }
    }

    // รีเซ็ตสถานะรอบกิจกรรมกลับเป็นค่าเริ่มต้น
    await supabase.from('event_state').update({
      active_station: 'IDLE',
      registration_open: true,
      megacode_mode: 'separate',
    }).eq('id', 1)

    setResetting(false)
    setConfirmText('')
    setMsg('✅ รีเซ็ตทั้งกระดานเรียบร้อยแล้ว — คลังโจทย์ยังอยู่ครบ พร้อมเริ่มการแข่งขันครั้งใหม่')
  }

  return (
    <div className="card-highlight" style={{ marginTop: 20, borderColor: 'var(--alert)' }}>
      <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--alert)', marginBottom: 10, letterSpacing: '.06em' }}>
        🗑️ รีเซ็ตทั้งกระดาน (สำหรับเริ่มการแข่งขันครั้งใหม่)
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
        <b style={{ color: 'var(--alert)' }}>ลบถาวร กู้คืนไม่ได้:</b> ทีม, ผู้เข้าแข่งขัน, กรรมการ, การจับคู่เครื่อง, ผลคะแนนทุกฐาน, ประวัติการตัดสิน, ผล Mega Code
      </p>
      <p style={{ fontSize: 13, color: 'var(--ecg)', marginBottom: 16 }}>
        ✓ เก็บไว้เสมอ: คลังโจทย์ ECG และ Algorithm (ใช้ซ้ำได้ในงานครั้งถัดไป)
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder={`พิมพ์ "${CONFIRM_WORD}" เพื่อยืนยัน`}
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <button
          onClick={handleFullReset}
          disabled={!canReset || resetting}
          style={{
            padding: '0 24px', height: 44, borderRadius: 10, border: '1px solid var(--alert)',
            background: canReset ? 'var(--alert)' : 'transparent',
            color: canReset ? '#2B0207' : 'var(--muted)',
            fontWeight: 800, cursor: canReset ? 'pointer' : 'not-allowed',
            opacity: resetting ? .6 : 1,
          }}
        >
          {resetting ? 'กำลังลบ...' : '🗑️ รีเซ็ตทั้งกระดาน'}
        </button>
      </div>

      {msg && <p style={{ fontSize: 13, marginTop: 12, color: msg.startsWith('✅') ? 'var(--ecg)' : 'var(--alert)' }}>{msg}</p>}
    </div>
  )
}
