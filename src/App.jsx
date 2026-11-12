import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import FirstRun from './pages/FirstRun.jsx';
import ServerError from './pages/ServerError.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Calendar from './pages/Calendar.jsx';
import Owners from './pages/Owners.jsx';
import OwnerDetail from './pages/OwnerDetail.jsx';
import Patients from './pages/Patients.jsx';
import PatientDetail from './pages/PatientDetail.jsx';
import Medicines from './pages/Medicines.jsx';
import Stock from './pages/Stock.jsx';
import Reports from './pages/Reports.jsx';
import Services from './pages/Services.jsx';
import Protocols from './pages/Protocols.jsx';
import RecordTemplates from './pages/RecordTemplates.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import NewInvoice from './pages/NewInvoice.jsx';
import Quotes from './pages/Quotes.jsx';
import SageExport from './pages/SageExport.jsx';
import Settings from './pages/Settings.jsx';
import Users from './pages/Users.jsx';
import RecordPrint from './pages/RecordPrint.jsx';
import Security, { Mandatory2FA } from './pages/Security.jsx';
import SetupWizard from './pages/SetupWizard.jsx';
import Import from './pages/Import.jsx';
import { TermsText, TermsCheckbox, TERMS_VERSION } from './components/TermsOfUse.jsx';
import Referrals from './pages/Referrals.jsx';
import ReferralDetail from './pages/ReferralDetail.jsx';
import ReferringVets from './pages/ReferringVets.jsx';
import ReferringVetDetail from './pages/ReferringVetDetail.jsx';

function ProtectedRoute({ permission, children }) {
  const { can } = useAuth();
  if (permission && !can(permission)) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  const { user, needsSetup, loading, serverError, mustEnroll2fa } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}>Chargement…</div>;
  }
  if (serverError) return <ServerError />;
  if (needsSetup) return <FirstRun />;
  if (!user) return <Login />;
  // Admins must enable 2FA before accessing anything else.
  if (mustEnroll2fa) return <Mandatory2FA />;
  return <SetupGate user={user}><MainRoutes location={location} /></SetupGate>;
}

// Installation neuve : l'administrateur passe d'abord par le paramétrage rapide.
// Installation existante sans accord (ou accord sur une ancienne version des
// conditions) : l'administrateur accepte les conditions d'utilisation une fois.
function SetupGate({ user, children }) {
  const [needed, setNeeded] = useState(user.role === 'admin' ? null : false);
  const [termsNeeded, setTermsNeeded] = useState(false);
  useEffect(() => {
    if (user.role !== 'admin') return;
    window.api.settings.get()
      .then((s) => {
        setTermsNeeded(s.termsVersion !== TERMS_VERSION);
        setNeeded(s.setupCompleted === '0');
      })
      .catch(() => setNeeded(false));
  }, [user.id, user.role]);
  if (needed === null) return <div style={{ padding: 40, textAlign: 'center' }}>Chargement…</div>;
  if (termsNeeded) return <TermsGate onDone={() => setTermsNeeded(false)} />;
  if (needed) return <SetupWizard onDone={() => setNeeded(false)} />;
  return children;
}

function TermsGate({ onDone }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const accept = async () => {
    setBusy(true); setError(null);
    try { await window.api.terms.accept(); onDone(); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <h1>Conditions d'utilisation</h1>
        <p className="text-light text-center mb-4">
          À lire et accepter une fois par l'administrateur du cabinet.
        </p>
        <TermsText />
        <TermsCheckbox checked={accepted} onChange={setAccepted} />
        {error && <div className="auth-error">{error}</div>}
        <button className="btn btn-primary" onClick={accept} disabled={!accepted || busy}
          style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}>
          {busy ? 'Enregistrement…' : 'Accepter et continuer'}
        </button>
      </div>
    </div>
  );
}

function MainRoutes({ location }) {

  // Print-only routes: bypass the Layout (no sidebar/header).
  // Used by Electron's hidden BrowserWindow → printToPDF for record/invoice exports.
  if (location.pathname.endsWith('/print')) {
    return (
      <Routes>
        <Route path="/records/:id/print" element={<RecordPrint />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/owners" element={<Owners />} />
        <Route path="/owners/:id" element={<OwnerDetail />} />
        <Route path="/patients" element={<Patients />} />
        <Route path="/patients/:id" element={<PatientDetail />} />
        <Route path="/medicines" element={<Medicines />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/reports" element={
          <ProtectedRoute permission="reports"><Reports /></ProtectedRoute>
        } />
        <Route path="/services" element={<Services />} />
        <Route path="/record-templates" element={
          <ProtectedRoute permission="patients"><RecordTemplates /></ProtectedRoute>
        } />
        <Route path="/protocols" element={
          <ProtectedRoute permission="invoices"><Protocols /></ProtectedRoute>
        } />
        <Route path="/invoices" element={
          <ProtectedRoute permission="invoices"><Invoices /></ProtectedRoute>
        } />
        <Route path="/invoices/new" element={
          <ProtectedRoute permission="invoices"><NewInvoice /></ProtectedRoute>
        } />
        <Route path="/invoices/:id/edit" element={
          <ProtectedRoute permission="invoices"><NewInvoice /></ProtectedRoute>
        } />
        <Route path="/invoices/:id" element={
          <ProtectedRoute permission="invoices"><InvoiceDetail /></ProtectedRoute>
        } />
        <Route path="/quotes" element={
          <ProtectedRoute permission="invoices"><Quotes /></ProtectedRoute>
        } />
        <Route path="/quotes/new" element={
          <ProtectedRoute permission="invoices"><NewInvoice key="quote" mode="quote" /></ProtectedRoute>
        } />
        <Route path="/quotes/:id/edit" element={
          <ProtectedRoute permission="invoices"><NewInvoice key="quote" mode="quote" /></ProtectedRoute>
        } />
        <Route path="/quotes/:id" element={
          <ProtectedRoute permission="invoices"><InvoiceDetail key="quote" mode="quote" /></ProtectedRoute>
        } />
        <Route path="/sage" element={
          <ProtectedRoute permission="sage"><SageExport /></ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute permission="settings"><Settings /></ProtectedRoute>
        } />
        <Route path="/import" element={
          <ProtectedRoute permission="settings"><Import /></ProtectedRoute>
        } />
        <Route path="/users" element={
          <ProtectedRoute permission="users"><Users /></ProtectedRoute>
        } />
        <Route path="/security" element={<Security />} />
        <Route path="/referrals" element={<Referrals />} />
        <Route path="/referrals/:id" element={<ReferralDetail />} />
        <Route path="/referring-vets" element={<ReferringVets />} />
        <Route path="/referring-vets/:id" element={<ReferringVetDetail />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ToastProvider>
  );
}
