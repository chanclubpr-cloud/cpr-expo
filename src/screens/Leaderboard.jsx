// src/screens/Leaderboard.jsx
// v2: เพิ่มคอลัมน์ Mega Code (คะแนนดิบ) + รองรับ 2 โหมดการคิดคะแนน
//   - combined: บวกแต้ม Mega Code (แปลงจากอันดับ) เข้ากับแต้มรวม 3 ฐาน แล้วจัดอันดับใหม่
//   - separate: แสดงคะแนนดิบ Mega Code แยกต่างหาก ไม่ปนกับแต้มรวม 3 ฐาน

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Leaderboard() {
  const [rows,          setRows]          = useState([])
  const [activeStation, setActiveStation] = useState('IDLE')
  const [megacodeMode,  setMegacodeMode]  = useState('separate')

  async function load() {
    const { data: state } = await supabase
      .from('event_state').select('active_station, megacode_mode').single()
    if (state) {
      setActiveStation(state.active_station)
      setMegacodeMode(state.megacode_mode || 'separate')
    }

    const { data: lb } = await supabase.from('leaderboard').select('*')

    // ดึงผล Mega Code (ทีมที่เข้ารอบ + คะแนนดิบ + อันดับ)
    const { data: mc } = await supabase
      .from('megacode_qualifiers')
      .select('team_id, megacode_results(checklist_score, final_rank)')

    const mcMap = {}
    let qualifiedCount = 0
    ;(mc || []).forEach(q => {
      const res = Array.isArray(q.megacode_results) ? q.megacode_results[0] : q.megacode_results
      if (res) {
        mcMap[q.team_id] = { score: res.checklist_score, rank: res.final_rank }
        qualifiedCount++
      }
    })

    // รวมข้อมูล Mega Code เข้ากับแถวหลัก
    const merged = (lb || []).map(r => {
      const mcData = mcMap[r.team_id]
      const megacodeScore = mcData?.score ?? null
      const megacodePoints = (state?.megacode_mode === 'combined' && mcData?.rank)
        ? Math.max(qualifiedCount - mcData.rank + 1, 0)
        : 0
      const grandTotal = r.total_points + megacodePoints
      return { ...r, megacodeScore, megacodePoints, grandTotal }
    })

    // จัดเรียง: โหมด combined ใช้ grandTotal / โหมด separate ใช้ total_points เดิม
    merged.sort((a, b) =>
      state?.megacode_mode === 'combined'
        ? b.grandTotal - a.grandTotal
        : b.total_points - a.total_points
    )

    setRows(merged)
  }

  useEffect(() => {
    load()
    const sub = supabase.channel('lb-realtime')
      .on('postgres_changes', { event:'*', schema:'public', table:'station_results' }, load)
      .on('postgres_changes', { event:'*', schema:'public', table:'megacode_results' }, load)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'event_state' }, load)
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [])

  const stationLabel = { IDLE:'รอเริ่ม', BLS:'BLS', ECG:'ECG', ALGORITHM:'Algorithm', MEGACODE:'Mega Code' }
  const medal = ['🥇','🥈','🥉']
  const hasMegacode = rows.some(r => r.megacodeScore != null)

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)', padding:'32px 24px' }}>
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
          {hasMegacode && (
            <span style={{ marginLeft:12, padding:'4px 10px', borderRadius:12, fontSize:11,
                           border:'1px solid var(--line)', color:'var(--muted)' }}>
              Mega Code: {megacodeMode === 'combined' ? 'รวมแต้ม' : 'แยกคะแนน'}
            </span>
          )}
        </div>
      </div>

      <table className="lb">
        <thead>
          <tr>
            <th>อันดับ</th>
            <th>ทีม</th>
            <th>BLS</th>
            <th>ECG</th>
            <th>Algorithm</th>
            <th>แต้มรวม (3 ฐาน)</th>
            {hasMegacode && <th>Mega Code (คะแนนจริง)</th>}
            {hasMegacode && megacodeMode === 'combined' && <th>แต้มรวมทั้งหมด</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const sortValue = megacodeMode === 'combined' ? r.grandTotal : r.total_points
            const maxValue = (megacodeMode === 'combined' ? rows[0]?.grandTotal : rows[0]?.total_points) || 1
            return (
              <tr key={r.team_id} className={i === 0 ? 'rank-1' : ''}>
                <td style={{ fontSize:22, width:60 }}>{medal[i] || i+1}</td>
                <td style={{ fontWeight:700, fontSize:20 }}>{r.team_name}</td>
                <td style={{ fontFamily:'JetBrains Mono,monospace' }}>{r.bls_points}</td>
                <td style={{ fontFamily:'JetBrains Mono,monospace' }}>{r.ecg_points}</td>
                <td style={{ fontFamily:'JetBrains Mono,monospace' }}>{r.algo_points}</td>
                <td>
                  <span style={{
                    fontFamily:'JetBrains Mono,monospace', fontWeight:700, fontSize:22,
                    color: (megacodeMode !== 'combined' && i===0) ? 'var(--ecg)' : 'var(--text)',
                  }}>
                    {r.total_points}
                  </span>
                  <div style={{ height:4, background:'var(--bg-panel-2)', borderRadius:2, marginTop:4, width:'100%' }}>
                    <div style={{ height:4, background:'var(--ecg)', borderRadius:2, width:`${(r.total_points/maxValue)*100}%`, transition:'.5s' }} />
                  </div>
                </td>
                {hasMegacode && (
                  <td style={{ fontFamily:'JetBrains Mono,monospace', color:'var(--amber)' }}>
                    {r.megacodeScore != null ? r.megacodeScore : '—'}
                  </td>
                )}
                {hasMegacode && megacodeMode === 'combined' && (
                  <td>
                    <span style={{ fontFamily:'JetBrains Mono,monospace', fontWeight:700, fontSize:22, color:'var(--ecg)' }}>
                      {r.grandTotal}
                    </span>
                  </td>
                )}
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr><td colSpan={8} style={{ textAlign:'center', padding:40, color:'var(--muted)', fontFamily:'JetBrains Mono,monospace' }}>รอผลการแข่งขัน...</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
