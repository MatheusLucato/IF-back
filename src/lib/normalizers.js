// Funcoes puras de saneamento/validacao de entrada e helpers de dominio.
// Movidas verbatim do server.js para serem compartilhadas entre routers/services.

function normalizeBirthDate(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return normalized;
}

function getMonthAndDay(dateValue) {
  const normalized = normalizeBirthDate(dateValue);
  if (!normalized) return null;

  const [, monthStr, dayStr] = normalized.split('-');
  return {
    month: Number(monthStr),
    day: Number(dayStr),
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeFunctionNames(value) {
  if (Array.isArray(value)) {
    const normalized = normalizeStringArray(value);
    return normalized.length > 0 ? normalized : ['Membro'];
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return ['Membro'];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const normalized = normalizeStringArray(parsed);
        return normalized.length > 0 ? normalized : ['Membro'];
      }
    } catch {
      // ignore
    }
  }

  return ['Membro'];
}

function functionNamesToString(value) {
  const names = normalizeFunctionNames(value);
  return names.join(', ');
}

function mapMinistryTeam(team) {
  if (!team || typeof team !== 'object') return null;

  const id = String(team.id || '').trim();
  const name = String(team.name || '').trim();
  const memberIds = normalizeStringArray(team.memberIds);

  if (!id || !name) return null;

  return {
    id,
    name,
    memberIds,
  };
}

function sanitizeMinistryTeams(value) {
  let rawValue = value;

  if (typeof rawValue === 'string') {
    try {
      rawValue = JSON.parse(rawValue);
    } catch {
      rawValue = [];
    }
  }

  if (!Array.isArray(rawValue)) return [];
  return rawValue.map(mapMinistryTeam).filter(Boolean);
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeScheduleMembers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((member) => {
      if (!member || typeof member !== 'object') return null;
      const entry = member;
      const memberId = String(entry.memberId || '').trim();
      const memberName = String(entry.memberName || '').trim();
      if (!memberId || !memberName) return null;
      return {
        memberId,
        memberName,
        role: String(entry.role || 'Membro').trim() || 'Membro',
      };
    })
    .filter(Boolean);
}

function normalizeScheduleAssignments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((assignment) => {
      if (!assignment || typeof assignment !== 'object') return null;
      const entry = assignment;
      const ministryId = String(entry.ministryId || '').trim();
      if (!ministryId) return null;
      const ministryName = String(entry.ministryName || '').trim() || 'Ministerio';
      const members = normalizeScheduleMembers(entry.members);
      return {
        ministryId,
        ministryName,
        members,
      };
    })
    .filter(Boolean);
}

function normalizeScheduleSong(value) {
  if (typeof value === 'string') {
    const id = String(value || '').trim();
    if (!id) return null;
    return {
      id,
      title: 'nao fornecido',
      artist: 'nao fornecido',
      durationSeconds: 0,
      key: 'nao fornecido',
      bpm: 0,
      lyrics: 'nao fornecido',
      chords: 'nao fornecido',
      audioUrl: null,
      youtubeUrl: null,
      thumbnailUrl: null,
      deezerUrl: null,
      source: 'manual',
      tags: [],
      memberAssignment: null,
    };
  }

  if (!value || typeof value !== 'object') return null;

  const item = value;
  const id = String(item.id || '').trim();
  if (!id) return null;

  return {
    id,
    title: String(item.title || '').trim() || 'nao fornecido',
    artist: String(item.artist || '').trim() || 'nao fornecido',
    durationSeconds: normalizeNumber(item.durationSeconds, 0),
    key: String(item.key || '').trim() || 'nao fornecido',
    bpm: normalizeNumber(item.bpm, 0),
    lyrics: String(item.lyrics || '').trim() || 'nao fornecido',
    chords: String(item.chords || '').trim() || 'nao fornecido',
    audioUrl: item.audioUrl ? String(item.audioUrl) : null,
    youtubeUrl: item.youtubeUrl ? String(item.youtubeUrl) : null,
    thumbnailUrl: item.thumbnailUrl ? String(item.thumbnailUrl) : null,
    deezerUrl: item.deezerUrl ? String(item.deezerUrl) : null,
    source: item.source === 'deezer' ? 'deezer' : 'manual',
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
    memberAssignment: item.memberAssignment || null,
  };
}

function normalizeScheduleSongs(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];

  value.forEach((item) => {
    const normalized = normalizeScheduleSong(item);
    if (!normalized) return;
    if (seen.has(normalized.id)) return;
    seen.add(normalized.id);
    output.push(normalized);
  });

  return output;
}

function normalizeServiceTime(value) {
  const normalized = String(value || '').trim();
  if (normalized === 'morning' || normalized === 'evening' || normalized === 'both') {
    return normalized;
  }
  return '';
}

function overlapsServiceTime(a, b) {
  return a === 'both' || b === 'both' || a === b;
}

function normalizeScheduleDate(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return normalized;
}

function normalizeOptionalId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeOptionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeThemePreference(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'dark' || normalized === 'light') {
    return normalized;
  }
  return '';
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `igreja-${Date.now()}`;
}

module.exports = {
  normalizeBirthDate,
  getMonthAndDay,
  normalizeStringArray,
  normalizeFunctionNames,
  functionNamesToString,
  mapMinistryTeam,
  sanitizeMinistryTeams,
  normalizeNumber,
  normalizeScheduleMembers,
  normalizeScheduleAssignments,
  normalizeScheduleSong,
  normalizeScheduleSongs,
  normalizeServiceTime,
  overlapsServiceTime,
  normalizeScheduleDate,
  normalizeOptionalId,
  normalizeOptionalText,
  normalizeThemePreference,
  slugify,
};
