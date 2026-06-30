import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function StorageCheckModal({ onClose, onProceed }) {
  const { user } = useAuth()
  const [recordings, setRecordings] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    loadRecordings()
  }, [])

  async function loadRecordings() {
    setLoading(true)
    const { data, error } = await supabase.storage.from('recordings').list(user.id, {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' },
    })
    if (!error && data) setRecordings(data)
    setLoading(false)
  }

  async function handleDelete(filename) {
    const path = `${user.id}/${filename}`
    setDeleting(filename)
    const { error } = await supabase.storage.from('recordings').remove([path])
    if (!error) {
      setRecordings((prev) => prev.filter((r) => r.name !== filename))

      // Also remove audio_url from session if it matches
      await supabase
        .from('sessions')
        .update({ audio_url: null })
        .eq('audio_url', path)
        .eq('user_id', user.id)
    }
    setDeleting(null)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Saved recordings</h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>
          Manage your recordings before starting a new session.
        </p>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <div className="spinner" />
          </div>
        ) : recordings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 14 }}>
            No saved recordings.
          </div>
        ) : (
          <div style={{ marginBottom: 8 }}>
            {recordings.map((rec) => (
              <div key={rec.name} className="recording-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rec.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {formatDate(rec.created_at)} · {formatBytes(rec.metadata?.size)}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(rec.name)}
                  disabled={deleting === rec.name}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--red)',
                    padding: '8px 10px',
                    fontSize: 18,
                    flexShrink: 0,
                    opacity: deleting === rec.name ? 0.4 : 1,
                  }}
                  aria-label="Delete recording"
                >
                  {deleting === rec.name ? '…' : '🗑'}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="warning-box" style={{ marginTop: 12 }}>
          Please ensure you have at least 200 MB free on your device before starting a session.
        </div>

        <button className="btn btn-primary" onClick={onProceed} style={{ marginBottom: 10 }}>
          Proceed
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
