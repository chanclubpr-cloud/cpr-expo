// src/screens/ParticipantECG.jsx
// จอ Laptop หน้าฐาน ECG — แสดงโจทย์และนาฬิกาถอยหลัง
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const BUDGET = 30

export default function ParticipantECG() {
  const [timeLeft,  setTimeLeft]  = useState(BUDGET)
  const [question,  setQuestion]  = useState(null)
  const [danger,    setDanger]    = useState(false)

  useEffect(() => {
    // Subscribe ฟัง event_state — เมื่อกรรมการเริ่ม/หยุดเวลาจะ sync มาที่นี่
    // (ในระบบจริงจะรับผ่าน Realtime channel ที่กรรมการ broadcast ค่า timeLeft ออกมา)
    const sub = supabase.channel('ecg-participant')
      .on('broadcast', { event:'timer' }, ({ payload }) => {
        setTimeLeft(payload.timeLeft)
        setDanger(payload.timeLeft <= 8)
      })
      .on('broadcast', { event:'question' }, ({ payload }) => {
        setQuestion(payload.question)
      })
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [])

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'var(--bg-deep)', padding:24 }}>
      {/* นาฬิกาถอยหลัง */}
      <div className={`timer-display${danger ? ' danger' : ''}`} style={{ fontSize:'clamp(80px,18vw,140px)', marginBottom:8 }}>
        {timeLeft}
      </div>
      <div className="timer-label" style={{ fontSize:14, marginBottom:32 }}>วินาทีคงเหลือ (30 วิ / 3 ข้อ)</div>

      {/* โจทย์ ECG */}
      {question ? (
        <div style={{ width:'100%', maxWidth:800 }}>
          {question.media_type === 'video'
            ? <video src={question.media_url} autoPlay controls style={{ width:'100%', borderRadius:12 }} />
            : <img   src={question.media_url} alt="ECG" style={{ width:'100%', borderRadius:12 }} />
          }
        </div>
      ) : (
        <div style={{ color:'var(--muted)', fontFamily:'JetBrains Mono,monospace', fontSize:14 }}>
          รอโจทย์จากกรรมการ...
        </div>
      )}

      <p style={{ fontFamily:'JetBrains Mono,monospace', fontSize:12, color:'var(--muted)', marginTop:24 }}>
        เขียนคำตอบลงกระดาษ — กรรมการจะกดหยุดเวลาเมื่อเห็นว่าเขียนเสร็จ
      </p>
    </div>
  )
}
