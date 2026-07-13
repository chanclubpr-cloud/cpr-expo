// src/screens/JudgeAlgo.jsx
// ============================================================
// v3: เปลี่ยนเป็นระบบ "งบเวลารวม 45 วิ / 3 ข้อ" เหมือนฐาน ECG
// (เดิมเป็น 10 วิ/ข้อ แยกกัน) และกรรมการต้องกด "▶️ เริ่ม" เองต่อคน
// (เดิมนาฬิกาเริ่มเดินอัตโนมัติทันทีที่ Master เปลี่ยนฐาน — เป็นบั๊ก)
//
// กติกา: ตอบผิด = ทำข้อเดิมซ้ำได้ ตราบใดที่งบเวลารวมยังไม่หมด
//        เวลาหมดแล้วยังไม่ผ่านครบ 3 ข้อ = กลับไปต่อคิวใหม่ เริ่มข้อ 1
// ============================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getServerTimeMs } from '../lib/serverTime'
import { useButtonGuard } from '../lib/useButtonGuard'
import { finalizeStationResult } from '../lib/scoring'
import { clearStationProgress, getStationProgressKey, loadStationProgress, saveStationProgress } from '../lib/stationProgress'

const BUDGET = 45 // วินาทีรวมสำหรับ 3 ข้อ

