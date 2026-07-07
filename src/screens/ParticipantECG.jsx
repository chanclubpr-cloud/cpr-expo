// src/screens/ParticipantECG.jsx
// ============================================================
// แก้บั๊ก: เดิมหน้านี้ฟังช่องสัญญาณชื่อ 'ecg-participant' ด้วย event
// 'timer'/'question' แต่ฝั่งกรรมการ (JudgeECG.jsx) ไม่เคยส่งสัญญาณ
// ชื่อนี้เลย ทั้งสองฝั่งจึง "คนละความถี่กัน" ไม่เคยคุยกันได้จริง
//
// แก้ไขให้ฟังช่องสัญญาณ `ecg-${teamId}` ด้วย event 'sync' แบบเดียวกับ
// ที่ฐาน Algorithm ใช้ (ซึ่งทำงานถูกต้องอยู่แล้ว) เพื่อความสอดคล้องกัน
// ============================================================

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ParticipantECG() {
  const teamId = localStorage.getItem('teamId')
  const [sync, setSync] = useState(null)

  useEffect(() => {
    const channel = supabase.channel(`ecg-${teamId}`)
      .on('broadcast', { event: 'sync' }, ({ payload }) => setSync(payload))
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [teamId])

  const wrapStyle = {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg-deep)', padding: 24, textAlign: 'center',
  }

  if (!sync) return (
    <div style={wrapStyle}>
      <div style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace' }}>
        รอกรรมการเริ่มฐาน ECG...
      </div>
    </div>
  )

  if (sync.done) return (
    <div style={wrapStyle}>
      <div style={{
        fontSize: 'clamp(64px,15vw,120px)', fontWeight: 800, color: 'var(--ecg)',
        textShadow: '0 0 40px rgba(51,255,156,.5)', fontFamily: 'Sarabun,sans-serif',
      }}>
        ผ่านครบทุกคน
      </div>
    </div>
  )

  if (sync.waiting) return (
    <div style={wrapStyle}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
      <div style={{ fontSize: 18, color: 'var(--text)', marginBottom: 8 }}>{sync.participantName}</div>
      <div style={{ fontFamily: 'JetBrains Mono,monospace', color: 'var(--muted)' }}>
        รอกรรมการกดเริ่ม...
      </div>
    </div>
  )

  const { question, timeLeft, questionIndex, participantName } = sync
  const danger = timeLeft <= 8

  return (
    <div style={wrapStyle}>
      <div className={`timer-display${danger ? ' danger' : ''}`} style={{ fontSize: 'clamp(80px,18vw,140px)', marginBottom: 8 }}>
        {timeLeft}
      </div>
      <div className="timer-label" style={{ fontSize: 14, marginBottom: 8 }}>
        {participantName} · ข้อ {questionIndex + 1} / 3 · วินาทีคงเหลือ (งบรวม 30 วิ / 3 ข้อ)
      </div>

      {question ? (
        <div style={{ width: '100%', maxWidth: 800, marginTop: 24 }}>
          {question.media_type === 'video'
            ? <video src={question.media_url} autoPlay controls style={{ width: '100%', borderRadius: 12 }} />
            : <img   src={question.media_url} alt="ECG" style={{ width: '100%', borderRadius: 12 }} />
          }
        </div>
      ) : (
        <div style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace', fontSize: 14, marginTop: 24 }}>
          ยังไม่มีโจทย์ ECG — กรุณา Admin เพิ่มโจทย์ก่อน
        </div>
      )}

      <p style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12, color: 'var(--muted)', marginTop: 24 }}>
        เขียนคำตอบลงกระดาษ — กรรมการจะกดหยุดเวลาเมื่อเห็นว่าเขียนเสร็จ
      </p>
    </div>
  )
}
