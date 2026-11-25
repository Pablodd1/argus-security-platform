import { Route, Routes } from "react-router";
import Cockpit from "@/pages/Cockpit";
import Targets from "@/pages/Targets";
import Jobs from "@/pages/Jobs";
import Findings from "@/pages/Findings";
import Reports from "@/pages/Reports";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Cockpit />} />
      <Route path="/targets" element={<Targets />} />
      <Route path="/jobs" element={<Jobs />} />
      <Route path="/findings" element={<Findings />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
