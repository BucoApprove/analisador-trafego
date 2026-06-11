import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dashboard" element={<Navigate to="/dashboard/perpetuo" replace />} />
        <Route path="/dashboard/:tab/:sub?" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/dashboard/perpetuo" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
