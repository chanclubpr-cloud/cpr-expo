// src/screens/JudgeECG.jsx — v2: server timestamp + button guard

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getServerTimeMs } from '../lib/serverTime'
import { useButtonGuard } from '../lib/useButtonGuard'

const BUDGET = 30  // วินาทีรวมสำหรับ 3 ข้อ

export default function JudgeECG() {
  const judgeId = localStorage.getItem('judgeId')
  const teamId  = localStorage.getItem('teamId')

  const [queue,        setQueue]        = useState([])
  const [teamName,     setTeamName]     = useState('')
  const [questions,    setQuestions]    = useState([])
  const [teamElapsed,  setTeamElapsed]  = useState(0)   // เวลารวมทีม (แสดงผล)
  const [timeLeft,     setTimeLeft]     = useState(BUDGET) // งบเวลา 30 วิ ของคนนี้
  const [timerOn,      setTimerOn]      = useState(false)
  const [qIndex,       setQIndex]       = useState(0)
  const [passed,       setPassed]       = useState([false,false,false])
  const [allDone,      setAllDone]      = useState(false)
  const [assignmentId, setAssignmentId] = useState(null)
  const [teamStartedAt,setTeamStartedAt]= useState(null)  // server timestamp เริ่มทีม
  const [personBudgetStartMs, setPersonBudgetStartMs] = useState(null) // ms เมื่อเริ่มคนนี้

  const passGuard = useButtonGuard()
  const failGuard = useButtonGuard()
  const stopGuard = useButtonGuard()

  const teamDisplayRef  = useRef(null)
  const qTimerRef       = useRef(null)

  // ─── โหลดข้อมูล ───
  useEffect(() => {
    async function load() {
      const { data: team } = await supabase
        .from('teams').select('team_name').eq('team_id', teamId).single()
      setTeamName(team?.team_name || '')

      const { data: members } = await supabase
        .from('participants').select('*')
        .eq('team_id', teamId).eq('is_reserve', false).order('queue_order')
      if (members) {
        setQueue(members.map((m,i) => ({
          ...m, status: i===0?'active':'waiting', retryCount:0
        })))
      }

      const { data: qs } = await supabase
        .from('ecg_questions').select('*').eq('is_active',true).order('display_order')
      setQuestions(qs || [])

      const { data: asgn } = await supabase
        .from('judge_assignments').select('assignment_id,started_at')
        .eq('judge_id', judgeId).eq('team_id', teamId).eq('status','active').single()

      let startIso = asgn?.started_at
      if (!startIso && asgn?.assignment_id) {
        const { data: updated } = await supabase
          .from('judge_assignments')
          .update({ started_at: new Date().toISOString() })
          .eq('assignment_id', asgn.assignment_id)
          .select('started_at').single()
        startIso = updated?.started_at
      }
      setAssignmentId(asgn?.assignment_id)
      setTeamStartedAt(startIso)

      // บันทึก ms เริ่มต้นของคนแรก (ใช้ server time)
      const nowMs = await getServerTimeMs()
      setPersonBudgetStartMs(nowMs)
      setTimerOn(true)
    }
    load()
  }, [judgeId, teamId])

  // ─── นาฬิการวมทีม (แสดงผล) ───
  useEffect(() => {
    if (!teamStartedAt || allDone) return
    teamDisplayRef.current = setInterval(() => {
      setTeamElapsed(Math.round((Date.now() - new Date(teamStartedAt).getTime()) / 1000))
    }, 500)
    return () => clearInterval(teamDisplayRef.current)
  }, [teamStartedAt, allDone])

  // ─── นาฬิกา 30 วิ ของผู้แข่งขันคนปัจจุบัน ───
  useEffect(() => {
    if (!timerOn || allDone) return
    qTimerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(qTimerRef.current)
          setTimerOn(false)
          handleTimeout()
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(qTimerRef.current)
  }, [timerOn, allDone])

  function formatTime(sec) {
    const m = Math.floor(sec/60).toString().padStart(2,'0')
    const s = (sec%60).toString().padStart(2,'0')
    return `${m}:${s}`
  }

  // เวลาที่ใช้ในข้อนี้ (วินาที ตามเวลา server)
  async function getQuestionTime() {
    if (!personBudgetStartMs) return 0
    const nowMs = await getServerTimeMs()
    return Math.round((nowMs - personBudgetStartMs) / 1000)
  }

  const activeIdx    = queue.findIndex(p => p.status === 'active')
  const activePerson = queue[activeIdx]
  const currentQ     = questions[qIndex % Math.max(questions.length, 1)]

  // ─── หมดเวลา → กลับไปต่อคิวใหม่ เริ่มข้อ 1 ───
  function handleTimeout() {
    if (activeIdx < 0) return
    const next = [...queue]
    const rested = { ...next[activeIdx], status:'resting', retryCount: next[activeIdx].retryCount+1 }
    next.splice(activeIdx,1)
    next.push(rested)
    const nextIdx = next.findIndex(p => p.status==='waiting'||p.status==='resting')
    if (nextIdx >= 0) next[nextIdx] = { ...next[nextIdx], status:'active' }
    setQueue(next)
    resetForNextPerson()
  }

  async function resetForNextPerson() {
    setQIndex(0)
    setPassed([false,false,false])
    setTimeLeft(BUDGET)
    // บันทึก ms เริ่มต้นใหม่ด้วย server time
    const nowMs = await getServerTimeMs()
    setPersonBudgetStartMs(nowMs)
    setTimerOn(true)
  }

  // ─── กดหยุดเวลา (กรรมการกดเมื่อเห็นว่าเขียนเสร็จ) ───
  const handleStopTimer = useCallback(() => stopGuard.run(async () => {
    clearInterval(qTimerRef.current)
    setTimerOn(false)
  }), [stopGuard])

  // ─── กดผ่านข้อปัจจุบัน ───
  const handlePassQ = useCallback(() => passGuard.run(async () => {
    if (activeIdx < 0) return
    const timeUsed = await getQuestionTime()

    await supabase.from('attempts').insert({
      participant_id:   activePerson.participant_id,
      assignment_id:    assignmentId,
      station_type:     'ECG',
      question_id:      currentQ?.question_id,
      question_number:  qIndex + 1,
      result:           'pass',
      judged_by:        judgeId,
      time_used_seconds: timeUsed,
    })

    if (qIndex >= 2) {
      // ผ่านครบ 3 ข้อ
      const next = queue.map((p,i) => i===activeIdx ? {...p,status:'passed'} : p)
      const nextIdx = next.findIndex(p => p.status==='waiting'||p.status==='resting')
      if (nextIdx >= 0) next[nextIdx] = {...next[nextIdx], status:'active'}
      setQueue(next)
      if (next.every(p => p.status==='passed')) {
        clearInterval(teamDisplayRef.current)
        setAllDone(true)
        await supabase.from('judge_assignments')
          .update({status:'finished', finished_at: new Date().toISOString()})
          .eq('assignment_id', assignmentId)
      } else {
        await resetForNextPerson()
      }
    } else {
      setPassed(prev => { const n=[...prev]; n[qIndex]=true; return n })
      setQIndex(qIndex+1)
      setTimerOn(true)
    }
  }), [queue, qIndex, activeIdx, activePerson, currentQ, assignmentId, passGuard])

  // ─── กดไม่ผ่าน → ย้ายคิว เริ่มข้อ 1 ───
  const handleFailQ = useCallback(() => failGuard.run(async () => {
    if (activeIdx < 0) return
    const timeUsed = await getQuestionTime()
    await supabase.from('attempts').insert({
      participant_id:   activePerson.participant_id,
      assignment_id:    assignmentId,
      station_type:     'ECG',
      question_id:      currentQ?.question_id,
      question_number:  qIndex + 1,
      result:           'fail',
      judged_by:        judgeId,
      time_used_seconds: timeUsed,
    })
    handleTimeout()
  }), [queue, qIndex, activeIdx, activePerson, currentQ, assignmentId, failGuard])

  const timerDanger = timeLeft <= 8

  if (!questions.length) return (
    <div className="screen">
      <p style={{color:'var(--muted)',marginTop:24,fontFamily:'JetBrains Mono,monospace'}}>
        ยังไม่มีโจทย์ ECG — กรุณา Admin เพิ่มโจทย์ก่อน
      </p>
    </div>
  )

  return (
    <div className="screen">
      {/* หัว */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',
                   marginTop:20,marginBottom:18}}>
        <div>
          <div style={{fontSize:22,fontWeight:800}}>{teamName}</div>
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:12,color:'var(--muted)'}}>
            ฐาน ECG · คน {activeIdx+1}/5
          </div>
        </div>
        <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:20,fontWeight:700,color:'var(--muted)'}}>
          ⏱ {formatTime(teamElapsed)}
        </div>
      </div>

      {/* นาฬิกา 30 วิ */}
      {!allDone && (
        <div className="card" style={{textAlign:'center',marginBottom:14}}>
          <div className="timer-label">เวลาคงเหลือ (งบรวม 30 วิ / 3 ข้อ)</div>
          <div className={`timer-display${timerDanger?' danger':''}`}>
            {timeLeft}
          </div>

          {/* ความคืบหน้า 3 ข้อ */}
          <div style={{display:'flex',gap:8,marginTop:8,justifyContent:'center'}}>
            {[0,1,2].map(i => (
              <span key={i} className={`badge ${passed[i]?'badge-pass':'badge-wait'}`}
                style={{opacity: i<qIndex||passed[i] ? 1 : .4}}>
                {passed[i] ? `ข้อ ${i+1} ✓` : `ข้อ ${i+1}`}
              </span>
            ))}
          </div>

          {/* ปุ่มหยุดเวลา */}
          <button
            className="btn-stop-timer"
            disabled={!timerOn || stopGuard.busy}
            onClick={handleStopTimer}
            style={{marginTop:12, opacity: !timerOn ? .4 : 1}}
          >
            {stopGuard.busy ? 'กำลังหยุด...' : timerOn ? '⏹ หยุดเวลา (เขียนคำตอบเสร็จแล้ว)' : '✓ หยุดเวลาแล้ว — กำลังตรวจคำตอบ'}
          </button>
        </div>
      )}

      {/* ภาพโจทย์ + ปุ่มตัดสิน */}
      {!allDone && currentQ && (
        <div className="card">
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:11,
                       color:'var(--muted)',marginBottom:10}}>
            โจทย์: {currentQ.question_code} ({currentQ.media_type === 'video' ? '🎬 คลิป' : '🖼 ภาพ'})
          </div>
          {currentQ.media_type === 'video'
            ? <video src={currentQ.media_url} controls
                style={{width:'100%',borderRadius:8,maxHeight:220}} />
            : <img src={currentQ.media_url} alt="ECG"
                style={{width:'100%',borderRadius:8}} />
          }

          {/* Error */}
          {(passGuard.lastError || failGuard.lastError) && (
            <div style={{background:'rgba(255,77,94,.1)',border:'1px solid var(--alert)',
                         borderRadius:8,padding:'10px 14px',margin:'12px 0',
                         color:'var(--alert)',fontSize:13,fontFamily:'JetBrains Mono,monospace'}}>
              ⚠ {passGuard.lastError||failGuard.lastError} — กรุณาลองกดอีกครั้ง
            </div>
          )}

          <div className="btn-judge-row" style={{marginTop:14}}>
            <button className="btn-pass" onClick={handlePassQ}
              disabled={passGuard.busy||failGuard.busy||timerOn}
              style={{opacity:(passGuard.busy||failGuard.busy||timerOn)?.6:1}}>
              {passGuard.busy ? 'บันทึก...' : '✓ ผ่าน'}
            </button>
            <button className="btn-fail" onClick={handleFailQ}
              disabled={passGuard.busy||failGuard.busy||timerOn}
              style={{opacity:(passGuard.busy||failGuard.busy||timerOn)?.6:1}}>
              {failGuard.busy ? 'บันทึก...' : '✕ ไม่ผ่าน'}
            </button>
          </div>
          {timerOn && (
            <p style={{textAlign:'center',color:'var(--muted)',fontSize:12,
                        fontFamily:'JetBrains Mono,monospace',marginTop:10}}>
              กดหยุดเวลาก่อน จึงจะกดผ่าน/ไม่ผ่านได้
            </p>
          )}
        </div>
      )}

      {/* สำเร็จ */}
      {allDone && (
        <div className="card" style={{borderColor:'var(--ecg)',textAlign:'center',padding:28}}>
          <div style={{fontSize:48}}>🎉</div>
          <div style={{fontSize:24,fontWeight:800,color:'var(--ecg)'}}>ผ่านครบทุกคน!</div>
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:14,
                       color:'var(--muted)',marginTop:8}}>
            เวลารวมทีม: {formatTime(teamElapsed)}
          </div>
        </div>
      )}

      {/* รายชื่อ */}
      {queue.map(p => (
        <div key={p.participant_id} className={`participant-row ${p.status}`}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div className="p-name">{p.full_name}</div>
              <div className="p-sub">
                {p.status==='passed'  ? 'ผ่านแล้ว' :
                 p.status==='active'  ? `ข้อ ${qIndex+1}/3 · รอบ ${p.retryCount+1}` :
                 p.status==='resting' ? `พักคิว · ${p.retryCount} รอบ` : 'รอคิว'}
              </div>
            </div>
            <span className={`badge ${
              p.status==='passed'  ? 'badge-pass' :
              p.status==='resting' ? 'badge-resting' :
              p.status==='active'  ? 'badge-pass' : 'badge-wait'
            }`}>
              {p.status==='passed'  ? '✓ ผ่าน' :
               p.status==='resting' ? 'พักคิว 🔁' :
               p.status==='active'  ? 'กำลังสอบ' : 'รอ'}
            </span>
          </div>
        </div>
      ))}

      <p className="note">
        ✅ ปุ่มผ่าน/ไม่ผ่านจะกดได้หลังจากกดหยุดเวลาแล้วเท่านั้น<br/>
        ✅ ระหว่างกดปุ่มจะขึ้น "บันทึก..." — ไม่ต้องกดซ้ำ<br/>
        ✅ เวลาอ้างอิงจาก server กลาง ยุติธรรมทุกเครื่อง
      </p>
    </div>
  )
}
