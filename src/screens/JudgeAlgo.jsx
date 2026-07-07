// src/screens/JudgeAlgo.jsx
// ============================================================
// เขียนใหม่ทั้งหมด (v2) แก้ปัญหา "ไม่แสดงผลการสอบเลย"
//
// เดิม: หน้านี้แค่โหลดรายชื่อครั้งเดียว ไม่เคยอัปเดตตามคำตอบจริง
// ใหม่: หน้านี้เป็น "ผู้ควบคุมหลัก" ของฐาน Algorithm ทั้งหมด
//   - คุมโจทย์ปัจจุบัน + นาฬิกา 15 วิ/ข้อ
//   - รับคำตอบจากจอผู้แข่งขัน (ผ่าน Realtime Broadcast)
//   - ตรวจถูก/ผิดเอง บันทึกผล และตัดสินใจว่าจะไปข้อถัดไปหรือให้ทำซ้ำ
//   - Broadcast โจทย์+เวลากลับไปให้จอผู้แข่งขันแสดงผล
//
// กติกาใหม่: ตอบผิด = ทำข้อเดิมซ้ำได้ ตราบใดที่เวลา 15 วิ (ต่อข้อ) ยังไม่หมด
//           เวลาหมดแล้วยังไม่ผ่าน = กลับไปต่อคิวใหม่ เริ่มข้อ 1
// ============================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { finalizeStationResult } from '../lib/scoring'

const TIME_PER_Q = 10

