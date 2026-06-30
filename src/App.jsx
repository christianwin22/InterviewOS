import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Register from './pages/Register'
import Home from './pages/Home'
import ContextForm from './pages/ContextForm'
import ProfilePicker from './pages/ProfilePicker'
import InterviewMode from './pages/InterviewMode'
import PracticeMode from './pages/PracticeMode'
import Report from './pages/Report'
import History from './pages/History'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<PrivateRoute><Home /></PrivateRoute>} />
          <Route path="/profile-picker/:mode" element={<PrivateRoute><ProfilePicker /></PrivateRoute>} />
          <Route path="/setup/:mode" element={<PrivateRoute><ContextForm /></PrivateRoute>} />
          <Route path="/interview" element={<PrivateRoute><InterviewMode /></PrivateRoute>} />
          <Route path="/practice" element={<PrivateRoute><PracticeMode /></PrivateRoute>} />
          <Route path="/report/:sessionId" element={<PrivateRoute><Report /></PrivateRoute>} />
          <Route path="/history" element={<PrivateRoute><History /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
