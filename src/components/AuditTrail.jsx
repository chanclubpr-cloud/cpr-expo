// src/components/AuditTrail.jsx
// ============================================================
// ใช้เมื่อผู้เข้าแข่งขัน "defense" การตัดสิน — แสดงข้อมูลดิบทุกครั้งที่
// กรรมการกดตัดสิน เรียงตามเวลาจริง พร้อมชื่อกรรมการที่ตัดสินกำกับไว้
// (ข้อมูลถูกบันทึกอัตโนมัติอยู่แล้วในตาราง attempts — หน้านี้แค่ดึงมาแสดงให้อ่านง่าย)
// ============================================================

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const STATION_LABEL = { BLS: 'BLS', ECG: 'ECG', ALGORITHM: 'Algorithm' }
const RESULT_LABEL  = { pass: '✓ ผ่าน', fail: '✕ ไม่ผ่าน', timeout: '⏱ หมดเวลา' }
const RESULT_COLOR  = { pass: 'var(--ecg)', fail: 'var(--alert)', timeout: 'var(--amber)' }

export default function AuditTrail({ teams }) {
  const [selectedTeam,    setSelectedTeam]    = useState('')
  const [selectedStation, setSelectedStation] = useState('BLS')
  const [rows,            setRows]            = useState([])
  const [loading,         setLoading]         = useState(false)

  async function loadTrail() {
    if (!selectedTeam) { setRows([]); return }
    setLoading(true)

    // หาสมาชิกทีมนี้ก่อน เพื่อกรอง attempts ที่เกี่ยวข้อง
    const { data: members } = await supabase
      .from('participants').select('participant_id, full_name')
      .eq('team_id', selectedTeam)
    const memberMap = Object.fromEntries((members || []).map(m => [m.participant_id, m.full_name]))
    const participantIds = Object.keys(memberMap)

    if (participantIds.length === 0) { setRows([]); setLoading(false); return }

    const { data: attempts } = await supabase
      .from('attempts')
      .select('*, judges(full_name)')
      .eq('station_type', selectedStation)
      .in('participant_id', participantIds)
      .order('created_at', { ascending: true })

    const enriched = (attempts || []).map(a => ({
      ...a,
      participant_name: memberMap[a.participant_id] || '—',
      judge_name: a.judges?.full_name || (a.judged_by ? '—' : 'ระบบ (อัตโนมัติ)'),
    }))
    setRows(enriched)
    setLoading(false)
  }

  useEffect(() => { loadTrail() }, [selectedTeam, selectedStation]) // eslint-disable-line

  function formatTimestamp(iso) {
    const d = new Date(iso)
    return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="card-highlight" style={{ marginTop: 16 }}>
      <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 10, letterSpacing: '.06em' }}>
        🔍 ตรวจสอบย้อนหลัง (Audit Trail) — ใช้เมื่อผู้เข้าแข่งขัน Defense ผลการตัดสิน
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>ทีม</label>
          <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)} style={{ width: '100%' }}>
            <option value="">— เลือกทีม —</option>
            {teams.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <label style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>ฐาน</label>
          <select value={selectedStation} onChange={e => setSelectedStation(e.target.value)} style={{ width: '100%' }}>
            <option value="BLS">BLS</option>
            <option value="ECG">ECG</option>
            <option value="ALGORITHM">Algorithm</option>
          </select>
        </div>
      </div>

      {loading && <p style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace', fontSize: 13 }}>กำลังโหลด...</p>}

      {!loading && selectedTeam && rows.length === 0 && (
        <p style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace', fontSize: 13 }}>ยังไม่มีข้อมูลการตัดสินสำหรับทีมนี้ในฐานนี้</p>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-panel-2)' }}>
                {['เวลา', 'ผู้แข่งขัน', 'ข้อ', 'ผล', 'เวลาที่ใช้', 'กรรมการที่ตัดสิน'].map(h => (
                  <th key={h} style={{ textAlign: 'left', color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace', fontSize: 11, padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.attempt_id}>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', fontFamily: 'JetBrains Mono,monospace', fontSize: 12, color: 'var(--muted)' }}>
                    {formatTimestamp(r.created_at)}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', fontWeight: 700 }}>{r.participant_name}</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', fontFamily: 'JetBrains Mono,monospace' }}>
                    {r.question_number ? `ข้อ ${r.question_number}` : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', color: RESULT_COLOR[r.result] || 'var(--text)', fontWeight: 700 }}>
                    {RESULT_LABEL[r.result] || r.result}
                    {r.is_override && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--amber)' }}>(อนุโลม)</span>}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', fontFamily: 'JetBrains Mono,monospace', fontSize: 12 }}>
                    {r.time_used_seconds != null ? `${Number(r.time_used_seconds).toFixed(1)} วิ` : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--muted)' }}>{r.judge_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="note">
        ตารางนี้ดึงจากบันทึกจริงในระบบ (ตาราง attempts) เรียงตามเวลาที่เกิดขึ้นจริง<br/>
        ถ้ามีการ "แก้ไขผล" จะเห็นเป็นแถวใหม่ต่อท้าย (ไม่ลบของเดิม) ทำให้ตรวจสอบย้อนหลังได้ครบทุกขั้นตอน
      </p>
    </div>
  )
}
