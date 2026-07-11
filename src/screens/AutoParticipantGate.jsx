// src/screens/AutoParticipantGate.jsx
// ============================================================
// จอผู้แข่งขัน (Laptop หน้าฐาน) — สลับหน้าจอตามฐานอัตโนมัติเช่นกัน
// ต่างจากกรรมการตรงที่ฐาน BLS ไม่มีจอแสดงผล (ใช้หุ่นจำลองแทน)
// จึงต้องมีข้อความแจ้งเมื่อ Master เปิดรอบ BLS
// ============================================================

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCurrentEvent } from '../lib/currentEvent'
import ParticipantECG  from './ParticipantECG'
import ParticipantAlgo from './ParticipantAlgo'

export default function AutoParticipantGate() {
  const [searchParams] = useSearchParams()
  const deviceNumber = Number(searchParams.get('device'))

  const [eventId,       setEventId]       = useState(null)
  const [teamId,        setTeamId]        = useState('')
  const [teamName,      setTeamName]      = useState('')
  const [activeStation, setActiveStation] = useState('IDLE')
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')

  useEffect(() => {
    async function load() {
      if (!deviceNumber) {
        setError('ไม่พบเลขเครื่องใน URL — ต้องเปิดแบบ /participant?device=หมายเลข')
        setLoading(false)
        return
      }

      const ev = await getCurrentEvent()
      if (!ev) {
        setError('ยังไม่มีงานแข่งขันที่เปิดอยู่ในระบบ — กรุณาแจ้ง Admin')
        setLoading(false)
        return
      }
      setEventId(ev.event_id)

      const { data: dev } = await supabase
        .from('device_assignments')
        .select('*, teams(team_name)')
        .eq('device_number', deviceNumber)
        .eq('event_id', ev.event_id)
        .maybeSingle()

      if (!dev || !dev.team_id) {
        setError(`ยังไม่มีการตั้งค่าเครื่อง #${deviceNumber} สำหรับงาน "${ev.event_name}" — กรุณาแจ้ง Admin`)
        setLoading(false)
        return
      }
      setTeamName(dev.teams?.team_name || '')
      setTeamId(dev.team_id)
      localStorage.setItem('teamId', dev.team_id) // เก็บสำรองไว้ด้วย เผื่อเข้าหน้าตรงๆ

      const { data: state } = await supabase
        .from('event_state').select('active_station').eq('event_id', ev.event_id).maybeSingle()
      setActiveStation(state?.active_station || 'IDLE')
      setLoading(false)
    }
    load()

    const sub = supabase.channel(`device-p-${deviceNumber}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'event_state' },
        (payload) => {
          if (payload.new.event_id !== eventId) return // ไม่ใช่งานปัจจุบัน ไม่สนใจ
          setActiveStation(payload.new.active_station)
        })
      .subscribe()
    return () => supabase.removeChannel(sub)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceNumber])

  const wrapStyle = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                       flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--muted)',
                       fontFamily: 'JetBrains Mono,monospace', textAlign: 'center', padding: 24 }

  if (loading) return <div style={wrapStyle}>กำลังโหลด...</div>
  if (error)   return <div style={wrapStyle}>⚠ {error}</div>

  if (activeStation === 'IDLE') return (
    <div style={wrapStyle}>
      <div style={{ fontSize: 18, color: 'var(--text)', marginBottom: 8 }}>ทีม {teamName}</div>
      ⚠ รอ Master เปิดรอบแข่งขัน...
    </div>
  )

  if (activeStation === 'BLS') return (
    <div style={wrapStyle}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🫀</div>
      <div style={{ fontSize: 18, color: 'var(--text)', marginBottom: 8 }}>ฐาน BLS — ใช้หุ่นจำลอง</div>
      ฐานนี้ไม่มีจอแสดงผล กรุณารอฐานถัดไป
    </div>
  )

  if (activeStation === 'ECG')       return <ParticipantECG  teamId={teamId} teamName={teamName} />
  if (activeStation === 'ALGORITHM') return <ParticipantAlgo teamId={teamId} teamName={teamName} />

  return <div style={wrapStyle}>⚠ ฐาน "{activeStation}" ยังไม่รองรับหน้าจอนี้</div>
}
