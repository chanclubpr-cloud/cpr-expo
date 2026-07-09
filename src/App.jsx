// src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom'
import Header from './components/Header'
import CompetitionGate from './components/CompetitionGate'
import AutoJudgeGate       from './screens/AutoJudgeGate'
import AutoParticipantGate from './screens/AutoParticipantGate'
import MasterPanel from './screens/MasterPanel'
import Leaderboard from './screens/Leaderboard'
import Feedback from './screens/Feedback'

export default function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<Navigate to="/judge" replace />} />

        {/* กรรมการ — เปิดครั้งเดียว /judge?device=N ค้างไว้ทั้งวัน */}
        <Route path="/judge" element={<CompetitionGate><AutoJudgeGate /></CompetitionGate>} />

        {/* ผู้แข่งขัน — เปิดครั้งเดียว /participant?device=N ค้างไว้ทั้งวัน */}
        <Route path="/participant" element={<CompetitionGate><AutoParticipantGate /></CompetitionGate>} />

        {/* Master + Admin ไม่ถูกบล็อก */}
        <Route path="/master" element={<MasterPanel />} />

        {/* Leaderboard ไม่ถูกบล็อก */}
        <Route path="/leaderboard" element={<Leaderboard />} />

        {/* แบบประเมินความพึงพอใจ — เปิดให้ทุกคนกรอกได้เสมอ */}
        <Route path="/feedback" element={<Feedback />} />
      </Routes>
    </>
  )
}
