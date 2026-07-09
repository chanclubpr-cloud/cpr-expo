// src/screens/JudgeAlgo.jsx
// ============================================================
// v3: เปลี่ยนเป็นระบบ "งบเวลารวม 30 วิ / 3 ข้อ" เหมือนฐาน ECG
// (เดิมเป็น 10 วิ/ข้อ แยกกัน) และกรรมการต้องกด "▶️ เริ่ม" เองต่อคน
// (เดิมนาฬิกาเริ่มเดินอัตโนมัติทันทีที่ Master เปลี่ยนฐาน — เป็นบั๊ก)
//
// กติกา: ตอบผิด = ทำข้อเดิมซ้ำได้ ตราบใดที่งบเวลารวมยังไม่หมด
//        เวลาหมดแล้วยังไม่ผ่านครบ 3 ข้อ = กลับไปต่อคิวใหม่ เริ่มข้อ 1
// ============================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useButtonGuard } from '../lib/useButtonGuard'
import { finalizeStationResult } from '../lib/scoring'

const BUDGET = 30 // วินาทีรวมสำหรับ 3 ข้อ (เหมือน ECG)

export default function JudgeAlgo() {
  const judgeId = localStorage.getItem('judgeId')
  const teamId  = localStorage.getItem('teamId')

  async function leaveTeam() {
    if (!confirm('ยืนยันรีเซ็ตฐานนี้ — ข้อมูลคิวปัจจุบันจะเริ่มใหม่')) return
    if (assignmentId) await supabase.from('judge_assignments').delete().eq('assignment_id', assignmentId)
    window.location.reload()
  }

  const [teamName,     setTeamName]     = useState('')
  const [questions,    setQuestions]    = useState([])
  const [queue,        setQueue]        = useState([])
  const [qIndex,       setQIndex]       = useState(0)
  const [passed,       setPassed]       = useState([false, false, false])
  const [timeLeft,     setTimeLeft]     = useState(BUDGET)
  const [timerOn,      setTimerOn]      = useState(false)
  const [personStarted, setPersonStarted] = useState(false) // กรรมการกด "เริ่ม" แล้วหรือยัง
  const [lastResult,   setLastResult]   = useState(null)
  const [allDone,      setAllDone]      = useState(false)
  const [assignmentId, setAssignmentId] = useState(null)
  const [teamOffset,   setTeamOffset]   = useState(0) // ใช้หมุนลำดับชุดโจทย์ (Latin Square)

  const timerRef   = useRef(null)
  const channelRef = useRef(null)
  const handleChoiceRef  = useRef(null) // ใช้แก้ปัญหา Stale Closure — เก็บฟังก์ชันเวอร์ชันล่าสุดไว้เสมอ
  const handleTimeoutRef = useRef(null) // ป้องกันปัญหาเดียวกันตอน "หมดเวลา"
  const startGuard = useButtonGuard()

  useEffect(() => {
    async function load() {
      const { data: team } = await supabase
        .from('teams').select('team_name').eq('team_id', teamId).single()
      setTeamName(team?.team_name || '')

      const { data: device } = await supabase
        .from('device_assignments').select('device_number').eq('team_id', teamId).maybeSingle()
      setTeamOffset(device?.device_number ? (device.device_number - 1) % 5 : 0)

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
      // ไม่เริ่มนาฬิกาอัตโนมัติแล้ว — รอกรรมการกด "▶️ เริ่ม" เอง
    }
    load()

    const channel = supabase.channel(`algo-${teamId}`)
    channel
      .on('broadcast', { event: 'choice' }, ({ payload }) => {
        // เรียกผ่าน ref เสมอ เพื่อให้ได้ฟังก์ชันเวอร์ชันล่าสุด (แก้ปัญหา Stale Closure)
        // ที่ทำให้เดิมกดตอบแล้วไม่มีผลอะไรเลย เพราะฟังก์ชันจำค่า currentQ ตอนโหลดหน้าครั้งแรก (ยังว่างเปล่า) ไว้ตลอดไป
        handleChoiceRef.current?.(payload.choice)
      })
      .subscribe()
    channelRef.current = channel
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, judgeId])

  // ─── นาฬิกางบเวลารวม 30 วิ ───
  useEffect(() => {
    if (!timerOn || allDone) return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current)
          setTimerOn(false)
          handleTimeoutRef.current?.()
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
    const person = queue[activeIdx]
    const setIndex = person ? ((person.queue_order - 1 + teamOffset) % 5) : 0
    const personQs = questions
      .filter(qq => Math.floor(((qq.display_order || 1) - 1) / 3) === setIndex)
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    const q = personQs[qIndex] || null
    channelRef.current.send({
      type: 'broadcast',
      event: 'sync',
      payload: {
        participantName: person?.full_name || '',
        participantIndex: activeIdx,
        questionIndex: qIndex,
        question: q ? {
          image_url: q.image_url, question_text: q.question_text,
          choice_a: q.choice_a, choice_b: q.choice_b, choice_c: q.choice_c, choice_d: q.choice_d,
        } : null,
        timeLeft,
        lastResult,
        done: allDone,
        waiting: !personStarted, // จอผู้แข่งขันจะโชว์ "รอกรรมการกดเริ่ม" ถ้ายัง true
        missingSet: personStarted && !q, // true = ชุดโจทย์ที่คนนี้ต้องทำยังไม่มีข้อมูลในระบบ
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, qIndex, timeLeft, lastResult, allDone, questions, personStarted, teamOffset])

  const activeIdx    = queue.findIndex(p => p.status === 'active')
  const activePerson = queue[activeIdx]

  // ─── คำนวณว่าคนนี้ควรได้ทำ "ชุดโจทย์" ไหน (0-4) — หมุนตามเลขเครื่องของทีม (Latin Square) ───
  const personSetIndex = activePerson
    ? ((activePerson.queue_order - 1 + teamOffset) % 5)
    : 0
  const personQuestions = questions
    .filter(q => Math.floor(((q.display_order || 1) - 1) / 3) === personSetIndex)
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
  const currentQ = personQuestions[qIndex] || null

  // ─── กรรมการกด "▶️ เริ่ม" ให้คนปัจจุบัน ───
  const handleStart = useCallback(() => startGuard.run(async () => {
    setQIndex(0)
    setPassed([false, false, false])
    setTimeLeft(BUDGET)
    setPersonStarted(true)
    setTimerOn(true)
    setLastResult(null)
  }), [startGuard])

  // ─── รับคำตอบจากจอผู้แข่งขัน ───
  async function handleChoice(choice) {
    if (!activePerson || !currentQ || allDone || !personStarted) return
    const isCorrect = choice === currentQ.correct_choice

    await supabase.from('attempts').insert({
      participant_id:   activePerson.participant_id,
      assignment_id:    assignmentId,
      station_type:     'ALGORITHM',
      question_id:      currentQ.question_id,
      question_number:  qIndex + 1,
      selected_choice:  choice,
      result:           isCorrect ? 'pass' : 'fail',
      judged_by:        null,
    })

    if (isCorrect) {
      setLastResult('correct')
      if (qIndex >= 2) {
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
        // ผ่านข้อนี้ ไปข้อถัดไป — เวลายังเดินต่อ ไม่รีเซ็ต (เหมือน ECG)
        setPassed(prev => { const n = [...prev]; n[qIndex] = true; return n })
        setQIndex(qIndex + 1)
      }
    } else {
      // ตอบผิด → ทำข้อเดิมซ้ำ ตราบใดที่งบเวลายังไม่หมด (ไม่ reset เวลา ไม่สลับคิว)
      setLastResult('wrong')
      setQueue(prev => prev.map((p, i) => i === activeIdx ? { ...p, retryCount: p.retryCount + 1 } : p))
    }
  }

  // อัปเดต ref ให้ชี้ไปที่ handleChoice/handleTimeout เวอร์ชันล่าสุดทุกครั้งที่ re-render
  // (จำเป็นเพราะ event listener และ interval ถูกตั้งไว้แค่ครั้งเดียวตอน mount)
  useEffect(() => {
    handleChoiceRef.current  = handleChoice
    handleTimeoutRef.current = handleTimeout
  })

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
    setTimeLeft(BUDGET)
    setPersonStarted(false) // รอกรรมการกด "เริ่ม" เองสำหรับคนถัดไป
    setTimerOn(false)
  }

  const timerDanger = timeLeft <= 8

  if (!questions.length) return (
    <div className="screen">
      <p style={{ color: 'var(--muted)', marginTop: 24, fontFamily: 'JetBrains Mono,monospace' }}>
        ยังไม่มีโจทย์ Algorithm — กรุณา Admin เพิ่มโจทย์ก่อน
      </p>
    </div>
  )

  return (
    <div className="screen-wide">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 20, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{teamName}</div>
          <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12, color: 'var(--muted)' }}>
            ฐาน Algorithm · คน {activeIdx + 1}/5 · งบเวลารวม 30 วิ / 3 ข้อ
          </div>
        </div>
        <button onClick={leaveTeam} style={{
          fontFamily: 'JetBrains Mono,monospace', fontSize: 11, background: 'none',
          border: '1px solid var(--line)', color: 'var(--muted)', borderRadius: 6,
          padding: '6px 10px', cursor: 'pointer',
        }}>🔄 รีเซ็ตฐานนี้</button>
      </div>

      <div className="judge-split">
      <div>
      {/* รอกรรมการกด "▶️ เริ่ม" */}
      {!allDone && !personStarted && (
        <div className="card" style={{ textAlign: 'center', marginBottom: 14 }}>
          <div className="p-name" style={{ marginBottom: 14 }}>{activePerson?.full_name}</div>
          <button
            onClick={handleStart}
            disabled={startGuard.busy}
            style={{
              width: '100%', padding: 18, borderRadius: 12, border: 'none',
              background: 'var(--ecg)', color: '#04170D', fontFamily: 'Sarabun,sans-serif',
              fontWeight: 800, fontSize: 20, cursor: 'pointer', opacity: startGuard.busy ? .6 : 1,
            }}
          >
            {startGuard.busy ? 'กำลังเริ่ม...' : '▶️ เริ่ม (งบเวลา 30 วิ / 3 ข้อ)'}
          </button>
        </div>
      )}

      {!allDone && personStarted && !currentQ && (
        <div className="warn-banner" style={{ marginBottom: 14 }}>
          ⚠ ยังไม่มีโจทย์สำหรับชุดที่ {personSetIndex + 1} (คนนี้ควรได้ทำชุดที่ {personSetIndex + 1} ตามระบบหมุนชุด)<br/>
          กรุณาไปที่ Admin → คลังโจทย์ Algorithm → เพิ่มโจทย์ให้ครบทั้ง 5 ชุด (ชุดละ 3 ข้อ เรียงลำดับ 1-15)
        </div>
      )}

      {!allDone && personStarted && currentQ && (
        <div className="card" style={{ textAlign: 'center', marginBottom: 14 }}>
          <div className="timer-label">เวลาคงเหลือ (งบรวม 30 วิ / 3 ข้อ)</div>
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
      </div>

      <div>
        <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:11,color:'var(--muted)',
                     marginBottom:10, letterSpacing:'.06em'}}>
          ลำดับผู้เข้าแข่งขัน
        </div>

      {queue.map(p => (
        <div key={p.participant_id} className={`participant-row ${p.status}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="p-name">{p.full_name}</div>
              <div className="p-sub">
                {p.status === 'passed'  ? 'ผ่านครบ 3 ข้อ' :
                 p.status === 'active'  ? (personStarted ? `กำลังทำ ข้อ ${qIndex + 1}/3 · สอบซ้ำ ${p.retryCount} ครั้ง` : 'รอกดเริ่ม') :
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
      </div>
      </div>

      <p className="note">
        ✅ กด "เริ่ม" ก่อนทุกครั้งที่ผู้แข่งขันพร้อมแล้ว — เวลาจะไม่เดินเองอัตโนมัติ<br/>
        ✅ ตอบผิด → ทำข้อเดิมซ้ำได้ ตราบใดที่งบเวลา 30 วิยังไม่หมด<br/>
        ✅ งบเวลาหมดแล้วยังไม่ผ่านครบ 3 ข้อ → กลับไปต่อคิวใหม่ เริ่มข้อ 1 เมื่อถึงรอบ
      </p>
    </div>
  )
}
