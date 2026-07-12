import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../lib/api'
import type { PublicSolutionData } from '../lib/types'

export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PublicSolutionData | null>(null)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'not_found' | 'error'>('loading')

  useEffect(() => {
    api.get(`/share/${token}`)
      .then((r) => { setData(r.data); setStatus('loaded') })
      .catch((err: { response?: { status: number } }) => {
        if (err.response?.status === 404) setStatus('not_found')
        else setStatus('error')
      })
  }, [token])

  if (status === 'loading') {
    return (
      <div className="full-page-spinner">
        <div className="spinner spinner-lg" />
      </div>
    )
  }

  if (status === 'not_found') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--text2)' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>This link is no longer available.</h2>
        </div>
      </div>
    )
  }

  if (status === 'error' || !data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--text2)' }}>
          <p>Something went wrong. Try again later.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 80px' }}>
      <div className="nav-logo" style={{ marginBottom: 24 }}>
        <span className="nav-logo-icon material-symbols-outlined">groups_3</span>
        kid splitter
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.4px', marginBottom: 4 }}>
        {data.cohort_name} — Class Lists
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--text3)', marginBottom: 32 }}>Shared view · Names only</p>
      <div className="roster-grid">
        {data.classes.map((cls) => (
          <div key={cls.class_number} className="roster-class-card">
            <div className="roster-class-header">
              <span>Class {cls.class_number}</span>
              <span style={{ fontWeight: 500, opacity: 0.75 }}>{cls.students.length} students</span>
            </div>
            {[...cls.students].sort((a, b) => a.first_name.localeCompare(b.first_name)).map((s, i) => (
              <div key={i} className="roster-student-row">
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{s.first_name}</span>
                {s.tags.map((t) => (
                  <span key={t} className="tag-pill" style={{ fontSize: 11.5 }}>{t}</span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
