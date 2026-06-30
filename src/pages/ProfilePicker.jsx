import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ProfilePicker() {
  const { mode } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [swipedId, setSwipedId] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const touchStartX = useRef(null)

  useEffect(() => {
    loadProfiles()
  }, [])

  async function loadProfiles() {
    const { data } = await supabase
      .from('job_profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
    if (data) setProfiles(data)
    setLoading(false)
  }

  function onTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }

  function onTouchEnd(e, id) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (dx < -50) {
      setSwipedId(id)
    } else if (dx > 20) {
      if (swipedId === id) setSwipedId(null)
    }
  }

  async function handleDelete(id) {
    setDeleting(id)
    await supabase.from('job_profiles').delete().eq('id', id).eq('user_id', user.id)
    setProfiles((prev) => prev.filter((p) => p.id !== id))
    setSwipedId(null)
    setDeleting(null)
  }

  function handleSelect(profile) {
    sessionStorage.setItem('selectedJobProfile', JSON.stringify(profile))
    navigate(`/setup/${mode}`)
  }

  function handleNew() {
    sessionStorage.removeItem('selectedJobProfile')
    navigate(`/setup/${mode}`)
  }

  const isInterview = mode === 'interview'
  const accentColor = isInterview ? 'var(--blue)' : 'var(--green)'
  const accentHover = isInterview ? 'var(--blue-hover)' : 'var(--green-hover)'

  return (
    <div className="page">
      <div className={`nav-bar ${isInterview ? 'blue' : 'green'}`}>
        <button
          className="nav-back"
          onClick={() => navigate('/')}
          style={{ color: 'rgba(255,255,255,0.9)' }}
        >
          ← Back
        </button>
        <span className="nav-title">Choose a profile</span>
        <div style={{ width: 60 }} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: '16px 16px 0',
            paddingBottom: 20,
          }}
          onClick={() => swipedId && setSwipedId(null)}
        >
          {loading ? (
            <div className="loading-screen"><div className="spinner" /></div>
          ) : profiles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '56px 16px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>No saved profiles yet</div>
              <div style={{ fontSize: 13 }}>Tap "New profile" below to create one.</div>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                Tap a profile to continue. Swipe left to delete.
              </p>
              {profiles.map((p) => {
                const meta = [p.interview_type, p.company].filter(Boolean).join(' · ')
                const subtitle = meta
                  ? `${meta} · Updated ${formatDate(p.updated_at)}`
                  : `Updated ${formatDate(p.updated_at)}`
                const swiped = swipedId === p.id

                return (
                  <div
                    key={p.id}
                    style={{ position: 'relative', marginBottom: 10, borderRadius: 12, overflow: 'hidden' }}
                  >
                    {/* Delete button revealed by swipe */}
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: 80,
                        background: 'var(--red)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '0 12px 12px 0',
                      }}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }}
                        disabled={deleting === p.id}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'white',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                          padding: '8px 12px',
                          opacity: deleting === p.id ? 0.5 : 1,
                        }}
                      >
                        {deleting === p.id ? '…' : 'Delete'}
                      </button>
                    </div>

                    {/* Profile card */}
                    <div
                      onTouchStart={onTouchStart}
                      onTouchEnd={(e) => onTouchEnd(e, p.id)}
                      onClick={() => swiped ? setSwipedId(null) : handleSelect(p)}
                      style={{
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: '14px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transform: swiped ? 'translateX(-80px)' : 'translateX(0)',
                        transition: 'transform 0.22s ease',
                        position: 'relative',
                        zIndex: 1,
                        WebkitTapHighlightColor: 'transparent',
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: 'var(--text)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {p.profile_name || 'Untitled profile'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                          {subtitle}
                        </div>
                      </div>
                      <div style={{ fontSize: 20, color: 'var(--text-muted)', marginLeft: 12, flexShrink: 0 }}>›</div>
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* New profile — fixed at bottom */}
        <div style={{
          flexShrink: 0,
          background: 'var(--bg)',
          borderTop: '0.5px solid var(--border)',
          padding: '12px 16px',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        }}>
          <button
            onClick={handleNew}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              padding: '14px 16px',
              borderRadius: 'var(--radius)',
              fontSize: 16,
              fontWeight: 500,
              cursor: 'pointer',
              background: 'transparent',
              color: accentColor,
              border: `1.5px solid ${accentColor}`,
              fontFamily: 'inherit',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            + New profile
          </button>
        </div>
      </div>
    </div>
  )
}
