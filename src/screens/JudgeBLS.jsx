// src/screens/JudgeBLS.jsx
// ============================================================
// v6: สอบตามเวลามาตรฐาน 2 นาทีต่อคน (fixed exam duration)
//
// ลำดับ: กด "▶️ เริ่ม" → นับถอยหลัง 2 นาที (ผู้แข่งขันปฏิบัติ CPR)
//        → ครบเวลา หน้ากรอกคะแนนขึ้นมาเอง → กรอกคะแนน → ระบบแจ้งผล
//        → กด "ยืนยันส่งคะแนน" → บันทึก → กรรมการเซ็ตหุ่นใหม่
//        → พร้อมแล้วกด "▶️ เริ่ม" ให้คนถัดไป
//
// เพราะเวลาสอบตายตัวเท่ากันทุกครั้ง (2 นาที) จึงไม่ใช้เวลาเป็นตัวช่วย
// จัดอันดับอีกต่อไป (ตัดสินด้วยจำนวนรอบ + คะแนนเฉลี่ย + จำนวนสอบซ้ำเท่านั้น
// — ถ้าเสมอกันทั้ง 3 เกณฑ์ ถือเป็นอันดับร่วมกัน)
// ============================================================

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useButtonGuard } from '../lib/useButtonGuard'
import { finalizeStationResult } from '../lib/scoring'

const PASS_THRESHOLD = 98
const EXAM_SECONDS    = 120 // 2 นาทีต่อคน (มาตรฐานการสอบ BLS)

