import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, ping, getApiBase, setApiBase } from '../lib/api.js';

const AuthContext = createContext(null);

export const ROLES = {
  admin: { label: 'Administrateur', level: 3 },
  veterinarian: { label: 'Vétérinaire', level: 2 },
  assistant: { label: 'Assistant(e)', level: 1 },
  // Compte technique de l'agent de laboratoire : n'accède qu'à l'envoi des résultats.
  lab: { label: 'Station labo', level: 0 },
};

export const PERMISSIONS = {
  admin:        { invoices: true,  settings: true,  users: true,  patients: true, owners: true, agenda: true, sage: true,  reports: true  },
  veterinarian: { invoices: true,  settings: false, users: false, patients: true, owners: true, agenda: true, sage: false, reports: false },
  assistant:    { invoices: true,  settings: false, users: false, patients: true, owners: true, agenda: true, sage: false, reports: false },
  lab:          { invoices: false, settings: false, users: false, patients: false, owners: false, agenda: false, sage: false, reports: false },
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState(null);
  const [mustEnroll2fa, setMustEnroll2fa] = useState(false);

  // Le serveur est seul juge (il connaît le mode démo) : on ne recalcule pas
  // la règle ici, on lit le drapeau qu'il renvoie avec l'utilisateur.
  const gate2fa = (u) => setMustEnroll2fa(!!u && !!u.mustEnroll2fa);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setServerError(null);
    // 1. Server reachable?
    const ok = await ping();
    if (!ok) {
      setServerError(`Impossible de joindre le serveur à ${getApiBase()}.`);
      setLoading(false);
      return;
    }
    // 2. Try to restore session from existing JWT
    if (getToken()) {
      try {
        const me = await api.auth.me();
        setUser(me);
        gate2fa(me);
        setLoading(false);
        return;
      } catch {
        setToken(null);
      }
    }
    // 3. No session: need login or first-run
    try {
      const has = await api.auth.hasAnyUser();
      setNeedsSetup(!has);
    } catch (e) {
      setServerError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const login = async (username, password, code) => {
    const r = await api.auth.login(username, password, code);
    if (r.needTotp) return { needTotp: true };
    setUser(r.user);
    setNeedsSetup(false);
    setMustEnroll2fa(!!r.mustEnroll2fa);
    return { user: r.user };
  };

  const logout = () => {
    api.auth.logout();
    setUser(null);
    setMustEnroll2fa(false);
  };

  const completeSetup = async (data) => {
    const u = await api.auth.createFirstAdmin(data);
    setNeedsSetup(false);
    setUser(u);
    gate2fa(u);
    return u;
  };

  // Re-fetch the current user (e.g. after enabling/disabling 2FA) and re-evaluate the gate.
  const refreshUser = async () => {
    const me = await api.auth.me();
    setUser(me);
    gate2fa(me);
    return me;
  };

  const can = (permission) => {
    if (!user) return false;
    const perms = PERMISSIONS[user.role] || {};
    return !!perms[permission];
  };

  const reconfigureServer = async (url) => {
    setApiBase(url);
    setUser(null);
    setToken(null);
    await bootstrap();
  };

  return (
    <AuthContext.Provider value={{
      user, login, logout, needsSetup, completeSetup, loading, can,
      serverError, reconfigureServer, retry: bootstrap,
      mustEnroll2fa, refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
