import React from 'react'
import logoUrl from '../assets/logo.svg'
import { SPECIALTIES_FR } from '../constants/specialties'

export default function Sidebar({ features, active, onSelect, profile, setProfile }) {
  const [editing, setEditing] = React.useState(false)
  const onChange = (k) => (e) => setProfile({ ...profile, [k]: e.target.value })
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-row">
          <img src={logoUrl} alt="MedAI logo" className="brand-logo" />
          <span>MedAI</span>
        </div>
        <div className="brand-subtitle">Founded by <br></br>Saif Eddine GHRIBI & Med Amine BENSALEM</div>
      </div>
      <nav>
        {features.map((f) => (
          <button
            key={f.key}
            className={`nav-item ${active === f.key ? 'active' : ''}`}
            onClick={() => f.enabled && onSelect(f.key)}
            disabled={!f.enabled}
          >
            {f.label}
            {!f.enabled ? ' (bientôt)' : ''}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="profile-header">Mon profil</div>
        <div className="profile-card">
          <div className="avatar" aria-hidden>{profile?.initials ?? 'DR'}</div>
          <div className="profile-info">
            <div className="name">{profile?.name ?? 'Docteur'}</div>
            <div className="meta">{profile?.specialty ?? 'Spécialité'}</div>
            <div className="meta muted">{profile?.facility ?? 'Établissement'}</div>
          </div>
        </div>
        <div className="profile-actions">
          <button className="profile-btn" onClick={() => setEditing((v) => !v)}>{editing ? 'Fermer' : 'Modifier le profil'}</button>
        </div>
        {editing && (
          <div className="profile-editor" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Nom</span>
              <input type="text" value={profile.name} onChange={onChange('name')} placeholder="Ex: Dr Jean Dupont" />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Spécialité</span>
              <select value={profile.specialty} onChange={onChange('specialty')}>
                {SPECIALTIES_FR.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Établissement</span>
              <input type="text" value={profile.facility} onChange={onChange('facility')} placeholder="Établissement" disabled />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Email</span>
              <input type="email" value={profile.email} onChange={onChange('email')} placeholder="email@exemple.fr" disabled />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Téléphone</span>
              <input type="tel" value={profile.phone} onChange={onChange('phone')} placeholder="0600000000" disabled />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Ville</span>
              <input type="text" value={profile.city} onChange={onChange('city')} placeholder="Ville" disabled />
            </label>
          </div>
        )}
      </div>
    </aside>
  )
}
