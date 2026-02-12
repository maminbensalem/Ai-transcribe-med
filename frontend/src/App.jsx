import React, { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import AssistantChat from './features/assistant/AssistantChat'
import Dictaphone from './features/dictaphone/Dictaphone'

export default function App() {
  const [active, setActive] = useState('assistant')
  const features = [
    { key: 'assistant', label: 'Assistant médical IA', enabled: true },
    { key: 'records', label: 'Newsletter', enabled: false },
    { key: 'dictaphone', label: 'Dictaphone', enabled: true },
  ]
  const [profile, setProfile] = useState(() => {
    try {
      const raw = localStorage.getItem('medai.profile.v1')
      if (raw) return JSON.parse(raw)
    } catch {}
    return {
      name: '',
      specialty: 'Médecine générale',
      facility: '',
      email: '',
      phone: '',
      city: '',
      initials: 'DR',
    }
  })

  // Keep initials in sync with name
  useEffect(() => {
    const initials = computeInitials(profile.name)
    if (initials !== profile.initials) {
      setProfile((p) => ({ ...p, initials }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.name])

  // Persist profile to localStorage
  useEffect(() => {
    try { localStorage.setItem('medai.profile.v1', JSON.stringify(profile)) } catch {}
  }, [profile])

  return (
    <div className="app">
      <Sidebar features={features} active={active} onSelect={setActive} profile={profile} setProfile={setProfile} />
      <main className="content">
        {active === 'assistant' && <AssistantChat doctorProfile={profile} />}
        {active === 'dictaphone' && <Dictaphone />}
        {active !== 'assistant' && active !== 'dictaphone' && <DisabledFeature />}
      </main>
    </div>
  )
}

function DisabledFeature() {
  return (
    <div className="disabled">
      This feature is not enabled yet.
    </div>
  )
}

function computeInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'DR'
  const first = parts[0][0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}
