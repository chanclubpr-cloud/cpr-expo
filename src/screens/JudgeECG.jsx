// src/screens/JudgeECG.jsx — v2: server timestamp + button guard

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getServerTimeMs } from '../lib/serverTime'
import { useButtonGuard } from '../lib/useButtonGuard'
import { finalizeStationResult } from '../lib/scoring'

const BUDGET = 30  // วินาทีรวมสำหรับ 3 ข้อ

export default function JudgeECG() {
  const judgeId = localStorage.getItem('judgeId')
  const teamId  = localStorage.getItem('teamId')

  async function leaveTeam() {
    if (!confirm('ยืนยันรีเซ็ตฐานนี้ — ข้อมูลคิวปัจจุบันจะเริ่มใหม่')) return
    if (assignmentId) await supabase.from('judge_assignments').delete().eq('assignment_id', assignmentId)
    window.location.reload()
  }

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
  const [needsRestart, setNeedsRestart] = useState(false) // true = รอกรรมการกดเริ่มข้อถัดไป/สอบซ้ำ
  const [restartLabel, setRestartLabel] = useState('')
  const [teamOffset,   setTeamOffset]   = useState(0) // ใช้หมุนลำดับชุดโจทย์ (Latin Square) — ทีมนี้เริ่มที่ชุดไหน

  const passGuard = useButtonGuard()
  const failGuard = useButtonGuard()
  const stopGuard = useButtonGuard()

  const teamDisplayRef  = useRef(null)
  const qTimerRef       = useRef(null)
  const channelRef      = useRef(null)

  // ─── โหลดข้อมูล ───
  useEffect(() => {
    async function load() {
      const { data: team } = await supabase
        .from('teams').select('team_name').eq('team_id', teamId).single()
      setTeamName(team?.team_name || '')

      // ดึงเลขเครื่องของทีมนี้ เพื่อคำนวณว่าทีมนี้ควรเริ่มที่ "ชุดโจทย์" ไหน (Latin Square rotation)
      const { data: device } = await supabase
        .from('device_assignments').select('device_number').eq('team_id', teamId).maybeSingle()
      setTeamOffset(device?.device_number ? (device.device_number - 1) % 5 : 0)

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
      // ไม่เริ่มนาฬิกาอัตโนมัติแล้ว — รอกรรมการกด "▶️ เริ่ม" เองต่อคน
    }
    load()

    // เปิดช่องสัญญาณส่งข้อมูลไปให้จอผู้แข่งขัน (ก่อนหน้านี้ไม่เคยสร้างช่องนี้เลย — คือบั๊กที่แก้ตอนนี้)
    const channel = supabase.channel(`ecg-${teamId}`)
    channel.subscribe()
    channelRef.current = channel
    return () => supabase.removeChannel(channel)
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

  // ─── คำนวณว่าคนนี้ควรได้ทำ "ชุดโจทย์" ไหน (0-4) ───
  // สูตร: (ลำดับคิวของคน - 1 + ค่าหมุนของทีม) % 5
  // ทำให้แต่ละทีมเจอชุดคนละลำดับ แต่ทุกคนจะได้ผ่านครบทั้ง 5 ชุดในที่สุด (เท่าเทียมกัน)
  const personSetIndex = activePerson
    ? ((activePerson.queue_order - 1 + teamOffset) % 5)
    : 0
  // กรองเฉพาะ 3 ข้อของชุดนี้ (ง่าย-ปานกลาง-ยาก เรียงตาม display_order)
  const personQuestions = questions
    .filter(q => Math.floor(((q.display_order || 1) - 1) / 3) === personSetIndex)
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
  const currentQ = personQuestions[qIndex] || null

  // ─── ส่งสถานะปัจจุบันให้จอผู้แข่งขันทุกครั้งที่มีการเปลี่ยนแปลง ───
  useEffect(() => {
    if (!channelRef.current) return
    channelRef.current.send({
      type: 'broadcast',
      event: 'sync',
      payload: {
        participantName: activePerson?.full_name || '',
        questionIndex: qIndex,
        question: currentQ ? {
          media_type: currentQ.media_type,
          media_url: currentQ.media_url,
        } : null,
        timeLeft,
        done: allDone,
        waiting: personBudgetStartMs === null || needsRestart, // true = ยังไม่กด "เริ่ม" / กำลังตรวจคำตอบ / รอเริ่มข้อถัดไป
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePerson, qIndex, currentQ, timeLeft, allDone, personBudgetStartMs, needsRestart])

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
    setPersonBudgetStartMs(null)
    setNeedsRestart(false)
    setTimerOn(false) // รอกรรมการกด "▶️ เริ่ม" เองต่อคน ไม่เริ่มอัตโนมัติ
  }

  // ─── กรรมการกด "▶️ เริ่ม" ให้คนปัจจุบัน ───
  const startGuard = useButtonGuard()
  const handlePersonStart = useCallback(() => startGuard.run(async () => {
    const nowMs = await getServerTimeMs()
    setPersonBudgetStartMs(nowMs)
    setTimeLeft(BUDGET)
    setTimerOn(true)
  }), [startGuard])

  // ─── กรรมการกด "▶️ เริ่มข้อถัดไป/เริ่มสอบซ้ำ" (ให้เวลาผู้แข่งขันตั้งหลักก่อนเขียน) ───
  const restartGuard = useButtonGuard()
  const handleRestartQuestion = useCallback(() => restartGuard.run(async () => {
    setNeedsRestart(false)
    setTimerOn(true) // เวลาที่เหลือจากงบ 30 วิ เดินต่อจากเดิม ไม่รีเซ็ตใหม่
  }), [restartGuard])

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
        await finalizeStationResult('ECG')
      } else {
        await resetForNextPerson()
      }
    } else {
      setPassed(prev => { const n=[...prev]; n[qIndex]=true; return n })
      setQIndex(qIndex+1)
      setNeedsRestart(true)
      setRestartLabel('▶️ เริ่มข้อถัดไป')
    }
  }), [queue, qIndex, activeIdx, activePerson, currentQ, assignmentId, passGuard])

  // ─── กดไม่ผ่าน → ทำข้อเดิมซ้ำ (ตราบใดที่เวลายังไม่หมด) ───
  // เปลี่ยนจากเดิมที่ "ตอบผิด = กลับไปต่อคิวทันที" เป็น
  // "ตอบผิด = ทำข้อเดิมซ้ำได้เรื่อยๆ จนกว่าจะผ่านหรือเวลาหมด"
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
    // นับจำนวนครั้งสอบซ้ำของคนนี้เพิ่ม (ยังคง active อยู่ที่ข้อเดิม)
    setQueue(prev => prev.map((p, i) => i === activeIdx ? { ...p, retryCount: p.retryCount + 1 } : p))
    setNeedsRestart(true)
    setRestartLabel('▶️ เริ่มสอบซ้ำ (ข้อเดิม)')
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
    <div className="screen-wide">
      {/* หัว */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',
                   marginTop:20,marginBottom:18}}>
        <div>
          <div style={{fontSize:22,fontWeight:800}}>{teamName}</div>
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:12,color:'var(--muted)'}}>
            ฐาน ECG · คน {activeIdx+1}/5
          </div>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:14}}>
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:20,fontWeight:700,color:'var(--muted)'}}>
            ⏱ {formatTime(teamElapsed)}
          </div>
          <button onClick={leaveTeam} style={{
            fontFamily:'JetBrains Mono,monospace', fontSize:11, background:'none',
            border:'1px solid var(--line)', color:'var(--muted)', borderRadius:6,
            padding:'6px 10px', cursor:'pointer',
          }}>🔄 รีเซ็ตฐานนี้</button>
        </div>
      </div>

      <div className="judge-split">
      <div>
      {/* รอกรรมการกด "▶️ เริ่ม" ก่อนนาฬิกาจะเดิน */}
      {!allDone && personBudgetStartMs === null && (
        <div className="card" style={{ textAlign:'center', marginBottom:14 }}>
          <div className="p-name" style={{ marginBottom:14 }}>{activePerson?.full_name}</div>
          <button
            onClick={handlePersonStart}
            disabled={startGuard.busy}
            style={{
              width:'100%', padding:18, borderRadius:12, border:'none',
              background:'var(--ecg)', color:'#04170D', fontFamily:'Sarabun,sans-serif',
              fontWeight:800, fontSize:20, cursor:'pointer', opacity: startGuard.busy ? .6 : 1,
            }}
          >
            {startGuard.busy ? 'กำลังเริ่ม...' : '▶️ เริ่ม (งบเวลา 30 วิ / 3 ข้อ)'}
          </button>
        </div>
      )}

      {/* รอกรรมการกด "▶️ เริ่มข้อถัดไป/เริ่มสอบซ้ำ" — ให้เวลาผู้แข่งขันตั้งหลักก่อนเขียน */}
      {!allDone && personBudgetStartMs !== null && needsRestart && (
        <div className="card" style={{ textAlign:'center', marginBottom:14, borderColor:'var(--amber)' }}>
          <div className="p-name" style={{ marginBottom:6 }}>{activePerson?.full_name}</div>
          <div className="p-sub" style={{ marginBottom:14 }}>
            เวลาคงเหลือ {timeLeft} วิ — พักไว้ชั่วคราว ไม่หักเวลา
          </div>
          <button
            onClick={handleRestartQuestion}
            disabled={restartGuard.busy}
            style={{
              width:'100%', padding:18, borderRadius:12, border:'none',
              background:'var(--ecg)', color:'#04170D', fontFamily:'Sarabun,sans-serif',
              fontWeight:800, fontSize:20, cursor:'pointer', opacity: restartGuard.busy ? .6 : 1,
            }}
          >
            {restartGuard.busy ? 'กำลังเริ่ม...' : restartLabel}
          </button>
        </div>
      )}

      {/* นาฬิกา 30 วิ */}
      {!allDone && personBudgetStartMs !== null && !needsRestart && (
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
      {!allDone && personBudgetStartMs !== null && !needsRestart && currentQ && (
        <div className="card">
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:11,
                       color:'var(--muted)',marginBottom:10}}>
            โจทย์: {currentQ.question_code} ({currentQ.media_type === 'video' ? '🎬 คลิป' : '🖼 ภาพ'})
          </div>
          {currentQ.media_type === 'video'
            ? <video key={currentQ.question_id} src={currentQ.media_url} controls autoPlay playsInline
                style={{width:'100%',borderRadius:8,maxHeight:220}} />
            : <img src={currentQ.media_url} alt="ECG"
                style={{width:'100%',borderRadius:8}} />
          }

          {/* เฉลย — สำหรับกรรมการอ้างอิงเทียบกับคำตอบที่ผู้แข่งขันเขียน (ผู้แข่งขันมองไม่เห็นส่วนนี้) */}
          {currentQ.answer_key && (
            <div style={{
              marginTop:12, padding:'10px 14px', borderRadius:8,
              background:'rgba(255,176,32,.08)', border:'1px solid var(--amber)',
            }}>
              <div style={{fontFamily:'JetBrains Mono,monospace', fontSize:10, color:'var(--amber)', marginBottom:4, letterSpacing:'.05em'}}>
                🔑 เฉลย (กรรมการเท่านั้น)
              </div>
              <div style={{fontSize:14, color:'var(--text)'}}>{currentQ.answer_key}</div>
            </div>
          )}

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
      </div>

      <div>
        <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:11,color:'var(--muted)',
                     marginBottom:10, letterSpacing:'.06em'}}>
          ลำดับผู้เข้าแข่งขัน
        </div>
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
      </div>
      </div>

      <p className="note">
        ✅ กดผ่าน/ไม่ผ่าน → ต้องกด "▶️ เริ่มข้อถัดไป/เริ่มสอบซ้ำ" อีกครั้งก่อนเวลาจะเดินต่อ (ให้เวลาตั้งหลัก)<br/>
        ✅ ช่วงที่รอกดเริ่ม เวลาจะหยุดนิ่ง ไม่ถูกหักจากงบ 30 วิ<br/>
        ✅ เวลาหมดแล้วยังไม่ผ่าน → กลับไปต่อคิวใหม่ เริ่มข้อ 1 เมื่อถึงรอบ
      </p>
    </div>
  )
}
