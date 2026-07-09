// src/screens/ParticipantAlgo.jsx
// ============================================================
// เขียนใหม่ (v2): หน้านี้เป็นแค่ "จอแสดงผล + รับคำตอบ" เท่านั้น
// ไม่ตัดสินถูก/ผิดเอง — ส่งคำตอบไปให้จอกรรมการ (JudgeAlgo) ตัดสิน
// แล้วรับสถานะล่าสุดกลับมาแสดงผลแบบเรียลไทม์
// ============================================================

import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

export default function ParticipantAlgo({ teamId: teamIdProp } = {}) {
  const teamId = teamIdProp || localStorage.getItem('teamId')
  const [sync, setSync] = useState(null)       // ข้อมูลล่าสุดจากกรรมการ
  const [locked, setLocked] = useState(false)  // ล็อกปุ่มระหว่างรอผลตัดสิน
  const channelRef = useRef(null)

  useEffect(() => {
    const channel = supabase.channel(`algo-${teamId}`)
    channel
      .on('broadcast', { event: 'sync' }, ({ payload }) => {
        setSync(payload)
        setLocked(false) // ผลตัดสินมาแล้ว ปลดล็อกปุ่มให้ตอบข้อถัดไปได้
      })
      .subscribe()
    channelRef.current = channel
    return () => supabase.removeChannel(channel)
  }, [teamId])

  function handleAnswer(choice) {
    if (locked || !channelRef.current) return
    setLocked(true)
    channelRef.current.send({ type: 'broadcast', event: 'choice', payload: { choice } })
  }

  if (!sync) return (
    <div style={{ minHeight: '100vh', overflowY: 'auto', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-deep)', color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace' }}>
      รอกรรมการเริ่มฐาน Algorithm...
    </div>
  )

  if (sync.done) return (
    <div style={{ minHeight: '100vh', overflowY: 'auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', background: 'var(--bg-deep)' }}>
      <div style={{ fontSize: 'clamp(64px,15vw,120px)', fontWeight: 800, color: 'var(--ecg)',
                    textShadow: '0 0 40px rgba(51,255,156,.5)', fontFamily: 'Sarabun,sans-serif' }}>
        ผ่านครบทุกคน
      </div>
    </div>
  )

  if (sync.waiting) return (
    <div style={{ minHeight: '100vh', overflowY: 'auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', background: 'var(--bg-deep)', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
      <div style={{ fontSize: 18, color: 'var(--text)', marginBottom: 8 }}>{sync.participantName}</div>
      <div style={{ fontFamily: 'JetBrains Mono,monospace', color: 'var(--muted)' }}>รอกรรมการกดเริ่ม...</div>
    </div>
  )

  if (sync.missingSet) return (
    <div style={{ minHeight: '100vh', overflowY: 'auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', background: 'var(--bg-deep)', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⚠</div>
      <div style={{ fontFamily: 'JetBrains Mono,monospace', color: 'var(--alert)' }}>ยังไม่มีโจทย์สำหรับชุดนี้ — กรุณาแจ้งกรรมการ/Admin</div>
    </div>
  )

  const { question, timeLeft, questionIndex, participantName, lastResult } = sync
  const timerDanger = timeLeft <= 5

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', padding: '16px 20px', overflowY: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 700, margin: '0 auto 14px' }}>
        <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 'clamp(12px,1.8vh,16px)', color: 'var(--muted)' }}>
          {participantName} · ข้อ {questionIndex + 1} / 3
        </span>
        <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 'clamp(28px,6vh,48px)', fontWeight: 700,
                       color: timerDanger ? 'var(--alert)' : 'var(--ecg)', lineHeight: 1 }}>
          {timeLeft}
        </span>
      </div>

      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        {question?.image_url && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <img src={question.image_url} alt="โจทย์"
              style={{ maxWidth: '100%', maxHeight: '32vh', width: 'auto', borderRadius: 12, objectFit: 'contain' }} />
          </div>
        )}

        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
          <p style={{ fontSize: 'clamp(14px,2.6vh,20px)', fontWeight: 600, lineHeight: 1.5 }}>{question?.question_text}</p>
        </div>

        {locked && lastResult == null ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace', padding: 20 }}>
            กำลังตรวจคำตอบ...
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {['A', 'B', 'C', 'D'].map(ch => (
              <button key={ch} disabled={locked} onClick={() => handleAnswer(ch)}
                style={{
                  padding: 'clamp(10px,2.4vh,20px) 14px', borderRadius: 12,
                  border: '1px solid var(--line)', background: 'var(--bg-panel-2)',
                  color: 'var(--text)', fontFamily: 'Sarabun,sans-serif',
                  fontSize: 'clamp(13px,2.2vh,18px)', fontWeight: 600,
                  cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? .5 : 1,
                  textAlign: 'left',
                }}>
                <span style={{ color: 'var(--ecg)', marginRight: 8, fontFamily: 'JetBrains Mono,monospace' }}>{ch}.</span>
                {question?.[`choice_${ch.toLowerCase()}`]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
