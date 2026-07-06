// src/screens/Leaderboard.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Leaderboard() {
  const [rows,          setRows]          = useState([])
  const [activeStation, setActiveStation] = useState('IDLE')

  async function load() {
    const { data: state } = await supabase.from('event_state').select('active_station').single()
    if (state) setActiveStation(state.active_station)

    // ดึงจาก view leaderboard ที่สร้างไว้ใน SQL
    const { data } = await supabase.from('leaderboard').select('*')
    setRows(data || [])
  }

  useEffect(() => {
    load()
    // Realtime subscription
    const sub = supabase.channel('lb-realtime')
      .on('postgres_changes', { event:'*', schema:'public', table:'station_results' }, load)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'event_state' }, load)
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [])

  const stationLabel = { IDLE:'รอเริ่ม', BLS:'BLS', ECG:'ECG', ALGORITHM:'Algorithm', MEGACODE:'Mega Code' }
  const medal = ['🥇','🥈','🥉']

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)', padding:'32px 24px' }}>
      {/* หัว */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:32 }}>
        <div>
          <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:12, color:'var(--muted)', letterSpacing:'.12em', marginBottom:4 }}>QSHC</div>
          <div style={{ fontFamily:'Sarabun,sans-serif', fontWeight:800, fontSize:32 }}>
            CPR <span style={{color:'var(--ecg)'}}>EXPO</span> LEADERBOARD
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, fontFamily:'JetBrains Mono,monospace', fontSize:14, color:'var(--ecg)' }}>
          <span className="pulse-dot" />
          รอบ: {stationLabel[activeStation]}
        </div>
      </div>

      {/* ตาราง */}
      <table className="lb">
        <thead>
          <tr>
            <th>อันดับ</th>
            <th>ทีม</th>
            <th>BLS</th>
            <th>ECG</th>
            <th>Algorithm</th>
            <th>แต้มรวม</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const maxPoints = rows[0]?.total_points || 1
            return (
              <tr key={r.team_id} className={i === 0 ? 'rank-1' : ''}>
                <td style={{ fontSize:22, width:60 }}>{medal[i] || i+1}</td>
                <td style={{ fontWeight:700, fontSize:20 }}>{r.team_name}</td>
                <td style={{ fontFamily:'JetBrains Mono,monospace' }}>{r.bls_points}</td>
                <td style={{ fontFamily:'JetBrains Mono,monospace' }}>{r.ecg_points}</td>
                <td style={{ fontFamily:'JetBrains Mono,monospace' }}>{r.algo_points}</td>
                <td>
                  <span style={{ fontFamily:'JetBrains Mono,monospace', fontWeight:700, fontSize:22, color: i===0 ? 'var(--ecg)' : 'var(--text)' }}>
                    {r.total_points}
                  </span>
                  <div style={{ height:4, background:'var(--bg-panel-2)', borderRadius:2, marginTop:4, width:'100%' }}>
                    <div style={{ height:4, background:'var(--ecg)', borderRadius:2, width:`${(r.total_points/maxPoints)*100}%`, transition:'.5s' }} />
                  </div>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign:'center', padding:40, color:'var(--muted)', fontFamily:'JetBrains Mono,monospace' }}>รอผลการแข่งขัน...</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
