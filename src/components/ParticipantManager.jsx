// src/components/ParticipantManager.jsx
// ============================================================
// ฟอร์มเพิ่ม "ผู้เข้าแข่งขัน" (สมาชิกทีม) ในหน้า Admin โดยตรง
// ไม่ต้องเข้า Supabase Table Editor อีกต่อไป
// ============================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function ParticipantManager({ teams }) {
  const [participants, setParticipants] = useState([])
  const [selectedTeam, setSelectedTeam] = useState('')
  const [name,         setName]         = useState('')
  const [queueOrder,   setQueueOrder]   = useState(1)
  const [isReserve,    setIsReserve]    = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  async function load() {
    const { data } = await supabase
      .from('participants').select('*, teams(team_name)').order('team_id').order('queue_order')
    setParticipants(data || [])
  }
  useEffect(() => { load() }, [])

  async function addParticipant() {
    setError('')
    if (!selectedTeam || !name.trim()) {
      setError('กรุณาเลือกทีมและกรอกชื่อผู้เข้าแข่งขัน')
      return
    }
    setSaving(true)
    const { error: insErr } = await supabase.from('participants').insert({
      team_id: selectedTeam,
      full_name: name.trim(),
      queue_order: Number(queueOrder),
      is_reserve: isReserve,
    })
    if (insErr) {
      setError(`เพิ่มไม่สำเร็จ: ${insErr.message}`)
    } else {
      setName('')
      setQueueOrder(q => Math.min(q + 1, 5))
      load()
    }
    setSaving(false)
  }

  async function deleteParticipant(participantId) {
    if (!confirm('ยืนยันลบผู้เข้าแข่งขันคนนี้?')) return
    await supabase.from('attempts').delete().eq('participant_id', participantId)
    const { error: delErr } = await supabase.from('participants').delete().eq('participant_id', participantId)
    if (delErr) {
      alert(`ลบไม่สำเร็จ: ${delErr.message}`)
      return
    }
    load()
  }

  // จัดกลุ่มตามทีม เพื่อแสดงผลอ่านง่าย
  const grouped = participants.reduce((acc, p) => {
    const key = p.teams?.team_name || 'ไม่ทราบทีม'
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  return (
    <div className="card-highlight" style={{ marginTop: 16 }}>
      <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 10, letterSpacing: '.06em' }}>
        🏃 ผู้เข้าแข่งขัน
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)} style={{ flex: '1 1 160px' }}>
          <option value="">— เลือกทีม —</option>
          {teams.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
        </select>
        <input type="text" placeholder="ชื่อผู้เข้าแข่งขัน" value={name}
          onChange={e => setName(e.target.value)} style={{ flex: '2 1 200px' }} />
        <select value={queueOrder} onChange={e => setQueueOrder(e.target.value)} style={{ width: 110 }}>
          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>คิวที่ {n}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'JetBrains Mono,monospace', fontSize: 12, color: 'var(--muted)' }}>
          <input type="checkbox" checked={isReserve} onChange={e => setIsReserve(e.target.checked)} />
          ตัวสำรอง
        </label>
        <button onClick={addParticipant} disabled={saving} className="btn-primary" style={{ width: 'auto', padding: '0 18px', fontSize: 14 }}>
          {saving ? '...' : '+ เพิ่ม'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--alert)', fontSize: 13, marginBottom: 10 }}>{error}</p>}

      <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 10 }}>
        {Object.keys(grouped).length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีผู้เข้าแข่งขัน</p>}
        {Object.entries(grouped).map(([teamName, members]) => (
          <div key={teamName} style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: 'var(--ecg)' }}>{teamName}</div>
            {members.map(p => (
              <div key={p.participant_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                     padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <span>
                  คิวที่ {p.queue_order} — {p.full_name}
                  {p.is_reserve && <span style={{ color: 'var(--amber)', fontSize: 11, marginLeft: 8 }}>(สำรอง)</span>}
                </span>
                <button onClick={() => deleteParticipant(p.participant_id)} style={{
                  fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
                  border: '1px solid var(--alert)', color: 'var(--alert)', borderRadius: 5,
                  padding: '3px 8px', cursor: 'pointer',
                }}>ลบ</button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="note">
        แต่ละทีมควรมีผู้เข้าแข่งขันตัวจริง 5 คน (คิวที่ 1-5) — ใส่ตัวสำรองเพิ่มได้โดยติ๊ก "ตัวสำรอง" (จะไม่ถูกเรียกใช้ตอนแข่งจริง)
      </p>
    </div>
  )
}
