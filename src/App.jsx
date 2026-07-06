// src/App.jsx
// ไฟล์นี้คือ "แผนที่" ของแอป บอกว่า URL ไหนแสดงหน้าจออะไร

import { Routes, Route, Navigate } from 'react-router-dom'
import Header from './components/Header'
import JudgeLogin  from './screens/JudgeLogin'
import JudgeBLS    from './screens/JudgeBLS'
import JudgeECG    from './screens/JudgeECG'
import JudgeAlgo   from './screens/JudgeAlgo'
import MasterPanel from './screens/MasterPanel'
import Leaderboard from './screens/Leaderboard'
import ParticipantECG  from './screens/ParticipantECG'
import ParticipantAlgo from './screens/ParticipantAlgo'

export default function App() {
  return (
    <>
      <Header />
      <Routes>
        {/* หน้าแรก → ไปหน้า Login กรรมการเป็น default */}
        <Route path="/"           element={<Navigate to="/judge" replace />} />

        {/* กรรมการ */}
        <Route path="/judge"      element={<JudgeLogin />} />
        <Route path="/judge/bls"  element={<JudgeBLS />} />
        <Route path="/judge/ecg"  element={<JudgeECG />} />
        <Route path="/judge/algo" element={<JudgeAlgo />} />

        {/* Master + Admin */}
        <Route path="/master"     element={<MasterPanel />} />

        {/* ผู้แข่งขัน (เปิดบน Laptop หน้าฐาน) */}
        <Route path="/participant/ecg"  element={<ParticipantECG />} />
        <Route path="/participant/algo" element={<ParticipantAlgo />} />

        {/* Leaderboard (เปิดบนจอโปรเจกเตอร์) */}
        <Route path="/leaderboard" element={<Leaderboard />} />
      </Routes>
    </>
  )
}
