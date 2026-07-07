// src/screens/ParticipantAlgo.jsx
// ============================================================
// เขียนใหม่ (v2): หน้านี้เป็นแค่ "จอแสดงผล + รับคำตอบ" เท่านั้น
// ไม่ตัดสินถูก/ผิดเอง — ส่งคำตอบไปให้จอกรรมการ (JudgeAlgo) ตัดสิน
// แล้วรับสถานะล่าสุดกลับมาแสดงผลแบบเรียลไทม์
// ============================================================

import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

export default function ParticipantAlgo() {
  const teamId = localStorage.getItem('teamId')
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-deep)', color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace' }}>
      รอกรรมการเริ่มฐาน Algorithm...
    </div>
  )

  if (sync.done) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', background: 'var(--bg-deep)' }}>
      <div style={{ fontSize: 'clamp(64px,15vw,120px)', fontWeight: 800, color: 'var(--ecg)',
                    textShadow: '0 0 40px rgba(51,255,156,.5)', fontFamily: 'Sarabun,sans-serif' }}>
        ผ่านครบทุกคน
      </div>
    </div>
  )

  if (sync.waiting) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', background: 'var(--bg-deep)', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
      <div style={{ fontSize: 18, color: 'var(--text)', marginBottom: 8 }}>{sync.participantName}</div>
      <div style={{ fontFamily: 'JetBrains Mono,monospace', color: 'var(--muted)' }}>รอกรรมการกดเริ่ม...</div>
    </div>
  )

  const { question, timeLeft, questionIndex, participantName, lastResult } = sync
  const timerDanger = timeLeft <= 5

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', padding: '24px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 700, margin: '0 auto 20px' }}>
        <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 16, color: 'var(--muted)' }}>
          {participantName} · ข้อ {questionIndex + 1} / 3
        </span>
        <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 48, fontWeight: 700,
                       color: timerDanger ? 'var(--alert)' : 'var(--ecg)' }}>
          {timeLeft}
        </span>
      </div>

      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        {question?.image_url && (
          <img src={question.image_url} alt="โจทย์" style={{ width: '100%', borderRadius: 12, marginBottom: 20 }} />
        )}

        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <p style={{ fontSize: 'clamp(16px,4vw,22px)', fontWeight: 600, lineHeight: 1.6 }}>{question?.question_text}</p>
        </div>

        {locked && lastResult == null ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace', padding: 20 }}>
            กำลังตรวจคำตอบ...
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {['A', 'B', 'C', 'D'].map(ch => (
              <button key={ch} disabled={locked} onClick={() => handleAnswer(ch)}
                style={{
                  padding: 'clamp(14px,4vw,22px)', borderRadius: 12,
                  border: '1px solid var(--line)', background: 'var(--bg-panel-2)',
                  color: 'var(--text)', fontFamily: 'Sarabun,sans-serif',
                  fontSize: 'clamp(15px,3.5vw,20px)', fontWeight: 600,
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
