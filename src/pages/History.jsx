import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return null
  const mins = Math.round((new Date(endedAt) - new Date(startedAt)) / 60000)
  return `${mins} min`
}

export default function History() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSessions()
  }, [])

  async function loadSessions() {
    const { data } = await supabase
      .from('sessions')
      .select('*, session_reports(overall_score)')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(100)

    setSessions(data || [])
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="page">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => navigate('/')}>← Back</button>
          <span className="nav-title">History</span>
          <div style={{ width: 48 }} />
        </div>
        <div className="loading-screen"><div className="spinner" /></div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="nav-bar">
        <button className="nav-back" onClick={() => navigate('/')}>← Back</button>
        <span className="nav-title">History</span>
        <div style={{ width: 48 }} />
      </div>

      <div className="container" style={{ paddingTop: 8, paddingBottom: 32 }}>
        {sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <p style={{ fontSize: 16 }}>No sessions yet.</p>
            <p style={{ fontSize: 14, marginTop: 6 }}>Start an Interview or Practice session to see your history here.</p>
            <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => navigate('/')}>
              Start a session
            </button>
          </div>
        ) : (
          sessions.map((sess) => {
            const score = sess.session_reports?.[0]?.overall_score
            const duration = formatDuration(sess.started_at, sess.ended_at)

            return (
              <Link
                key={sess.id}
                to={`/report/${sess.id}`}
                className="history-item"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sess.company || 'Untitled session'}
                    {sess.job_title && (
                      <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> — {sess.job_title}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
                    {formatDate(sess.started_at)}
                    {duration && ` · ${duration}`}
                    {score != null && ` · Score ${Number(score).toFixed(1)}/10`}
                  </div>
                </div>
                <span className={`mode-tag ${sess.mode}`}>
                  {sess.mode === 'interview' ? 'Interview' : 'Practice'}
                </span>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
