// src/screens/JudgeAlgo.jsx
// กรรมการฐาน Algorithm — เฝ้าดูสถานะเท่านั้น ไม่มีปุ่มกด
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function JudgeAlgo() {
  const teamId = localStorage.getItem('teamId')
  const [queue,    setQueue]    = useState([])
  const [teamName, setTeamName] = useState('')

  useEffect(() => {
    async function load() {
      const { data: team } = await supabase
        .from('teams').select('team_name').eq('team_id', teamId).single()
      setTeamName(team?.team_name || '')

      const { data: members } = await supabase
        .from('participants').select('*')
        .eq('team_id', teamId).eq('is_reserve', false).order('queue_order')
      if (members) {
        setQueue(members.map((m, i) => ({ ...m, status: i === 0 ? 'active' : 'waiting', passedQ: 0, retryCount: 0 })))
      }
    }
    load()

    // Subscribe รับ realtime attempts จากฐาน Algorithm
    const sub = supabase.channel('algo-attempts')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'attempts',
          filter:`station_type=eq.ALGORITHM` }, () => load())
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [teamId])

  return (
    <div className="screen">
      <div style={{ marginTop:20, marginBottom:18 }}>
        <div style={{ fontSize:22, fontWeight:800 }}>{teamName}</div>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:12, color:'var(--muted)' }}>
          ฐาน Algorithm — โหมดเฝ้าดู (ระบบเช็คอัตโนมัติ ไม่ต้องกดตัดสิน)
        </div>
      </div>

      {queue.map(p => (
        <div key={p.participant_id} className={`participant-row ${p.status}`}>
          <div className="p-name">{p.full_name}</div>
          <div className="p-sub">
            {p.status === 'passed'  ? 'ผ่านครบ 3 ข้อ' :
             p.status === 'active'  ? `ข้อ ${p.passedQ+1}/3 · รอบ ${p.retryCount+1}` :
             p.status === 'resting' ? `พักคิว · ${p.retryCount} รอบ` : 'รอคิว'}
          </div>
        </div>
      ))}
      <p className="note">หน้าจอนี้เฝ้าดูเท่านั้น ผู้แข่งขันตอบบนจอ Laptop ของตัวเอง ระบบเช็คถูก/ผิดและนับเวลาให้อัตโนมัติ</p>
    </div>
  )
}
