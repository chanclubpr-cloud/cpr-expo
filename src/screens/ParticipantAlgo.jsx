// src/screens/ParticipantAlgo.jsx
// จอ Laptop หน้าฐาน Algorithm — ผู้แข่งขันกดตอบเอง
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const TIME_PER_Q = 15  // วินาที/ข้อ

export default function ParticipantAlgo() {
  const [question,   setQuestion]   = useState(null)
  const [qIndex,     setQIndex]     = useState(0)
  const [passedCount, setPassedCount] = useState(0)
  const [timeLeft,   setTimeLeft]   = useState(TIME_PER_Q)
  const [feedback,   setFeedback]   = useState(null)  // 'correct' | 'wrong' | 'timeout' | 'done'
  const [questions,  setQuestions]  = useState([])
  const timerRef = useRef(null)

  // teamId และ participantId ควรส่งผ่าน URL params ในระบบจริง
  // ตอนนี้ใช้ localStorage ก่อน
  const teamId = localStorage.getItem('teamId')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('algo_questions').select('*').eq('is_active', true).order('display_order')
      setQuestions(data || [])
      if (data?.length) setQuestion(data[0])
    }
    load()
  }, [])

  // นาฬิกาต่อข้อ
  useEffect(() => {
    if (feedback || !question) return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current)
          setFeedback('timeout')
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [question, qIndex, feedback])

  async function handleAnswer(choice) {
    clearInterval(timerRef.current)
    const isCorrect = choice === question.correct_choice

    await supabase.from('attempts').insert({
      station_type:     'ALGORITHM',
      question_id:      question.question_id,
      question_number:  qIndex + 1,
      selected_choice:  choice,
      result:           isCorrect ? 'pass' : 'fail',
      time_used_seconds: TIME_PER_Q - timeLeft,
    })

    if (isCorrect) {
      const newPassed = passedCount + 1
      if (newPassed >= 3) {
        setPassedCount(newPassed)
        setFeedback('done')
      } else {
        setFeedback('correct')
        setTimeout(() => {
          const nextQ = questions[(qIndex + 1) % questions.length]
          setQuestion(nextQ)
          setQIndex(qIndex + 1)
          setPassedCount(newPassed)
          setTimeLeft(TIME_PER_Q)
          setFeedback(null)
        }, 1200)
      }
    } else {
      setFeedback('wrong')
      setTimeout(() => {
        // ตอบผิด → กลับไปต่อคิวใหม่ (ในระบบจริง broadcast ไปบอกหน้ากรรมการ)
        // ที่นี่แค่ reset ข้อ 1 ใหม่ (simulated)
        setQIndex(0); setPassedCount(0); setQuestion(questions[0]); setTimeLeft(TIME_PER_Q); setFeedback(null)
      }, 1500)
    }
  }

  const timerDanger = timeLeft <= 5

  // หน้าสำเร็จ
  if (feedback === 'done') return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'var(--bg-deep)' }}>
      <div style={{ fontSize:'clamp(64px,15vw,120px)', fontWeight:800, color:'var(--ecg)', textShadow:'0 0 40px rgba(51,255,156,.5)', fontFamily:'Sarabun,sans-serif' }}>ผ่าน</div>
      <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:16, color:'var(--muted)', marginTop:12 }}>ครบ 3/3 ข้อ — เชิญคนถัดไป</div>
    </div>
  )

  if (!question) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg-deep)', color:'var(--muted)', fontFamily:'JetBrains Mono,monospace' }}>
      ยังไม่มีโจทย์ Algorithm
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)', padding:'24px 20px' }}>
      {/* นาฬิกา + ข้อที่ */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', maxWidth:700, margin:'0 auto 20px' }}>
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:16, color:'var(--muted)' }}>
          ข้อ {passedCount + 1} / 3
        </span>
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:48, fontWeight:700, color: timerDanger ? 'var(--alert)' : 'var(--ecg)' }}>
          {timeLeft}
        </span>
      </div>

      <div style={{ maxWidth:700, margin:'0 auto' }}>
        {/* ภาพประกอบ */}
        {question.image_url && (
          <img src={question.image_url} alt="โจทย์" style={{ width:'100%', borderRadius:12, marginBottom:20 }} />
        )}

        {/* โจทย์ */}
        <div style={{ background:'var(--bg-panel)', border:'1px solid var(--line)', borderRadius:12, padding:20, marginBottom:20 }}>
          <p style={{ fontSize:'clamp(16px,4vw,22px)', fontWeight:600, lineHeight:1.6 }}>{question.question_text}</p>
        </div>

        {/* ตัวเลือก */}
        {feedback ? (
          <div style={{ textAlign:'center', fontSize:32, fontWeight:800, color: feedback==='correct' ? 'var(--ecg)' : 'var(--alert)', padding:30 }}>
            {feedback === 'correct' ? '✓ ถูก' : feedback === 'wrong' ? '✕ ผิด' : '⏱ หมดเวลา'}
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            {['A','B','C','D'].map(ch => (
              <button key={ch} onClick={() => handleAnswer(ch)}
                style={{
                  padding:'clamp(14px,4vw,22px)', borderRadius:12,
                  border:'1px solid var(--line)', background:'var(--bg-panel-2)',
                  color:'var(--text)', fontFamily:'Sarabun,sans-serif',
                  fontSize:'clamp(15px,3.5vw,20px)', fontWeight:600, cursor:'pointer',
                  textAlign:'left', transition:'.12s',
                }}>
                <span style={{ color:'var(--ecg)', marginRight:8, fontFamily:'JetBrains Mono,monospace' }}>{ch}.</span>
                {question[`choice_${ch.toLowerCase()}`]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