export default function JudgeAlgo({ teamId: teamIdProp, judgeId: judgeIdProp, judgeName, eventId } = {}) {
  const judgeId = judgeIdProp || localStorage.getItem('judgeId')
  const teamId  = teamIdProp  || localStorage.getItem('teamId')

  async function leaveTeam() {
    if (!confirm('ยืนยันรีเซ็ตฐานนี้ — ข้อมูลคิวปัจจุบันจะเริ่มใหม่')) return
    if (assignmentId) await supabase.from('judge_assignments').delete().eq('assignment_id', assignmentId)
    if (progressKeyRef.current) clearStationProgress(progressKeyRef.current)
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
  const [personBudgetStartMs, setPersonBudgetStartMs] = useState(null) // ms เมื่อเริ่มคนนี้ (เวลาเซิร์ฟเวอร์ — ใช้คำนวณเวลาที่เหลือใหม่ตอนรีเฟรช/หลุดสัญญาณ เหมือนฐาน ECG)

  const timerRef   = useRef(null)
  const channelRef = useRef(null)
  const handleChoiceRef  = useRef(null) // ใช้แก้ปัญหา Stale Closure — เก็บฟังก์ชันเวอร์ชันล่าสุดไว้เสมอ
  const handleTimeoutRef = useRef(null) // ป้องกันปัญหาเดียวกันตอน "หมดเวลา"
  const progressKeyRef = useRef('')
  const hydratedRef = useRef(false)
  const startGuard = useButtonGuard()

  useEffect(() => {
    async function load() {
      hydratedRef.current = false
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
        .eq('judge_id', judgeId).eq('team_id', teamId).eq('station_type', 'ALGORITHM').eq('status', 'active').maybeSingle()

      progressKeyRef.current = getStationProgressKey({ stationType: 'ALGORITHM', teamId, judgeId })
      const saved = loadStationProgress(progressKeyRef.current)
      const freshQueue = (members || []).map((m, i) => ({ ...m, status: i === 0 ? 'active' : 'waiting', retryCount: 0 }))

      const assignmentToUse = asgn?.assignment_id || saved?.assignmentId || null
      if (asgn?.assignment_id && !asgn.started_at) {
        await supabase.from('judge_assignments')
          .update({ started_at: new Date().toISOString() })
          .eq('assignment_id', asgn.assignment_id)
      }

      setAssignmentId(assignmentToUse)

      if (saved && saved.assignmentId === assignmentToUse) {
        setQueue(saved.queue?.length ? saved.queue : freshQueue)
        setQIndex(typeof saved.qIndex === 'number' ? saved.qIndex : 0)
        setPassed(Array.isArray(saved.passed) ? saved.passed : [false, false, false])
        setPersonStarted(Boolean(saved.personStarted))
        setLastResult(saved.lastResult ?? null)
        setAllDone(Boolean(saved.allDone))
        setPersonBudgetStartMs(saved.personBudgetStartMs ?? null)

        if (saved.personBudgetStartMs && saved.personStarted && !saved.allDone) {
          // คำนวณเวลาที่เหลือใหม่จากเวลาเซิร์ฟเวอร์จริง (กันปัญหาเวลา "ฟรี" ถ้ารีเฟรช/หลุดสัญญาณ
          // ระหว่างนับถอยหลัง — เดิมฐานนี้ดึงตัวเลขวินาทีที่บันทึกไว้ล่าสุดมาใช้ตรงๆ โดยไม่คำนวณ
          // เวลาที่หายไประหว่างหลุดการเชื่อมต่อ ทำให้ผู้แข่งขันได้เวลาเพิ่มฟรีๆ ไม่ยุติธรรมกับทีมอื่น)
          const nowMs = await getServerTimeMs()
          const elapsed = Math.max(0, Math.round((nowMs - saved.personBudgetStartMs) / 1000))
          setTimeLeft(Math.max(0, BUDGET - elapsed))
          setTimerOn(elapsed < BUDGET)
        } else {
          setTimeLeft(typeof saved.timeLeft === 'number' ? saved.timeLeft : BUDGET)
          setTimerOn(Boolean(saved.timerOn))
        }
      } else {
        setQueue(freshQueue)
        setQIndex(0)
        setPassed([false, false, false])
        setTimeLeft(BUDGET)
        setTimerOn(false)
        setPersonStarted(false)
        setLastResult(null)
        setAllDone(false)
        setPersonBudgetStartMs(null)
      }
      hydratedRef.current = true
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
  useEffect(() => {
    if (!hydratedRef.current || !progressKeyRef.current || !assignmentId) return
    saveStationProgress(progressKeyRef.current, {
      assignmentId,
      teamId,
      judgeId,
      stationType: 'ALGORITHM',
      queue,
      qIndex,
      passed,
      timeLeft,
      timerOn,
      personStarted,
      lastResult,
      allDone,
      personBudgetStartMs,
    })
  }, [assignmentId, queue, qIndex, passed, timeLeft, timerOn, personStarted, lastResult, allDone, teamId, judgeId, personBudgetStartMs])

  // ─── นาฬิกางบเวลารวม 45 วิ ───
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
  function sendSync() {
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
  }
  useEffect(() => {
    sendSync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, qIndex, timeLeft, lastResult, allDone, questions, personStarted, teamOffset])

  // ─── ส่งสัญญาณซ้ำเป็นระยะ (heartbeat) — กันจอผู้แข่งขันค้าง ───
  // เหตุผลเดียวกับฐาน ECG: broadcast เป็นแบบ "ยิงแล้วจบ" ถ้าผู้แข่งขันรีเฟรชตอนระบบหยุดนิ่ง
  // (เช่น ยังไม่กดเริ่มคนถัดไป) จะไม่มี sync ใหม่ส่งไปจนกว่ากรรมการจะขยับ — ส่งซ้ำทุก 3 วิ กันค้าง
  const sendSyncRef = useRef(sendSync)
  useEffect(() => { sendSyncRef.current = sendSync })
  useEffect(() => {
    const heartbeat = setInterval(() => sendSyncRef.current(), 3000)
    return () => clearInterval(heartbeat)
  }, [])

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
    const nowMs = await getServerTimeMs()
    setQIndex(0)
    setPassed([false, false, false])
    setTimeLeft(BUDGET)
    setPersonBudgetStartMs(nowMs)
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
          await finalizeStationResult('ALGORITHM', eventId)
          clearStationProgress(progressKeyRef.current)
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

  // ─── หมดเวลา → บันทึกลงประวัติเป็น 'timeout' ก่อน แล้วกลับไปต่อคิวใหม่ เริ่มข้อ 1 ───
  // (เดิมไม่บันทึกอะไรเลยตอนหมดเวลา ทำให้ Audit Trail ไม่มีหลักฐาน และจำนวนสอบซ้ำที่ใช้ตัดสิน
  //  เสมอกัน (tie-breaker) นับต่ำกว่าความจริงถ้าทีมเจอหมดเวลาล้วนๆ โดยไม่เคยตอบผิด)
  async function handleTimeout() {
    if (activeIdx < 0 || !activePerson) return
    setLastResult('timeout')
    const { error: timeoutErr } = await supabase.from('attempts').insert({
      participant_id:   activePerson.participant_id,
      assignment_id:    assignmentId,
      station_type:     'ALGORITHM',
      question_id:      currentQ?.question_id,
      question_number:  qIndex + 1,
      result:           'timeout',
      judged_by:        null,
    })
    if (timeoutErr) {
      // แจ้งเตือนให้เห็นทันที (ไม่บล็อกคิว) — ถ้าเงียบไปเฉยๆ จะไม่รู้เลยว่าบันทึกไม่ลง
      console.error('[JudgeAlgo] บันทึก timeout ไม่สำเร็จ:', timeoutErr)
      alert(`⚠ บันทึกประวัติ "หมดเวลา" ไม่สำเร็จ: ${timeoutErr.message}\n\nคิวจะเดินต่อตามปกติ แต่กรุณาแจ้งผู้ดูแลระบบเพื่อตรวจสอบ (อาจเป็นเพราะฐานข้อมูลยังไม่รองรับค่า "timeout" ในคอลัมน์ result)`)
    }
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
    setPersonBudgetStartMs(null)
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
            ฐาน Algorithm · คน {activeIdx + 1}/5 · งบเวลารวม 45 วิ / 3 ข้อ{judgeName && <> · กรรมการ: {judgeName}</>}
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
            {startGuard.busy ? 'กำลังเริ่ม...' : '▶️ เริ่ม (งบเวลา 45 วิ / 3 ข้อ)'}
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
          <div className="timer-label">เวลาคงเหลือ (งบรวม 45 วิ / 3 ข้อ)</div>
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
        ✅ ตอบผิด → ทำข้อเดิมซ้ำได้ ตราบใดที่งบเวลา 45 วิยังไม่หมด<br/>
        ✅ งบเวลาหมดแล้วยังไม่ผ่านครบ 3 ข้อ → กลับไปต่อคิวใหม่ เริ่มข้อ 1 เมื่อถึงรอบ
      </p>
    </div>
  )
}