export default function JudgeBLS({ teamId: teamIdProp, judgeId: judgeIdProp } = {}) {
  // รับค่าผ่าน prop โดยตรงก่อนเสมอ (แต่ละแท็บแยกหน่วยความจำกัน ไม่ชนกัน)
  // localStorage เป็นแค่ทางสำรอง เผื่อเปิดหน้านี้ตรงๆ โดยไม่ผ่าน AutoJudgeGate
  const judgeId = judgeIdProp || localStorage.getItem('judgeId')
  const teamId  = teamIdProp  || localStorage.getItem('teamId')

  async function leaveTeam() {
    if (!confirm('ยืนยันรีเซ็ตฐานนี้ — ข้อมูลคิวปัจจุบันจะเริ่มใหม่')) return
    if (assignmentId) await supabase.from('judge_assignments').delete().eq('assignment_id', assignmentId)
    window.location.reload()
  }

  const [queue,        setQueue]        = useState([])
  const [teamName,     setTeamName]     = useState('')
  const [assignmentId, setAssignmentId] = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [allPassed,    setAllPassed]    = useState(false)

  // phase: 'idle' (รอกดเริ่ม) | 'counting' (กำลังนับถอยหลัง 2 นาที) | 'scoring' (ครบเวลาแล้ว กรอกคะแนนได้)
  const [phase, setPhase] = useState('idle')
  const [timeLeft, setTimeLeft] = useState(EXAM_SECONDS)
  const timerRef = useRef(null)

  const [scoreInput, setScoreInput] = useState('')
  const [confirming, setConfirming] = useState(false)

  const startGuard  = useButtonGuard()
  const submitGuard = useButtonGuard()

  useEffect(() => {
    async function load() {
      const { data: team } = await supabase
        .from('teams').select('team_name').eq('team_id', teamId).single()
      setTeamName(team?.team_name || '')

      const { data: members } = await supabase
        .from('participants').select('*')
        .eq('team_id', teamId).eq('is_reserve', false).order('queue_order')

      const { data: asgn } = await supabase
        .from('judge_assignments').select('assignment_id, started_at')
        .eq('judge_id', judgeId).eq('team_id', teamId).eq('status', 'active').single()

      if (asgn?.assignment_id && !asgn.started_at) {
        await supabase.from('judge_assignments')
          .update({ started_at: new Date().toISOString() })
          .eq('assignment_id', asgn.assignment_id)
      }
      setAssignmentId(asgn?.assignment_id)

      if (members) {
        setQueue(members.map((m, i) => ({
          ...m, status: i === 0 ? 'active' : 'waiting', retryCount: 0,
        })))
      }
      setLoading(false)
    }
    load()
  }, [judgeId, teamId])

  // นับถอยหลัง — เมื่อครบเวลาจะสลับไปหน้ากรอกคะแนนเองอัตโนมัติ
  useEffect(() => {
    if (phase !== 'counting') return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current)
          setPhase('scoring')
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [phase])

  function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0')
    const s = (sec % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const activeIdx    = queue.findIndex(p => p.status === 'active')
  const activePerson = queue[activeIdx]

  const numericScore = scoreInput === '' ? null : Number(scoreInput)
  const previewResult = numericScore == null ? null : (numericScore >= PASS_THRESHOLD ? 'pass' : 'fail')

  function handleScoreChange(v) {
    if (v === '' || (/^\d{0,3}(\.\d{0,2})?$/.test(v) && Number(v) <= 100)) {
      setScoreInput(v)
      setConfirming(false)
    }
  }

  // ─── กด "▶️ เริ่ม" → เริ่มนับถอยหลัง 2 นาที ───
  const handleStart = useCallback(() => startGuard.run(async () => {
    setTimeLeft(EXAM_SECONDS)
    setPhase('counting')
  }), [startGuard])

  async function finishStation() {
    setAllPassed(true)
    await supabase.from('judge_assignments')
      .update({ status: 'finished', finished_at: new Date().toISOString() })
      .eq('assignment_id', assignmentId)
    await finalizeStationResult('BLS')
  }

  // ─── กด "ยืนยันส่งคะแนน" ───
  const handleConfirmSend = useCallback(() => submitGuard.run(async () => {
    if (activeIdx < 0 || numericScore == null) return
    const result = previewResult

    await supabase.from('attempts').insert({
      participant_id: activePerson.participant_id,
      assignment_id: assignmentId,
      station_type: 'BLS',
      result,
      score: numericScore,
      judged_by: judgeId,
      time_used_seconds: EXAM_SECONDS, // เวลาสอบตายตัว ไม่ใช้ตัดสินอันดับ เก็บไว้อ้างอิงเฉยๆ
    })

    if (result === 'pass') {
      const next = queue.map((p, i) => i === activeIdx ? { ...p, status: 'passed' } : p)
      const nextWaiting = next.findIndex(p => p.status === 'waiting' || p.status === 'resting')
      if (nextWaiting >= 0) next[nextWaiting] = { ...next[nextWaiting], status: 'active' }
      setQueue(next)
      setScoreInput(''); setConfirming(false); setPhase('idle')
      if (next.every(p => p.status === 'passed')) await finishStation()
    } else {
      const next = [...queue]
      const rested = { ...next[activeIdx], status: 'resting', retryCount: next[activeIdx].retryCount + 1 }
      next.splice(activeIdx, 1)
      next.push(rested)
      const nextIdx = next.findIndex(p => p.status === 'waiting' || p.status === 'resting')
      if (nextIdx >= 0) next[nextIdx] = { ...next[nextIdx], status: 'active' }
      setQueue(next)
      setScoreInput(''); setConfirming(false); setPhase('idle')
    }
  }), [queue, activeIdx, activePerson, numericScore, previewResult, submitGuard, assignmentId, judgeId])

  async function handleCorrect(participantId, newScore) {
    const result = newScore >= PASS_THRESHOLD ? 'pass' : 'fail'
    await supabase.from('attempts').insert({
      participant_id: participantId, assignment_id: assignmentId,
      station_type: 'BLS', result, score: newScore, judged_by: judgeId, time_used_seconds: EXAM_SECONDS,
    })
    setQueue(prev => prev.map(p => {
      if (p.participant_id !== participantId) return p
      return { ...p, status: result === 'pass' ? 'passed' : 'resting',
               retryCount: result === 'pass' ? p.retryCount : p.retryCount + 1 }
    }))
  }

  const statusBadge = {
    active:  <span className="badge badge-pass">กำลังสอบ</span>,
    passed:  <span className="badge badge-pass">✓ ผ่าน</span>,
    resting: <span className="badge badge-resting">พักคิว 🔁</span>,
    waiting: <span className="badge badge-wait">รอ</span>,
  }

  const timerDanger = timeLeft <= 15

  if (loading) return <div className="screen"><p style={{color:'var(--muted)',marginTop:24,fontFamily:'JetBrains Mono,monospace'}}>กำลังโหลด...</p></div>

  return (
    <div className="screen">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:20, marginBottom:18 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:800 }}>{teamName}</div>
          <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:12, color:'var(--muted)' }}>
            ฐาน BLS · สอบคนละ {EXAM_SECONDS / 60} นาที · เกณฑ์ผ่าน ≥ {PASS_THRESHOLD} คะแนน
          </div>
        </div>
        <button onClick={leaveTeam} style={{
          fontFamily:'JetBrains Mono,monospace', fontSize:11, background:'none',
          border:'1px solid var(--line)', color:'var(--muted)', borderRadius:6,
          padding:'6px 10px', cursor:'pointer',
        }}>🔄 รีเซ็ตฐานนี้</button>
      </div>

      {activePerson && !allPassed && (
        <div className="card" style={{ borderColor:'var(--ecg-dim)', marginBottom:16 }}>
          <div className="p-name" style={{ marginBottom:6 }}>{activePerson.full_name}</div>
          <div className="p-sub" style={{ marginBottom:14 }}>
            สอบซ้ำ {activePerson.retryCount} ครั้ง — คนที่ {activeIdx + 1}/5
          </div>

          {/* phase: idle — รอกดเริ่ม */}
          {phase === 'idle' && (
            <button onClick={handleStart} disabled={startGuard.busy} style={{
              width:'100%', padding:18, borderRadius:12, border:'none',
              background:'var(--ecg)', color:'#04170D', fontFamily:'Sarabun,sans-serif',
              fontWeight:800, fontSize:20, cursor:'pointer', opacity: startGuard.busy ? .6 : 1,
            }}>
              {startGuard.busy ? 'กำลังเริ่ม...' : '▶️ เริ่ม (สอบ 2 นาที)'}
            </button>
          )}

          {/* phase: counting — นับถอยหลัง 2 นาที ยังกรอกคะแนนไม่ได้ */}
          {phase === 'counting' && (
            <div style={{ textAlign:'center' }}>
              <div className="timer-label">กำลังปฏิบัติ CPR — เวลาคงเหลือ</div>
              <div className={`timer-display${timerDanger ? ' danger' : ''}`} style={{ fontSize: 56 }}>
                {formatTime(timeLeft)}
              </div>
              <p style={{ color:'var(--muted)', fontSize:12, fontFamily:'JetBrains Mono,monospace', marginTop:10 }}>
                ครบเวลาแล้วหน้ากรอกคะแนนจะขึ้นเองอัตโนมัติ
              </p>
            </div>
          )}

          {/* phase: scoring — ครบเวลาแล้ว กรอกคะแนนได้ */}
          {phase === 'scoring' && (
            <>
              <label style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'var(--muted)', display:'block', marginBottom:8 }}>
                ⏰ ครบเวลาแล้ว — กรอกคะแนนจากหุ่น (0-100)
              </label>
              <input
                type="text" inputMode="decimal" value={scoreInput}
                onChange={e => handleScoreChange(e.target.value)}
                placeholder="เช่น 99"
                style={{ fontSize: 32, fontWeight: 800, textAlign: 'center', padding: '16px', fontFamily: 'JetBrains Mono,monospace' }}
              />

              {previewResult && (
                <div style={{
                  textAlign:'center', marginTop:14, padding:'12px', borderRadius:10,
                  background: previewResult === 'pass' ? 'rgba(51,255,156,.12)' : 'rgba(255,77,94,.1)',
                  border: `1.5px solid ${previewResult === 'pass' ? 'var(--ecg)' : 'var(--alert)'}`,
                }}>
                  <span style={{
                    fontFamily:'Sarabun,sans-serif', fontWeight:800, fontSize:20,
                    color: previewResult === 'pass' ? 'var(--ecg)' : 'var(--alert)',
                  }}>
                    {previewResult === 'pass' ? '✓ ผ่าน' : '✕ ไม่ผ่าน'}
                  </span>
                </div>
              )}

              {previewResult && !confirming && (
                <button className="btn-primary" style={{ marginTop:14 }} onClick={() => setConfirming(true)}>
                  ยืนยันส่งคะแนน {scoreInput}
                </button>
              )}
              {previewResult && confirming && (
                <div style={{ marginTop:14 }}>
                  <p style={{ textAlign:'center', color:'var(--muted)', fontSize:13, marginBottom:10, fontFamily:'JetBrains Mono,monospace' }}>
                    ยืนยันส่งคะแนน {scoreInput} ({previewResult === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน'}) ใช่หรือไม่?
                  </p>
                  <div style={{ display:'flex', gap:10 }}>
                    <button className="btn-primary" style={{ flex:1 }} onClick={handleConfirmSend} disabled={submitGuard.busy}>
                      {submitGuard.busy ? 'กำลังส่ง...' : '✓ ใช่ ส่งคะแนน'}
                    </button>
                    <button style={{
                      flex:1, padding:16, borderRadius:10, border:'1px solid var(--line)',
                      background:'none', color:'var(--muted)', fontFamily:'Sarabun,sans-serif',
                      fontWeight:700, fontSize:15, cursor:'pointer',
                    }} onClick={() => setConfirming(false)}>ยกเลิก</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {allPassed && (
        <div className="card" style={{ borderColor:'var(--ecg)', textAlign:'center', padding:28 }}>
          <div style={{ fontSize:48, marginBottom:8 }}>🎉</div>
          <div style={{ fontSize:24, fontWeight:800, color:'var(--ecg)' }}>ผ่านครบทุกคน!</div>
        </div>
      )}

      <div style={{ marginTop:8 }}>
        {queue.map(p => (
          <div key={p.participant_id} className={`participant-row ${p.status}`}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div className="p-name">{p.full_name}</div>
                <div className="p-sub">
                  {p.status === 'resting' ? `สอบซ้ำ ${p.retryCount} ครั้ง` :
                   p.status === 'passed'  ? 'ผ่านแล้ว' :
                   p.status === 'active'  ? (phase === 'counting' ? 'กำลังสอบ (นับถอยหลัง)' : phase === 'scoring' ? 'รอกรอกคะแนน' : 'รอกดเริ่ม') : 'รอคิว'}
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
                {statusBadge[p.status]}
                {(p.status === 'passed' || p.status === 'resting') && (
                  <EditResult onCorrect={(newScore) => handleCorrect(p.participant_id, newScore)} />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="note">
        ✅ กด "เริ่ม" → นับถอยหลัง 2 นาทีอัตโนมัติ → ครบเวลาแล้วหน้ากรอกคะแนนขึ้นเอง<br/>
        ✅ ระหว่างรอ สามารถเซ็ตหุ่นให้พร้อมสำหรับคนถัดไปได้เลย<br/>
        ✅ อันดับทีมตัดสินจาก จำนวนรอบ → คะแนนเฉลี่ย → จำนวนสอบซ้ำ (เสมอกันทั้ง 3 ข้อ = อันดับร่วม)
      </p>
    </div>
  )
}

function EditResult({ onCorrect }) {
  const [open, setOpen] = useState(false)
  const [val, setVal]   = useState('')
  const guard = useButtonGuard()
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        style={{fontFamily:'JetBrains Mono,monospace',fontSize:11,
                background:'none',border:'1px solid var(--line)',color:'var(--muted)',
                borderRadius:5,padding:'4px 8px',cursor:'pointer'}}>
        แก้ไขผล
      </button>
      {open && (
        <div style={{display:'flex',gap:6,marginTop:6, alignItems:'center'}}>
          <input type="text" inputMode="decimal" value={val} onChange={e => setVal(e.target.value)}
            placeholder="คะแนนใหม่" style={{ width:80, padding:'6px 8px', fontSize:13 }} />
          <button className="btn-pass"
            style={{flex:'none',padding:'8px 14px',fontSize:13, opacity:guard.busy?.6:1}}
            disabled={guard.busy || val === ''}
            onClick={() => guard.run(async () => { await onCorrect(Number(val)); setOpen(false); setVal('') })}>
            {guard.busy ? '...' : 'ส่ง'}
          </button>
        </div>
      )}
    </div>
  )
}
