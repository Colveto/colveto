import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth, ROLES } from '../context/AuthContext.jsx';
import UpdateBanner from './UpdateBanner.jsx';

const NAV = [
  { to: '/dashboard', label: 'Tableau de bord', icon: '🏠', permission: null },
  { to: '/calendar', label: 'Agenda', icon: '📅', permission: 'agenda' },
  { to: '/owners', label: 'Propriétaires', icon: '👥', permission: 'owners' },
  { to: '/patients', label: 'Patients', icon: '🐾', permission: 'patients' },
  { to: '/services', label: 'Actes', icon: '🩺', permission: 'invoices' },
  { to: '/protocols', label: 'Protocoles', icon: '🧪', permission: 'invoices' },
  { to: '/record-templates', label: 'Modèles de rapports', icon: '📋', permission: 'patients' },
  { to: '/medicines', label: 'Médicaments', icon: '💊', permission: 'patients' },
  { to: '/stock', label: 'Stock', icon: '📦', permission: 'patients' },
  { to: '/reports', label: 'Rapports', icon: '📈', permission: 'reports' },
  { to: '/referrals', label: 'Dossiers référés', icon: '🔗', permission: null },
  { to: '/referring-vets', label: 'Vétérinaires référents', icon: '🩻', permission: null },
  { to: '/invoices', label: 'Facturation', icon: '🧾', permission: 'invoices' },
  { to: '/quotes', label: 'Devis', icon: '📝', permission: 'invoices' },
  { to: '/sage', label: 'Export Sage', icon: '📊', permission: 'sage' },
  { to: '/users', label: 'Utilisateurs', icon: '👤', permission: 'users' },
  { to: '/security', label: 'Sécurité', icon: '🔒', permission: null },
  { to: '/settings', label: 'Paramètres', icon: '⚙️', permission: 'settings' },
];

export default function Layout({ children }) {
  const { user, logout, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleNav = NAV.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="layout">
      <div className="mobile-topbar">
        <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu">☰</button>
        <img
          src="colveto-logo.png"
          alt="Colveto"
          style={{ height: 28, width: 'auto', objectFit: 'contain' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'inline'; }}
        />
        <span style={{ display: 'none', fontFamily: "'DM Serif Display', serif", fontSize: '1.1rem', color: 'white' }}>Colveto</span>
      </div>

      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}

      <aside className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src="colveto-logo.png"
              alt="Colveto"
              style={{ height: 36, width: 'auto', objectFit: 'contain' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'inline'; }}
            />
            <span style={{ display: 'none', fontFamily: "'DM Serif Display', serif", fontSize: '1.4rem', color: '#2563eb' }}>Colveto</span>
          </div>
          <button className="sidebar-close-btn" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu">✕</button>
        </div>
        <nav className="sidebar-nav" onClick={() => setMobileOpen(false)}>
          {visibleNav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {user && (
            <div style={{ padding: 16, borderTop: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{user.fullName}</div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 8 }}>
                {ROLES?.[user.role]?.label || user.role}
              </div>
              <button className="btn btn-secondary" style={{ width: '100%' }} onClick={logout}>Déconnexion</button>
            </div>
          )}
        </div>
      </aside>
      <main className="main"><UpdateBanner />{children}</main>
    </div>
  );
}
