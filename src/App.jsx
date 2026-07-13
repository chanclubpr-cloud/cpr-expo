// src/App.jsx
import { Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import CompetitionGate from './components/CompetitionGate'
import AdminGate from './components/AdminGate'
import RoleSelector       from './screens/RoleSelector'
import AutoJudgeGate       from './screens/AutoJudgeGate'
import AutoParticipantGate from './screens/AutoParticipantGate'
import MasterPanel from './screens/MasterPanel'
import Leaderboard from './screens/Leaderboard'

export default function App() {
  return (
    <>
      <Header />
      <Routes>
        {/* หน้าแรก — เลือกบทบาท กรรมการ/ผู้เข้าแข่งขัน/Admin+Master */}
        <Route path="/" element={<RoleSelector />} />

        {/* กรรมการ — เปิดครั้งเดียว /judge?device=N ค้างไว้ทั้งวัน */}
        <Route path="/judge" element={<CompetitionGate><AutoJudgeGate /></CompetitionGate>} />

        {/* ผู้แข่งขัน — เปิดครั้งเดียว /participant?device=N ค้างไว้ทั้งวัน */}
        <Route path="/participant" element={<CompetitionGate><AutoParticipantGate /></CompetitionGate>} />

        {/* Master + Admin — ต้องใส่รหัสผ่านก่อนเข้า */}
        <Route path="/master" element={<AdminGate><MasterPanel /></AdminGate>} />

        {/* Leaderboard ไม่ถูกบล็อก */}
        <Route path="/leaderboard" element={<Leaderboard />} />

      </Routes>
    </>
  )
}