export default function JudgeAlgo() {
  const judgeId = localStorage.getItem('judgeId')
  const teamId  = localStorage.getItem('teamId')

  const [teamName,     setTeamName]     = useState('')
  const [questions,    setQuestions]    = useState([])
  const [queue,        setQueue]        = useState([])
  const [qIndex,       setQIndex]       = useState(0)
  const [passed,       setPassed]       = useState([false, false, false])
  const [timeLeft,     setTimeLeft]     = useState(TIME_PER_Q)
  const [timerOn,      setTimerOn]      = useState(false)
  const [lastResult,   setLastResult]   = useState(null) // 'correct' | 'wrong' | 'timeout' | null
  const [allDone,      setAllDone]      = useState(false)
  const [assignmentId, setAssignmentId] = useState(null)

  const timerRef   = useRef(null)
  const channelRef = useRef(null)

  async function leaveTeam() {
    if (!confirm('ยืนยันรีเซ็ตฐานนี้ — ข้อมูลคิวปัจจุบันจะเริ่มใหม่')) return
    if (assignmentId) await supabase.from('judge_assignments').delete().eq('assignment_id', assignmentId)
    window.location.reload()
  }

  // ─── โหลดข้อมูลเริ่มต้น ───
  useEffect(() => {
    async function load() {
      const { data: team } = await supabase
        .from('teams').select('team_name').eq('team_id', teamId).single()
      setTeamName(team?.team_name || '')

      const { data: members } = await supabase
        .from('participants').select('*')
        .eq('team_id', teamId).eq('is_reserve', false).order('queue_order')
      if (members) {
        setQueue(members.map((m, i) => ({ ...m, status: i === 0 ? 'active' : 'waiting', retryCount: 0 })))
      }

      const { data: qs } = await supabase
        .from('algo_questions').select('*').eq('is_active', true).order('display_order')
      setQuestions(qs || [])

      const { data: asgn } = await supabase
        .from('judge_assignments').select('assignment_id, started_at')
        .eq('judge_id', judgeId).eq('team_id', teamId).eq('status', 'active').single()

      if (asgn?.assignment_id) {
        setAssignmentId(asgn.assignment_id)
        if (!asgn.started_at) {
          await supabase.from('judge_assignments')
            .update({ started_at: new Date().toISOString() })
            .eq('assignment_id', asgn.assignment_id)
        }
      }
      setTimerOn(true)
    }
    load()

    // ช่องสัญญาณสื่อสารกับจอผู้แข่งขัน (ฝั่งนี้เป็นผู้ควบคุมหลัก)
    const channel = supabase.channel(`algo-${teamId}`)
    channel
      .on('broadcast', { event: 'choice' }, ({ payload }) => handleChoice(payload.choice))
      .subscribe()
    channelRef.current = channel
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, judgeId])

  // ─── นาฬิกา 15 วิ/ข้อ ───
  useEffect(() => {
    if (!timerOn || allDone) return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current)
          setTimerOn(false)
          handleTimeout()
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [timerOn, allDone])

  // ─── ส่งสถานะปัจจุบันให้จอผู้แข่งขันเสมอเมื่อมีการเปลี่ยนแปลง ───
  useEffect(() => {
    if (!channelRef.current || !questions.length) return
    const activeIdx = queue.findIndex(p => p.status === 'active')
    const q = questions[qIndex % questions.length]
    channelRef.current.send({
      type: 'broadcast',
      event: 'sync',
      payload: {
        participantName: queue[activeIdx]?.full_name || '',
        participantIndex: activeIdx,
        questionIndex: qIndex,
        question: q ? {
          image_url: q.image_url, question_text: q.question_text,
          choice_a: q.choice_a, choice_b: q.choice_b, choice_c: q.choice_c, choice_d: q.choice_d,
        } : null,
        timeLeft,
        lastResult,
        done: allDone,
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, qIndex, timeLeft, lastResult, allDone, questions])

  const activeIdx    = queue.findIndex(p => p.status === 'active')
  const activePerson = queue[activeIdx]
  const currentQ     = questions[qIndex % Math.max(questions.length, 1)]

  // ─── รับคำตอบจากจอผู้แข่งขัน ───
  async function handleChoice(choice) {
    if (!activePerson || !currentQ || allDone) return
    const isCorrect = choice === currentQ.correct_choice

    await supabase.from('attempts').insert({
      participant_id:   activePerson.participant_id,
      assignment_id:    assignmentId,
      station_type:     'ALGORITHM',
      question_id:      currentQ.question_id,
      question_number:  qIndex + 1,
      selected_choice:  choice,
      result:           isCorrect ? 'pass' : 'fail',
      judged_by:        null, // ระบบเช็คอัตโนมัติ
    })

    if (isCorrect) {
      setLastResult('correct')
      if (qIndex >= 2) {
        // ผ่านครบ 3 ข้อ
        const next = queue.map((p, i) => i === activeIdx ? { ...p, status: 'passed' } : p)
        const nextIdx = next.findIndex(p => p.status === 'waiting' || p.status === 'resting')
        if (nextIdx >= 0) next[nextIdx] = { ...next[nextIdx], status: 'active' }
        setQueue(next)
        if (next.every(p => p.status === 'passed')) {
          setAllDone(true)
          setTimerOn(false)
          await supabase.from('judge_assignments')
            .update({ status: 'finished', finished_at: new Date().toISOString() })
            .eq('assignment_id', assignmentId)
          await finalizeStationResult('ALGORITHM')
        } else {
          resetForNextPerson()
        }
      } else {
        setPassed(prev => { const n = [...prev]; n[qIndex] = true; return n })
        setQIndex(qIndex + 1)
        setTimeLeft(TIME_PER_Q)
      }
    } else {
      // ตอบผิด → ทำข้อเดิมซ้ำ ตราบใดที่เวลายังไม่หมด (ไม่ reset เวลา ไม่สลับคิว)
      setLastResult('wrong')
      setQueue(prev => prev.map((p, i) => i === activeIdx ? { ...p, retryCount: p.retryCount + 1 } : p))
    }
  }

  // ─── หมดเวลา → กลับไปต่อคิวใหม่ เริ่มข้อ 1 ───
  function handleTimeout() {
    if (activeIdx < 0) return
    setLastResult('timeout')
    const next = [...queue]
    const rested = { ...next[activeIdx], status: 'resting', retryCount: next[activeIdx].retryCount + 1 }
    next.splice(activeIdx, 1)
    next.push(rested)
    const nextIdx = next.findIndex(p => p.status === 'waiting' || p.status === 'resting')
    if (nextIdx >= 0) next[nextIdx] = { ...next[nextIdx], status: 'active' }
    setQueue(next)
    resetForNextPerson()
  }

  function resetForNextPerson() {
    setQIndex(0)
    setPassed([false, false, false])
    setTimeLeft(TIME_PER_Q)
    setTimerOn(true)
  }

  const timerDanger = timeLeft <= 5

  if (!questions.length) return (
    <div className="screen">
      <p style={{ color: 'var(--muted)', marginTop: 24, fontFamily: 'JetBrains Mono,monospace' }}>
        ยังไม่มีโจทย์ Algorithm — กรุณา Admin เพิ่มโจทย์ก่อน
      </p>
    </div>
  )

  return (
    <div className="screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 20, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{teamName}</div>
          <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12, color: 'var(--muted)' }}>
            ฐาน Algorithm · คน {activeIdx + 1}/5 · ข้อ {qIndex + 1}/3
          </div>
        </div>
        <button onClick={leaveTeam} style={{
          fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
          border: '1px solid var(--line)', color: 'var(--muted)', borderRadius: 6,
          padding: '6px 10px', cursor: 'pointer',
        }}>🔄 รีเซ็ตฐานนี้</button>
      </div>

      {!allDone && (
        <div className="card" style={{ textAlign: 'center', marginBottom: 14 }}>
          <div className="timer-label">เวลาคงเหลือ (ข้อนี้)</div>
          <div className={`timer-display${timerDanger ? ' danger' : ''}`}>{timeLeft}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'center' }}>
            {[0, 1, 2].map(i => (
              <span key={i} className={`badge ${passed[i] ? 'badge-pass' : 'badge-wait'}`}
                style={{ opacity: i <= qIndex ? 1 : .4 }}>
                {passed[i] ? `ข้อ ${i + 1} ✓` : `ข้อ ${i + 1}`}
              </span>
            ))}
          </div>
          {lastResult && (
            <div style={{
              marginTop: 10, fontFamily: 'JetBrains Mono,monospace', fontWeight: 700,
              color: lastResult === 'correct' ? 'var(--ecg)' : 'var(--alert)',
            }}>
              {lastResult === 'correct' ? '✓ ตอบถูก' : lastResult === 'wrong' ? '✕ ตอบผิด — ทำข้อนี้ซ้ำ' : '⏱ หมดเวลา — กลับไปต่อคิว'}
            </div>
          )}
        </div>
      )}

      {allDone && (
        <div className="card" style={{ borderColor: 'var(--ecg)', textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: 48 }}>🎉</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ecg)' }}>ผ่านครบทุกคน!</div>
        </div>
      )}

      {queue.map(p => (
        <div key={p.participant_id} className={`participant-row ${p.status}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="p-name">{p.full_name}</div>
              <div className="p-sub">
                {p.status === 'passed'  ? 'ผ่านครบ 3 ข้อ' :
                 p.status === 'active'  ? `กำลังทำ ข้อ ${qIndex + 1}/3 · สอบซ้ำ ${p.retryCount} ครั้ง` :
                 p.status === 'resting' ? `พักคิว · สอบซ้ำ ${p.retryCount} ครั้ง` : 'รอคิว'}
              </div>
            </div>
            <span className={`badge ${
              p.status === 'passed'  ? 'badge-pass' :
              p.status === 'resting' ? 'badge-resting' :
              p.status === 'active'  ? 'badge-pass' : 'badge-wait'
            }`}>
              {p.status === 'passed'  ? '✓ ผ่าน' :
               p.status === 'resting' ? 'พักคิว 🔁' :
               p.status === 'active'  ? 'กำลังสอบ' : 'รอ'}
            </span>
          </div>
        </div>
      ))}

      <p className="note">
        ✅ ตอบผิด → ทำข้อเดิมซ้ำได้ ตราบใดที่เวลา 15 วิ/ข้อ ยังไม่หมด<br/>
        ✅ เวลาหมดแล้วยังไม่ผ่าน → กลับไปต่อคิวใหม่ เริ่มข้อ 1 เมื่อถึงรอบ<br/>
        ✅ หน้านี้ควบคุมโจทย์ที่แสดงบนจอผู้แข่งขันแบบเรียลไทม์
      </p>
    </div>
  )
}
