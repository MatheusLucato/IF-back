// Mappers: convertem linhas do banco (snake_case) para o formato da API
// (camelCase), com defaults. Movidos verbatim do server.js.
const {
  normalizeScheduleAssignments,
  normalizeScheduleSongs,
  normalizeScheduleSong,
  sanitizeMinistryTeams,
} = require('./normalizers');

function isGhostUser(row) {
  return row && row.role === 'admin';
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name || row.full_name,
    email: row.email,
    role: row.role,
    profilePicture: row.profile_picture,
    birthDate: row.birth_date,
    themePreference: row.theme_preference || 'light',
    createdAt: row.created_at,
  };
}

function mapLeader(row) {
  if (!row || isGhostUser(row)) return null;

  return {
    id: row.id,
    name: row.name || row.full_name,
    role: row.role,
  };
}

function mapSchedule(row) {
  return {
    id: row.id,
    date: row.date,
    serviceTime: row.service_time,
    assignments: normalizeScheduleAssignments(row.assignments),
    createdByUserId: row.created_by_user_id || null,
    musicMinistryId: row.music_ministry_id || null,
    musicMinisterId: row.music_minister_id || null,
    musicMinisterName: row.music_minister_name || null,
    songs: normalizeScheduleSongs(row.songs),
  };
}

function mapStoredSong(row) {
  if (!row) return null;

  const sourceSong = row.song && typeof row.song === 'object' ? row.song : {};
  const normalized = normalizeScheduleSong({ id: row.id, ...sourceSong });
  if (!normalized) return null;
  return normalized;
}

function mapMinistry(row) {
  return {
    id: row.id,
    name: row.name,
    leaderId: row.leader_id,
    leaderName: row.leader_name || 'Lider removido',
    managers: Array.isArray(row.managers) ? row.managers : [],
    managerUsers: Array.isArray(row.manager_users) ? row.manager_users : [],
    ministers: Array.isArray(row.ministers) ? row.ministers : [],
    ministerUsers: Array.isArray(row.minister_users) ? row.minister_users : [],
    memberUserIds: Array.isArray(row.member_user_ids) ? row.member_user_ids : [],
    memberUsers: Array.isArray(row.member_users) ? row.member_users : [],
    memberCount: Number.isFinite(row.member_count) ? row.member_count : 0,
    color: row.color || '#ffffff',
    imageUrl: row.image_url || null,
    isMusicMinistry: Boolean(row.is_music_ministry),
    functions: Array.isArray(row.functions) ? row.functions : [],
    repertoire: Array.isArray(row.repertoire) ? row.repertoire : [],
    teams: sanitizeMinistryTeams(row.teams),
    createdAt: row.created_at,
  };
}

function mapChurch(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tradeName: row.trade_name || null,
    cnpj: row.cnpj || null,
    phone: row.phone || null,
    whatsapp: row.whatsapp || null,
    email: row.email || null,
    website: row.website || null,
    address: row.address || null,
    city: row.city || null,
    state: row.state || null,
    country: row.country || null,
    slug: row.slug || null,
    status: row.status,
    plan: row.plan,
    // Domínio por tenant (F9.3). Colunas podem não existir antes da migração 0030.
    customDomain: row.custom_domain || null,
    domainVerified: row.domain_verified || false,
    domainVerificationToken: row.domain_verification_token || null,
  };
}

// --- Pessoas / Membros (Fase 1) ---

function mapMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || null,
    fullName: row.full_name,
    socialName: row.social_name || null,
    gender: row.gender || null,
    birthDate: row.birth_date || null,
    maritalStatus: row.marital_status || null,
    cpf: row.cpf || null,
    rg: row.rg || null,
    email: row.email || null,
    phone: row.phone || null,
    whatsapp: row.whatsapp || null,
    photoUrl: row.photo_url || null,
    address: {
      zip: row.address_zip || null,
      street: row.address_street || null,
      number: row.address_number || null,
      complement: row.address_complement || null,
      district: row.address_district || null,
      city: row.address_city || null,
      state: row.address_state || null,
    },
    membershipStatus: row.membership_status || 'visitor',
    joinedAt: row.joined_at || null,
    baptismDate: row.baptism_date || null,
    conversionDate: row.conversion_date || null,
    notes: row.notes || null,
    isActive: row.is_active !== false,
    anonymizedAt: row.anonymized_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapFamily(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    // members é preenchido pelo service quando há join.
    members: Array.isArray(row.members) ? row.members : undefined,
  };
}

function mapFamilyMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    role: row.role || 'other',
    isHead: Boolean(row.is_head),
    createdAt: row.created_at,
  };
}

function mapMemberEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: row.member_id,
    type: row.type,
    eventDate: row.event_date,
    title: row.title || null,
    notes: row.notes || null,
    metadata: row.metadata || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
  };
}

function mapInvitation(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: row.member_id || null,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by || null,
    expiresAt: row.expires_at || null,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

// Link de convite reutilizável (0042). Deriva um `status` legível a partir das
// flags/contadores para a UI de gestão.
function mapInviteLink(row) {
  if (!row) return null;
  const expired = Boolean(row.expires_at) && new Date(row.expires_at) <= new Date();
  const exhausted = row.max_uses != null && row.uses >= row.max_uses;
  let status = 'active';
  if (!row.is_active) status = 'revoked';
  else if (expired) status = 'expired';
  else if (exhausted) status = 'exhausted';
  return {
    id: row.id,
    token: row.token,
    label: row.label || null,
    role: row.role,
    maxUses: row.max_uses != null ? row.max_uses : null,
    uses: row.uses || 0,
    expiresAt: row.expires_at || null,
    isActive: Boolean(row.is_active),
    status,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapChurchSettings(row) {
  if (!row) return null;
  return {
    logoUrl: row.logo_url || null,
    logoCompactUrl: row.logo_compact_url || null,
    faviconUrl: row.favicon_url || null,
    coverUrl: row.cover_url || null,
    colorPrimary: row.color_primary,
    colorSecondary: row.color_secondary,
    colorAccent: row.color_accent,
    colorButton: row.color_button,
    colorLink: row.color_link,
    language: row.language,
    timezone: row.timezone,
    dateFormat: row.date_format,
    settings: row.settings || {},
  };
}

// --- Secretaria & Documentos (Fase 2) ---

function mapDocumentTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type || 'other',
    description: row.description || null,
    body: row.body || '',
    isActive: row.is_active !== false,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapIssuedDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: row.member_id || null,
    templateId: row.template_id || null,
    title: row.title,
    type: row.type || 'other',
    renderedContent: row.rendered_content || '',
    fileUrl: row.file_url || null,
    issuedBy: row.issued_by || null,
    issuedAt: row.issued_at,
    memberName: row.member_name || null,
  };
}

function mapInstitutionDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    category: row.category || 'other',
    description: row.description || null,
    fileUrl: row.file_url,
    uploadedBy: row.uploaded_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

// --- Agenda & Eventos (Fase 3) ---

function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description || null,
    location: row.location || null,
    startsAt: row.starts_at,
    endsAt: row.ends_at || null,
    coverUrl: row.cover_url || null,
    capacity: row.capacity ?? null,
    isPublished: Boolean(row.is_published),
    allowRegistration: row.allow_registration !== false,
    responsibleMemberId: row.responsible_member_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    // Preenchidos pelo service quando agregados.
    registrationCount: typeof row.registration_count === 'number' ? row.registration_count : undefined,
    checkedInCount: typeof row.checked_in_count === 'number' ? row.checked_in_count : undefined,
  };
}

function mapEventRegistration(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    memberId: row.member_id || null,
    name: row.name,
    email: row.email || null,
    phone: row.phone || null,
    status: row.status || 'confirmed',
    qrToken: row.qr_token,
    checkedInAt: row.checked_in_at || null,
    checkedInBy: row.checked_in_by || null,
    notes: row.notes || null,
    createdAt: row.created_at,
  };
}

// --- Ensino (Fase 4) ---

function mapClass(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    ageRange: row.age_range || null,
    schedule: row.schedule || null,
    room: row.room || null,
    description: row.description || null,
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    // Agregações opcionais preenchidas pelo service.
    teachers: Array.isArray(row.teachers) ? row.teachers : undefined,
    enrollmentCount: typeof row.enrollment_count === 'number' ? row.enrollment_count : undefined,
  };
}

function mapClassEnrollment(row) {
  if (!row) return null;
  return {
    id: row.id,
    classId: row.class_id,
    memberId: row.member_id,
    status: row.status || 'active',
    enrolledAt: row.enrolled_at,
    createdAt: row.created_at,
    memberName: row.member_name || null,
    photoUrl: row.photo_url || null,
  };
}

function mapClassSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    classId: row.class_id,
    sessionDate: row.session_date,
    lessonTitle: row.lesson_title || null,
    offeringCents: Number.isFinite(row.offering_cents) ? row.offering_cents : 0,
    visitorsCount: Number.isFinite(row.visitors_count) ? row.visitors_count : 0,
    notes: row.notes || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    presentCount: typeof row.present_count === 'number' ? row.present_count : undefined,
  };
}

function mapClassAttendance(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    memberId: row.member_id,
    present: Boolean(row.present),
  };
}

// --- Comunicação (Fase 7) ---

function mapAnnouncement(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body || '',
    audience: row.audience || 'all',
    audienceRef: row.audience_ref || null,
    isPinned: Boolean(row.is_pinned),
    publishAt: row.publish_at,
    expiresAt: row.expires_at || null,
    authorId: row.author_id || null,
    authorName: row.author_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapPrayerRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: row.member_id || null,
    requesterName: row.requester_name || null,
    title: row.title || null,
    body: row.body,
    visibility: row.visibility || 'pastoral',
    status: row.status || 'open',
    isAnonymous: Boolean(row.is_anonymous),
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapNotificationPrefs(row) {
  if (!row) return null;
  return {
    emailEnabled: row.email_enabled !== false,
    pushEnabled: row.push_enabled !== false,
    topics: row.topics || {},
  };
}

function mapNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || null,
    channel: row.channel,
    template: row.template,
    recipient: row.recipient || null,
    subject: row.subject || null,
    status: row.status,
    error: row.error || null,
    createdAt: row.created_at,
  };
}

// --- Financeiro (Fase 5/6) ---
// Valores em centavos (bigint) chegam como number; mapeamos sem perder precisão.

function mapFinCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    parentId: row.parent_id || null,
    name: row.name,
    kind: row.kind || 'expense',
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapFinCostCenter(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapFinAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type || 'bank',
    openingBalanceCents: Number(row.opening_balance_cents || 0),
    bankName: row.bank_name || null,
    isActive: row.is_active !== false,
    // Saldo calculado é preenchido pelo service quando agregado.
    balanceCents: typeof row.balance_cents === 'number' ? row.balance_cents : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapFinTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id || null,
    categoryId: row.category_id || null,
    costCenterId: row.cost_center_id || null,
    memberId: row.member_id || null,
    type: row.type || 'expense',
    amountCents: Number(row.amount_cents || 0),
    date: row.date,
    description: row.description || null,
    attachmentUrl: row.attachment_url || null,
    reconciled: Boolean(row.reconciled),
    source: row.source || 'manual',
    sourceId: row.source_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapFinPayable(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplier: row.supplier,
    description: row.description || null,
    categoryId: row.category_id || null,
    costCenterId: row.cost_center_id || null,
    dueDate: row.due_date,
    amountCents: Number(row.amount_cents || 0),
    status: row.status || 'open',
    paidAt: row.paid_at || null,
    paidTransactionId: row.paid_transaction_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapFinReceivable(row) {
  if (!row) return null;
  return {
    id: row.id,
    payer: row.payer,
    description: row.description || null,
    categoryId: row.category_id || null,
    costCenterId: row.cost_center_id || null,
    memberId: row.member_id || null,
    dueDate: row.due_date,
    amountCents: Number(row.amount_cents || 0),
    status: row.status || 'open',
    receivedAt: row.received_at || null,
    receivedTransactionId: row.received_transaction_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapFinReceipt(row) {
  if (!row) return null;
  return {
    id: row.id,
    transactionId: row.transaction_id || null,
    memberId: row.member_id || null,
    number: row.number,
    year: row.year,
    payerName: row.payer_name || null,
    amountCents: Number(row.amount_cents || 0),
    description: row.description || null,
    fileUrl: row.file_url || null,
    issuedAt: row.issued_at,
    issuedBy: row.issued_by || null,
    // formatado "0001/2026" para exibição.
    formattedNumber: `${String(row.number).padStart(4, '0')}/${row.year}`,
  };
}

function mapFinBankImport(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id || null,
    fileName: row.file_name || null,
    bankId: row.bank_id || null,
    periodStart: row.period_start || null,
    periodEnd: row.period_end || null,
    totalLines: Number(row.total_lines || 0),
    matchedLines: Number(row.matched_lines || 0),
    createdBy: row.created_by || null,
    createdAt: row.created_at,
  };
}

function mapFinBankLine(row) {
  if (!row) return null;
  return {
    id: row.id,
    importId: row.import_id,
    accountId: row.account_id || null,
    fitid: row.fitid || null,
    postedAt: row.posted_at,
    amountCents: Number(row.amount_cents || 0),
    type: row.type || null,
    memo: row.memo || null,
    status: row.status || 'unmatched',
    matchedTransactionId: row.matched_transaction_id || null,
    createdAt: row.created_at,
    // candidatos de match são preenchidos pelo service quando sugeridos.
    suggestions: Array.isArray(row.suggestions) ? row.suggestions : undefined,
  };
}

function mapFinClosing(row) {
  if (!row) return null;
  return {
    id: row.id,
    period: row.period,
    openingCents: Number(row.opening_cents || 0),
    incomeCents: Number(row.income_cents || 0),
    expenseCents: Number(row.expense_cents || 0),
    closingCents: Number(row.closing_cents || 0),
    status: row.status || 'closed',
    notes: row.notes || null,
    closedBy: row.closed_by || null,
    closedAt: row.closed_at,
    updatedAt: row.updated_at || null,
  };
}

function mapGivingFund(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || null,
    categoryId: row.category_id || null,
    goalCents: row.goal_cents == null ? null : Number(row.goal_cents),
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order || 0),
    // total arrecadado é preenchido pelo service quando agregado.
    raisedCents: typeof row.raised_cents === 'number' ? row.raised_cents : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapDonation(row) {
  if (!row) return null;
  return {
    id: row.id,
    fundId: row.fund_id || null,
    memberId: row.member_id || null,
    subscriptionId: row.subscription_id || null,
    donorName: row.donor_name || null,
    donorEmail: row.donor_email || null,
    amountCents: Number(row.amount_cents || 0),
    method: row.method || 'pix',
    status: row.status || 'pending',
    provider: row.provider || null,
    providerChargeId: row.provider_charge_id || null,
    pixPayload: row.pix_payload || null,
    pixQrImage: row.pix_qr_image || null,
    checkoutUrl: row.checkout_url || null,
    paidAt: row.paid_at || null,
    transactionId: row.transaction_id || null,
    receiptId: row.receipt_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapDonationSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    fundId: row.fund_id || null,
    memberId: row.member_id || null,
    donorName: row.donor_name || null,
    donorEmail: row.donor_email || null,
    amountCents: Number(row.amount_cents || 0),
    period: row.period || 'monthly',
    method: row.method || 'credit_card',
    status: row.status || 'pending',
    provider: row.provider || null,
    providerSubId: row.provider_sub_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function mapFinBoleto(row) {
  if (!row) return null;
  return {
    id: row.id,
    receivableId: row.receivable_id || null,
    memberId: row.member_id || null,
    payerName: row.payer_name,
    payerDocument: row.payer_document || null,
    description: row.description || null,
    amountCents: Number(row.amount_cents || 0),
    dueDate: row.due_date,
    status: row.status || 'pending',
    provider: row.provider || null,
    providerChargeId: row.provider_charge_id || null,
    bankSlipUrl: row.bank_slip_url || null,
    digitableLine: row.digitable_line || null,
    barcode: row.barcode || null,
    paidAt: row.paid_at || null,
    transactionId: row.transaction_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

module.exports = {
  isGhostUser,
  mapUser,
  mapLeader,
  mapSchedule,
  mapStoredSong,
  mapMinistry,
  mapChurch,
  mapChurchSettings,
  mapMember,
  mapFamily,
  mapFamilyMember,
  mapMemberEvent,
  mapInvitation,
  mapInviteLink,
  mapDocumentTemplate,
  mapIssuedDocument,
  mapInstitutionDocument,
  mapEvent,
  mapEventRegistration,
  mapClass,
  mapClassEnrollment,
  mapClassSession,
  mapClassAttendance,
  mapAnnouncement,
  mapPrayerRequest,
  mapNotificationPrefs,
  mapNotification,
  mapFinCategory,
  mapFinCostCenter,
  mapFinAccount,
  mapFinTransaction,
  mapFinPayable,
  mapFinReceivable,
  mapFinReceipt,
  mapFinBankImport,
  mapFinBankLine,
  mapFinClosing,
  mapGivingFund,
  mapDonation,
  mapDonationSubscription,
  mapFinBoleto,
};
