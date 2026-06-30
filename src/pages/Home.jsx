import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import StorageCheckModal from '../components/StorageCheckModal'

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [modalMode, setModalMode] = useState(null)

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="page">
      <div className="nav-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, background: 'var(--blue)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MicSVG size={18} color="white" />
          </div>
          <span className="nav-title">InterviewOS</span>
        </div>
        <button
          onClick={handleSignOut}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14, padding: '8px 0' }}
        >
          Sign out
        </button>
      </div>

      <div className="home-content">
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>
          {user?.email}
        </p>

        <div className="mode-btn-wrap">
          <button className="btn btn-primary" onClick={() => setModalMode('interview')}>
            <MicSVG size={20} color="white" />
            Interview mode
          </button>
          <p className="mode-btn-desc">AI listens and shows you suggested answers in real time</p>
        </div>

        <div className="mode-btn-wrap">
          <button className="btn btn-green" onClick={() => setModalMode('practice')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
              <polyline points="9 11 12 14 15 11" />
            </svg>
            Practice mode
          </button>
          <p className="mode-btn-desc">AI interviews you with dynamic follow-up questions</p>
        </div>

        <button
          className="btn btn-ghost"
          onClick={() => navigate('/history')}
          style={{ marginTop: 8 }}
        >
          View history
        </button>
      </div>

      {modalMode && (
        <StorageCheckModal
          onClose={() => setModalMode(null)}
          onProceed={() => {
            setModalMode(null)
            navigate(`/setup/${modalMode}`)
          }}
        />
      )}
    </div>
  )
}

function MicSVG({ size = 24, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}
