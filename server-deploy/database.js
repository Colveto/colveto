const BetterSqlite3 = require('better-sqlite3');
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const { ORTHO_TEMPLATES } = require('./record-templates-seed');

class Database {
  constructor(dbPath) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
    this.migrate();
    this.seedIfEmpty();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS owners (
        id TEXT PRIMARY KEY,
        firstName TEXT NOT NULL,
        lastName TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        address TEXT,
        city TEXT,
        postalCode TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        name TEXT NOT NULL,
        species TEXT NOT NULL,
        breed TEXT,
        sex TEXT,
        birthDate TEXT,
        weight REAL,
        color TEXT,
        microchipId TEXT,
        sterilized INTEGER DEFAULT 0,
        allergies TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (ownerId) REFERENCES owners(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS medical_records (
        id TEXT PRIMARY KEY,
        patientId TEXT NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        treatment TEXT,
        weight REAL,
        temperature REAL,
        veterinarian TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        patientId TEXT,
        ownerId TEXT,
        startTime TEXT NOT NULL,
        endTime TEXT NOT NULL,
        title TEXT NOT NULL,
        reason TEXT,
        status TEXT DEFAULT 'scheduled',
        veterinarian TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE SET NULL,
        FOREIGN KEY (ownerId) REFERENCES owners(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        code TEXT,
        name TEXT NOT NULL,
        description TEXT,
        priceHT REAL NOT NULL,
        vatRate REAL DEFAULT 20.0,
        accountCode TEXT DEFAULT '706000'
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        ownerId TEXT NOT NULL,
        patientId TEXT,
        date TEXT NOT NULL,
        dueDate TEXT,
        status TEXT DEFAULT 'draft',
        totalHT REAL NOT NULL,
        totalVAT REAL NOT NULL,
        totalTTC REAL NOT NULL,
        notes TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (ownerId) REFERENCES owners(id),
        FOREIGN KEY (patientId) REFERENCES patients(id)
      );

      CREATE TABLE IF NOT EXISTS invoice_items (
        id TEXT PRIMARY KEY,
        invoiceId TEXT NOT NULL,
        serviceId TEXT,
        description TEXT NOT NULL,
        quantity REAL DEFAULT 1,
        priceHT REAL NOT NULL,
        vatRate REAL DEFAULT 20.0,
        accountCode TEXT DEFAULT '706000',
        FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS appointment_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        defaultDuration INTEGER NOT NULL DEFAULT 30,
        color TEXT NOT NULL DEFAULT '#2563eb',
        description TEXT,
        sortOrder INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS time_blocks (
        id TEXT PRIMARY KEY,
        startTime TEXT NOT NULL,
        endTime TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        kind TEXT DEFAULT 'other',
        recurrence TEXT,
        createdAt TEXT NOT NULL,
        createdBy TEXT
      );

      CREATE TABLE IF NOT EXISTS follow_up_reminders (
        id TEXT PRIMARY KEY,
        patientId TEXT NOT NULL,
        medicalRecordId TEXT,
        type TEXT,
        title TEXT NOT NULL,
        notes TEXT,
        scheduledDate TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sentAt TEXT,
        errorMsg TEXT,
        createdAt TEXT NOT NULL,
        createdBy TEXT,
        FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (medicalRecordId) REFERENCES medical_records(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_followup_date ON follow_up_reminders(scheduledDate, status);

      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        appointmentId TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'email',
        recipient TEXT,
        status TEXT NOT NULL,
        scheduledAt TEXT,
        sentAt TEXT,
        errorMsg TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (appointmentId) REFERENCES appointments(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_reminders_appointment ON reminders(appointmentId);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        fullName TEXT NOT NULL,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'assistant',
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        lastLogin TEXT
      );

      CREATE TABLE IF NOT EXISTS medicines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        atcCode TEXT,
        description TEXT,
        baseUnit TEXT NOT NULL DEFAULT 'unité',
        packagingDescription TEXT,
        defaultVatRate REAL NOT NULL DEFAULT 3.0,
        minStockAlert REAL NOT NULL DEFAULT 0,
        targetMarginPct REAL NOT NULL DEFAULT 35.0,
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        createdAt TEXT NOT NULL,
        createdBy TEXT
      );

      CREATE TABLE IF NOT EXISTS medicine_sale_units (
        id TEXT PRIMARY KEY,
        medicineId TEXT NOT NULL,
        name TEXT NOT NULL,
        quantityInBaseUnit REAL NOT NULL,
        defaultPriceHT REAL NOT NULL DEFAULT 0,
        isDefault INTEGER NOT NULL DEFAULT 0,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (medicineId) REFERENCES medicines(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS medicine_lots (
        id TEXT PRIMARY KEY,
        medicineId TEXT NOT NULL,
        lotNumber TEXT NOT NULL,
        expiryDate TEXT NOT NULL,
        supplierName TEXT,
        purchaseDate TEXT NOT NULL,
        purchasePriceHT REAL NOT NULL DEFAULT 0,
        initialQuantityBaseUnit REAL NOT NULL,
        remainingQuantityBaseUnit REAL NOT NULL,
        notes TEXT,
        createdAt TEXT NOT NULL,
        createdBy TEXT,
        FOREIGN KEY (medicineId) REFERENCES medicines(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS medicine_dispensings (
        id TEXT PRIMARY KEY,
        patientId TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        lotId TEXT NOT NULL,
        saleUnitId TEXT NOT NULL,
        quantitySold REAL NOT NULL,
        baseUnitsConsumed REAL NOT NULL,
        date TEXT NOT NULL,
        prescribedBy TEXT,
        invoiceId TEXT,
        invoiceItemId TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (patientId) REFERENCES patients(id),
        FOREIGN KEY (ownerId) REFERENCES owners(id),
        FOREIGN KEY (lotId) REFERENCES medicine_lots(id),
        FOREIGN KEY (saleUnitId) REFERENCES medicine_sale_units(id),
        FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS monthly_overheads (
        id TEXT PRIMARY KEY,
        yearMonth TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        amountHT REAL NOT NULL DEFAULT 0,
        notes TEXT,
        createdAt TEXT NOT NULL,
        createdBy TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_overheads_month ON monthly_overheads(yearMonth);

      CREATE TABLE IF NOT EXISTS protocols (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL,
        createdBy TEXT
      );

      CREATE TABLE IF NOT EXISTS protocol_items (
        id TEXT PRIMARY KEY,
        protocolId TEXT NOT NULL,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'act',
        serviceId TEXT,
        medicineId TEXT,
        saleUnitId TEXT,
        description TEXT NOT NULL,
        quantityMode TEXT NOT NULL DEFAULT 'fixed',
        quantity REAL NOT NULL DEFAULT 1,
        priceHT REAL NOT NULL DEFAULT 0,
        vatRate REAL NOT NULL DEFAULT 17,
        accountCode TEXT DEFAULT '706000',
        FOREIGN KEY (protocolId) REFERENCES protocols(id) ON DELETE CASCADE,
        FOREIGN KEY (serviceId) REFERENCES services(id) ON DELETE SET NULL,
        FOREIGN KEY (medicineId) REFERENCES medicines(id) ON DELETE SET NULL,
        FOREIGN KEY (saleUnitId) REFERENCES medicine_sale_units(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS lab_requests (
        id TEXT PRIMARY KEY,
        patientId TEXT NOT NULL,
        requisitionNumber TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requestedTests TEXT,
        note TEXT,
        createdBy TEXT,
        createdAt TEXT NOT NULL,
        sentAt TEXT,
        error TEXT,
        FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS lab_results (
        id TEXT PRIMARY KEY,
        patientId TEXT,
        requestId TEXT,
        diagnosticSetId TEXT,
        requisitionNumber TEXT,
        instrument TEXT,
        runDate TEXT,
        messageSubType TEXT,
        clientLastName TEXT,
        clientFirstName TEXT,
        patientName TEXT,
        patientSpecies TEXT,
        reportPdfPath TEXT,
        sourceFile TEXT NOT NULL UNIQUE,
        notes TEXT,
        rawXml TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE SET NULL,
        FOREIGN KEY (requestId) REFERENCES lab_requests(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS lab_assays (
        id TEXT PRIMARY KEY,
        resultId TEXT NOT NULL,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        assayName TEXT NOT NULL,
        value TEXT,
        valueNum REAL,
        unit TEXT,
        qualifier TEXT,
        refCriticalLow REAL,
        refLow REAL,
        refHigh REAL,
        refCriticalHigh REAL,
        flag TEXT,
        FOREIGN KEY (resultId) REFERENCES lab_results(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_patients_owner ON patients(ownerId);
      CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(startTime);
      CREATE INDEX IF NOT EXISTS idx_records_patient ON medical_records(patientId);
      CREATE INDEX IF NOT EXISTS idx_invoices_owner ON invoices(ownerId);
      CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
      CREATE INDEX IF NOT EXISTS idx_blocks_start ON time_blocks(startTime);
      CREATE INDEX IF NOT EXISTS idx_lots_medicine ON medicine_lots(medicineId, expiryDate);
      CREATE INDEX IF NOT EXISTS idx_lots_expiry ON medicine_lots(expiryDate);
      CREATE INDEX IF NOT EXISTS idx_dispensings_lot ON medicine_dispensings(lotId);
      CREATE INDEX IF NOT EXISTS idx_dispensings_patient ON medicine_dispensings(patientId, date);
      CREATE INDEX IF NOT EXISTS idx_sale_units_medicine ON medicine_sale_units(medicineId);
      CREATE INDEX IF NOT EXISTS idx_protocol_items_protocol ON protocol_items(protocolId, sortOrder);
      CREATE INDEX IF NOT EXISTS idx_lab_requests_patient ON lab_requests(patientId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_lab_requests_status ON lab_requests(status);
      CREATE INDEX IF NOT EXISTS idx_lab_requests_reqnum ON lab_requests(requisitionNumber);
      CREATE INDEX IF NOT EXISTS idx_lab_results_patient ON lab_results(patientId, runDate);
      CREATE INDEX IF NOT EXISTS idx_lab_results_set ON lab_results(diagnosticSetId);
      CREATE INDEX IF NOT EXISTS idx_lab_assays_result ON lab_assays(resultId, sortOrder);
    `);
  }

  migrate() {
    // Add createdBy columns to existing tables (no-op if already present)
    const cols = ['appointments', 'medical_records', 'invoices'];
    for (const table of cols) {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN createdBy TEXT`);
      } catch (e) {
        // column already exists
      }
    }
    // Add appointmentTypeId to appointments (no-op if already present)
    try {
      this.db.exec('ALTER TABLE appointments ADD COLUMN appointmentTypeId TEXT');
    } catch (e) {
      // column already exists
    }
    // Phase A medication tracking: extend invoice_items
    const invoiceItemCols = [
      "ALTER TABLE invoice_items ADD COLUMN kind TEXT DEFAULT 'act'",
      "ALTER TABLE invoice_items ADD COLUMN medicineId TEXT",
      "ALTER TABLE invoice_items ADD COLUMN lotId TEXT",
      "ALTER TABLE invoice_items ADD COLUMN saleUnitId TEXT",
      "ALTER TABLE invoice_items ADD COLUMN dispensingId TEXT",
      // Per-line patient: lets one invoice cover several animals of the same owner.
      "ALTER TABLE invoice_items ADD COLUMN patientId TEXT",
      // Remise : priceHT reste le prix NET (CA/TVA/Sage inchangés) ; on garde le prix
      // catalogue et le % pour l'affichage et pour pouvoir rééditer la remise.
      "ALTER TABLE invoice_items ADD COLUMN listPriceHT REAL",
      "ALTER TABLE invoice_items ADD COLUMN discountPct REAL",
    ];
    for (const sql of invoiceItemCols) {
      try { this.db.exec(sql); } catch (e) { /* already exists */ }
    }
    // Phase E: target margin per medicine
    try { this.db.exec("ALTER TABLE medicines ADD COLUMN targetMarginPct REAL NOT NULL DEFAULT 35.0"); } catch (e) {}
    // Legacy column from the removed Google Calendar sync — kept inert (no code reads it)
    try { this.db.exec('ALTER TABLE appointments ADD COLUMN googleEventId TEXT'); } catch (e) {}
    // Mode de paiement noté au passage en « payée » (cash, card, transfer, payconiq, cheque).
    try { this.db.exec('ALTER TABLE invoices ADD COLUMN paymentMethod TEXT'); } catch (e) {}
    try { this.db.exec('ALTER TABLE invoices ADD COLUMN paidAt TEXT'); } catch (e) {}
    // Caisse : comptages réels (count) et mouvements hors factures (withdrawal = sortie,
    // ex. dépôt en banque ; deposit = apport). Les encaissements viennent des factures.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cash_movements (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        note TEXT,
        createdAt TEXT NOT NULL,
        createdBy TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cash_movements_date ON cash_movements(date);
    `);
    // Budget control: category + VAT on monthly overheads
    const overheadCols = [
      'ALTER TABLE monthly_overheads ADD COLUMN category TEXT',
      'ALTER TABLE monthly_overheads ADD COLUMN vatRate REAL NOT NULL DEFAULT 0',
      'ALTER TABLE monthly_overheads ADD COLUMN vatRecoverable INTEGER NOT NULL DEFAULT 1',
    ];
    for (const sql of overheadCols) {
      try { this.db.exec(sql); } catch (e) { /* already exists */ }
    }
    // Security: track last password change to invalidate older JWTs
    try { this.db.exec('ALTER TABLE users ADD COLUMN passwordChangedAt TEXT'); } catch (e) { /* already exists */ }
    // 2FA (TOTP) columns
    try { this.db.exec('ALTER TABLE users ADD COLUMN totpSecret TEXT'); } catch (e) { /* already exists */ }
    try { this.db.exec('ALTER TABLE users ADD COLUMN totpEnabled INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* already exists */ }
    try { this.db.exec('ALTER TABLE users ADD COLUMN totpBackupCodes TEXT'); } catch (e) { /* already exists */ }
    // Réduction fournisseur sur prix net d'un lot (n'affecte pas le prix de vente)
    const lotDiscountCols = [
      'ALTER TABLE medicine_lots ADD COLUMN unitPriceHT REAL',
      'ALTER TABLE medicine_lots ADD COLUMN discountPct REAL',
    ];
    for (const sql of lotDiscountCols) {
      try { this.db.exec(sql); } catch (e) { /* already exists */ }
    }
    // Faits légaux/administratifs rattachés au patient (déclaration chien
    // dangereux, date d'identification électronique).
    const patientLegalCols = [
      'ALTER TABLE patients ADD COLUMN dangerousDog INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE patients ADD COLUMN microchipDate TEXT',
    ];
    for (const sql of patientLegalCols) {
      try { this.db.exec(sql); } catch (e) { /* already exists */ }
    }
    // Clients adressés par un confrère : la case de la fiche client pointe sur
    // une fiche de vétérinaire référent (table referring_vets ci-dessous).
    const ownerReferralCols = [
      'ALTER TABLE owners ADD COLUMN referredByVet INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE owners ADD COLUMN referringVetId TEXT',
    ];
    for (const sql of ownerReferralCols) {
      try { this.db.exec(sql); } catch (e) { /* already exists */ }
    }
    // Devis : mêmes lignes qu'une facture mais sans lot ni déstockage. Tables
    // séparées pour ne jamais entrer dans le CA, la TVA ou l'export Sage.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        ownerId TEXT NOT NULL,
        patientId TEXT,
        date TEXT NOT NULL,
        validUntil TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        totalHT REAL NOT NULL DEFAULT 0,
        totalVAT REAL NOT NULL DEFAULT 0,
        totalTTC REAL NOT NULL DEFAULT 0,
        notes TEXT,
        invoiceId TEXT,
        createdAt TEXT NOT NULL,
        createdBy TEXT,
        FOREIGN KEY (ownerId) REFERENCES owners(id),
        FOREIGN KEY (patientId) REFERENCES patients(id)
      );
      CREATE TABLE IF NOT EXISTS quote_items (
        id TEXT PRIMARY KEY,
        quoteId TEXT NOT NULL,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'act',
        serviceId TEXT,
        medicineId TEXT,
        saleUnitId TEXT,
        patientId TEXT,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        priceHT REAL NOT NULL DEFAULT 0,
        vatRate REAL NOT NULL DEFAULT 17,
        accountCode TEXT DEFAULT '706000',
        FOREIGN KEY (quoteId) REFERENCES quotes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quoteId, sortOrder);
    `);
    for (const sql of [
      'ALTER TABLE quote_items ADD COLUMN listPriceHT REAL',
      'ALTER TABLE quote_items ADD COLUMN discountPct REAL',
    ]) {
      try { this.db.exec(sql); } catch (e) { /* already exists */ }
    }

    // Login audit log
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS login_events (
        id TEXT PRIMARY KEY,
        userId TEXT,
        username TEXT,
        success INTEGER NOT NULL,
        reason TEXT,
        ip TEXT,
        userAgent TEXT,
        createdAt TEXT NOT NULL
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_login_events_created ON login_events(createdAt)');

    // Portail vétérinaires référents
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS referral_cases (
        id TEXT PRIMARY KEY,
        reference TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'submitted',
        referringVetCivility TEXT,
        referringVetName TEXT NOT NULL,
        referringVetClinic TEXT,
        referringVetEmail TEXT NOT NULL,
        referringVetPhone TEXT,
        ownerFirstName TEXT,
        ownerLastName TEXT,
        ownerEmail TEXT,
        ownerPhone TEXT,
        patientName TEXT NOT NULL,
        species TEXT,
        breed TEXT,
        sex TEXT,
        birthDate TEXT,
        weight REAL,
        reasonForReferral TEXT,
        urgency TEXT,
        notes TEXT,
        patientId TEXT,
        ownerId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        linkedAt TEXT,
        linkedBy TEXT,
        FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE SET NULL,
        FOREIGN KEY (ownerId) REFERENCES owners(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_referral_cases_status ON referral_cases(status, createdAt);
      CREATE INDEX IF NOT EXISTS idx_referral_cases_patient ON referral_cases(patientId);
    `);
    // Already-existing referral_cases tables (deployed before civilité was added) need the column too.
    try { this.db.exec('ALTER TABLE referral_cases ADD COLUMN referringVetCivility TEXT'); } catch (e) { /* already exists */ }
    this.db.exec(`

      CREATE TABLE IF NOT EXISTS referral_intake_files (
        id TEXT PRIMARY KEY,
        caseId TEXT NOT NULL,
        category TEXT NOT NULL,
        originalName TEXT NOT NULL,
        storedFilename TEXT NOT NULL,
        mimeType TEXT NOT NULL,
        sizeBytes INTEGER NOT NULL,
        uploadedAt TEXT NOT NULL,
        FOREIGN KEY (caseId) REFERENCES referral_cases(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_referral_intake_files_case ON referral_intake_files(caseId);

      CREATE TABLE IF NOT EXISTS referral_tokens (
        id TEXT PRIMARY KEY,
        caseId TEXT NOT NULL,
        tokenHash TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        revokedAt TEXT,
        lastUsedAt TEXT,
        useCount INTEGER NOT NULL DEFAULT 0,
        createdReason TEXT NOT NULL DEFAULT 'initial',
        FOREIGN KEY (caseId) REFERENCES referral_cases(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_referral_tokens_case ON referral_tokens(caseId);
      CREATE INDEX IF NOT EXISTS idx_referral_tokens_hash ON referral_tokens(tokenHash);

      CREATE TABLE IF NOT EXISTS referral_events (
        id TEXT PRIMARY KEY,
        caseId TEXT NOT NULL,
        type TEXT NOT NULL,
        fromStatus TEXT,
        toStatus TEXT,
        note TEXT,
        visibleToReferrer INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        createdBy TEXT,
        FOREIGN KEY (caseId) REFERENCES referral_cases(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_referral_events_case ON referral_events(caseId, createdAt);

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        patientId TEXT NOT NULL,
        medicalRecordId TEXT,
        category TEXT NOT NULL DEFAULT 'other',
        originalName TEXT NOT NULL,
        storedFilename TEXT NOT NULL,
        mimeType TEXT NOT NULL,
        sizeBytes INTEGER NOT NULL,
        notes TEXT,
        visibleToReferrer INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        createdBy TEXT,
        FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (medicalRecordId) REFERENCES medical_records(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_patient ON attachments(patientId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_attachments_record ON attachments(medicalRecordId);
    `);

    // Répertoire des vétérinaires qui nous adressent des cas. Alimenté à la
    // fois par le portail (dédoublonnage sur l'email) et à la main, car
    // beaucoup de confrères réfèrent simplement par mail ou par téléphone.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS referring_vets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        clinic TEXT,
        email TEXT,
        phone TEXT,
        address TEXT,
        postalCode TEXT,
        city TEXT,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_referring_vets_email ON referring_vets(email);

      -- Journal des dossiers/radios envoyés à un référent (traçabilité : qui a
      -- reçu quoi, quand).
      CREATE TABLE IF NOT EXISTS referral_vet_sends (
        id TEXT PRIMARY KEY,
        referringVetId TEXT NOT NULL,
        patientId TEXT,
        toEmail TEXT NOT NULL,
        subject TEXT,
        summary TEXT,
        sentAt TEXT NOT NULL,
        sentBy TEXT,
        FOREIGN KEY (referringVetId) REFERENCES referring_vets(id) ON DELETE CASCADE,
        FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_referral_vet_sends_vet ON referral_vet_sends(referringVetId, sentAt);
      CREATE INDEX IF NOT EXISTS idx_referral_vet_sends_patient ON referral_vet_sends(patientId, sentAt);
    `);
    // Rattachement des dossiers du portail à une fiche de référent
    try { this.db.exec('ALTER TABLE referral_cases ADD COLUMN referringVetId TEXT'); } catch (e) { /* already exists */ }
    this.backfillReferringVets();

    // Modèles de rapports (acte médical pré-rédigé à compléter)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS record_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        recordType TEXT,
        title TEXT,
        description TEXT,
        treatment TEXT,
        sortOrder INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT
      );
    `);
    // Modèles ortho livrés une seule fois : le drapeau évite de les recréer
    // si l'utilisateur les a supprimés.
    const seeded = this.db.prepare("SELECT value FROM settings WHERE key = 'recordTemplatesSeeded'").get();
    if (!seeded) {
      const now = new Date().toISOString();
      const ins = this.db.prepare(`
        INSERT INTO record_templates (id, name, recordType, title, description, treatment, sortOrder, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.db.transaction(() => {
        ORTHO_TEMPLATES.forEach((t, i) => ins.run(randomUUID(), t.name, t.recordType, t.title, t.description, t.treatment, i, now));
        this.db.prepare("INSERT INTO settings (key, value) VALUES ('recordTemplatesSeeded', '1')").run();
      })();
    }
  }

  // Crée une fiche de référent pour chaque vétérinaire déjà présent dans les
  // dossiers du portail (dédoublonnage sur l'email, insensible à la casse) et
  // rattache ces dossiers. Idempotent : ne touche qu'aux dossiers non rattachés.
  backfillReferringVets() {
    const orphans = this.db.prepare(`
      SELECT id, referringVetName, referringVetClinic, referringVetEmail, referringVetPhone
      FROM referral_cases
      WHERE (referringVetId IS NULL OR referringVetId = '')
        AND referringVetEmail IS NOT NULL AND TRIM(referringVetEmail) <> ''
    `).all();
    if (orphans.length === 0) return;
    const link = this.db.prepare('UPDATE referral_cases SET referringVetId = ? WHERE id = ?');
    for (const c of orphans) {
      const vet = this.findOrCreateReferringVet({
        name: c.referringVetName,
        clinic: c.referringVetClinic,
        email: c.referringVetEmail,
        phone: c.referringVetPhone,
      });
      if (vet) link.run(vet.id, c.id);
    }
  }

  seedIfEmpty() {
    // Always seed appointment types if missing (works for fresh AND existing DBs)
    const apptTypeCount = this.db.prepare('SELECT COUNT(*) as c FROM appointment_types').get().c;
    if (apptTypeCount === 0) {
      const defaultTypes = [
        { name: 'Consultation', duration: 30, color: '#2563eb', sort: 1 },
        { name: 'Vaccination', duration: 15, color: '#16a34a', sort: 2 },
        { name: 'Examen / contrôle', duration: 30, color: '#9333ea', sort: 3 },
        { name: 'Stérilisation', duration: 60, color: '#db2777', sort: 4 },
        { name: 'Chirurgie', duration: 90, color: '#ea580c', sort: 5 },
        { name: 'Urgence', duration: 30, color: '#dc2626', sort: 6 },
        { name: 'Détartrage', duration: 45, color: '#06b6d4', sort: 7 },
      ];
      const insertType = this.db.prepare(
        'INSERT INTO appointment_types (id, name, defaultDuration, color, sortOrder) VALUES (?, ?, ?, ?, ?)'
      );
      for (const t of defaultTypes) insertType.run(randomUUID(), t.name, t.duration, t.color, t.sort);
    }

    // Default cabinet hours if not set
    const settingsAdded = {};
    const existing = this.getSettings();
    if (!existing.cabinetOpenHour) settingsAdded.cabinetOpenHour = '9';
    if (!existing.cabinetCloseHour) settingsAdded.cabinetCloseHour = '18';
    if (!existing.cabinetSlotMinutes) settingsAdded.cabinetSlotMinutes = '15';
    // Motifs autorisés pour un client adressé par un confrère. Amorcé une seule
    // fois (clé absente) sur les consultations orthopédiques et les contrôles ;
    // ensuite c'est la colonne « Référés » des Paramètres qui pilote la liste.
    if (existing.referredAllowedTypeIds === undefined) {
      const seedIds = this.listAppointmentTypes()
        .filter((t) => /orthop|contr[oô]l/i.test(t.name || ''))
        .map((t) => t.id);
      if (seedIds.length) settingsAdded.referredAllowedTypeIds = seedIds.join(',');
    }
    if (Object.keys(settingsAdded).length > 0) this.saveSettings(settingsAdded);

    const ownerCount = this.db.prepare('SELECT COUNT(*) as c FROM owners').get().c;
    if (ownerCount === 0) {
      // Default services
      const defaultServices = [
        { code: 'CONS', name: 'Consultation standard', priceHT: 35.00, vatRate: 20, accountCode: '706000' },
        { code: 'VAC', name: 'Vaccination', priceHT: 45.00, vatRate: 20, accountCode: '706000' },
        { code: 'STER', name: 'Stérilisation', priceHT: 150.00, vatRate: 20, accountCode: '706000' },
        { code: 'CHIR', name: 'Chirurgie', priceHT: 250.00, vatRate: 20, accountCode: '706000' },
        { code: 'IDEN', name: 'Identification (puce)', priceHT: 60.00, vatRate: 20, accountCode: '706000' },
        { code: 'URG', name: 'Urgence', priceHT: 80.00, vatRate: 20, accountCode: '706000' },
        { code: 'MED', name: 'Médicaments', priceHT: 15.00, vatRate: 10, accountCode: '707000' },
      ];
      // Skip if any service already exists (don't recreate after wipe)
      const svcCount = this.db.prepare('SELECT COUNT(*) as c FROM services').get().c;
      const insertSvc = svcCount === 0 ? this.db.prepare(
        'INSERT INTO services (id, code, name, priceHT, vatRate, accountCode) VALUES (?, ?, ?, ?, ?, ?)'
      ) : null;
      if (insertSvc) {
        for (const s of defaultServices) {
          insertSvc.run(randomUUID(), s.code, s.name, s.priceHT, s.vatRate, s.accountCode);
        }
      }

      // Default settings
      const defaultSettings = {
        clinicName: 'Mon cabinet vétérinaire',
        clinicAddress: '',
        clinicCity: '',
        clinicPostalCode: '',
        clinicSiret: '',
        clinicVatNumber: '',
        invoicePrefix: 'F',
        invoiceCounter: '1',
        quotePrefix: 'D',
        quoteCounter: '1',
        sageJournalCode: 'VT',
        sageVatAccount: '445710',
        sageClientAccount: '411000',
      };
      const insertSetting = this.db.prepare(
        'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
      );
      for (const [k, v] of Object.entries(defaultSettings)) {
        insertSetting.run(k, v);
      }
      // Assistant de paramétrage : proposé uniquement sur une installation neuve
      // (une base qui a déjà des comptes est considérée comme paramétrée).
      const hasUsers = this.db.prepare('SELECT 1 FROM users LIMIT 1').get();
      insertSetting.run('setupCompleted', hasUsers ? '1' : '0');

      // Sample data — only on a truly fresh install (no clinicName ever set)
      const isFresh = !this.db.prepare("SELECT value FROM settings WHERE key='clinicName' AND value != ''").get();
      if (!isFresh) return;
      const ownerId1 = randomUUID();
      const ownerId2 = randomUUID();
      this.db.prepare(`INSERT INTO owners (id, firstName, lastName, email, phone, address, city, postalCode, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          ownerId1, 'Marie', 'Dupont', 'marie.dupont@example.com', '0612345678',
          '12 rue des Lilas', 'Lyon', '69001', new Date().toISOString()
        );
      this.db.prepare(`INSERT INTO owners (id, firstName, lastName, email, phone, address, city, postalCode, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          ownerId2, 'Jean', 'Martin', 'jean.martin@example.com', '0698765432',
          '5 av. de la Paix', 'Lyon', '69003', new Date().toISOString()
        );

      const patientId1 = randomUUID();
      const patientId2 = randomUUID();
      this.db.prepare(`INSERT INTO patients (id, ownerId, name, species, breed, sex, birthDate, weight, sterilized, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          patientId1, ownerId1, 'Felix', 'Chat', 'Européen', 'M', '2020-03-15', 4.5, 1, new Date().toISOString()
        );
      this.db.prepare(`INSERT INTO patients (id, ownerId, name, species, breed, sex, birthDate, weight, sterilized, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          patientId2, ownerId2, 'Rex', 'Chien', 'Labrador', 'M', '2018-07-22', 28.0, 0, new Date().toISOString()
        );

      // Sample appointment for today
      const today = new Date();
      const start = new Date(today.setHours(10, 0, 0, 0)).toISOString();
      const end = new Date(today.setHours(10, 30, 0, 0)).toISOString();
      this.db.prepare(`INSERT INTO appointments (id, patientId, ownerId, startTime, endTime, title, reason, status, veterinarian, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomUUID(), patientId1, ownerId1, start, end,
          'Consultation Felix', 'Vaccination annuelle', 'scheduled', 'Dr. Vétérinaire',
          new Date().toISOString()
        );
    }
  }

  // ===== Auth & Users =====
  hasAnyUser() {
    return this.db.prepare('SELECT COUNT(*) as c FROM users').get().c > 0;
  }

  authenticate(username, password) {
    const user = this.db.prepare(
      'SELECT * FROM users WHERE username = ? AND active = 1'
    ).get(username);
    if (!user) return null;
    if (!bcrypt.compareSync(password, user.passwordHash)) return null;
    this.db.prepare('UPDATE users SET lastLogin = ? WHERE id = ?')
      .run(new Date().toISOString(), user.id);
    // Never expose secrets; keep totpEnabled so the caller knows if 2FA applies.
    const { passwordHash, totpSecret, totpBackupCodes, ...safe } = user;
    return safe;
  }

  listUsers() {
    return this.db.prepare(
      'SELECT id, username, fullName, email, role, active, createdAt, lastLogin FROM users ORDER BY fullName'
    ).all();
  }

  getUser(id) {
    return this.db.prepare(
      'SELECT id, username, fullName, email, role, active, createdAt, lastLogin, totpEnabled FROM users WHERE id = ?'
    ).get(id);
  }

  // ===== 2FA (TOTP) =====
  setTotpSecret(id, secret) {
    this.db.prepare('UPDATE users SET totpSecret = ?, totpEnabled = 0 WHERE id = ?').run(secret, id);
  }
  getTotp(id) {
    return this.db.prepare('SELECT totpSecret, totpEnabled, totpBackupCodes FROM users WHERE id = ?').get(id);
  }
  enableTotp(id, backupCodesJson) {
    this.db.prepare('UPDATE users SET totpEnabled = 1, totpBackupCodes = ? WHERE id = ?').run(backupCodesJson, id);
  }
  disableTotp(id) {
    this.db.prepare('UPDATE users SET totpEnabled = 0, totpSecret = NULL, totpBackupCodes = NULL WHERE id = ?').run(id);
  }
  consumeBackupCode(id, code) {
    const row = this.db.prepare('SELECT totpBackupCodes FROM users WHERE id = ?').get(id);
    if (!row || !row.totpBackupCodes) return false;
    let codes;
    try { codes = JSON.parse(row.totpBackupCodes); } catch { return false; }
    const idx = codes.findIndex((h) => bcrypt.compareSync(code, h));
    if (idx === -1) return false;
    codes.splice(idx, 1);
    this.db.prepare('UPDATE users SET totpBackupCodes = ? WHERE id = ?').run(JSON.stringify(codes), id);
    return true;
  }

  // ===== Login audit log =====
  logLoginEvent(e) {
    this.db.prepare(`
      INSERT INTO login_events (id, userId, username, success, reason, ip, userAgent, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), e.userId || null, e.username || null, e.success ? 1 : 0,
      e.reason || null, e.ip || null, e.userAgent || null, new Date().toISOString()
    );
  }
  listLoginEvents(limit = 100) {
    return this.db.prepare('SELECT * FROM login_events ORDER BY createdAt DESC LIMIT ?').all(Math.min(Number(limit) || 100, 500));
  }

  createUser(data) {
    const id = randomUUID();
    const hash = bcrypt.hashSync(data.password, 10);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO users (id, username, passwordHash, fullName, email, role, active, createdAt, passwordChangedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.username.toLowerCase().trim(), hash,
      data.fullName, data.email || null,
      data.role || 'assistant',
      data.active === false ? 0 : 1,
      now, now
    );
    return this.getUser(id);
  }

  getPasswordChangedAt(id) {
    const row = this.db.prepare('SELECT passwordChangedAt FROM users WHERE id = ?').get(id);
    return row ? row.passwordChangedAt : null;
  }

  updateUser(id, data) {
    const fields = [];
    const values = [];
    if (data.fullName !== undefined) { fields.push('fullName = ?'); values.push(data.fullName); }
    if (data.email !== undefined) { fields.push('email = ?'); values.push(data.email || null); }
    if (data.role !== undefined) { fields.push('role = ?'); values.push(data.role); }
    if (data.active !== undefined) { fields.push('active = ?'); values.push(data.active ? 1 : 0); }
    if (data.password) {
      fields.push('passwordHash = ?');
      values.push(bcrypt.hashSync(data.password, 10));
      // Changing the password invalidates all previously issued tokens.
      fields.push('passwordChangedAt = ?');
      values.push(new Date().toISOString());
    }
    if (fields.length === 0) return this.getUser(id);
    values.push(id);
    this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getUser(id);
  }

  deleteUser(id) {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Owners =====
  listOwners() {
    return this.db.prepare(`
      SELECT o.*, COUNT(p.id) as patientCount,
        v.name as referringVetName, v.clinic as referringVetClinic, v.email as referringVetEmail
      FROM owners o
      LEFT JOIN patients p ON p.ownerId = o.id
      LEFT JOIN referring_vets v ON v.id = o.referringVetId
      GROUP BY o.id
      ORDER BY o.lastName, o.firstName
    `).all();
  }
  getOwner(id) {
    return this.db.prepare(`
      SELECT o.*,
        v.name as referringVetName, v.clinic as referringVetClinic,
        v.email as referringVetEmail, v.phone as referringVetPhone
      FROM owners o
      LEFT JOIN referring_vets v ON v.id = o.referringVetId
      WHERE o.id = ?
    `).get(id);
  }
  createOwner(data) {
    const id = randomUUID();
    const referral = this.normalizeOwnerReferral(data);
    this.db.prepare(`
      INSERT INTO owners (id, firstName, lastName, email, phone, address, city, postalCode, notes, referredByVet, referringVetId, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.firstName, data.lastName, data.email || null, data.phone || null,
      data.address || null, data.city || null, data.postalCode || null, data.notes || null,
      referral.referredByVet, referral.referringVetId,
      new Date().toISOString());
    return this.getOwner(id);
  }
  updateOwner(id, data) {
    const current = this.db.prepare('SELECT referredByVet, referringVetId FROM owners WHERE id = ?').get(id) || {};
    const referral = this.normalizeOwnerReferral(data, current);
    this.db.prepare(`
      UPDATE owners SET firstName=?, lastName=?, email=?, phone=?, address=?, city=?, postalCode=?, notes=?,
        referredByVet=?, referringVetId=?
      WHERE id=?
    `).run(data.firstName, data.lastName, data.email || null, data.phone || null,
      data.address || null, data.city || null, data.postalCode || null, data.notes || null,
      referral.referredByVet, referral.referringVetId, id);
    return this.getOwner(id);
  }
  // Un client n'est « référé » que si la case est cochée ; décocher la case
  // détache aussi le vétérinaire pour ne pas laisser un lien fantôme.
  normalizeOwnerReferral(data, current = {}) {
    const flagGiven = data.referredByVet !== undefined;
    const referred = flagGiven
      ? (data.referredByVet ? 1 : 0)
      : (current.referredByVet ? 1 : 0);
    if (!referred) return { referredByVet: 0, referringVetId: null };
    const vetGiven = data.referringVetId !== undefined;
    return {
      referredByVet: 1,
      referringVetId: (vetGiven ? data.referringVetId : current.referringVetId) || null,
    };
  }
  deleteOwner(id) {
    this.db.prepare('DELETE FROM owners WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Patients =====
  listPatients(ownerId) {
    if (ownerId) {
      return this.db.prepare(`
        SELECT p.*, o.firstName as ownerFirstName, o.lastName as ownerLastName
        FROM patients p JOIN owners o ON o.id = p.ownerId
        WHERE p.ownerId = ? ORDER BY p.name
      `).all(ownerId);
    }
    return this.db.prepare(`
      SELECT p.*, o.firstName as ownerFirstName, o.lastName as ownerLastName
      FROM patients p JOIN owners o ON o.id = p.ownerId
      ORDER BY p.name
    `).all();
  }
  getPatient(id) {
    return this.db.prepare(`
      SELECT p.*, o.firstName as ownerFirstName, o.lastName as ownerLastName, o.phone as ownerPhone,
        o.referredByVet, o.referringVetId,
        v.name as referringVetName, v.clinic as referringVetClinic, v.email as referringVetEmail
      FROM patients p
      JOIN owners o ON o.id = p.ownerId
      LEFT JOIN referring_vets v ON v.id = o.referringVetId
      WHERE p.id = ?
    `).get(id);
  }
  createPatient(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO patients (id, ownerId, name, species, breed, sex, birthDate, weight, color, microchipId, sterilized, allergies, notes, dangerousDog, microchipDate, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.ownerId, data.name, data.species, data.breed || null,
      data.sex || null, data.birthDate || null, data.weight || null,
      data.color || null, data.microchipId || null, data.sterilized ? 1 : 0,
      data.allergies || null, data.notes || null, data.dangerousDog ? 1 : 0,
      data.microchipDate || null, new Date().toISOString());
    return this.getPatient(id);
  }
  updatePatient(id, data) {
    // Changement de propriétaire : l'historique (factures, RDV passés) reste au
    // nom de l'ancien propriétaire ; seuls les RDV à venir suivent l'animal.
    const current = this.db.prepare('SELECT ownerId FROM patients WHERE id = ?').get(id);
    if (current && data.ownerId && data.ownerId !== current.ownerId) {
      if (!this.db.prepare('SELECT 1 FROM owners WHERE id = ?').get(data.ownerId)) {
        const err = new Error('Propriétaire introuvable'); err.status = 400; throw err;
      }
      this.db.transaction(() => {
        this.db.prepare('UPDATE patients SET ownerId = ? WHERE id = ?').run(data.ownerId, id);
        this.db.prepare('UPDATE appointments SET ownerId = ? WHERE patientId = ? AND startTime >= ?')
          .run(data.ownerId, id, new Date().toISOString());
      })();
    }
    this.db.prepare(`
      UPDATE patients SET name=?, species=?, breed=?, sex=?, birthDate=?, weight=?, color=?, microchipId=?, sterilized=?, allergies=?, notes=?, dangerousDog=?, microchipDate=?
      WHERE id=?
    `).run(data.name, data.species, data.breed || null, data.sex || null,
      data.birthDate || null, data.weight || null, data.color || null,
      data.microchipId || null, data.sterilized ? 1 : 0,
      data.allergies || null, data.notes || null, data.dangerousDog ? 1 : 0,
      data.microchipDate || null, id);
    return this.getPatient(id);
  }
  deletePatient(id) {
    this.db.prepare('DELETE FROM patients WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Medical records =====
  listMedicalRecords(patientId) {
    return this.db.prepare(`
      SELECT * FROM medical_records WHERE patientId = ? ORDER BY date DESC
    `).all(patientId);
  }
  createMedicalRecord(data) {
    const id = randomUUID();
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO medical_records (id, patientId, date, type, title, description, treatment, weight, temperature, veterinarian, createdAt, createdBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, data.patientId, data.date, data.type, data.title,
        data.description || null, data.treatment || null,
        data.weight || null, data.temperature || null,
        data.veterinarian || null, new Date().toISOString(),
        data.createdBy || null);

      // Optional follow-up reminder attached to this record
      if (data.followUp && data.followUp.scheduledDate) {
        this.createFollowUpReminder({
          patientId: data.patientId,
          medicalRecordId: id,
          type: data.followUp.type || data.type,
          title: data.followUp.title || `Rappel: ${data.title}`,
          notes: data.followUp.notes || null,
          scheduledDate: data.followUp.scheduledDate,
          createdBy: data.createdBy || null,
        });
      }
    });
    tx();
    return this.db.prepare('SELECT * FROM medical_records WHERE id = ?').get(id);
  }
  updateMedicalRecord(id, data) {
    this.db.prepare(`
      UPDATE medical_records SET
        date = ?, type = ?, title = ?, description = ?, treatment = ?,
        weight = ?, temperature = ?, veterinarian = ?
      WHERE id = ?
    `).run(
      data.date, data.type, data.title,
      data.description || null, data.treatment || null,
      data.weight || null, data.temperature || null,
      data.veterinarian || null, id,
    );
    return this.db.prepare('SELECT * FROM medical_records WHERE id = ?').get(id);
  }
  deleteMedicalRecord(id) {
    this.db.prepare('DELETE FROM medical_records WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Lab integration =====
  createLabRequest(data) {
    const id = randomUUID();
    const requisitionNumber = data.requisitionNumber
      || ('CV' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000).toString().padStart(3, '0'));
    this.db.prepare(`
      INSERT INTO lab_requests (id, patientId, requisitionNumber, status, requestedTests, note, createdBy, createdAt)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(id, data.patientId, requisitionNumber,
      data.requestedTests ? JSON.stringify(data.requestedTests) : null,
      data.note || null, data.createdBy || null, new Date().toISOString());
    return this.getLabRequest(id);
  }
  getLabRequest(id) {
    return this.db.prepare('SELECT * FROM lab_requests WHERE id = ?').get(id);
  }
  listLabRequests(patientId) {
    return this.db.prepare('SELECT * FROM lab_requests WHERE patientId = ? ORDER BY createdAt DESC').all(patientId);
  }
  // Pending requests joined with patient/owner demographics (used by the bridge to build XML).
  listPendingLabRequests() {
    return this.db.prepare(`
      SELECT r.*, p.name as patientName, p.species as patientSpecies, p.sex as patientSex,
             p.weight as patientWeight, p.breed as patientBreed, p.birthDate as patientBirthDate,
             p.sterilized as patientSterilized,
             o.id as clientId, o.firstName as clientFirstName, o.lastName as clientLastName
      FROM lab_requests r
      JOIN patients p ON p.id = r.patientId
      JOIN owners o ON o.id = p.ownerId
      WHERE r.status = 'pending'
      ORDER BY r.createdAt ASC
    `).all();
  }
  setLabRequestStatus(id, status, extra = {}) {
    const fields = ['status = ?'];
    const vals = [status];
    if (extra.sentAt !== undefined) { fields.push('sentAt = ?'); vals.push(extra.sentAt); }
    if (extra.error !== undefined) { fields.push('error = ?'); vals.push(extra.error); }
    vals.push(id);
    this.db.prepare(`UPDATE lab_requests SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return this.getLabRequest(id);
  }
  cancelLabRequest(id) {
    return this.setLabRequestStatus(id, 'cancelled');
  }

  // Match an incoming result to a patient: first by requisition number (our own order),
  // else by patient name (+ owner last name when it disambiguates). Either field may be null.
  matchLabResult({ requisitionNumber, clientLastName, patientName }) {
    let patientId = null, requestId = null;
    if (requisitionNumber) {
      const req = this.db.prepare(
        'SELECT id, patientId FROM lab_requests WHERE requisitionNumber = ? ORDER BY createdAt DESC LIMIT 1'
      ).get(requisitionNumber);
      if (req) { requestId = req.id; patientId = req.patientId; }
    }
    if (!patientId && patientName) {
      const rows = this.db.prepare(`
        SELECT p.id as patientId, o.lastName as ownerLastName
        FROM patients p JOIN owners o ON o.id = p.ownerId
        WHERE lower(p.name) = lower(?)
      `).all(patientName);
      let candidates = rows;
      if (clientLastName) {
        const filtered = rows.filter((r) => (r.ownerLastName || '').toLowerCase() === clientLastName.toLowerCase());
        if (filtered.length) candidates = filtered;
      }
      if (candidates.length === 1) patientId = candidates[0].patientId;
    }
    return { patientId, requestId };
  }

  // Insert a parsed result (normalized parser output + { sourceFile, reportPdfPath, rawXml }).
  // Idempotent on sourceFile; performs server-side patient matching.
  // On duplicate: if the new payload now has a PDF and the existing record had none,
  // backfill reportPdfPath — handles the race where the result XML arrived before
  // the lab PDF was written to the Reports folder.
  ingestLabResult(payload) {
    const existing = this.db.prepare('SELECT id, reportPdfPath FROM lab_results WHERE sourceFile = ?').get(payload.sourceFile);
    if (existing) {
      let backfilled = false;
      if (payload.reportPdfPath && !existing.reportPdfPath) {
        this.db.prepare('UPDATE lab_results SET reportPdfPath = ? WHERE id = ?').run(payload.reportPdfPath, existing.id);
        backfilled = true;
      }
      return { duplicate: true, backfilled, matched: null, result: this.getLabResult(existing.id) };
    }

    const match = this.matchLabResult({
      requisitionNumber: payload.requisitionNumber,
      clientLastName: payload.client && payload.client.lastName,
      patientName: payload.patient && payload.patient.name,
    });

    const id = randomUUID();
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO lab_results (id, patientId, requestId, diagnosticSetId, requisitionNumber, instrument,
          runDate, messageSubType, clientLastName, clientFirstName, patientName, patientSpecies,
          reportPdfPath, sourceFile, notes, rawXml, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, match.patientId, match.requestId, payload.diagnosticSetId || null,
        payload.requisitionNumber || null, payload.instrument || null,
        payload.runDtIso || payload.runDt || null, payload.messageSubType || null,
        (payload.client && payload.client.lastName) || null,
        (payload.client && payload.client.firstName) || null,
        (payload.patient && payload.patient.name) || null,
        (payload.patient && payload.patient.species) || null,
        payload.reportPdfPath || null, payload.sourceFile,
        (payload.notes && payload.notes.length) ? payload.notes.join('\n') : null,
        payload.rawXml || null, new Date().toISOString());

      const insAssay = this.db.prepare(`
        INSERT INTO lab_assays (id, resultId, sortOrder, assayName, value, valueNum, unit, qualifier,
          refCriticalLow, refLow, refHigh, refCriticalHigh, flag)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      (payload.assays || []).forEach((a, i) => {
        insAssay.run(randomUUID(), id, i, a.name || '', a.value || null,
          a.valueNum == null ? null : a.valueNum, a.unit || null, a.qualifier || null,
          a.refCriticalLow == null ? null : a.refCriticalLow,
          a.refLow == null ? null : a.refLow,
          a.refHigh == null ? null : a.refHigh,
          a.refCriticalHigh == null ? null : a.refCriticalHigh,
          a.flag || null);
      });

      if (match.requestId) {
        this.db.prepare("UPDATE lab_requests SET status = 'received' WHERE id = ? AND status IN ('sent','pending')")
          .run(match.requestId);
      }
    });
    tx();
    return { duplicate: false, matched: !!match.patientId, result: this.getLabResult(id) };
  }
  getLabResult(id) {
    const result = this.db.prepare('SELECT * FROM lab_results WHERE id = ?').get(id);
    if (!result) return null;
    result.assays = this.db.prepare('SELECT * FROM lab_assays WHERE resultId = ? ORDER BY sortOrder').all(id);
    return result;
  }
  listLabResults(patientId) {
    const results = this.db.prepare(
      'SELECT * FROM lab_results WHERE patientId = ? ORDER BY runDate DESC, createdAt DESC'
    ).all(patientId);
    for (const r of results) {
      r.assays = this.db.prepare('SELECT * FROM lab_assays WHERE resultId = ? ORDER BY sortOrder').all(r.id);
    }
    return results;
  }
  listUnmatchedLabResults() {
    const results = this.db.prepare('SELECT * FROM lab_results WHERE patientId IS NULL ORDER BY createdAt DESC').all();
    for (const r of results) {
      r.assays = this.db.prepare('SELECT * FROM lab_assays WHERE resultId = ? ORDER BY sortOrder').all(r.id);
    }
    return results;
  }
  assignLabResult(id, patientId) {
    this.db.prepare('UPDATE lab_results SET patientId = ? WHERE id = ?').run(patientId, id);
    return this.getLabResult(id);
  }

  // ===== Appointment types =====
  listAppointmentTypes() {
    return this.db.prepare('SELECT * FROM appointment_types ORDER BY sortOrder, name').all();
  }
  createAppointmentType(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO appointment_types (id, name, defaultDuration, color, description, sortOrder)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.defaultDuration || 30, data.color || '#2563eb',
      data.description || null, data.sortOrder || 0);
    return this.db.prepare('SELECT * FROM appointment_types WHERE id = ?').get(id);
  }
  updateAppointmentType(id, data) {
    this.db.prepare(`
      UPDATE appointment_types
      SET name=?, defaultDuration=?, color=?, description=?, sortOrder=?
      WHERE id=?
    `).run(data.name, data.defaultDuration, data.color, data.description || null,
      data.sortOrder || 0, id);
    return this.db.prepare('SELECT * FROM appointment_types WHERE id = ?').get(id);
  }
  deleteAppointmentType(id) {
    this.db.prepare('DELETE FROM appointment_types WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Time blocks =====
  listTimeBlocks(range) {
    let query = `SELECT * FROM time_blocks`;
    const params = [];
    if (range && range.startDate && range.endDate) {
      // Include both single blocks in range AND all recurring blocks (we expand them client-side)
      query += ' WHERE (startTime <= ? AND endTime >= ?) OR recurrence IS NOT NULL';
      params.push(range.endDate, range.startDate);
    }
    query += ' ORDER BY startTime ASC';
    return this.db.prepare(query).all(...params);
  }
  createTimeBlock(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO time_blocks (id, startTime, endTime, title, description, kind, recurrence, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.startTime, data.endTime, data.title,
      data.description || null, data.kind || 'other',
      data.recurrence || null, new Date().toISOString(), data.createdBy || null);
    return this.db.prepare('SELECT * FROM time_blocks WHERE id = ?').get(id);
  }
  updateTimeBlock(id, data) {
    this.db.prepare(`
      UPDATE time_blocks SET startTime=?, endTime=?, title=?, description=?, kind=?, recurrence=?
      WHERE id=?
    `).run(data.startTime, data.endTime, data.title,
      data.description || null, data.kind || 'other',
      data.recurrence || null, id);
    return this.db.prepare('SELECT * FROM time_blocks WHERE id = ?').get(id);
  }
  deleteTimeBlock(id) {
    this.db.prepare('DELETE FROM time_blocks WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Appointments =====
  listAppointments(range) {
    let query = `
      SELECT a.*,
        p.name as patientName, p.species,
        o.firstName as ownerFirstName, o.lastName as ownerLastName, o.phone as ownerPhone,
        t.name as typeName, t.color as typeColor, t.defaultDuration as typeDuration
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.patientId
      LEFT JOIN owners o ON o.id = a.ownerId
      LEFT JOIN appointment_types t ON t.id = a.appointmentTypeId
    `;
    const params = [];
    if (range && range.startDate && range.endDate) {
      query += ' WHERE a.startTime >= ? AND a.startTime <= ?';
      params.push(range.startDate, range.endDate);
    }
    query += ' ORDER BY a.startTime ASC';
    return this.db.prepare(query).all(...params);
  }
  createAppointment(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO appointments (id, patientId, ownerId, startTime, endTime, title, reason, status, veterinarian, notes, appointmentTypeId, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.patientId || null, data.ownerId || null,
      data.startTime, data.endTime, data.title,
      data.reason || null, data.status || 'scheduled',
      data.veterinarian || null, data.notes || null,
      data.appointmentTypeId || null,
      new Date().toISOString(), data.createdBy || null);
    return this.db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  }
  updateAppointment(id, data) {
    this.db.prepare(`
      UPDATE appointments SET patientId=?, ownerId=?, startTime=?, endTime=?, title=?, reason=?, status=?, veterinarian=?, notes=?, appointmentTypeId=?
      WHERE id=?
    `).run(data.patientId || null, data.ownerId || null,
      data.startTime, data.endTime, data.title,
      data.reason || null, data.status || 'scheduled',
      data.veterinarian || null, data.notes || null,
      data.appointmentTypeId || null, id);
    return this.db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  }
  deleteAppointment(id) {
    this.db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Appointment types =====
  listAppointmentTypes() {
    return this.db.prepare('SELECT * FROM appointment_types ORDER BY sortOrder, name').all();
  }
  createAppointmentType(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO appointment_types (id, name, defaultDuration, color, description, sortOrder)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.defaultDuration || 30, data.color || '#2563eb',
      data.description || null, data.sortOrder || 0);
    return this.db.prepare('SELECT * FROM appointment_types WHERE id = ?').get(id);
  }
  updateAppointmentType(id, data) {
    this.db.prepare(`
      UPDATE appointment_types SET name=?, defaultDuration=?, color=?, description=?, sortOrder=?
      WHERE id=?
    `).run(data.name, data.defaultDuration, data.color, data.description || null,
      data.sortOrder || 0, id);
    return this.db.prepare('SELECT * FROM appointment_types WHERE id = ?').get(id);
  }
  deleteAppointmentType(id) {
    this.db.prepare('DELETE FROM appointment_types WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Time blocks =====
  listTimeBlocks(range) {
    let query = `SELECT * FROM time_blocks`;
    const params = [];
    if (range && range.startDate && range.endDate) {
      query += ' WHERE (startTime <= ? AND endTime >= ?) OR recurrence IS NOT NULL';
      params.push(range.endDate, range.startDate);
    }
    query += ' ORDER BY startTime ASC';
    return this.db.prepare(query).all(...params);
  }
  createTimeBlock(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO time_blocks (id, startTime, endTime, title, description, kind, recurrence, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.startTime, data.endTime, data.title,
      data.description || null, data.kind || 'other',
      data.recurrence || null, new Date().toISOString(), data.createdBy || null);
    return this.db.prepare('SELECT * FROM time_blocks WHERE id = ?').get(id);
  }
  updateTimeBlock(id, data) {
    this.db.prepare(`
      UPDATE time_blocks SET startTime=?, endTime=?, title=?, description=?, kind=?, recurrence=?
      WHERE id=?
    `).run(data.startTime, data.endTime, data.title,
      data.description || null, data.kind || 'other',
      data.recurrence || null, id);
    return this.db.prepare('SELECT * FROM time_blocks WHERE id = ?').get(id);
  }
  deleteTimeBlock(id) {
    this.db.prepare('DELETE FROM time_blocks WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Services =====
  listServices() {
    return this.db.prepare('SELECT * FROM services ORDER BY name').all();
  }
  createService(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO services (id, code, name, description, priceHT, vatRate, accountCode)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.code || null, data.name, data.description || null,
      data.priceHT, data.vatRate || 20.0, data.accountCode || '706000');
    return this.db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  }
  deleteService(id) {
    this.db.prepare('DELETE FROM services WHERE id = ?').run(id);
    return { success: true };
  }
  updateService(id, data) {
    this.db.prepare(`
      UPDATE services SET code=?, name=?, description=?, priceHT=?, vatRate=?, accountCode=?
      WHERE id=?
    `).run(
      data.code || null,
      data.name,
      data.description || null,
      Number(data.priceHT),
      Number(data.vatRate) || 17,
      data.accountCode || '706000',
      id
    );
    return this.db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  }

  // ===== Modèles de rapports =====
  listRecordTemplates() {
    return this.db.prepare('SELECT * FROM record_templates ORDER BY sortOrder, name COLLATE NOCASE').all();
  }
  getRecordTemplate(id) {
    return this.db.prepare('SELECT * FROM record_templates WHERE id = ?').get(id);
  }
  createRecordTemplate(data) {
    const id = randomUUID();
    const maxOrder = this.db.prepare('SELECT COALESCE(MAX(sortOrder), -1) AS m FROM record_templates').get().m;
    this.db.prepare(`
      INSERT INTO record_templates (id, name, recordType, title, description, treatment, sortOrder, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.recordType || null, data.title || null, data.description || null,
      data.treatment || null, maxOrder + 1, new Date().toISOString());
    return this.getRecordTemplate(id);
  }
  updateRecordTemplate(id, data) {
    this.db.prepare(`
      UPDATE record_templates SET name=?, recordType=?, title=?, description=?, treatment=?, updatedAt=? WHERE id=?
    `).run(data.name, data.recordType || null, data.title || null, data.description || null,
      data.treatment || null, new Date().toISOString(), id);
    return this.getRecordTemplate(id);
  }
  deleteRecordTemplate(id) {
    this.db.prepare('DELETE FROM record_templates WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Protocols =====
  listProtocols() {
    return this.db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM protocol_items WHERE protocolId = p.id) AS itemsCount
      FROM protocols p
      ORDER BY p.name COLLATE NOCASE
    `).all();
  }
  getProtocol(id) {
    const protocol = this.db.prepare('SELECT * FROM protocols WHERE id = ?').get(id);
    if (!protocol) return null;
    protocol.items = this.db.prepare(`
      SELECT pi.*,
        s.name AS serviceName, s.code AS serviceCode,
        m.name AS medicineName, m.baseUnit AS medicineBaseUnit,
        su.name AS saleUnitName
      FROM protocol_items pi
      LEFT JOIN services s ON s.id = pi.serviceId
      LEFT JOIN medicines m ON m.id = pi.medicineId
      LEFT JOIN medicine_sale_units su ON su.id = pi.saleUnitId
      WHERE pi.protocolId = ?
      ORDER BY pi.sortOrder, pi.id
    `).all(id);
    return protocol;
  }
  createProtocol(data) {
    const id = randomUUID();
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO protocols (id, name, description, notes, createdAt, createdBy)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.name,
        data.description || null,
        data.notes || null,
        new Date().toISOString(),
        data.createdBy || null
      );
      this._insertProtocolItems(id, data.items || []);
    });
    tx();
    return this.getProtocol(id);
  }
  updateProtocol(id, data) {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE protocols SET name=?, description=?, notes=? WHERE id=?
      `).run(
        data.name,
        data.description || null,
        data.notes || null,
        id
      );
      if (Array.isArray(data.items)) {
        this.db.prepare('DELETE FROM protocol_items WHERE protocolId = ?').run(id);
        this._insertProtocolItems(id, data.items);
      }
    });
    tx();
    return this.getProtocol(id);
  }
  deleteProtocol(id) {
    this.db.prepare('DELETE FROM protocols WHERE id = ?').run(id);
    return { success: true };
  }
  _insertProtocolItems(protocolId, items) {
    const insert = this.db.prepare(`
      INSERT INTO protocol_items
        (id, protocolId, sortOrder, kind, serviceId, medicineId, saleUnitId, description, quantityMode, quantity, priceHT, vatRate, accountCode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    items.forEach((it, idx) => {
      const kind = it.kind === 'product' ? 'product' : 'act';
      const quantityMode = it.quantityMode === 'per_kg' ? 'per_kg' : 'fixed';
      insert.run(
        randomUUID(),
        protocolId,
        Number.isFinite(it.sortOrder) ? it.sortOrder : idx,
        kind,
        kind === 'act' ? (it.serviceId || null) : null,
        kind === 'product' ? (it.medicineId || null) : null,
        kind === 'product' ? (it.saleUnitId || null) : null,
        it.description || '',
        quantityMode,
        Number(it.quantity) || 0,
        Number(it.priceHT) || 0,
        Number(it.vatRate) || 17,
        it.accountCode || (kind === 'product' ? '707000' : '706000')
      );
    });
  }

  // ===== Invoices =====
  listInvoices() {
    const rows = this.db.prepare(`
      SELECT i.*,
        o.firstName as ownerFirstName, o.lastName as ownerLastName,
        p.name as patientName,
        (SELECT GROUP_CONCAT(DISTINCT pp.name) FROM invoice_items ii
           JOIN patients pp ON pp.id = ii.patientId WHERE ii.invoiceId = i.id) as itemPatientNames,
        (SELECT GROUP_CONCAT(DISTINCT ii.patientId) FROM invoice_items ii
           WHERE ii.invoiceId = i.id AND ii.patientId IS NOT NULL) as itemPatientIds
      FROM invoices i
      JOIN owners o ON o.id = i.ownerId
      LEFT JOIN patients p ON p.id = i.patientId
      ORDER BY i.date DESC, i.number DESC
    `).all();
    for (const inv of rows) {
      inv.patientNames = inv.itemPatientNames ? inv.itemPatientNames.split(',') : (inv.patientName ? [inv.patientName] : []);
      inv.patientIds = inv.itemPatientIds ? inv.itemPatientIds.split(',') : (inv.patientId ? [inv.patientId] : []);
      delete inv.itemPatientNames;
      delete inv.itemPatientIds;
    }
    return rows;
  }
  getInvoice(id) {
    const invoice = this.db.prepare(`
      SELECT i.*,
        o.firstName as ownerFirstName, o.lastName as ownerLastName,
        o.address as ownerAddress, o.city as ownerCity, o.postalCode as ownerPostalCode,
        p.name as patientName
      FROM invoices i
      JOIN owners o ON o.id = i.ownerId
      LEFT JOIN patients p ON p.id = i.patientId
      WHERE i.id = ?
    `).get(id);
    if (!invoice) return null;
    invoice.items = this.db.prepare(`
      SELECT ii.*, pp.name as patientName
      FROM invoice_items ii
      LEFT JOIN patients pp ON pp.id = ii.patientId
      WHERE ii.invoiceId = ?
    `).all(id);
    // Distinct patients actually billed on this invoice (covers multi-animal invoices).
    const seen = new Map();
    for (const it of invoice.items) {
      if (it.patientId && !seen.has(it.patientId)) seen.set(it.patientId, it.patientName);
    }
    if (seen.size === 0 && invoice.patientId) seen.set(invoice.patientId, invoice.patientName);
    invoice.patients = Array.from(seen, ([id, name]) => ({ id, name }));
    if (invoice.patients.length > 1) invoice.patientName = invoice.patients.map((p) => p.name).join(', ');
    invoice.fromQuote = this.db.prepare('SELECT id, number FROM quotes WHERE invoiceId = ?').get(id) || null;
    return invoice;
  }
  // Numérotation sans trou : un brouillon porte un numéro provisoire et ne
  // consomme le compteur qu'à la validation (_assignInvoiceNumber).
  static isProvisionalNumber(number) {
    return String(number || '').startsWith('BROUILLON-');
  }
  peekNextInvoiceNumber() {
    const settings = this.getSettings();
    const prefix = settings.invoicePrefix || 'F';
    const counter = parseInt(settings.invoiceCounter || '1', 10);
    return `${prefix}${new Date().getFullYear()}-${String(counter).padStart(4, '0')}`;
  }
  _assignInvoiceNumber(id) {
    const number = this.peekNextInvoiceNumber();
    const counter = parseInt(this.getSettings().invoiceCounter || '1', 10);
    this.db.prepare('UPDATE invoices SET number = ? WHERE id = ?').run(number, id);
    this.db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(counter + 1), 'invoiceCounter');
  }

  createInvoice(data) {
    const id = randomUUID();
    const number = `BROUILLON-${id.slice(0, 8).toUpperCase()}`;

    let totalHT = 0, totalVAT = 0;
    for (const item of data.items) {
      const lineHT = Number(item.quantity) * Number(item.priceHT);
      totalHT += lineHT;
      totalVAT += lineHT * (Number(item.vatRate) / 100);
    }
    const totalTTC = totalHT + totalVAT;

    const tx = this.db.transaction(() => {
      if (data.quoteId) {
        const quote = this.db.prepare('SELECT invoiceId FROM quotes WHERE id = ?').get(data.quoteId);
        if (!quote) throw Object.assign(new Error('Devis introuvable.'), { status: 404 });
        if (quote.invoiceId) throw Object.assign(new Error('Ce devis a déjà été transformé en facture.'), { status: 400 });
      }
      this.db.prepare(`
        INSERT INTO invoices (id, number, ownerId, patientId, date, dueDate, status, totalHT, totalVAT, totalTTC, notes, createdAt, createdBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, number, data.ownerId, data.patientId || null,
        data.date, data.dueDate || null, data.status || 'draft',
        totalHT, totalVAT, totalTTC, data.notes || null,
        new Date().toISOString(), data.createdBy || null);

      const insertItem = this.db.prepare(`
        INSERT INTO invoice_items (id, invoiceId, serviceId, description, quantity, priceHT, vatRate, accountCode, kind, medicineId, lotId, saleUnitId, dispensingId, patientId, listPriceHT, discountPct)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of data.items) {
        const itemId = randomUUID();
        const itemPatientId = item.patientId || data.patientId || null;
        let dispensingId = null;
        if (item.kind === 'product') {
          if (!item.lotId) throw new Error('Lot manquant pour la ligne produit "' + item.description + '"');
          if (!item.saleUnitId) throw new Error('Unité de vente manquante pour "' + item.description + '"');
          if (!itemPatientId) throw new Error('Animal requis pour la ligne produit "' + item.description + '" (traçabilité).');
          dispensingId = this._dispenseProductLine({
            item, itemId, invoiceId: id, patientId: itemPatientId, ownerId: data.ownerId,
            date: data.date, createdBy: data.createdBy,
          });
        }
        insertItem.run(
          itemId, id, item.serviceId || null, item.description,
          Number(item.quantity), Number(item.priceHT), Number(item.vatRate) || (item.kind === 'product' ? 3 : 17),
          item.accountCode || (item.kind === 'product' ? '707000' : '706000'),
          item.kind || 'act', item.medicineId || null, item.lotId || null,
          item.saleUnitId || null, dispensingId, itemPatientId,
          ...this._discountCols(item)
        );
      }

      // Facture issue d'un devis : le devis passe en « facturé » et pointe sur elle.
      if (data.quoteId) {
        this.db.prepare("UPDATE quotes SET status = 'invoiced', invoiceId = ? WHERE id = ?").run(id, data.quoteId);
      }
    });
    tx();
    return this.getInvoice(id);
  }
  // Déstockage d'une ligne produit : on part du lot choisi, puis, s'il ne suffit
  // pas, on complète avec les autres lots du même produit dans l'ordre
  // d'encodage (FIFO). Un dispensing par lot entamé (traçabilité) ; la
  // quantité vendue est répartie au prorata. Renvoie l'id du premier dispensing.
  _dispenseProductLine({ item, itemId, invoiceId, patientId, ownerId, date, createdBy }) {
    const first = this.db.prepare('SELECT * FROM medicine_lots WHERE id = ?').get(item.lotId);
    if (!first) throw new Error('Lot introuvable: ' + item.lotId);
    const su = this.db.prepare('SELECT * FROM medicine_sale_units WHERE id = ?').get(item.saleUnitId);
    if (!su) throw new Error('Unité de vente introuvable: ' + item.saleUnitId);
    const perUnit = Number(su.quantityInBaseUnit);
    const needed = perUnit * Number(item.quantity);
    const others = this.db.prepare(`
      SELECT * FROM medicine_lots
      WHERE medicineId = ? AND id != ? AND remainingQuantityBaseUnit > 0
      ORDER BY createdAt ASC, purchaseDate ASC
    `).all(first.medicineId, first.id);
    const lots = [first, ...others];
    const available = lots.reduce((s, l) => s + Math.max(0, Number(l.remainingQuantityBaseUnit)), 0);
    if (needed > available + 0.0001) {
      throw new Error('Stock insuffisant pour "' + item.description + '" (disponible tous lots confondus : ' + available + ', demandé : ' + needed + ').');
    }
    const insertDispensing = this.db.prepare(`
      INSERT INTO medicine_dispensings (id, patientId, ownerId, lotId, saleUnitId, quantitySold, baseUnitsConsumed, date, prescribedBy, invoiceId, invoiceItemId, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateLot = this.db.prepare('UPDATE medicine_lots SET remainingQuantityBaseUnit = remainingQuantityBaseUnit - ? WHERE id = ?');
    let left = needed;
    let firstDispensingId = null;
    for (const lot of lots) {
      if (left <= 0.0001) break;
      const remaining = Math.max(0, Number(lot.remainingQuantityBaseUnit));
      // Dernier lot entamé : on prend tout le reste (absorbe les arrondis).
      const take = remaining + 0.0001 >= left ? left : remaining;
      if (take <= 0) continue;
      const dId = randomUUID();
      insertDispensing.run(
        dId, patientId, ownerId, lot.id, item.saleUnitId,
        take === needed ? Number(item.quantity) : (perUnit > 0 ? take / perUnit : 0), take, date,
        createdBy || null, invoiceId, itemId, item.notes || null,
        new Date().toISOString()
      );
      updateLot.run(take, lot.id);
      if (!firstDispensingId) firstDispensingId = dId;
      left -= take;
    }
    return firstDispensingId;
  }

  // Transitions autorisées. Un brouillon provisoire ne s'annule pas (on le supprime) ;
  // une facture numérotée ne se supprime pas (on l'annule) ; payée/annulée sont finales.
  updateInvoiceStatus(id, status, paymentMethod = null) {
    const existing = this.getInvoice(id);
    if (!existing) return null;
    const provisional = Database.isProvisionalNumber(existing.number);
    const allowed = {
      draft: provisional ? ['sent', 'paid'] : ['sent', 'paid', 'cancelled'],
      sent: ['paid', 'cancelled'],
    }[existing.status] || [];
    if (!allowed.includes(status)) {
      const msg = existing.status === 'draft' && status === 'cancelled'
        ? 'Un brouillon ne s\'annule pas : supprimez-le.'
        : 'Changement de statut impossible pour cette facture.';
      throw Object.assign(new Error(msg), { status: 400 });
    }
    const tx = this.db.transaction(() => {
      if (provisional) this._assignInvoiceNumber(id);
      if (status === 'paid') {
        // Paiement déjà noté sur le brouillon : on garde son mode et son heure (entrée en caisse).
        this.db.prepare('UPDATE invoices SET status = ?, paymentMethod = ?, paidAt = ? WHERE id = ?')
          .run(status, paymentMethod || existing.paymentMethod, existing.paidAt || new Date().toISOString(), id);
      } else {
        this.db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, id);
      }
      if (status === 'cancelled') this._releaseInvoiceStockAndQuote(id);
    });
    tx();
    return this.getInvoice(id);
  }

  // Edit a DRAFT invoice in place: reverse old product lines (restock + drop their
  // dispensings), replace all lines, and re-apply stock. Number/status are kept.
  updateInvoice(id, data) {
    const existing = this.getInvoice(id);
    if (!existing) throw Object.assign(new Error('Facture introuvable.'), { status: 404 });
    if (existing.status !== 'draft') {
      throw Object.assign(new Error('Seules les factures en brouillon peuvent être modifiées.'), { status: 400 });
    }

    let totalHT = 0, totalVAT = 0;
    for (const item of data.items) {
      const lineHT = Number(item.quantity) * Number(item.priceHT);
      totalHT += lineHT;
      totalVAT += lineHT * (Number(item.vatRate) / 100);
    }
    const totalTTC = totalHT + totalVAT;

    const tx = this.db.transaction(() => {
      // 1) Reverse previous product lines: restock lots, then delete their dispensings.
      const oldDisp = this.db.prepare('SELECT id, lotId, baseUnitsConsumed FROM medicine_dispensings WHERE invoiceId = ?').all(id);
      const restock = this.db.prepare('UPDATE medicine_lots SET remainingQuantityBaseUnit = remainingQuantityBaseUnit + ? WHERE id = ?');
      const delDisp = this.db.prepare('DELETE FROM medicine_dispensings WHERE id = ?');
      for (const d of oldDisp) {
        if (d.lotId) restock.run(Number(d.baseUnitsConsumed) || 0, d.lotId);
        delDisp.run(d.id);
      }
      // 2) Remove old line items.
      this.db.prepare('DELETE FROM invoice_items WHERE invoiceId = ?').run(id);
      // 3) Update the invoice header (keep number, status, createdAt).
      this.db.prepare(`
        UPDATE invoices SET ownerId = ?, patientId = ?, date = ?, dueDate = ?, totalHT = ?, totalVAT = ?, totalTTC = ?, notes = ?
        WHERE id = ?
      `).run(
        data.ownerId, data.patientId || null, data.date, data.dueDate || null,
        totalHT, totalVAT, totalTTC, data.notes || null, id
      );

      // 4) Re-insert items + dispensings + decrement stock (same rules as createInvoice).
      const insertItem = this.db.prepare(`
        INSERT INTO invoice_items (id, invoiceId, serviceId, description, quantity, priceHT, vatRate, accountCode, kind, medicineId, lotId, saleUnitId, dispensingId, patientId, listPriceHT, discountPct)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of data.items) {
        const itemId = randomUUID();
        const itemPatientId = item.patientId || data.patientId || null;
        let dispensingId = null;
        if (item.kind === 'product') {
          if (!item.lotId) throw new Error('Lot manquant pour la ligne produit "' + item.description + '"');
          if (!item.saleUnitId) throw new Error('Unité de vente manquante pour "' + item.description + '"');
          if (!itemPatientId) throw new Error('Animal requis pour la ligne produit "' + item.description + '" (traçabilité).');
          dispensingId = this._dispenseProductLine({
            item, itemId, invoiceId: id, patientId: itemPatientId, ownerId: data.ownerId,
            date: data.date, createdBy: data.createdBy,
          });
        }
        insertItem.run(
          itemId, id, item.serviceId || null, item.description,
          Number(item.quantity), Number(item.priceHT), Number(item.vatRate) || (item.kind === 'product' ? 3 : 17),
          item.accountCode || (item.kind === 'product' ? '707000' : '706000'),
          item.kind || 'act', item.medicineId || null, item.lotId || null,
          item.saleUnitId || null, dispensingId, itemPatientId,
          ...this._discountCols(item)
        );
      }
    });
    tx();
    return this.getInvoice(id);
  }
  // Note le paiement d'un brouillon (n'importe quel rôle) sans le valider ;
  // null efface la note. La validation le fera passer directement en « payée ».
  setDraftPayment(id, paymentMethod) {
    const existing = this.db.prepare('SELECT status FROM invoices WHERE id = ?').get(id);
    if (!existing) throw Object.assign(new Error('Facture introuvable.'), { status: 404 });
    if (existing.status !== 'draft') {
      throw Object.assign(new Error('Seul le paiement d\'un brouillon peut être noté ainsi.'), { status: 400 });
    }
    this.db.prepare('UPDATE invoices SET paymentMethod = ?, paidAt = ? WHERE id = ?')
      .run(paymentMethod, paymentMethod ? new Date().toISOString() : null, id);
    return this.getInvoice(id);
  }
  validateInvoice(id) {
    const existing = this.db.prepare('SELECT status, paymentMethod FROM invoices WHERE id = ?').get(id);
    if (!existing) throw Object.assign(new Error('Facture introuvable.'), { status: 404 });
    if (existing.status !== 'draft') throw Object.assign(new Error('Facture déjà validée.'), { status: 400 });
    return this.updateInvoiceStatus(id, existing.paymentMethod ? 'paid' : 'sent');
  }

  deleteInvoice(id) {
    const existing = this.db.prepare('SELECT status, number FROM invoices WHERE id = ?').get(id);
    if (!existing) throw Object.assign(new Error('Facture introuvable.'), { status: 404 });
    if (!Database.isProvisionalNumber(existing.number)) {
      throw Object.assign(new Error('Une facture numérotée ne peut pas être supprimée : annulez-la.'), { status: 400 });
    }
    const tx = this.db.transaction(() => {
      this._releaseInvoiceStockAndQuote(id);
      this.db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
    });
    tx();
    return { success: true };
  }
  // Remet en stock les produits d'une facture supprimée ou annulée et rend son devis transformable.
  _releaseInvoiceStockAndQuote(id) {
    // Reverse stock consumption and drop dispensings so they no longer show in patient history.
    const disp = this.db.prepare('SELECT id, lotId, baseUnitsConsumed FROM medicine_dispensings WHERE invoiceId = ?').all(id);
    const restock = this.db.prepare('UPDATE medicine_lots SET remainingQuantityBaseUnit = remainingQuantityBaseUnit + ? WHERE id = ?');
    const delDisp = this.db.prepare('DELETE FROM medicine_dispensings WHERE id = ?');
    for (const d of disp) {
      if (d.lotId) restock.run(Number(d.baseUnitsConsumed) || 0, d.lotId);
      delDisp.run(d.id);
    }
    // Le devis d'origine redevient transformable.
    this.db.prepare("UPDATE quotes SET status = 'accepted', invoiceId = NULL WHERE invoiceId = ?").run(id);
  }

  // ===== Quotes (devis) =====
  // Un devis reprend les lignes d'une facture (actes, produits, animal par ligne)
  // mais ne réserve ni ne consomme aucun lot : le stock n'est touché qu'au moment
  // où il est transformé en facture (createInvoice avec quoteId).
  listQuotes() {
    const rows = this.db.prepare(`
      SELECT q.*,
        o.firstName as ownerFirstName, o.lastName as ownerLastName,
        p.name as patientName, i.number as invoiceNumber,
        (SELECT GROUP_CONCAT(DISTINCT pp.name) FROM quote_items qi
           JOIN patients pp ON pp.id = qi.patientId WHERE qi.quoteId = q.id) as itemPatientNames
      FROM quotes q
      JOIN owners o ON o.id = q.ownerId
      LEFT JOIN patients p ON p.id = q.patientId
      LEFT JOIN invoices i ON i.id = q.invoiceId
      ORDER BY q.date DESC, q.number DESC
    `).all();
    for (const q of rows) {
      q.patientNames = q.itemPatientNames ? q.itemPatientNames.split(',') : (q.patientName ? [q.patientName] : []);
      delete q.itemPatientNames;
    }
    return rows;
  }
  getQuote(id) {
    const quote = this.db.prepare(`
      SELECT q.*,
        o.firstName as ownerFirstName, o.lastName as ownerLastName,
        o.address as ownerAddress, o.city as ownerCity, o.postalCode as ownerPostalCode,
        p.name as patientName, i.number as invoiceNumber
      FROM quotes q
      JOIN owners o ON o.id = q.ownerId
      LEFT JOIN patients p ON p.id = q.patientId
      LEFT JOIN invoices i ON i.id = q.invoiceId
      WHERE q.id = ?
    `).get(id);
    if (!quote) return null;
    quote.items = this.db.prepare(`
      SELECT qi.*, pp.name as patientName
      FROM quote_items qi
      LEFT JOIN patients pp ON pp.id = qi.patientId
      WHERE qi.quoteId = ?
      ORDER BY qi.sortOrder
    `).all(id);
    const seen = new Map();
    for (const it of quote.items) {
      if (it.patientId && !seen.has(it.patientId)) seen.set(it.patientId, it.patientName);
    }
    if (seen.size === 0 && quote.patientId) seen.set(quote.patientId, quote.patientName);
    quote.patients = Array.from(seen, ([pid, name]) => ({ id: pid, name }));
    if (quote.patients.length > 1) quote.patientName = quote.patients.map((p) => p.name).join(', ');
    return quote;
  }
  _quoteTotals(items) {
    let totalHT = 0, totalVAT = 0;
    for (const item of items) {
      const lineHT = Number(item.quantity) * Number(item.priceHT);
      totalHT += lineHT;
      totalVAT += lineHT * (Number(item.vatRate) / 100);
    }
    return { totalHT, totalVAT, totalTTC: totalHT + totalVAT };
  }
  _insertQuoteItems(quoteId, data) {
    const insertItem = this.db.prepare(`
      INSERT INTO quote_items (id, quoteId, sortOrder, kind, serviceId, medicineId, saleUnitId, patientId, description, quantity, priceHT, vatRate, accountCode, listPriceHT, discountPct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    data.items.forEach((item, idx) => {
      const kind = item.kind === 'product' ? 'product' : 'act';
      insertItem.run(
        randomUUID(), quoteId, idx, kind, item.serviceId || null,
        kind === 'product' ? (item.medicineId || null) : null,
        kind === 'product' ? (item.saleUnitId || null) : null,
        item.patientId || data.patientId || null, item.description,
        Number(item.quantity), Number(item.priceHT),
        Number(item.vatRate) || (kind === 'product' ? 3 : 17),
        item.accountCode || (kind === 'product' ? '707000' : '706000'),
        ...this._discountCols(item)
      );
    });
  }
  // [listPriceHT, discountPct] d'une ligne remisée, [null, null] sinon.
  _discountCols(item) {
    const pct = Number(item.discountPct) || 0;
    if (pct <= 0 || item.listPriceHT == null) return [null, null];
    return [Number(item.listPriceHT), pct];
  }
  createQuote(data) {
    const id = randomUUID();
    const settings = this.getSettings();
    const prefix = settings.quotePrefix || 'D';
    const counter = parseInt(settings.quoteCounter || '1', 10);
    const number = `${prefix}${new Date().getFullYear()}-${String(counter).padStart(4, '0')}`;
    const { totalHT, totalVAT, totalTTC } = this._quoteTotals(data.items);
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO quotes (id, number, ownerId, patientId, date, validUntil, status, totalHT, totalVAT, totalTTC, notes, createdAt, createdBy)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
      `).run(id, number, data.ownerId, data.patientId || null, data.date, data.validUntil || null,
        totalHT, totalVAT, totalTTC, data.notes || null, new Date().toISOString(), data.createdBy || null);
      this._insertQuoteItems(id, data);
      this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run('quoteCounter', String(counter + 1));
    });
    tx();
    return this.getQuote(id);
  }
  updateQuote(id, data) {
    const existing = this.getQuote(id);
    if (!existing) throw Object.assign(new Error('Devis introuvable.'), { status: 404 });
    if (existing.invoiceId) {
      throw Object.assign(new Error('Ce devis a déjà été transformé en facture : il ne peut plus être modifié.'), { status: 400 });
    }
    const { totalHT, totalVAT, totalTTC } = this._quoteTotals(data.items);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM quote_items WHERE quoteId = ?').run(id);
      this.db.prepare(`
        UPDATE quotes SET ownerId = ?, patientId = ?, date = ?, validUntil = ?, totalHT = ?, totalVAT = ?, totalTTC = ?, notes = ?
        WHERE id = ?
      `).run(data.ownerId, data.patientId || null, data.date, data.validUntil || null,
        totalHT, totalVAT, totalTTC, data.notes || null, id);
      this._insertQuoteItems(id, data);
    });
    tx();
    return this.getQuote(id);
  }
  updateQuoteStatus(id, status) {
    if (!['draft', 'sent', 'accepted', 'refused'].includes(status)) {
      throw Object.assign(new Error('Statut de devis invalide.'), { status: 400 });
    }
    const existing = this.getQuote(id);
    if (!existing) return null;
    if (existing.invoiceId) {
      throw Object.assign(new Error('Ce devis a déjà été transformé en facture.'), { status: 400 });
    }
    this.db.prepare('UPDATE quotes SET status = ? WHERE id = ?').run(status, id);
    return this.getQuote(id);
  }
  deleteQuote(id) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM quote_items WHERE quoteId = ?').run(id);
      this.db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
    })();
    return { success: true };
  }

  // ===== Medicines (catalog) =====
  listMedicines({ activeOnly = true, search = '' } = {}) {
    const where = [];
    const params = [];
    if (activeOnly) where.push('m.active = 1');
    if (search) {
      where.push('(m.name LIKE ? OR m.atcCode LIKE ? OR m.description LIKE ?)');
      const like = '%' + search + '%';
      params.push(like, like, like);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const meds = this.db.prepare(`
      SELECT m.*,
        COALESCE(SUM(l.remainingQuantityBaseUnit), 0) AS totalStockBase,
        MIN(l.expiryDate) AS nearestExpiry
      FROM medicines m
      LEFT JOIN medicine_lots l ON l.medicineId = m.id AND l.remainingQuantityBaseUnit > 0
      ${whereSql}
      GROUP BY m.id
      ORDER BY m.name COLLATE NOCASE
    `).all(...params);
    return meds;
  }

  getMedicine(id) {
    const med = this.db.prepare('SELECT * FROM medicines WHERE id = ?').get(id);
    if (!med) return null;
    med.saleUnits = this.db.prepare(
      'SELECT * FROM medicine_sale_units WHERE medicineId = ? ORDER BY sortOrder, quantityInBaseUnit'
    ).all(id);
    med.lots = this.db.prepare(
      'SELECT * FROM medicine_lots WHERE medicineId = ? ORDER BY expiryDate'
    ).all(id);
    return med;
  }

  createMedicine(data) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO medicines (id, name, atcCode, description, baseUnit, packagingDescription, defaultVatRate, minStockAlert, targetMarginPct, active, notes, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.name,
      data.atcCode || null,
      data.description || null,
      data.baseUnit || 'unité',
      data.packagingDescription || null,
      data.defaultVatRate ?? 3.0,
      data.minStockAlert ?? 0,
      data.targetMarginPct ?? 35.0,
      data.active === false ? 0 : 1,
      data.notes || null,
      now,
      data.createdBy || null
    );
    if (Array.isArray(data.saleUnits)) {
      for (const u of data.saleUnits) this._insertSaleUnit(id, u);
    }
    return this.getMedicine(id);
  }

  updateMedicine(id, data) {
    this.db.prepare(`
      UPDATE medicines SET name=?, atcCode=?, description=?, baseUnit=?, packagingDescription=?, defaultVatRate=?, minStockAlert=?, targetMarginPct=?, active=?, notes=?
      WHERE id=?
    `).run(
      data.name,
      data.atcCode || null,
      data.description || null,
      data.baseUnit || 'unité',
      data.packagingDescription || null,
      data.defaultVatRate ?? 3.0,
      data.minStockAlert ?? 0,
      data.targetMarginPct ?? 35.0,
      data.active === false ? 0 : 1,
      data.notes || null,
      id
    );
    return this.getMedicine(id);
  }

  deleteMedicine(id) {
    // Soft-delete: set active = 0 (preserves traceability of past dispensings)
    this.db.prepare('UPDATE medicines SET active = 0 WHERE id = ?').run(id);
    return { ok: true };
  }

  _insertSaleUnit(medicineId, u) {
    const id = u.id || randomUUID();
    this.db.prepare(`
      INSERT INTO medicine_sale_units (id, medicineId, name, quantityInBaseUnit, defaultPriceHT, isDefault, sortOrder)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, medicineId, u.name, u.quantityInBaseUnit, u.defaultPriceHT ?? 0, u.isDefault ? 1 : 0, u.sortOrder ?? 0);
    return id;
  }

  saveSaleUnits(medicineId, units) {
    // FK-safe: UPDATE existing, INSERT new, DELETE only unused ones
    const tx = this.db.transaction((arr) => {
      const existing = this.db.prepare('SELECT id FROM medicine_sale_units WHERE medicineId = ?').all(medicineId);
      const incomingIds = new Set((arr || []).filter((u) => u.id).map((u) => u.id));
      const updateStmt = this.db.prepare(`
        UPDATE medicine_sale_units SET name=?, quantityInBaseUnit=?, defaultPriceHT=?, isDefault=?, sortOrder=?
        WHERE id=? AND medicineId=?
      `);
      const checkUsage = this.db.prepare('SELECT COUNT(*) AS c FROM medicine_dispensings WHERE saleUnitId = ?');
      const deleteStmt = this.db.prepare('DELETE FROM medicine_sale_units WHERE id = ?');

      // Delete existing rows that are not in the new list AND have no dispensings
      const skipped = [];
      for (const e of existing) {
        if (incomingIds.has(e.id)) continue;
        const usage = checkUsage.get(e.id);
        if (usage.c > 0) {
          skipped.push(e.id);
        } else {
          deleteStmt.run(e.id);
        }
      }

      // Update existing or insert new
      for (const u of (arr || [])) {
        if (u.id) {
          updateStmt.run(u.name, u.quantityInBaseUnit, u.defaultPriceHT ?? 0, u.isDefault ? 1 : 0, u.sortOrder ?? 0, u.id, medicineId);
        } else {
          this._insertSaleUnit(medicineId, u);
        }
      }
    });
    tx(units || []);
    return this.db.prepare('SELECT * FROM medicine_sale_units WHERE medicineId = ? ORDER BY sortOrder, quantityInBaseUnit').all(medicineId);
  }

  // ===== Medicine lots (stock management) =====
  listLots({ medicineId, expiringInDays, lowStockOnly, withZeroStock = false } = {}) {
    const where = ['1=1'];
    const params = [];
    if (medicineId) {
      where.push('l.medicineId = ?');
      params.push(medicineId);
    }
    if (!withZeroStock) {
      where.push('l.remainingQuantityBaseUnit > 0');
    }
    if (expiringInDays != null) {
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + Number(expiringInDays));
      where.push('l.expiryDate <= ?');
      params.push(horizon.toISOString().slice(0, 10));
    }
    let lots = this.db.prepare(`
      SELECT l.*, m.name AS medicineName, m.baseUnit, m.minStockAlert, m.active AS medicineActive
      FROM medicine_lots l
      JOIN medicines m ON m.id = l.medicineId
      WHERE ${where.join(' AND ')}
      ORDER BY l.expiryDate ASC, m.name ASC
    `).all(...params);

    if (lowStockOnly) {
      // Group remaining by medicine, filter those under min threshold
      const totals = {};
      for (const l of lots) {
        totals[l.medicineId] = (totals[l.medicineId] || 0) + l.remainingQuantityBaseUnit;
      }
      lots = lots.filter((l) => l.minStockAlert > 0 && totals[l.medicineId] < l.minStockAlert);
    }
    return lots;
  }

  getLot(id) {
    const lot = this.db.prepare(`
      SELECT l.*, m.name AS medicineName, m.baseUnit
      FROM medicine_lots l
      JOIN medicines m ON m.id = l.medicineId
      WHERE l.id = ?
    `).get(id);
    return lot;
  }

  createLot(data) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const initialQty = Number(data.initialQuantityBaseUnit);
    if (!data.medicineId) throw new Error('medicineId requis');
    if (!data.lotNumber) throw new Error('Numéro de lot requis');
    if (!data.expiryDate) throw new Error('Date de péremption requise');
    if (!data.purchaseDate) throw new Error('Date d\'achat requise');
    if (!isFinite(initialQty) || initialQty <= 0) throw new Error('Quantité initiale invalide');
    // Réduction fournisseur (comme sur facture : P.N. = P.U. - remise%) : réduit le coût d'achat réel
    // sans jamais toucher au prix de vente (voir recalcMargin côté front, basé sur unitPriceHT brut).
    const unitPriceHT = data.unitPriceHT != null && data.unitPriceHT !== '' ? Number(data.unitPriceHT) : null;
    const discountPct = data.discountPct != null && data.discountPct !== '' ? Number(data.discountPct) : null;
    // Explicit purchasePriceHT wins (front computes it at package level, matching the invoice total exactly);
    // otherwise recompute from unit price/discount × quantity (same fallback as updateLot).
    const purchasePriceHT = data.purchasePriceHT != null && data.purchasePriceHT !== ''
      ? Number(data.purchasePriceHT)
      : (unitPriceHT != null
        ? Math.round(Math.round(unitPriceHT * (1 - (discountPct || 0) / 100) * 100) / 100 * initialQty * 100) / 100
        : 0);
    this.db.prepare(`
      INSERT INTO medicine_lots (id, medicineId, lotNumber, expiryDate, supplierName, purchaseDate, purchasePriceHT, unitPriceHT, discountPct, initialQuantityBaseUnit, remainingQuantityBaseUnit, notes, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.medicineId,
      data.lotNumber,
      data.expiryDate,
      data.supplierName || null,
      data.purchaseDate,
      purchasePriceHT,
      unitPriceHT,
      discountPct,
      initialQty,
      initialQty,
      data.notes || null,
      now,
      data.createdBy || null
    );
    return this.getLot(id);
  }

  updateLot(id, data) {
    // Allow editing metadata; remaining quantity can also be adjusted manually (loss, breakage…)
    const cur = this.getLot(id);
    if (!cur) throw new Error('Lot introuvable');
    const newRemaining = data.remainingQuantityBaseUnit != null
      ? Number(data.remainingQuantityBaseUnit)
      : cur.remainingQuantityBaseUnit;
    const newQty = data.initialQuantityBaseUnit != null ? Number(data.initialQuantityBaseUnit) : cur.initialQuantityBaseUnit;
    const unitPriceHT = data.unitPriceHT != null ? Number(data.unitPriceHT) : cur.unitPriceHT;
    const discountPct = data.discountPct != null ? Number(data.discountPct) : cur.discountPct;
    // Explicit purchasePriceHT wins (backward compat); otherwise recompute from unit price/discount if either changed
    let purchasePriceHT;
    if (data.purchasePriceHT != null) {
      purchasePriceHT = Number(data.purchasePriceHT);
    } else if (data.unitPriceHT != null || data.discountPct != null) {
      purchasePriceHT = unitPriceHT != null
        ? Math.round(Math.round(unitPriceHT * (1 - (discountPct || 0) / 100) * 100) / 100 * newQty * 100) / 100
        : cur.purchasePriceHT;
    } else {
      purchasePriceHT = cur.purchasePriceHT;
    }
    this.db.prepare(`
      UPDATE medicine_lots SET lotNumber=?, expiryDate=?, supplierName=?, purchaseDate=?, purchasePriceHT=?, unitPriceHT=?, discountPct=?, initialQuantityBaseUnit=?, remainingQuantityBaseUnit=?, notes=?
      WHERE id=?
    `).run(
      data.lotNumber ?? cur.lotNumber,
      data.expiryDate ?? cur.expiryDate,
      data.supplierName ?? cur.supplierName,
      data.purchaseDate ?? cur.purchaseDate,
      purchasePriceHT,
      unitPriceHT,
      discountPct,
      newQty,
      newRemaining,
      data.notes ?? cur.notes,
      id
    );
    return this.getLot(id);
  }

  deleteLot(id) {
    // Only allow if no dispensings reference this lot
    const usage = this.db.prepare('SELECT COUNT(*) AS c FROM medicine_dispensings WHERE lotId = ?').get(id);
    if (usage.c > 0) {
      throw new Error('Impossible de supprimer : ce lot a été dispensé à ' + usage.c + ' patient(s). Mettez la quantité restante à 0 si épuisé.');
    }
    this.db.prepare('DELETE FROM medicine_lots WHERE id = ?').run(id);
    return { ok: true };
  }

  // ===== Dispensings (medication traceability queries) =====
  listDispensingsByLot(lotId) {
    return this.db.prepare(`
      SELECT d.*,
        m.name AS medicineName, m.baseUnit,
        l.lotNumber, l.expiryDate,
        su.name AS saleUnitName, su.quantityInBaseUnit AS saleUnitQty,
        p.name AS patientName, p.species AS patientSpecies,
        o.firstName AS ownerFirstName, o.lastName AS ownerLastName, o.email AS ownerEmail, o.phone AS ownerPhone
      FROM medicine_dispensings d
      JOIN medicine_lots l ON l.id = d.lotId
      JOIN medicines m ON m.id = l.medicineId
      LEFT JOIN medicine_sale_units su ON su.id = d.saleUnitId
      JOIN patients p ON p.id = d.patientId
      JOIN owners o ON o.id = d.ownerId
      WHERE d.lotId = ?
      ORDER BY d.date DESC
    `).all(lotId);
  }

  listDispensingsByPatient(patientId) {
    return this.db.prepare(`
      SELECT d.*,
        m.name AS medicineName, m.baseUnit,
        l.lotNumber, l.expiryDate,
        su.name AS saleUnitName,
        i.number AS invoiceNumber
      FROM medicine_dispensings d
      JOIN medicine_lots l ON l.id = d.lotId
      JOIN medicines m ON m.id = l.medicineId
      LEFT JOIN medicine_sale_units su ON su.id = d.saleUnitId
      LEFT JOIN invoices i ON i.id = d.invoiceId
      WHERE d.patientId = ?
      ORDER BY d.date DESC
    `).all(patientId);
  }

  searchLotsByNumber(lotNumberSearch) {
    return this.db.prepare(`
      SELECT l.*, m.name AS medicineName, m.baseUnit
      FROM medicine_lots l
      JOIN medicines m ON m.id = l.medicineId
      WHERE l.lotNumber LIKE ?
      ORDER BY l.expiryDate DESC
    `).all('%' + lotNumberSearch + '%');
  }

  // ===== Reports =====
  marginReport({ startDate, endDate } = {}) {
    // Per medicine: total revenue HT (from dispensings linked to invoices),
    // total cost HT (proportional to baseUnitsConsumed × cost per base unit of the lot)
    const params = [];
    let dateClause = '';
    if (startDate) { dateClause += ' AND d.date >= ?'; params.push(startDate); }
    if (endDate) { dateClause += ' AND d.date <= ?'; params.push(endDate); }
    const rows = this.db.prepare(`
      SELECT
        m.id AS medicineId,
        m.name AS medicineName,
        m.baseUnit,
        m.targetMarginPct,
        SUM(d.baseUnitsConsumed) AS totalUnitsSold,
        SUM(d.baseUnitsConsumed * (l.purchasePriceHT / NULLIF(l.initialQuantityBaseUnit, 0))) AS totalCostHT,
        SUM(d.quantitySold * COALESCE(ii.priceHT, 0)) AS totalRevenueHT,
        COUNT(DISTINCT d.id) AS dispensingsCount
      FROM medicine_dispensings d
      JOIN medicine_lots l ON l.id = d.lotId
      JOIN medicines m ON m.id = l.medicineId
      LEFT JOIN invoice_items ii ON ii.id = d.invoiceItemId OR ii.dispensingId = d.id
      WHERE 1=1 ${dateClause}
      GROUP BY m.id, m.name, m.baseUnit, m.targetMarginPct
      ORDER BY totalRevenueHT DESC
    `).all(...params);
    return rows.map((r) => ({
      ...r,
      totalRevenueHT: r.totalRevenueHT || 0,
      totalCostHT: r.totalCostHT || 0,
      marginEUR: (r.totalRevenueHT || 0) - (r.totalCostHT || 0),
      marginPct: r.totalCostHT > 0 ? (((r.totalRevenueHT - r.totalCostHT) / r.totalCostHT) * 100) : null,
    }));
  }

  // ===== Monthly overheads (charges fixes / variables saisies à la main) =====
  listMonthlyOverheads({ startMonth, endMonth } = {}) {
    const params = [];
    let where = '1=1';
    if (startMonth) { where += ' AND yearMonth >= ?'; params.push(startMonth); }
    if (endMonth)   { where += ' AND yearMonth <= ?'; params.push(endMonth); }
    return this.db.prepare(
      `SELECT * FROM monthly_overheads WHERE ${where} ORDER BY yearMonth DESC, kind, label`
    ).all(...params);
  }
  createMonthlyOverhead(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO monthly_overheads (id, yearMonth, kind, label, amountHT, category, vatRate, vatRecoverable, notes, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.yearMonth, data.kind, data.label,
      Number(data.amountHT) || 0,
      data.category || null,
      Number(data.vatRate) || 0,
      data.vatRecoverable === false || data.vatRecoverable === 0 ? 0 : 1,
      data.notes || null,
      new Date().toISOString(), data.createdBy || null
    );
    return this.db.prepare('SELECT * FROM monthly_overheads WHERE id = ?').get(id);
  }
  updateMonthlyOverhead(id, data) {
    this.db.prepare(`
      UPDATE monthly_overheads SET yearMonth=?, kind=?, label=?, amountHT=?, category=?, vatRate=?, vatRecoverable=?, notes=?
      WHERE id=?
    `).run(
      data.yearMonth, data.kind, data.label,
      Number(data.amountHT) || 0,
      data.category || null,
      Number(data.vatRate) || 0,
      data.vatRecoverable === false || data.vatRecoverable === 0 ? 0 : 1,
      data.notes || null, id
    );
    return this.db.prepare('SELECT * FROM monthly_overheads WHERE id = ?').get(id);
  }
  deleteMonthlyOverhead(id) {
    this.db.prepare('DELETE FROM monthly_overheads WHERE id = ?').run(id);
    return { success: true };
  }
  sumMonthlyOverheads({ startMonth, endMonth } = {}) {
    const params = [];
    let where = '1=1';
    if (startMonth) { where += ' AND yearMonth >= ?'; params.push(startMonth); }
    if (endMonth)   { where += ' AND yearMonth <= ?'; params.push(endMonth); }
    const rows = this.db.prepare(
      `SELECT kind, COALESCE(SUM(amountHT), 0) AS total FROM monthly_overheads WHERE ${where} GROUP BY kind`
    ).all(...params);
    const out = { fixed: 0, variable: 0 };
    for (const r of rows) { if (r.kind === 'fixed') out.fixed = r.total; else if (r.kind === 'variable') out.variable = r.total; }
    return out;
  }
  // Detailed overhead breakdown: HT/VAT/TTC split by kind and by category, plus deductible VAT.
  overheadsBreakdown({ startMonth, endMonth } = {}) {
    const params = [];
    let where = '1=1';
    if (startMonth) { where += ' AND yearMonth >= ?'; params.push(startMonth); }
    if (endMonth)   { where += ' AND yearMonth <= ?'; params.push(endMonth); }
    const rows = this.db.prepare(`SELECT * FROM monthly_overheads WHERE ${where}`).all(...params);
    let fixedHT = 0, variableHT = 0, vatTotal = 0, vatDeductible = 0;
    const catMap = new Map();
    for (const r of rows) {
      const ht = Number(r.amountHT) || 0;
      const rate = Number(r.vatRate) || 0;
      const vat = ht * rate / 100;
      if (r.kind === 'fixed') fixedHT += ht; else variableHT += ht;
      vatTotal += vat;
      if (r.vatRecoverable) vatDeductible += vat;
      const cat = r.category || 'Sans catégorie';
      const c = catMap.get(cat) || { category: cat, ht: 0, vat: 0, ttc: 0, fixedHT: 0, variableHT: 0 };
      c.ht += ht; c.vat += vat; c.ttc += ht + vat;
      if (r.kind === 'fixed') c.fixedHT += ht; else c.variableHT += ht;
      catMap.set(cat, c);
    }
    const byCategory = [...catMap.values()].sort((a, b) => b.ht - a.ht);
    return { fixedHT, variableHT, totalHT: fixedHT + variableHT, vatTotal, vatDeductible, ttc: fixedHT + variableHT + vatTotal, byCategory };
  }

  // ===== Reports — financial / activity / tops / team =====
  // Helper: yearMonth boundaries from date range (YYYY-MM-DD → YYYY-MM)
  _ymRange(startDate, endDate) {
    return {
      startMonth: startDate ? startDate.slice(0, 7) : null,
      endMonth: endDate ? endDate.slice(0, 7) : null,
    };
  }

  financialSummary({ startDate, endDate, userId } = {}) {
    const params = [];
    let where = "i.status != 'cancelled'";
    if (startDate) { where += ' AND i.date >= ?'; params.push(startDate); }
    if (endDate)   { where += ' AND i.date <= ?'; params.push(endDate); }
    if (userId)    { where += ' AND i.createdBy = ?'; params.push(userId); }

    const ca = this.db.prepare(
      `SELECT COALESCE(SUM(totalHT), 0) AS ht, COALESCE(SUM(totalTTC), 0) AS ttc, COUNT(*) AS n FROM invoices i WHERE ${where}`
    ).get(...params);

    const tvaRows = this.db.prepare(`
      SELECT ii.vatRate AS rate,
        COALESCE(SUM(ii.quantity * ii.priceHT * ii.vatRate / 100.0), 0) AS amount
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE ${where}
      GROUP BY ii.vatRate
      ORDER BY ii.vatRate
    `).all(...params);

    // Overheads (independent of userId — they are clinic-wide).
    // Medicine purchase cost is no longer subtracted here — it is meant to be
    // entered manually as a charge (overhead) so it appears in the budget.
    const { startMonth, endMonth } = this._ymRange(startDate, endDate);
    const ob = this.overheadsBreakdown({ startMonth, endMonth });
    const overheads = {
      fixed: ob.fixedHT,
      variable: ob.variableHT,
      vatDeductible: ob.vatDeductible,
      byCategory: ob.byCategory,
    };

    const profit = (ca.ht || 0) - ob.fixedHT - ob.variableHT;

    // Monthly breakdown for chart (always last 12 months ending at endDate or today)
    const anchorDate = endDate || new Date().toISOString().slice(0, 10);
    const anchor = new Date(anchorDate);
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1)); // UTC: sinon décalage d'un mois sur un serveur en CET
      months.push(d.toISOString().slice(0, 7));
    }
    const monthlyParams = userId ? [userId] : [];
    const monthlyWhere = userId ? " AND i.createdBy = ?" : "";
    const monthly = this.db.prepare(`
      SELECT substr(i.date, 1, 7) AS ym,
        COALESCE(SUM(i.totalHT), 0) AS ca_ht
      FROM invoices i
      WHERE i.status != 'cancelled' ${monthlyWhere}
        AND substr(i.date, 1, 7) IN (${months.map(() => '?').join(',')})
      GROUP BY substr(i.date, 1, 7)
    `).all(...monthlyParams, ...months);
    const monthlyMap = new Map(monthly.map((r) => [r.ym, r.ca_ht]));
    const ohMonthly = this.db.prepare(`
      SELECT yearMonth AS ym, COALESCE(SUM(amountHT), 0) AS charges_ht
      FROM monthly_overheads
      WHERE yearMonth IN (${months.map(() => '?').join(',')})
      GROUP BY yearMonth
    `).all(...months);
    const ohMap = new Map(ohMonthly.map((r) => [r.ym, r.charges_ht]));
    const byMonth = months.map((ym) => {
      const ca_ht = monthlyMap.get(ym) || 0;
      const charges_ht = ohMap.get(ym) || 0;
      return { month: ym, ca_ht, charges_ht, profit: ca_ht - charges_ht };
    });

    return {
      range: { startDate: startDate || null, endDate: endDate || null, userId: userId || null },
      ca: { ht: ca.ht || 0, ttc: ca.ttc || 0, count: ca.n || 0 },
      tva: (() => {
        const collected = tvaRows.reduce((s, r) => s + (r.amount || 0), 0);
        return { byRate: tvaRows, total: collected, collected, deductible: ob.vatDeductible, net: collected - ob.vatDeductible };
      })(),
      overheads,
      profit,
      byMonth,
    };
  }

  activityStats({ startDate, endDate, userId } = {}) {
    const dateRange = (col) => {
      const p = [];
      let w = '1=1';
      if (startDate) { w += ` AND ${col} >= ?`; p.push(startDate); }
      if (endDate)   { w += ` AND ${col} <= ?`; p.push(endDate + 'T23:59:59.999Z'); }
      return { w, p };
    };

    // New owners (createdAt is full ISO)
    const o = dateRange('createdAt');
    const newOwners = this.db.prepare(`SELECT COUNT(*) AS c FROM owners WHERE ${o.w}`).get(...o.p).c;
    const newPatients = this.db.prepare(`SELECT COUNT(*) AS c FROM patients WHERE ${o.w}`).get(...o.p).c;

    // Medical records (proxy for consultations) — filtered by createdBy if userId
    const r = dateRange('date');
    const recParams = [...r.p];
    let recWhere = r.w;
    if (userId) { recWhere += ' AND createdBy = ?'; recParams.push(userId); }
    const nConsultations = this.db.prepare(
      `SELECT COUNT(*) AS c FROM medical_records WHERE ${recWhere}`
    ).get(...recParams).c;

    // Species breakdown (patients seen via medical_records in range)
    const spParams = [];
    let spWhere = '1=1';
    if (startDate) { spWhere += ' AND mr.date >= ?'; spParams.push(startDate); }
    if (endDate)   { spWhere += ' AND mr.date <= ?'; spParams.push(endDate + 'T23:59:59.999Z'); }
    if (userId)    { spWhere += ' AND mr.createdBy = ?'; spParams.push(userId); }
    const speciesRows = this.db.prepare(`
      SELECT p.species, COUNT(DISTINCT mr.id) AS n
      FROM medical_records mr
      JOIN patients p ON p.id = mr.patientId
      WHERE ${spWhere}
      GROUP BY p.species
      ORDER BY n DESC
    `).all(...spParams);

    // 12-month breakdown
    const anchorDate = endDate || new Date().toISOString().slice(0, 10);
    const anchor = new Date(anchorDate);
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1)); // UTC: sinon décalage d'un mois sur un serveur en CET
      months.push(d.toISOString().slice(0, 7));
    }
    const placeholders = months.map(() => '?').join(',');
    const newOwnersByMonth = this.db.prepare(`
      SELECT substr(createdAt, 1, 7) AS ym, COUNT(*) AS c FROM owners
      WHERE substr(createdAt, 1, 7) IN (${placeholders}) GROUP BY substr(createdAt, 1, 7)
    `).all(...months);
    const newPatientsByMonth = this.db.prepare(`
      SELECT substr(createdAt, 1, 7) AS ym, COUNT(*) AS c FROM patients
      WHERE substr(createdAt, 1, 7) IN (${placeholders}) GROUP BY substr(createdAt, 1, 7)
    `).all(...months);
    const userFilter = userId ? ' AND createdBy = ?' : '';
    const userParams = userId ? [userId] : [];
    const consultsByMonth = this.db.prepare(`
      SELECT substr(date, 1, 7) AS ym, COUNT(*) AS c FROM medical_records
      WHERE substr(date, 1, 7) IN (${placeholders}) ${userFilter}
      GROUP BY substr(date, 1, 7)
    `).all(...months, ...userParams);
    const mapOf = (rows) => new Map(rows.map((x) => [x.ym, x.c]));
    const oMap = mapOf(newOwnersByMonth);
    const pMap = mapOf(newPatientsByMonth);
    const cMap = mapOf(consultsByMonth);
    const byMonth = months.map((ym) => ({
      month: ym,
      newOwners: oMap.get(ym) || 0,
      newPatients: pMap.get(ym) || 0,
      nConsultations: cMap.get(ym) || 0,
    }));

    return {
      range: { startDate: startDate || null, endDate: endDate || null, userId: userId || null },
      newOwners, newPatients, nConsultations,
      speciesBreakdown: speciesRows,
      byMonth,
    };
  }

  topStats({ startDate, endDate, limit = 10 } = {}) {
    const params = [];
    let where = "i.status != 'cancelled'";
    if (startDate) { where += ' AND i.date >= ?'; params.push(startDate); }
    if (endDate)   { where += ' AND i.date <= ?'; params.push(endDate); }

    // Top acts (invoice_items kind='act' or NULL/default)
    const topActs = this.db.prepare(`
      SELECT
        COALESCE(s.id, '__nosvc__:' || ii.description) AS key,
        ii.serviceId,
        COALESCE(s.code, '') AS code,
        COALESCE(s.name, ii.description) AS name,
        COUNT(*) AS n,
        COALESCE(SUM(ii.quantity * ii.priceHT), 0) AS ca_ht
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      LEFT JOIN services s ON s.id = ii.serviceId
      WHERE ${where} AND (ii.kind = 'act' OR ii.kind IS NULL)
      GROUP BY key
      ORDER BY ca_ht DESC
      LIMIT ?
    `).all(...params, limit);

    // Top medicines sold (via dispensings linked to invoices in range)
    const medParams = [];
    let medWhere = "i.status != 'cancelled'";
    if (startDate) { medWhere += ' AND i.date >= ?'; medParams.push(startDate); }
    if (endDate)   { medWhere += ' AND i.date <= ?'; medParams.push(endDate); }
    const topMeds = this.db.prepare(`
      SELECT m.id AS medicineId, m.name,
        COALESCE(SUM(d.baseUnitsConsumed), 0) AS qty,
        m.baseUnit,
        COALESCE(SUM(d.quantitySold * ii.priceHT), 0) AS ca_ht,
        COALESCE(SUM(d.baseUnitsConsumed * (l.purchasePriceHT / NULLIF(l.initialQuantityBaseUnit, 0))), 0) AS cost_ht
      FROM medicine_dispensings d
      JOIN medicine_lots l ON l.id = d.lotId
      JOIN medicines m ON m.id = l.medicineId
      JOIN invoice_items ii ON ii.id = d.invoiceItemId OR ii.dispensingId = d.id
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE ${medWhere}
      GROUP BY m.id, m.name, m.baseUnit
      ORDER BY ca_ht DESC
      LIMIT ?
    `).all(...medParams, limit);

    // Top clients (by total invoiced HT in range)
    const topClients = this.db.prepare(`
      SELECT o.id AS ownerId, o.firstName, o.lastName,
        COUNT(i.id) AS n_invoices,
        COALESCE(SUM(i.totalHT), 0) AS ca_ht
      FROM invoices i
      JOIN owners o ON o.id = i.ownerId
      WHERE ${where}
      GROUP BY o.id, o.firstName, o.lastName
      ORDER BY ca_ht DESC
      LIMIT ?
    `).all(...params, limit);

    return {
      range: { startDate: startDate || null, endDate: endDate || null },
      topActs: topActs.map((r) => ({ ...r, margin_ht: undefined })),
      topMeds: topMeds.map((r) => ({
        ...r,
        margin_ht: (r.ca_ht || 0) - (r.cost_ht || 0),
      })),
      topClients,
    };
  }

  teamStats({ startDate, endDate } = {}) {
    const params = [];
    let invWhere = "i.status != 'cancelled'";
    if (startDate) { invWhere += ' AND i.date >= ?'; params.push(startDate); }
    if (endDate)   { invWhere += ' AND i.date <= ?'; params.push(endDate); }

    const users = this.db.prepare(
      'SELECT id, fullName, username, role FROM users WHERE active = 1 ORDER BY fullName'
    ).all();

    const invRows = this.db.prepare(`
      SELECT i.createdBy AS userId,
        COUNT(*) AS n_invoices,
        COALESCE(SUM(i.totalHT), 0) AS ca_ht
      FROM invoices i
      WHERE ${invWhere} AND i.createdBy IS NOT NULL
      GROUP BY i.createdBy
    `).all(...params);
    const invMap = new Map(invRows.map((r) => [r.userId, r]));

    // Consultations (medical_records) per user
    const recParams = [];
    let recWhere = 'createdBy IS NOT NULL';
    if (startDate) { recWhere += ' AND date >= ?'; recParams.push(startDate); }
    if (endDate)   { recWhere += ' AND date <= ?'; recParams.push(endDate + 'T23:59:59.999Z'); }
    const recRows = this.db.prepare(`
      SELECT createdBy AS userId, COUNT(*) AS n FROM medical_records
      WHERE ${recWhere} GROUP BY createdBy
    `).all(...recParams);
    const recMap = new Map(recRows.map((r) => [r.userId, r.n]));

    // Acts count from invoice_items (act lines per invoice.createdBy)
    const actRows = this.db.prepare(`
      SELECT i.createdBy AS userId, COUNT(*) AS n
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE ${invWhere} AND i.createdBy IS NOT NULL AND (ii.kind = 'act' OR ii.kind IS NULL)
      GROUP BY i.createdBy
    `).all(...params);
    const actMap = new Map(actRows.map((r) => [r.userId, r.n]));

    // Medicine dispensings per user (via invoice.createdBy, more reliable than d.prescribedBy)
    const dispRows = this.db.prepare(`
      SELECT i.createdBy AS userId, COUNT(*) AS n
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE ${invWhere} AND i.createdBy IS NOT NULL AND ii.kind = 'product'
      GROUP BY i.createdBy
    `).all(...params);
    const dispMap = new Map(dispRows.map((r) => [r.userId, r.n]));

    return {
      range: { startDate: startDate || null, endDate: endDate || null },
      users: users.map((u) => {
        const inv = invMap.get(u.id);
        return {
          userId: u.id,
          fullName: u.fullName,
          username: u.username,
          role: u.role,
          nConsultations: recMap.get(u.id) || 0,
          ca_ht: inv?.ca_ht || 0,
          n_invoices: inv?.n_invoices || 0,
          nActs: actMap.get(u.id) || 0,
          nDispensings: dispMap.get(u.id) || 0,
        };
      }),
    };
  }

  // ===== Settings =====
  // Export complet et lisible de toutes les données du cabinet (réversibilité).
  // Toutes les tables, sans les secrets : mots de passe, 2FA, jetons, mot de
  // passe SMTP. Les fichiers joints restent dans le dossier de données.
  exportAll() {
    const SKIP_TABLES = new Set(['referral_tokens']);
    const SKIP_COLS = { users: ['passwordHash', 'totpSecret', 'totpBackupCodes'] };
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map((r) => r.name);
    const out = {};
    for (const t of tables) {
      if (SKIP_TABLES.has(t)) continue;
      let rows = this.db.prepare(`SELECT * FROM "${t}"`).all();
      const drop = SKIP_COLS[t];
      if (drop) rows = rows.map((r) => { const c = { ...r }; for (const k of drop) delete c[k]; return c; });
      if (t === 'settings') rows = rows.filter((r) => !/pass|secret|token/i.test(r.key));
      out[t] = rows.map((r) => {
        const c = {};
        for (const [k, v] of Object.entries(r)) c[k] = Buffer.isBuffer(v) ? v.toString('base64') : v;
        return c;
      });
    }
    return out;
  }

  getSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    return obj;
  }
  saveSettings(data) {
    const upsert = this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const tx = this.db.transaction((entries) => {
      for (const [k, v] of entries) upsert.run(k, String(v ?? ''));
    });
    tx(Object.entries(data));
    return this.getSettings();
  }

  // ===== Stats =====
  getDashboardStats() {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const todayAppts = this.db.prepare(`
      SELECT COUNT(*) as c FROM appointments WHERE startTime >= ? AND startTime <= ?
    `).get(todayStart.toISOString(), todayEnd.toISOString()).c;

    const totalPatients = this.db.prepare('SELECT COUNT(*) as c FROM patients').get().c;
    const totalOwners = this.db.prepare('SELECT COUNT(*) as c FROM owners').get().c;

    const unpaidCount = this.db.prepare(`
      SELECT COUNT(*) as c FROM invoices WHERE status = 'sent' OR status = 'draft'
    `).get().c;

    const upcomingAppts = this.db.prepare(`
      SELECT a.*, p.name as patientName, o.firstName as ownerFirstName, o.lastName as ownerLastName
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.patientId
      LEFT JOIN owners o ON o.id = a.ownerId
      WHERE a.startTime >= ? AND (a.status = 'scheduled' OR a.status = 'confirmed')
      ORDER BY a.startTime ASC LIMIT 5
    `).all(new Date().toISOString());

    return { todayAppts, totalPatients, totalOwners, unpaidCount, upcomingAppts };
  }

  // ===== Caisse =====
  // Solde théorique = dernier comptage + factures payées en espèces depuis
  // + apports − sorties depuis. Chaque comptage affiche l'écart avec ce théorique.
  cashSummary({ startDate, endDate } = {}) {
    const cashIn = this.db.prepare(`
      SELECT i.id, i.number, i.status, i.date, i.paidAt, i.totalTTC, o.firstName as ownerFirstName, o.lastName as ownerLastName
      FROM invoices i JOIN owners o ON o.id = i.ownerId
      WHERE i.status IN ('paid', 'draft') AND i.paymentMethod = 'cash' AND i.paidAt IS NOT NULL
      ORDER BY i.paidAt
    `).all();
    const movements = this.db.prepare(`
      SELECT m.*, u.fullName as createdByName FROM cash_movements m
      LEFT JOIN users u ON u.id = m.createdBy
      ORDER BY m.date, m.createdAt
    `).all();

    // Rejoue la chronologie : encaissements et mouvements triés par date.
    const events = [
      ...cashIn.map((i) => ({ at: i.paidAt, kind: 'invoice', amount: i.totalTTC })),
      ...movements.map((m) => ({ at: m.date, kind: m.type, amount: m.amount, movement: m })),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    let expected = null;
    const counts = [];
    for (const e of events) {
      if (e.kind === 'count') {
        counts.push({ ...e.movement, expected, gap: expected == null ? null : Math.round((e.amount - expected) * 100) / 100 });
        expected = e.amount;
      } else if (expected != null) {
        expected = Math.round((expected + (e.kind === 'withdrawal' ? -e.amount : e.amount)) * 100) / 100;
      }
    }

    const inPeriod = (iso) => (!startDate || iso.slice(0, 10) >= startDate) && (!endDate || iso.slice(0, 10) <= endDate);
    const periodInvoices = cashIn.filter((i) => inPeriod(i.paidAt));
    const periodMovements = movements.filter((m) => inPeriod(m.date));
    return {
      // Les brouillons payés en espèces sont déjà dans la caisse (comptés dans le théorique)
      // mais pas encore validés : total à part.
      cashInvoicesTotal: periodInvoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.totalTTC, 0),
      cashDraftsTotal: periodInvoices.filter((i) => i.status === 'draft').reduce((s, i) => s + i.totalTTC, 0),
      cashInvoices: periodInvoices,
      withdrawalsTotal: periodMovements.filter((m) => m.type === 'withdrawal').reduce((s, m) => s + m.amount, 0),
      depositsTotal: periodMovements.filter((m) => m.type === 'deposit').reduce((s, m) => s + m.amount, 0),
      movements: periodMovements,
      expectedBalance: expected,
      lastCount: counts.length ? counts[counts.length - 1] : null,
      counts: counts.filter((c) => inPeriod(c.date)),
    };
  }
  addCashMovement(data) {
    if (!['count', 'withdrawal', 'deposit'].includes(data.type)) {
      throw Object.assign(new Error('Type de mouvement invalide.'), { status: 400 });
    }
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw Object.assign(new Error('Montant invalide.'), { status: 400 });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO cash_movements (id, date, type, amount, note, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.date || now, data.type, amount, data.note || null, now, data.createdBy || null);
    return { id };
  }
  deleteCashMovement(id) {
    this.db.prepare('DELETE FROM cash_movements WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Sage exports =====
  generateFEC(options) {
    const { startDate, endDate } = options;
    const settings = this.getSettings();
    const journalCode = settings.sageJournalCode || 'VT';
    const vatAccount = settings.sageVatAccount || '445710';
    const clientAccount = settings.sageClientAccount || '411000';

    const invoices = this.db.prepare(`
      SELECT i.*, o.firstName, o.lastName
      FROM invoices i
      JOIN owners o ON o.id = i.ownerId
      WHERE i.date >= ? AND i.date <= ? AND i.status NOT IN ('cancelled', 'draft')
      ORDER BY i.date, i.number
    `).all(startDate, endDate);

    const headers = [
      'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum',
      'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate',
      'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet',
      'ValidDate', 'Montantdevise', 'Idevise',
    ];
    const lines = [headers.join('\t')];

    let ecritureNum = 1;
    for (const inv of invoices) {
      const dateFmt = inv.date.replace(/-/g, '');
      const lib = `Facture ${inv.number} - ${inv.firstName} ${inv.lastName}`.replace(/\t/g, ' ');
      const auxNum = `411${inv.ownerId.replace(/-/g, '').substring(0, 6).toUpperCase()}`;
      const auxLib = `${inv.lastName} ${inv.firstName}`.replace(/\t/g, ' ');

      lines.push([
        journalCode, 'Ventes', ecritureNum, dateFmt, clientAccount,
        'Clients', auxNum, auxLib, inv.number, dateFmt,
        lib, inv.totalTTC.toFixed(2).replace('.', ','), '0,00', '', '',
        dateFmt, '0,00', 'EUR',
      ].join('\t'));

      const items = this.db.prepare('SELECT * FROM invoice_items WHERE invoiceId = ?').all(inv.id);
      const byAccount = {};
      for (const it of items) {
        const acc = it.accountCode || '706000';
        const lineHT = it.quantity * it.priceHT;
        const lineVAT = lineHT * (it.vatRate / 100);
        if (!byAccount[acc]) byAccount[acc] = { ht: 0, vat: 0 };
        byAccount[acc].ht += lineHT;
        byAccount[acc].vat += lineVAT;
      }
      for (const [acc, totals] of Object.entries(byAccount)) {
        lines.push([
          journalCode, 'Ventes', ecritureNum, dateFmt, acc,
          'Ventes prestations', '', '', inv.number, dateFmt,
          lib, '0,00', totals.ht.toFixed(2).replace('.', ','), '', '',
          dateFmt, '0,00', 'EUR',
        ].join('\t'));
      }

      if (inv.totalVAT > 0) {
        lines.push([
          journalCode, 'Ventes', ecritureNum, dateFmt, vatAccount,
          'TVA collectée', '', '', inv.number, dateFmt,
          lib, '0,00', inv.totalVAT.toFixed(2).replace('.', ','), '', '',
          dateFmt, '0,00', 'EUR',
        ].join('\t'));
      }

      ecritureNum++;
    }

    return lines.join('\r\n');
  }

  generateInvoicesCSV(options) {
    const { startDate, endDate } = options;
    const invoices = this.db.prepare(`
      SELECT i.*, o.firstName, o.lastName, o.email
      FROM invoices i
      JOIN owners o ON o.id = i.ownerId
      WHERE i.date >= ? AND i.date <= ? AND i.status NOT IN ('cancelled', 'draft')
      ORDER BY i.date, i.number
    `).all(startDate, endDate);

    const headers = ['Numero', 'Date', 'Client', 'Email', 'Statut', 'TotalHT', 'TVA', 'TotalTTC'];
    const rows = [headers.join(';')];
    for (const inv of invoices) {
      rows.push([
        inv.number, inv.date,
        `${inv.lastName} ${inv.firstName}`,
        inv.email || '',
        inv.status,
        inv.totalHT.toFixed(2).replace('.', ','),
        inv.totalVAT.toFixed(2).replace('.', ','),
        inv.totalTTC.toFixed(2).replace('.', ','),
      ].join(';'));
    }
    return '﻿' + rows.join('\r\n');
  }

  // ===== Follow-up reminders =====
  listFollowUpReminders(filter = {}) {
    let query = `
      SELECT f.*,
        p.name as patientName, p.species as patientSpecies,
        o.id as ownerId, o.firstName as ownerFirstName, o.lastName as ownerLastName, o.email as ownerEmail
      FROM follow_up_reminders f
      JOIN patients p ON p.id = f.patientId
      JOIN owners o ON o.id = p.ownerId
    `;
    const params = [];
    const wheres = [];
    if (filter.status) { wheres.push('f.status = ?'); params.push(filter.status); }
    if (filter.patientId) { wheres.push('f.patientId = ?'); params.push(filter.patientId); }
    if (filter.upcomingDays) {
      wheres.push('f.scheduledDate <= ? AND f.status = ?');
      const target = new Date();
      target.setDate(target.getDate() + parseInt(filter.upcomingDays, 10));
      params.push(target.toISOString().slice(0, 10), 'pending');
    }
    if (wheres.length) query += ' WHERE ' + wheres.join(' AND ');
    query += ' ORDER BY f.scheduledDate ASC';
    return this.db.prepare(query).all(...params);
  }
  createFollowUpReminder(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO follow_up_reminders (id, patientId, medicalRecordId, type, title, notes, scheduledDate, status, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.patientId, data.medicalRecordId || null,
      data.type || null, data.title, data.notes || null,
      data.scheduledDate, data.status || 'pending',
      new Date().toISOString(), data.createdBy || null);
    return this.db.prepare('SELECT * FROM follow_up_reminders WHERE id = ?').get(id);
  }
  updateFollowUpReminder(id, data) {
    this.db.prepare(`
      UPDATE follow_up_reminders SET title=?, notes=?, scheduledDate=?, status=?, type=?
      WHERE id=?
    `).run(data.title, data.notes || null, data.scheduledDate,
      data.status || 'pending', data.type || null, id);
    return this.db.prepare('SELECT * FROM follow_up_reminders WHERE id = ?').get(id);
  }
  markFollowUpSent(id, sentAt, errorMsg) {
    this.db.prepare(`
      UPDATE follow_up_reminders SET status = ?, sentAt = ?, errorMsg = ? WHERE id = ?
    `).run(errorMsg ? 'failed' : 'sent', sentAt, errorMsg || null, id);
  }
  deleteFollowUpReminder(id) {
    this.db.prepare('DELETE FROM follow_up_reminders WHERE id = ?').run(id);
    return { success: true };
  }
  findFollowUpsToSend(today) {
    return this.db.prepare(`
      SELECT f.*,
        p.name as patientName, p.species as patientSpecies,
        o.firstName as ownerFirstName, o.lastName as ownerLastName, o.email as ownerEmail
      FROM follow_up_reminders f
      JOIN patients p ON p.id = f.patientId
      JOIN owners o ON o.id = p.ownerId
      WHERE f.status = 'pending'
        AND f.scheduledDate <= ?
        AND o.email IS NOT NULL AND o.email <> ''
      ORDER BY f.scheduledDate ASC
    `).all(today);
  }

  // ===== Reminders (for appointments) =====
  listReminders(limit = 100) {
    return this.db.prepare(`
      SELECT r.*,
        a.startTime as appointmentStart, a.title as appointmentTitle,
        o.firstName as ownerFirstName, o.lastName as ownerLastName,
        p.name as patientName
      FROM reminders r
      LEFT JOIN appointments a ON a.id = r.appointmentId
      LEFT JOIN owners o ON o.id = a.ownerId
      LEFT JOIN patients p ON p.id = a.patientId
      ORDER BY r.createdAt DESC LIMIT ?
    `).all(limit);
  }
  listRemindersByAppointment(appointmentId) {
    return this.db.prepare(
      'SELECT * FROM reminders WHERE appointmentId = ? ORDER BY createdAt DESC'
    ).all(appointmentId);
  }
  hasReminderSent(appointmentId, channel) {
    const r = this.db.prepare(
      "SELECT 1 FROM reminders WHERE appointmentId = ? AND channel = ? AND status = 'sent' LIMIT 1"
    ).get(appointmentId, channel);
    return !!r;
  }
  createReminder(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO reminders (id, appointmentId, channel, recipient, status, scheduledAt, sentAt, errorMsg, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.appointmentId, data.channel || 'email',
      data.recipient || null, data.status || 'pending',
      data.scheduledAt || null, data.sentAt || null,
      data.errorMsg || null, new Date().toISOString());
    return this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
  }
  findAppointmentsNeedingReminder(fromIso, toIso) {
    return this.db.prepare(`
      SELECT a.*,
        p.name as patientName,
        o.firstName as ownerFirstName, o.lastName as ownerLastName, o.email as ownerEmail,
        t.name as typeName, t.color as typeColor
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.patientId
      LEFT JOIN owners o ON o.id = a.ownerId
      LEFT JOIN appointment_types t ON t.id = a.appointmentTypeId
      WHERE a.startTime >= ? AND a.startTime <= ?
        AND a.status = 'scheduled'
        AND o.email IS NOT NULL AND o.email <> ''
        AND NOT EXISTS (
          SELECT 1 FROM reminders r
          WHERE r.appointmentId = a.id AND r.channel = 'email' AND r.status = 'sent'
        )
      ORDER BY a.startTime ASC
    `).all(fromIso, toIso);
  }

  // ===== Répertoire des vétérinaires référents =====
  listReferringVets(filter = {}) {
    let query = `
      SELECT v.*,
        (SELECT COUNT(*) FROM referral_cases c WHERE c.referringVetId = v.id) as caseCount,
        (SELECT COUNT(*) FROM owners o WHERE o.referringVetId = v.id) as clientCount,
        (SELECT MAX(s.sentAt) FROM referral_vet_sends s WHERE s.referringVetId = v.id) as lastSentAt
      FROM referring_vets v
    `;
    const params = [];
    const wheres = [];
    if (filter.activeOnly) wheres.push('v.active = 1');
    if (filter.search) {
      wheres.push('(v.name LIKE ? OR v.clinic LIKE ? OR v.email LIKE ? OR v.city LIKE ?)');
      const like = `%${filter.search}%`;
      params.push(like, like, like, like);
    }
    if (wheres.length) query += ' WHERE ' + wheres.join(' AND ');
    query += ' ORDER BY v.active DESC, v.name COLLATE NOCASE';
    return this.db.prepare(query).all(...params);
  }
  getReferringVet(id) {
    return this.db.prepare('SELECT * FROM referring_vets WHERE id = ?').get(id);
  }
  getReferringVetByEmail(email) {
    const e = (email || '').trim();
    if (!e) return null;
    return this.db.prepare('SELECT * FROM referring_vets WHERE LOWER(email) = LOWER(?) LIMIT 1').get(e);
  }
  createReferringVet(data) {
    const name = (data.name || '').trim();
    if (!name) throw Object.assign(new Error('Le nom du vétérinaire est obligatoire.'), { status: 400 });
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO referring_vets (id, name, clinic, email, phone, address, postalCode, city, notes, active, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, data.clinic || null, (data.email || '').trim() || null, data.phone || null,
      data.address || null, data.postalCode || null, data.city || null, data.notes || null,
      data.active === 0 || data.active === false ? 0 : 1, now, now);
    return this.getReferringVet(id);
  }
  updateReferringVet(id, data) {
    const current = this.getReferringVet(id);
    if (!current) throw Object.assign(new Error('Vétérinaire introuvable.'), { status: 404 });
    const name = data.name !== undefined ? (data.name || '').trim() : current.name;
    if (!name) throw Object.assign(new Error('Le nom du vétérinaire est obligatoire.'), { status: 400 });
    const pick = (key) => (data[key] !== undefined ? (data[key] || null) : current[key]);
    this.db.prepare(`
      UPDATE referring_vets
      SET name=?, clinic=?, email=?, phone=?, address=?, postalCode=?, city=?, notes=?, active=?, updatedAt=?
      WHERE id=?
    `).run(name, pick('clinic'), (data.email !== undefined ? (data.email || '').trim() || null : current.email),
      pick('phone'), pick('address'), pick('postalCode'), pick('city'), pick('notes'),
      data.active !== undefined ? (data.active ? 1 : 0) : current.active,
      new Date().toISOString(), id);
    return this.getReferringVet(id);
  }
  deleteReferringVet(id) {
    // On détache plutôt que de casser : les dossiers du portail et les fiches
    // clients gardent leur historique, ils perdent juste le lien.
    this.db.prepare('UPDATE referral_cases SET referringVetId = NULL WHERE referringVetId = ?').run(id);
    this.db.prepare('UPDATE owners SET referringVetId = NULL WHERE referringVetId = ?').run(id);
    this.db.prepare('DELETE FROM referring_vets WHERE id = ?').run(id);
    return { success: true };
  }
  // Retrouve une fiche par email, sinon la crée. Sert au portail (dossier
  // entrant) et à la reprise de l'existant.
  findOrCreateReferringVet(data) {
    const email = (data.email || '').trim();
    const name = (data.name || '').trim();
    if (!email && !name) return null;
    const existing = email ? this.getReferringVetByEmail(email) : null;
    if (existing) {
      // Complète les champs restés vides sans écraser ce qui a été saisi à la main.
      const fill = {};
      if (!existing.clinic && data.clinic) fill.clinic = data.clinic;
      if (!existing.phone && data.phone) fill.phone = data.phone;
      if (Object.keys(fill).length) return this.updateReferringVet(existing.id, fill);
      return existing;
    }
    return this.createReferringVet({ name: name || email, clinic: data.clinic, email, phone: data.phone });
  }
  // Patients adressés par ce vétérinaire : ceux de ses dossiers portail + ceux
  // dont le propriétaire lui est rattaché sur sa fiche client.
  listReferringVetPatients(vetId) {
    return this.db.prepare(`
      SELECT p.id, p.name, p.species, p.breed,
        o.id as ownerId, o.firstName as ownerFirstName, o.lastName as ownerLastName,
        (SELECT c.reference FROM referral_cases c WHERE c.patientId = p.id AND c.referringVetId = ? ORDER BY c.createdAt DESC LIMIT 1) as reference,
        (SELECT MAX(s.sentAt) FROM referral_vet_sends s WHERE s.patientId = p.id AND s.referringVetId = ?) as lastSentAt
      FROM patients p
      JOIN owners o ON o.id = p.ownerId
      WHERE o.referringVetId = ?
         OR p.id IN (SELECT c.patientId FROM referral_cases c WHERE c.referringVetId = ? AND c.patientId IS NOT NULL)
      ORDER BY o.lastName COLLATE NOCASE, p.name COLLATE NOCASE
    `).all(vetId, vetId, vetId, vetId);
  }
  listReferringVetSends(filter = {}) {
    let query = `
      SELECT s.*, p.name as patientName, v.name as vetName
      FROM referral_vet_sends s
      LEFT JOIN patients p ON p.id = s.patientId
      LEFT JOIN referring_vets v ON v.id = s.referringVetId
    `;
    const params = [];
    const wheres = [];
    if (filter.referringVetId) { wheres.push('s.referringVetId = ?'); params.push(filter.referringVetId); }
    if (filter.patientId) { wheres.push('s.patientId = ?'); params.push(filter.patientId); }
    if (wheres.length) query += ' WHERE ' + wheres.join(' AND ');
    query += ' ORDER BY s.sentAt DESC';
    if (filter.limit) query += ` LIMIT ${parseInt(filter.limit, 10)}`;
    return this.db.prepare(query).all(...params);
  }
  logReferringVetSend(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO referral_vet_sends (id, referringVetId, patientId, toEmail, subject, summary, sentAt, sentBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.referringVetId, data.patientId || null, data.toEmail,
      data.subject || null, data.summary || null, new Date().toISOString(), data.sentBy || null);
    return this.db.prepare('SELECT * FROM referral_vet_sends WHERE id = ?').get(id);
  }

  // ===== Referral cases (portail vétérinaires référents) =====
  nextReferralReference() {
    const year = new Date().getFullYear();
    const row = this.db.prepare(
      "SELECT COUNT(*) as n FROM referral_cases WHERE reference LIKE ?"
    ).get(`REF-${year}-%`);
    const seq = String((row?.n || 0) + 1).padStart(4, '0');
    return `REF-${year}-${seq}`;
  }
  createReferralCase(data) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const reference = this.nextReferralReference();
    this.db.prepare(`
      INSERT INTO referral_cases (
        id, reference, status, referringVetCivility, referringVetName, referringVetClinic, referringVetEmail, referringVetPhone,
        ownerFirstName, ownerLastName, ownerEmail, ownerPhone,
        patientName, species, breed, sex, birthDate, weight,
        reasonForReferral, urgency, notes, createdAt, updatedAt
      ) VALUES (?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, reference, data.referringVetCivility || null, data.referringVetName, data.referringVetClinic || null,
      data.referringVetEmail, data.referringVetPhone || null,
      data.ownerFirstName || null, data.ownerLastName || null, data.ownerEmail || null, data.ownerPhone || null,
      data.patientName, data.species || null, data.breed || null, data.sex || null,
      data.birthDate || null, data.weight || null,
      data.reasonForReferral || null, data.urgency || null, data.notes || null,
      now, now
    );
    return this.getReferralCase(id);
  }
  getReferralCase(id) {
    return this.db.prepare('SELECT * FROM referral_cases WHERE id = ?').get(id);
  }
  // Le formulaire public laisse saisir n'importe quel nom et n'importe quelle
  // adresse : rattacher un dossier à un patient existant donne à cette adresse
  // l'accès à tout son dossier médical. Une adresse n'est « connue » que si le
  // cabinet l'a déjà validée : un autre dossier de cette adresse déjà rattaché,
  // ou une fiche confrère saisie à la main (pas créée par le portail).
  referralEmailTrust(kase) {
    const email = String(kase.referringVetEmail || '').trim().toLowerCase();
    const freemail = /@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|gmx|proton|protonmail|aol|orange|free|laposte|wanadoo|pt|web)\./.test(email);
    if (!email) return { known: false, freemail, reason: 'Aucune adresse e-mail.' };
    const linkedBefore = this.db.prepare(`
      SELECT COUNT(*) AS c FROM referral_cases
      WHERE id != ? AND lower(trim(referringVetEmail)) = ? AND patientId IS NOT NULL
    `).get(kase.id, email).c;
    if (linkedBefore > 0) return { known: true, freemail, reason: `${linkedBefore} dossier(s) de cette adresse déjà rattaché(s).` };
    const vet = this.getReferringVetByEmail(email);
    if (vet) {
      // Fiche créée par le portail = au plus tard quelques secondes après son premier dossier.
      const firstCase = this.db.prepare(
        'SELECT MIN(createdAt) AS t FROM referral_cases WHERE lower(trim(referringVetEmail)) = ?'
      ).get(email).t;
      const manual = !firstCase || new Date(vet.createdAt).getTime() < new Date(firstCase).getTime() - 60 * 1000;
      if (manual) return { known: true, freemail, reason: 'Adresse enregistrée dans le répertoire des confrères.' };
    }
    return { known: false, freemail, reason: 'Première fois que cette adresse écrit au cabinet.' };
  }
  getReferralCaseByReference(reference) {
    return this.db.prepare('SELECT * FROM referral_cases WHERE reference = ?').get(reference);
  }
  listReferralCases(filter = {}) {
    let query = 'SELECT * FROM referral_cases';
    const params = [];
    const wheres = [];
    if (filter.status) { wheres.push('status = ?'); params.push(filter.status); }
    if (filter.patientId) { wheres.push('patientId = ?'); params.push(filter.patientId); }
    if (filter.search) {
      wheres.push('(patientName LIKE ? OR referringVetName LIKE ? OR referringVetClinic LIKE ? OR reference LIKE ?)');
      const like = `%${filter.search}%`;
      params.push(like, like, like, like);
    }
    if (wheres.length) query += ' WHERE ' + wheres.join(' AND ');
    query += ' ORDER BY createdAt DESC';
    return this.db.prepare(query).all(...params);
  }
  linkReferralCase(id, { patientId, ownerId, linkedBy }) {
    this.db.prepare(`
      UPDATE referral_cases SET patientId=?, ownerId=?, linkedAt=?, linkedBy=?, updatedAt=?
      WHERE id=?
    `).run(patientId, ownerId || null, new Date().toISOString(), linkedBy || null, new Date().toISOString(), id);
    return this.getReferralCase(id);
  }
  updateReferralCaseStatus(id, status) {
    this.db.prepare('UPDATE referral_cases SET status=?, updatedAt=? WHERE id=?')
      .run(status, new Date().toISOString(), id);
    return this.getReferralCase(id);
  }
  deleteReferralCase(id) {
    // ON DELETE CASCADE takes care of referral_intake_files/referral_tokens/referral_events rows.
    this.db.prepare('DELETE FROM referral_cases WHERE id = ?').run(id);
    return { success: true };
  }

  createReferralIntakeFile(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO referral_intake_files (id, caseId, category, originalName, storedFilename, mimeType, sizeBytes, uploadedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.caseId, data.category || 'other', data.originalName, data.storedFilename,
      data.mimeType, data.sizeBytes, new Date().toISOString());
    return this.db.prepare('SELECT * FROM referral_intake_files WHERE id = ?').get(id);
  }
  listReferralIntakeFiles(caseId) {
    return this.db.prepare('SELECT * FROM referral_intake_files WHERE caseId = ? ORDER BY uploadedAt').all(caseId);
  }
  getReferralIntakeFile(id) {
    return this.db.prepare('SELECT * FROM referral_intake_files WHERE id = ?').get(id);
  }

  createReferralToken(caseId, tokenHash, { expiresAt, createdReason = 'initial' }) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO referral_tokens (id, caseId, tokenHash, createdAt, expiresAt, createdReason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, caseId, tokenHash, new Date().toISOString(), expiresAt, createdReason);
    return this.db.prepare('SELECT * FROM referral_tokens WHERE id = ?').get(id);
  }
  getReferralTokenByHash(tokenHash) {
    return this.db.prepare(`
      SELECT * FROM referral_tokens
      WHERE tokenHash = ? AND revokedAt IS NULL AND expiresAt > ?
    `).get(tokenHash, new Date().toISOString());
  }
  touchReferralToken(id) {
    this.db.prepare('UPDATE referral_tokens SET lastUsedAt=?, useCount=useCount+1 WHERE id=?')
      .run(new Date().toISOString(), id);
  }
  revokeReferralTokens(caseId) {
    this.db.prepare('UPDATE referral_tokens SET revokedAt=? WHERE caseId=? AND revokedAt IS NULL')
      .run(new Date().toISOString(), caseId);
  }

  createReferralEvent(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO referral_events (id, caseId, type, fromStatus, toStatus, note, visibleToReferrer, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.caseId, data.type, data.fromStatus || null, data.toStatus || null,
      data.note || null, data.visibleToReferrer === false ? 0 : 1,
      new Date().toISOString(), data.createdBy || null);
    return this.db.prepare('SELECT * FROM referral_events WHERE id = ?').get(id);
  }
  listReferralEvents(caseId, { referrerOnly = false } = {}) {
    let query = 'SELECT * FROM referral_events WHERE caseId = ?';
    if (referrerOnly) query += ' AND visibleToReferrer = 1';
    query += ' ORDER BY createdAt ASC';
    return this.db.prepare(query).all(caseId);
  }

  // ===== Attachments (pièces jointes patient : radios, photos, documents) =====
  createAttachment(data) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO attachments (id, patientId, medicalRecordId, category, originalName, storedFilename, mimeType, sizeBytes, notes, visibleToReferrer, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.patientId, data.medicalRecordId || null, data.category || 'other',
      data.originalName, data.storedFilename, data.mimeType, data.sizeBytes,
      data.notes || null, data.visibleToReferrer === false ? 0 : 1,
      new Date().toISOString(), data.createdBy || null);
    return this.getAttachment(id);
  }
  getAttachment(id) {
    return this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  }
  listAttachments(patientId, { referrerOnly = false } = {}) {
    let query = 'SELECT * FROM attachments WHERE patientId = ?';
    if (referrerOnly) query += ' AND visibleToReferrer = 1';
    query += ' ORDER BY createdAt DESC';
    return this.db.prepare(query).all(patientId);
  }
  updateAttachment(id, data) {
    this.db.prepare('UPDATE attachments SET notes=?, visibleToReferrer=? WHERE id=?')
      .run(data.notes || null, data.visibleToReferrer === false ? 0 : 1, id);
    return this.getAttachment(id);
  }
  deleteAttachment(id) {
    this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    return { success: true };
  }

  // ===== Backups =====
  async backupTo(destFile) {
    await this.db.backup(destFile);
    return { success: true };
  }

  close() {
    this.db.close();
  }
}

module.exports = Database;
