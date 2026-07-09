// src/screens/AutoJudgeGate.jsx
// ============================================================
// แทนที่หน้า Login เดิมทั้งหมด — กรรมการไม่ต้องเลือกชื่อ/ทีมเองอีกต่อไป
//
// หลักการ: Admin ผูก "เลขเครื่อง" กับ "ทีม + กรรมการ" ไว้ล่วงหน้า
// เครื่องนี้แค่เปิด URL /judge?device=3 ค้างไว้ทั้งวัน
// แล้วระบบจะ:
//   1) อ่านเลขเครื่องจาก URL
//   2) ไปถามฐานข้อมูลว่า "เครื่อง 3 = ทีมไหน กรรมการคนไหน"
//   3) ฟัง Master ว่าตอนนี้แข่งฐานอะไร (active_station)
//   4) สลับไปแสดงหน้าจอ BLS/ECG/Algorithm ของทีมนั้นให้อัตโนมัติ
//   5) สร้าง judge_assignment ให้เองถ้ายังไม่มี (ไม่ต้องกดเลือกทีม)
// ============================================================

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import JudgeBLS  from './JudgeBLS'
import JudgeECG  from './JudgeECG'
import JudgeAlgo from './JudgeAlgo'

export default function AutoJudgeGate() {
  const [searchParams] = useSearchParams()
  const deviceNumber = Number(searchParams.get('device'))

  const [mapping,       setMapping]       = useState(null) // {team_id, judge_id, team_name, judge_name}
  const [activeStation, setActiveStation] = useState('IDLE')
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')

  // โหลดการจับคู่เครื่อง + สถานะรอบกิจกรรม แล้วฟังการเปลี่ยนแปลงตลอด
  useEffect(() => {
    async function load() {
      if (!deviceNumber) {
        setError('ไม่พบเลขเครื่องใน URL — ต้องเปิดแบบ /judge?device=หมายเลข')
        setLoading(false)
        return
      }

      const { data: dev } = await supabase
        .from('device_assignments')
        .select('*, teams(team_name), judges(full_name)')
        .eq('device_number', deviceNumber)
        .maybeSingle()

      if (!dev || !dev.team_id) {
        setError(`ยังไม่มีการตั้งค่าเครื่อง #${deviceNumber} — กรุณาแจ้ง Admin`)
        setLoading(false)
        return
      }

      setMapping({
        teamId:    dev.team_id,
        judgeId:   dev.judge_id,
        teamName:  dev.teams?.team_name,
        judgeName: dev.judges?.full_name,
      })

      const { data: state } = await supabase
        .from('event_state').select('active_station').single()
      setActiveStation(state?.active_station || 'IDLE')

      // เก็บไว้ใน localStorage เพื่อให้หน้า JudgeBLS/ECG/Algo เดิมใช้งานได้เลย
      localStorage.setItem('teamId', dev.team_id)
      localStorage.setItem('judgeId', dev.judge_id || '')

      setLoading(false)
    }
    load()

    // ฟังการเปลี่ยนฐานของ Master แบบเรียลไทม์
    const sub = supabase.channel(`device-${deviceNumber}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'event_state' },
        (payload) => setActiveStation(payload.new.active_station))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_assignments',
          filter: `device_number=eq.${deviceNumber}` }, load)
      .subscribe()
    return () => supabase.removeChannel(sub)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceNumber])

  // สร้าง judge_assignment อัตโนมัติเมื่อฐานเปลี่ยนหรือทีมเปลี่ยน (ถ้ายังไม่มี)
  useEffect(() => {
    async function ensureAssignment() {
      if (!mapping || activeStation === 'IDLE') return
      const { data: existing } = await supabase
        .from('judge_assignments')
        .select('assignment_id')
        .eq('team_id', mapping.teamId)
        .eq('station_type', activeStation)
        .eq('status', 'active')
        .maybeSingle()

      if (!existing) {
        await supabase.from('judge_assignments').insert({
          judge_id: mapping.judgeId,
          team_id: mapping.teamId,
          station_type: activeStation,
          status: 'active',
        })
      }
    }
    ensureAssignment()
  }, [mapping, activeStation])

  if (loading) return <div className="screen"><p style={{ color: 'var(--muted)', marginTop: 24 }}>กำลังโหลด...</p></div>

  if (error) return (
    <div className="screen">
      <div className="warn-banner" style={{ marginTop: 24 }}>⚠ {error}</div>
    </div>
  )

  if (activeStation === 'IDLE') return (
    <div className="screen">
      <div style={{ marginTop: 60, textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>เครื่อง #{deviceNumber} — {mapping.teamName}</div>
        <div style={{ fontFamily: 'JetBrains Mono,monospace', color: 'var(--muted)', marginTop: 8 }}>
          กรรมการ: {mapping.judgeName}
        </div>
        <div className="warn-banner" style={{ marginTop: 20 }}>⚠ Master ยังไม่เปิดรอบแข่งขัน — รอสักครู่</div>
      </div>
    </div>
  )

  if (activeStation === 'BLS')       return <JudgeBLS  teamId={mapping.teamId} judgeId={mapping.judgeId} />
  if (activeStation === 'ECG')       return <JudgeECG  teamId={mapping.teamId} judgeId={mapping.judgeId} />
  if (activeStation === 'ALGORITHM') return <JudgeAlgo teamId={mapping.teamId} judgeId={mapping.judgeId} />

  return (
    <div className="screen">
      <div className="warn-banner" style={{ marginTop: 24 }}>⚠ ฐาน "{activeStation}" ยังไม่รองรับหน้าจอนี้</div>
    </div>
  )
}
