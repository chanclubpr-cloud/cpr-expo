// src/screens/JudgeLogin.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function JudgeLogin() {
  const navigate = useNavigate()

  const [judges,       setJudges]       = useState([])
  const [teams,        setTeams]        = useState([])
  const [takenTeams,   setTakenTeams]   = useState([])   // ทีมที่ถูกจองแล้ว
  const [activeStation, setActiveStation] = useState('IDLE')

  const [selectedJudge, setSelectedJudge] = useState('')
  const [selectedTeam,  setSelectedTeam]  = useState('')
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  // โหลดข้อมูลเมื่อเปิดหน้า
  useEffect(() => {
    async function load() {
      // โหลดสถานะรอบแข่งขันปัจจุบัน
      const { data: state } = await supabase
        .from('event_state').select('active_station').single()
      if (state) setActiveStation(state.active_station)

      // โหลดรายชื่อกรรมการ (กรองตามฐานที่แข่งอยู่)
      const { data: judgeList } = await supabase
        .from('judges').select('*').order('full_name')
      setJudges(judgeList || [])

      // โหลดรายชื่อทีม
      const { data: teamList } = await supabase
        .from('teams').select('*').order('team_name')
      setTeams(teamList || [])

      // โหลดทีมที่มีกรรมการจับแล้วในรอบนี้ (ล็อกไม่ให้จองซ้ำ)
      const { data: assignments } = await supabase
        .from('judge_assignments')
        .select('team_id')
        .eq('station_type', state?.active_station || 'BLS')
        .eq('status', 'active')
      setTakenTeams((assignments || []).map(a => a.team_id))

      setLoading(false)
    }
    load()
  }, [])

  async function handleStart() {
    if (!selectedJudge || !selectedTeam) {
      setError('กรุณาเลือกชื่อกรรมการและทีมให้ครบก่อน')
      return
    }
    setSaving(true)
    setError('')

    // สร้าง judge_assignment (ถ้าซ้ำจะ error จาก UNIQUE constraint)
    const { error: assignErr } = await supabase
      .from('judge_assignments')
      .insert({
        judge_id:     selectedJudge,
        team_id:      selectedTeam,
        station_type: activeStation,
        status:       'active',
      })

    if (assignErr) {
      setError('ทีมนี้มีกรรมการรับผิดชอบแล้ว กรุณาเลือกทีมอื่น')
      setSaving(false)
      return
    }

    // บันทึก session ลง localStorage เพื่อใช้ในหน้าถัดไป
    localStorage.setItem('judgeId',   selectedJudge)
    localStorage.setItem('teamId',    selectedTeam)
    localStorage.setItem('station',   activeStation)

    // ไปหน้าตามฐานที่กำลังแข่ง
    const routes = { BLS:'bls', ECG:'ecg', ALGORITHM:'algo' }
    navigate(`/judge/${routes[activeStation] || 'bls'}`)
  }

  if (loading) return <div className="screen"><p style={{color:'var(--muted)'}}>กำลังโหลด...</p></div>

  return (
    <div className="screen">
      <h1 className="page-title" style={{marginTop:20}}>กรรมการ — เข้าสู่ระบบ</h1>
      <p className="page-sub">
        รอบกิจกรรมปัจจุบัน: <b>{activeStation === 'IDLE' ? 'ยังไม่เริ่ม' : activeStation}</b>
      </p>

      {activeStation === 'IDLE' && (
        <div className="warn-banner">⚠ Master ยังไม่เปิดรอบแข่งขัน — รอสักครู่</div>
      )}

      <div className="card">
        <div className="field">
          <label>ชื่อกรรมการ</label>
          <select value={selectedJudge} onChange={e => setSelectedJudge(e.target.value)}>
            <option value="">— เลือกชื่อของท่าน —</option>
            {judges.map(j => (
              <option key={j.judge_id} value={j.judge_id}>
                {j.full_name} (ฐาน {j.station_number})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>ทีมที่รับผิดชอบในรอบนี้</label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {teams.map(t => {
              const taken = takenTeams.includes(t.team_id)
              const selected = selectedTeam === t.team_id
              return (
                <button
                  key={t.team_id}
                  disabled={taken}
                  onClick={() => !taken && setSelectedTeam(t.team_id)}
                  style={{
                    padding: '14px',
                    borderRadius: 10,
                    border: `2px solid ${selected ? 'var(--ecg)' : taken ? 'var(--line)' : 'var(--line)'}`,
                    background: selected ? 'linear-gradient(180deg,#103324,var(--bg-panel-2))' : 'var(--bg-panel-2)',
                    color: taken ? 'var(--muted)' : 'var(--text)',
                    fontSize: 16, fontWeight: 700, fontFamily: 'Sarabun,sans-serif',
                    cursor: taken ? 'not-allowed' : 'pointer',
                    opacity: taken ? .5 : 1,
                    textAlign: 'center',
                  }}
                >
                  {t.team_name}
                  {taken && <div style={{fontSize:11, color:'var(--alert)', marginTop:4}}>มีกรรมการแล้ว</div>}
                </button>
              )
            })}
          </div>
        </div>

        {error && <p style={{color:'var(--alert)', fontSize:14, marginBottom:10}}>{error}</p>}

        <button
          className="btn-primary"
          onClick={handleStart}
          disabled={saving || activeStation === 'IDLE'}
        >
          {saving ? 'กำลังเข้าสู่ระบบ...' : 'เริ่มปฏิบัติหน้าที่ →'}
        </button>
      </div>

      <p className="note">
        ทีมที่ขึ้นว่า "มีกรรมการแล้ว" หมายถึงเครื่องอื่นเลือกไปแล้ว ระบบล็อกอัตโนมัติ กันข้อมูลชน
      </p>
    </div>
  )
}
