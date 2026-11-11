import React, { useEffect, useState, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

const SPECIES = ['Chien', 'Chat', 'Lapin', 'NAC', 'Oiseau', 'Reptile', 'Cheval', 'Autre'];

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtWeekDay(d) {
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function fmtDayLong(d) {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function isoLocal(date) {
  const tz = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tz).toISOString().slice(0, 16);
}

function pad(n) { return String(n).padStart(2, '0'); }

const KIND_LABELS = {
  lunch: '🍽 Pause déjeuner',
  vacation: '🌴 Vacances',
  training: '📚 Formation',
  off: '⛔ Indisponible',
  other: '⏸ Bloqué',
};

// Motif affiché dans une case d'agenda : le type de RDV, complété par le motif
// libre quand il en dit plus. Le texte « Réservation en ligne par … » est le
// remplissage automatique du formulaire public : il n'apporte rien ici.
function apptMotif(appt) {
  const typeLabel = (appt.typeName || appt.title || '').trim();
  const reason = (appt.reason || '').trim();
  const extra = /^R[ée]servation en ligne par /i.test(reason) ? '' : reason;
  if (!extra || extra === typeLabel) return typeLabel;
  return typeLabel ? `${typeLabel} · ${extra}` : extra;
}

export default function Calendar() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [view, setView] = useState(() => (window.innerWidth < 768 ? 'day' : 'week')); // 'week' or 'day'
  const [refDate, setRefDate] = useState(new Date());
  const [appointments, setAppointments] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [types, setTypes] = useState([]);
  const [owners, setOwners] = useState([]);
  const [patients, setPatients] = useState([]);
  const [settings, setSettings] = useState({});
  const [showApptModal, setShowApptModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [editingAppt, setEditingAppt] = useState(null);
  const [editingBlock, setEditingBlock] = useState(null);
  const [newOwner, setNewOwner] = useState(null);
  const [newPatient, setNewPatient] = useState(null);

  const openHour = parseInt(settings.cabinetOpenHour || '9', 10);
  const closeHour = parseInt(settings.cabinetCloseHour || '18', 10);
  const slotMinutes = parseInt(settings.cabinetSlotMinutes || '15', 10);

  const days = useMemo(() => {
    if (view === 'day') return [startOfDay(refDate)];
    const ws = startOfWeek(refDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ws);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [view, refDate]);

  const slotsPerHour = Math.floor(60 / slotMinutes);
  const totalSlots = (closeHour - openHour) * slotsPerHour;

  // Whatever the granularity, the grid should fill exactly the space available
  // below the toolbar down to the legend (or the bottom of the page) — never
  // taller (forcing a scrollbar) nor shorter (leaving blank space). We measure
  // that space live and derive the per-slot pixel height from it, instead of
  // using a fixed constant.
  const cardRef = useRef(null);
  const headerCellRef = useRef(null);
  const legendRef = useRef(null);
  const [dynamicSlotPx, setDynamicSlotPx] = useState(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const headerCell = headerCellRef.current;
    if (!card || !headerCell) return;
    const mainEl = card.closest('.main');
    if (!mainEl) return;

    function recompute() {
      // Below 769px the layout switches to a normally-scrolling page (see the
      // 768px breakpoint in index.css) — .main no longer has a fixed height,
      // so there's nothing meaningful to fill. Fall back to the old constants.
      if (window.innerWidth <= 768) { setDynamicSlotPx(null); return; }
      const mainRect = mainEl.getBoundingClientRect();
      const mainPaddingBottom = parseFloat(getComputedStyle(mainEl).paddingBottom) || 0;
      const cardTop = card.getBoundingClientRect().top;
      const headerH = headerCell.getBoundingClientRect().height;
      const legendBlock = legendRef.current ? legendRef.current.getBoundingClientRect().height + 8 /* .mt-2 */ : 0;
      const available = mainRect.bottom - mainPaddingBottom - cardTop - headerH - legendBlock;
      if (available > 0 && totalSlots > 0) setDynamicSlotPx(available / totalSlots);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(mainEl);
    window.addEventListener('resize', recompute);
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute); };
  }, [totalSlots, types.length, view]);

  // Pixel-perfect nudge: box-model details we don't hand-derive above (card
  // border, collapsed margins, subpixel rounding) can leave a few px of
  // residual over/underflow after that estimate. Measure it once the grid has
  // actually re-rendered and correct for exactly that amount. Self-limiting:
  // once overflow is ~0 the condition is false and no further update happens.
  useLayoutEffect(() => {
    if (dynamicSlotPx == null) return;
    const mainEl = cardRef.current?.closest('.main');
    if (!mainEl || window.innerWidth <= 768) return;
    const overflow = mainEl.scrollHeight - mainEl.clientHeight;
    if (Math.abs(overflow) > 0.5 && totalSlots > 0) {
      setDynamicSlotPx((prev) => Math.max(1, prev - overflow / totalSlots));
    }
  }, [dynamicSlotPx, totalSlots]);

  const slotPx = dynamicSlotPx || (view === 'day' ? 22 : 14);

  const load = useCallback(async () => {
    const start = startOfDay(days[0]);
    const end = new Date(days[days.length - 1]);
    end.setHours(23, 59, 59, 999);

    const [appts, blks] = await Promise.all([
      window.api.appointments.list({ startDate: start.toISOString(), endDate: end.toISOString() }),
      window.api.timeBlocks.list({ startDate: start.toISOString(), endDate: end.toISOString() }),
    ]);
    setAppointments(appts);
    setBlocks(blks);
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.api.appointmentTypes.list().then(setTypes);
    window.api.owners.list().then(setOwners);
    window.api.patients.list().then(setPatients);
    window.api.settings.get().then(setSettings);
  }, []);

  // Compute event placement
  function eventsForDay(day) {
    const dayStart = startOfDay(day);
    const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
    const items = [];

    for (const a of appointments) {
      const start = new Date(a.startTime);
      const end = new Date(a.endTime);
      if (end < dayStart || start > dayEnd) continue;
      items.push({ ...a, kind: 'appointment' });
    }

    // Expand blocks (recurring + single)
    for (const b of blocks) {
      const occurrences = expandBlock(b, day);
      for (const occ of occurrences) {
        items.push({ ...b, kind: 'block', startTime: occ.start.toISOString(), endTime: occ.end.toISOString() });
      }
    }
    return items;
  }

  function eventStyle(event, day) {
    const dayStart = startOfDay(day);
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    const startInMins = Math.max(0, (start - dayStart) / 60000 - openHour * 60);
    const endInMins = Math.min((closeHour - openHour) * 60, (end - dayStart) / 60000 - openHour * 60);
    const top = (startInMins / slotMinutes) * (slotPx);
    const height = Math.max(slotPx * 0.8, ((endInMins - startInMins) / slotMinutes) * slotPx - 1);
    return { top: `${top}px`, height: `${height}px` };
  }

  const openNewAppt = (date, hour, minute = 0) => {
    const start = new Date(date);
    start.setHours(hour, minute, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 30);
    setEditingAppt({
      startTime: isoLocal(start),
      endTime: isoLocal(end),
      title: '',
      reason: '',
      ownerId: '',
      patientId: '',
      veterinarian: user?.role === 'veterinarian' ? user.fullName : '',
      status: 'scheduled',
      appointmentTypeId: types[0]?.id || '',
    });
    setShowApptModal(true);
  };

  const openEditAppt = (appt) => {
    setEditingAppt({
      ...appt,
      startTime: isoLocal(new Date(appt.startTime)),
      endTime: isoLocal(new Date(appt.endTime)),
      ownerId: appt.ownerId || '',
      patientId: appt.patientId || '',
      appointmentTypeId: appt.appointmentTypeId || '',
    });
    setShowApptModal(true);
  };

  const onTypeChange = (typeId) => {
    const t = types.find((x) => x.id === typeId);
    if (!t) { setEditingAppt({ ...editingAppt, appointmentTypeId: typeId }); return; }
    const start = new Date(editingAppt.startTime);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + (t.defaultDuration || 30));
    setEditingAppt({
      ...editingAppt,
      appointmentTypeId: typeId,
      title: editingAppt.title || t.name,
      endTime: isoLocal(end),
    });
  };

  const saveAppt = async () => {
    const data = {
      ...editingAppt,
      startTime: new Date(editingAppt.startTime).toISOString(),
      endTime: new Date(editingAppt.endTime).toISOString(),
      ownerId: editingAppt.ownerId || null,
      patientId: editingAppt.patientId || null,
      appointmentTypeId: editingAppt.appointmentTypeId || null,
    };
    try {
      if (editingAppt.id) await window.api.appointments.update(editingAppt.id, data);
      else {
        const created = await window.api.appointments.create({ ...data, createdBy: user?.id });
        if (created?.confirmationError) showToast(created.confirmationError, 'error');
        else if (created?.confirmationSentTo) showToast('Confirmation envoyée à ' + created.confirmationSentTo, 'success');
      }
    } catch (e) {
      // Motif refusé pour un client adressé par un confrère, entre autres.
      showToast(e.message, 'error');
      return;
    }
    setShowApptModal(false);
    setEditingAppt(null);
    load();
  };

  const removeAppt = async () => {
    if (!confirm('Supprimer ce rendez-vous ?')) return;
    await window.api.appointments.delete(editingAppt.id);
    setShowApptModal(false);
    load();
  };

  const sendReminderNow = async () => {
    try {
      const result = await window.api.reminders.sendNow(editingAppt.id);
      if (result.ok) showToast('Email de rappel envoyé ✓', 'success');
      else showToast('Échec : ' + (result.error || 'erreur inconnue'), 'error');
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const openNewBlock = () => {
    const start = new Date(refDate);
    start.setHours(12, 0, 0, 0);
    const end = new Date(start);
    end.setHours(14, 0, 0, 0);
    setEditingBlock({
      startTime: isoLocal(start),
      endTime: isoLocal(end),
      title: 'Pause déjeuner',
      kind: 'lunch',
      recurrence: '',
      description: '',
    });
    setShowBlockModal(true);
  };

  const openEditBlock = (block) => {
    setEditingBlock({
      ...block,
      startTime: isoLocal(new Date(block.startTime)),
      endTime: isoLocal(new Date(block.endTime)),
      recurrence: block.recurrence || '',
    });
    setShowBlockModal(true);
  };

  const saveBlock = async () => {
    const data = {
      ...editingBlock,
      startTime: new Date(editingBlock.startTime).toISOString(),
      endTime: new Date(editingBlock.endTime).toISOString(),
      recurrence: editingBlock.recurrence || null,
    };
    if (editingBlock.id) await window.api.timeBlocks.update(editingBlock.id, data);
    else await window.api.timeBlocks.create(data);
    setShowBlockModal(false);
    setEditingBlock(null);
    load();
  };

  const removeBlock = async () => {
    if (!confirm('Supprimer ce blocage ?')) return;
    await window.api.timeBlocks.delete(editingBlock.id);
    setShowBlockModal(false);
    load();
  };

  const filteredPatients = patients.filter(
    (p) => !editingAppt?.ownerId || p.ownerId === editingAppt.ownerId
  );

  // Client adressé par un confrère : on ne lui propose que les motifs autorisés
  // (réglage « Référés » des Paramètres), pour qu'il ne prenne pas un rendez-vous
  // de médecine générale. Le serveur applique la même règle.
  const referredAllowedIds = (settings.referredAllowedTypeIds || '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const apptOwner = editingAppt?.ownerId
    ? owners.find((o) => o.id === editingAppt.ownerId)
    : null;
  const typeRestricted = !!(apptOwner?.referredByVet && referredAllowedIds.length > 0);
  const selectableTypes = typeRestricted
    ? types.filter((t) => referredAllowedIds.includes(t.id))
    : types;

  // Strip accents + lowercase + trim so "Rex", "rex ", "Réx" all match
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  const findOwnerIn = (list, firstName, lastName) => {
    const f = norm(firstName), l = norm(lastName);
    if (!f && !l) return null;
    return list.find((o) => norm(o.firstName) === f && norm(o.lastName) === l) || null;
  };

  const findPatientIn = (list, ownerId, name) => {
    const n = norm(name);
    if (!n || !ownerId) return null;
    return list.find((p) => p.ownerId === ownerId && norm(p.name) === n) || null;
  };

  const openNewOwner = async (prefillName = '') => {
    // Refresh first to avoid a stale list
    const fresh = await window.api.owners.list();
    setOwners(fresh);
    const parts = prefillName.split(' ').filter(Boolean);
    const guessLast = parts[0] || prefillName;
    const guessFirst = parts.length > 1 ? parts.slice(1).join(' ') : '';
    const existing = findOwnerIn(fresh, guessFirst, guessLast)
                  || findOwnerIn(fresh, guessLast, guessFirst); // try swapped too
    if (existing) {
      showToast(`Propriétaire ${existing.lastName} ${existing.firstName} déjà enregistré — sélectionné`, 'success');
      setEditingAppt({ ...editingAppt, ownerId: existing.id, patientId: '' });
      return;
    }
    setNewOwner({
      firstName: guessFirst,
      lastName: guessLast,
      email: '', phone: '', address: '', city: '', postalCode: '', notes: '',
    });
  };

  const saveNewOwner = async () => {
    if (!newOwner.firstName?.trim() || !newOwner.lastName?.trim()) {
      showToast('Prénom et nom requis', 'error');
      return;
    }
    const fresh = await window.api.owners.list();
    setOwners(fresh);
    const existing = findOwnerIn(fresh, newOwner.firstName, newOwner.lastName);
    if (existing) {
      showToast(`Propriétaire ${existing.lastName} ${existing.firstName} déjà enregistré — sélectionné`, 'success');
      setEditingAppt({ ...editingAppt, ownerId: existing.id, patientId: '' });
      setNewOwner(null);
      return;
    }
    try {
      const created = await window.api.owners.create(newOwner);
      const list = await window.api.owners.list();
      setOwners(list);
      setEditingAppt({ ...editingAppt, ownerId: created.id, patientId: '' });
      setNewOwner(null);
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const openNewPatient = async (prefillName = '') => {
    if (!editingAppt?.ownerId) {
      showToast('Sélectionnez d\'abord un propriétaire', 'error');
      return;
    }
    const fresh = await window.api.patients.list();
    setPatients(fresh);
    const existing = findPatientIn(fresh, editingAppt.ownerId, prefillName);
    if (existing) {
      showToast(`${existing.name} est déjà enregistré pour ce propriétaire — sélectionné`, 'success');
      setEditingAppt({ ...editingAppt, patientId: existing.id });
      return;
    }
    setNewPatient({
      ownerId: editingAppt.ownerId,
      name: prefillName,
      species: 'Chien',
      breed: '', sex: '', birthDate: '', weight: '', color: '',
      microchipId: '', sterilized: false, allergies: '', notes: '',
    });
  };

  const saveNewPatient = async () => {
    if (!newPatient.name?.trim()) {
      showToast('Nom requis', 'error');
      return;
    }
    const fresh = await window.api.patients.list();
    setPatients(fresh);
    const existing = findPatientIn(fresh, newPatient.ownerId, newPatient.name);
    if (existing) {
      showToast(`${existing.name} est déjà enregistré pour ce propriétaire — sélectionné`, 'success');
      setEditingAppt({ ...editingAppt, patientId: existing.id });
      setNewPatient(null);
      return;
    }
    try {
      const data = { ...newPatient, weight: newPatient.weight ? parseFloat(newPatient.weight) : null };
      const created = await window.api.patients.create(data);
      const list = await window.api.patients.list();
      setPatients(list);
      setEditingAppt({ ...editingAppt, patientId: created.id });
      setNewPatient(null);
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const navigate = (delta) => {
    const d = new Date(refDate);
    d.setDate(d.getDate() + (view === 'day' ? delta : delta * 7));
    setRefDate(d);
  };

  return (
    <div>
      <div className="page-header">
        <h2>Agenda</h2>
        <div className="flex-row">
          <div className="view-toggle">
            <button className={`btn btn-sm ${view === 'day' ? 'btn-primary' : ''}`}
              onClick={() => setView('day')}>Jour</button>
            <button className={`btn btn-sm ${view === 'week' ? 'btn-primary' : ''}`}
              onClick={() => setView('week')}>Semaine</button>
          </div>
          <button className="btn btn-sm" onClick={() => navigate(-1)}>←</button>
          <button className="btn btn-sm" onClick={() => setRefDate(new Date())}>Aujourd'hui</button>
          <button className="btn btn-sm" onClick={() => navigate(1)}>→</button>
          <button className="btn btn-sm" onClick={openNewBlock}>⏸ Bloquer</button>
          <button className="btn btn-primary btn-sm" onClick={() => openNewAppt(refDate, openHour)}>+ RDV</button>
        </div>
      </div>

      {view === 'day' && (
        <div className="text-light mb-4" style={{ fontSize: 14 }}>
          {fmtDayLong(refDate)}
        </div>
      )}

      <div ref={cardRef} className="card" style={{ padding: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <CalendarGrid
          days={days}
          openHour={openHour}
          closeHour={closeHour}
          slotMinutes={slotMinutes}
          slotPx={slotPx}
          eventsForDay={eventsForDay}
          eventStyle={eventStyle}
          onSlotClick={openNewAppt}
          onApptClick={openEditAppt}
          onBlockClick={openEditBlock}
          types={types}
          view={view}
          headerCellRef={headerCellRef}
        />
      </div>

      {/* Légende : une seule ligne, pour laisser la hauteur à la grille */}
      {types.length > 0 && (
        <div ref={legendRef} className="cal-legend mt-2">
          {types.map((t) => (
            <span key={t.id} className="type-legend" title={`${t.name} — ${t.defaultDuration} min`}>
              <span className="type-color" style={{ background: t.color }} />
              {t.name}
            </span>
          ))}
        </div>
      )}

      {showApptModal && editingAppt && (
        <Modal
          title={editingAppt.id ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'}
          onClose={() => setShowApptModal(false)}
          footer={
            <>
              {editingAppt.id && <button className="btn btn-danger" onClick={removeAppt}>Supprimer</button>}
              {editingAppt.id && <button className="btn" onClick={sendReminderNow}>✉ Envoyer rappel maintenant</button>}
              <button className="btn" onClick={() => setShowApptModal(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={saveAppt}>Enregistrer</button>
            </>
          }
        >
          <div className="form-row">
            <div className="form-group">
              <label>Type *</label>
              <select className="select" value={editingAppt.appointmentTypeId || ''}
                onChange={(e) => onTypeChange(e.target.value)}>
                <option value="">— Aucun —</option>
                {selectableTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.defaultDuration} min)</option>
                ))}
              </select>
              {typeRestricted && (
                <small className="text-light">
                  🔗 Client adressé par {apptOwner.referringVetName ? `Dr ${apptOwner.referringVetName}` : 'un confrère'} :
                  motifs limités.
                </small>
              )}
            </div>
            <div className="form-group">
              <label>Titre *</label>
              <input className="input" value={editingAppt.title}
                onChange={(e) => setEditingAppt({ ...editingAppt, title: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Début *</label>
              <input className="input" type="datetime-local" value={editingAppt.startTime}
                onChange={(e) => setEditingAppt({ ...editingAppt, startTime: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Fin *</label>
              <input className="input" type="datetime-local" value={editingAppt.endTime}
                onChange={(e) => setEditingAppt({ ...editingAppt, endTime: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Propriétaire
                {editingAppt.ownerId && (
                  <Link to={`/owners/${editingAppt.ownerId}`}
                    style={{ marginLeft: 8, fontWeight: 'normal', fontSize: 12 }}>
                    → Voir la fiche
                  </Link>
                )}
              </label>
              <SearchSelect
                value={editingAppt.ownerId}
                onChange={(id) => setEditingAppt((prev) => {
                  const o = owners.find((x) => x.id === id);
                  const restricted = o?.referredByVet && referredAllowedIds.length > 0;
                  const keepType = !restricted || referredAllowedIds.includes(prev.appointmentTypeId);
                  return {
                    ...prev, ownerId: id, patientId: '', appointmentTypeId: keepType ? prev.appointmentTypeId : '',
                    // Client adressé par un confrère : confirmation par mail proposée d'office.
                    notifyOwner: !prev.id && !!o?.referredByVet && !!o?.email,
                  };
                })}
                options={owners.map((o) => ({
                  id: o.id,
                  label: `${o.lastName} ${o.firstName}`,
                  sub: [o.email, o.phone].filter(Boolean).join(' · ') || null,
                  keywords: `${o.email || ''} ${o.phone || ''} ${o.city || ''}`,
                }))}
                placeholder="Rechercher un propriétaire…"
                onCreate={openNewOwner}
                createLabel="Nouveau propriétaire"
              />
            </div>
            <div className="form-group">
              <label>Patient
                {editingAppt.patientId && (
                  <Link to={`/patients/${editingAppt.patientId}`}
                    style={{ marginLeft: 8, fontWeight: 'normal', fontSize: 12 }}>
                    → Voir la fiche
                  </Link>
                )}
              </label>
              <SearchSelect
                value={editingAppt.patientId}
                onChange={(id) => setEditingAppt({ ...editingAppt, patientId: id })}
                options={filteredPatients.map((p) => ({
                  id: p.id,
                  label: `${p.name} (${p.species})`,
                  sub: p.breed || null,
                  keywords: `${p.breed || ''} ${p.species}`,
                }))}
                placeholder={editingAppt.ownerId ? 'Rechercher un patient…' : 'Choisir d\'abord un propriétaire'}
                onCreate={editingAppt.ownerId ? openNewPatient : undefined}
                createLabel="Nouveau patient"
                disabled={!editingAppt.ownerId}
              />
            </div>
          </div>
          {!editingAppt.id && apptOwner && (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'normal', cursor: apptOwner.email ? 'pointer' : 'default' }}>
                <input type="checkbox" disabled={!apptOwner.email}
                  checked={!!editingAppt.notifyOwner && !!apptOwner.email}
                  onChange={(e) => setEditingAppt({ ...editingAppt, notifyOwner: e.target.checked })} />
                ✉ Envoyer une confirmation par mail au propriétaire
                {apptOwner.email
                  ? <span className="text-light">({apptOwner.email})</span>
                  : <span className="text-light">— aucune adresse email sur la fiche</span>}
              </label>
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Motif</label>
              <input className="input" value={editingAppt.reason || ''}
                onChange={(e) => setEditingAppt({ ...editingAppt, reason: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Vétérinaire</label>
              <input className="input" value={editingAppt.veterinarian || ''}
                onChange={(e) => setEditingAppt({ ...editingAppt, veterinarian: e.target.value })} />
            </div>
          </div>
          <div className="form-row cols-1">
            <div className="form-group">
              <label>Statut</label>
              <select className="select" value={editingAppt.status}
                onChange={(e) => setEditingAppt({ ...editingAppt, status: e.target.value })}>
                <option value="scheduled">Planifié</option>
                <option value="confirmed">Confirmé par le client</option>
                <option value="completed">Terminé</option>
                <option value="cancelled">Annulé</option>
              </select>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea className="textarea" value={editingAppt.notes || ''}
                onChange={(e) => setEditingAppt({ ...editingAppt, notes: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}

      {newOwner && (
        <Modal
          title="Nouveau propriétaire"
          onClose={() => setNewOwner(null)}
          footer={
            <>
              <button className="btn" onClick={() => setNewOwner(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={saveNewOwner}>Créer</button>
            </>
          }
        >
          <div className="form-row">
            <div className="form-group">
              <label>Prénom *</label>
              <input className="input" autoFocus value={newOwner.firstName}
                onChange={(e) => setNewOwner({ ...newOwner, firstName: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Nom *</label>
              <input className="input" value={newOwner.lastName}
                onChange={(e) => setNewOwner({ ...newOwner, lastName: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input className="input" type="email" value={newOwner.email}
                onChange={(e) => setNewOwner({ ...newOwner, email: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Téléphone</label>
              <input className="input" value={newOwner.phone}
                onChange={(e) => setNewOwner({ ...newOwner, phone: e.target.value })} />
            </div>
          </div>
          <div className="form-row cols-1">
            <div className="form-group">
              <label>Adresse</label>
              <input className="input" value={newOwner.address}
                onChange={(e) => setNewOwner({ ...newOwner, address: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Code postal</label>
              <input className="input" value={newOwner.postalCode}
                onChange={(e) => setNewOwner({ ...newOwner, postalCode: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Ville</label>
              <input className="input" value={newOwner.city}
                onChange={(e) => setNewOwner({ ...newOwner, city: e.target.value })} />
            </div>
          </div>
          <small className="text-light">Vous pourrez compléter les autres informations depuis la fiche du propriétaire.</small>
        </Modal>
      )}

      {newPatient && (
        <Modal
          title="Nouveau patient"
          onClose={() => setNewPatient(null)}
          footer={
            <>
              <button className="btn" onClick={() => setNewPatient(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={saveNewPatient}>Créer</button>
            </>
          }
        >
          <div className="form-row">
            <div className="form-group">
              <label>Nom *</label>
              <input className="input" autoFocus value={newPatient.name}
                onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Espèce *</label>
              <select className="select" value={newPatient.species}
                onChange={(e) => setNewPatient({ ...newPatient, species: e.target.value })}>
                {SPECIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Race</label>
              <input className="input" value={newPatient.breed}
                onChange={(e) => setNewPatient({ ...newPatient, breed: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Sexe</label>
              <select className="select" value={newPatient.sex}
                onChange={(e) => setNewPatient({ ...newPatient, sex: e.target.value })}>
                <option value="">—</option>
                <option value="M">Mâle</option>
                <option value="F">Femelle</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Date de naissance</label>
              <input className="input" type="date" value={newPatient.birthDate}
                onChange={(e) => setNewPatient({ ...newPatient, birthDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Poids (kg)</label>
              <input className="input" type="number" step="0.1" value={newPatient.weight}
                onChange={(e) => setNewPatient({ ...newPatient, weight: e.target.value })} />
            </div>
          </div>
          <small className="text-light">Vous pourrez compléter les autres informations depuis la fiche du patient.</small>
        </Modal>
      )}

      {showBlockModal && editingBlock && (
        <Modal
          title={editingBlock.id ? 'Modifier le blocage' : 'Bloquer un créneau'}
          onClose={() => setShowBlockModal(false)}
          footer={
            <>
              {editingBlock.id && <button className="btn btn-danger" onClick={removeBlock}>Supprimer</button>}
              <button className="btn" onClick={() => setShowBlockModal(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={saveBlock}>Enregistrer</button>
            </>
          }
        >
          <div className="form-row">
            <div className="form-group">
              <label>Titre *</label>
              <input className="input" value={editingBlock.title}
                onChange={(e) => setEditingBlock({ ...editingBlock, title: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select className="select" value={editingBlock.kind}
                onChange={(e) => setEditingBlock({ ...editingBlock, kind: e.target.value })}>
                <option value="lunch">🍽 Pause déjeuner</option>
                <option value="vacation">🌴 Vacances</option>
                <option value="training">📚 Formation</option>
                <option value="off">⛔ Indisponible</option>
                <option value="other">⏸ Autre</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Début *</label>
              <input className="input" type="datetime-local" value={editingBlock.startTime}
                onChange={(e) => setEditingBlock({ ...editingBlock, startTime: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Fin *</label>
              <input className="input" type="datetime-local" value={editingBlock.endTime}
                onChange={(e) => setEditingBlock({ ...editingBlock, endTime: e.target.value })} />
            </div>
          </div>
          <div className="form-row cols-1">
            <div className="form-group">
              <label>Récurrence</label>
              <select className="select" value={editingBlock.recurrence || ''}
                onChange={(e) => setEditingBlock({ ...editingBlock, recurrence: e.target.value })}>
                <option value="">Une seule fois</option>
                <option value="daily">Tous les jours</option>
                <option value="weekdays">Du lundi au vendredi</option>
                <option value="weekly">Toutes les semaines (même jour)</option>
              </select>
              <small className="text-light">
                Si vous choisissez une récurrence, l'heure de début/fin se répète chaque jour concerné.
              </small>
            </div>
            <div className="form-group">
              <label>Description</label>
              <input className="input" value={editingBlock.description || ''}
                onChange={(e) => setEditingBlock({ ...editingBlock, description: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Expand a block into actual occurrences for a given day, based on its recurrence
function expandBlock(block, day) {
  const dayStart = startOfDay(day);
  const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
  const blockStart = new Date(block.startTime);
  const blockEnd = new Date(block.endTime);

  // No recurrence: only show if the day overlaps
  if (!block.recurrence) {
    if (blockEnd >= dayStart && blockStart <= dayEnd) {
      return [{ start: blockStart, end: blockEnd }];
    }
    return [];
  }

  // Recurrence: only after the original startTime date
  if (day < startOfDay(blockStart)) return [];

  const dayOfWeek = day.getDay(); // 0=Sun..6=Sat
  let matches = false;
  if (block.recurrence === 'daily') matches = true;
  else if (block.recurrence === 'weekdays') matches = dayOfWeek >= 1 && dayOfWeek <= 5;
  else if (block.recurrence === 'weekly') matches = dayOfWeek === blockStart.getDay();

  if (!matches) return [];

  const occStart = new Date(day);
  occStart.setHours(blockStart.getHours(), blockStart.getMinutes(), 0, 0);
  const occEnd = new Date(day);
  occEnd.setHours(blockEnd.getHours(), blockEnd.getMinutes(), 0, 0);
  if (occEnd <= occStart) occEnd.setDate(occEnd.getDate() + 1);
  return [{ start: occStart, end: occEnd }];
}

// Rendez-vous qui se chevauchent : placés côte à côte plutôt qu'empilés.
// Chaque groupe de RDV liés par un chevauchement partage la largeur de la
// colonne du jour ; chaque RDV prend la première sous-colonne libre.
function layoutOverlaps(events) {
  const appts = events
    .filter((e) => e.kind === 'appointment')
    .map((e) => ({ e, start: new Date(e.startTime).getTime(), end: new Date(e.endTime).getTime() }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const layout = new Map();
  let group = [];
  let colEnds = [];
  let groupEnd = -Infinity;
  const flush = () => {
    for (const g of group) layout.set(g.e, { col: g.col, cols: colEnds.length });
    group = []; colEnds = []; groupEnd = -Infinity;
  };
  for (const a of appts) {
    if (a.start >= groupEnd) flush();
    let col = colEnds.findIndex((end) => end <= a.start);
    if (col === -1) { col = colEnds.length; colEnds.push(a.end); } else colEnds[col] = a.end;
    a.col = col;
    group.push(a);
    groupEnd = Math.max(groupEnd, a.end);
  }
  flush();
  return layout;
}

function CalendarGrid({ days, openHour, closeHour, slotMinutes, slotPx, eventsForDay, eventStyle, onSlotClick, onApptClick, onBlockClick, view, headerCellRef }) {
  const slotsPerHour = Math.floor(60 / slotMinutes);
  const hours = Array.from({ length: closeHour - openHour }, (_, i) => openHour + i);

  return (
    <div className="cal-container" style={{
      display: 'grid',
      gridTemplateColumns: `60px repeat(${days.length}, 1fr)`,
      minWidth: days.length > 1 ? `${60 + days.length * 100}px` : undefined,
    }}>
      <div ref={headerCellRef} className="cal-cell-hdr"></div>
      {days.map((d, i) => (
        <div key={i} className="cal-cell-hdr">
          {view === 'day'
            ? d.toLocaleDateString('fr-FR', { weekday: 'long' })
            : d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
        </div>
      ))}

      <div className="cal-time-col">
        {hours.map((h) => (
          <div key={h} className="cal-hour-label" style={{ height: `${slotPx * slotsPerHour}px` }}>
            {h}h
          </div>
        ))}
      </div>

      {days.map((day, di) => {
        const events = eventsForDay(day);
        const overlaps = layoutOverlaps(events);
        return (
          <div key={di} className="cal-day-col" style={{
            height: `${slotPx * slotsPerHour * hours.length}px`,
          }}>
            {/* Slots clickable */}
            {hours.map((h) => (
              Array.from({ length: slotsPerHour }, (_, s) => (
                <div
                  key={`${h}-${s}`}
                  className="cal-slot"
                  style={{
                    height: `${slotPx}px`,
                    borderTop: s === 0 ? '1px solid var(--border)' : '1px dashed #f1f5f9',
                  }}
                  onClick={() => onSlotClick(day, h, s * slotMinutes)}
                />
              ))
            ))}

            {/* Render events */}
            {events.map((e, idx) => {
              const style = eventStyle(e, day);
              const pos = overlaps.get(e);
              if (pos && pos.cols > 1) {
                const w = `(100% - 4px) / ${pos.cols}`;
                style.left = `calc(2px + ${w} * ${pos.col})`;
                style.width = `calc(${w} - 2px)`;
                style.right = 'auto';
              }
              if (e.kind === 'block') {
                return (
                  <div
                    key={`b-${e.id}-${idx}`}
                    className="cal-block"
                    style={style}
                    onClick={(ev) => { ev.stopPropagation(); onBlockClick(e); }}
                    title={e.title + (e.description ? ' — ' + e.description : '')}
                  >
                    <div className="cal-block-content">
                      {KIND_LABELS[e.kind] || '⏸'} {e.title}
                    </div>
                  </div>
                );
              }
              const color = e.typeColor || '#64748b';
              const isCancelled = e.status === 'cancelled';
              const time = new Date(e.startTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              const patient = e.patientName || '';
              const owner = [e.ownerLastName, e.ownerFirstName].filter(Boolean).join(' ');
              const motif = apptMotif(e);
              // La case affiche toujours patient / propriétaire / motif ; seule
              // la mise en page se resserre quand le créneau est court, pour que
              // les trois informations restent lisibles sans déborder.
              const boxHeight = parseFloat(style.height) || 0;
              const lines = boxHeight >= 40 ? 3 : boxHeight >= 27 ? 2 : 1;
              // Sur deux lignes, le propriétaire se réduit à son nom de famille
              // et rejoint le patient, pour laisser une ligne entière au motif.
              const shortOwner = e.ownerLastName || owner;
              const parts = [patient, shortOwner, motif].filter(Boolean);
              return (
                <div
                  key={`a-${e.id}-${idx}`}
                  className={`cal-appt ${isCancelled ? 'cancelled' : ''} status-${e.status}`}
                  style={{
                    ...style,
                    background: color + (isCancelled ? '40' : 'ee'),
                    borderLeft: `4px solid ${color}`,
                  }}
                  onClick={(ev) => { ev.stopPropagation(); onApptClick(e); }}
                  title={[`${time} — ${patient || 'Sans patient'}`, owner, motif].filter(Boolean).join('\n')}
                >
                  {lines === 1 ? (
                    <div className="cal-appt-line">
                      <span className="cal-appt-time">{time}</span>
                      {parts.join(' · ')}
                    </div>
                  ) : lines === 2 ? (
                    <>
                      <div className="cal-appt-line">
                        <span className="cal-appt-time">{time}</span>
                        <span className="cal-appt-patient">{patient}</span>
                        {patient && shortOwner ? ' · ' : ''}{shortOwner}
                      </div>
                      <div className="cal-appt-line cal-appt-sub">{motif}</div>
                    </>
                  ) : (
                    <>
                      <div className="cal-appt-line">
                        <span className="cal-appt-time">{time}</span>
                        <span className="cal-appt-patient">{patient}</span>
                      </div>
                      <div className="cal-appt-line cal-appt-sub">{owner}</div>
                      <div className="cal-appt-line cal-appt-sub">{motif}</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
