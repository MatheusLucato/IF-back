const { getSupabase } = require('../db');
const { mapFamily, mapFamilyMember } = require('../lib/mappers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');

const supabase = getSupabase();
const FAMILIES_MIGRATION = '0005_families.sql';
const FAMILY_SELECT = 'id,name,notes,created_at,updated_at';
const LINK_SELECT = 'id,family_id,member_id,role,is_head,created_at';

// Anexa os integrantes (com nome/foto) a uma lista de famílias.
async function attachMembers(families, churchId) {
  if (!families || families.length === 0) return [];
  const familyIds = families.map((f) => f.id);

  const { data: links } = await supabase
    .from('family_members')
    .select(LINK_SELECT)
    .eq('church_id', churchId)
    .in('family_id', familyIds);

  const memberIds = [...new Set((links || []).map((l) => l.member_id))];
  let peopleById = new Map();
  if (memberIds.length > 0) {
    const { data: people } = await supabase
      .from('members')
      .select('id,full_name,photo_url')
      .eq('church_id', churchId)
      .in('id', memberIds);
    peopleById = new Map((people || []).map((p) => [p.id, p]));
  }

  return families.map((fam) => {
    const mapped = mapFamily(fam);
    mapped.members = (links || [])
      .filter((l) => l.family_id === fam.id)
      .map((l) => ({
        ...mapFamilyMember(l),
        name: peopleById.get(l.member_id)?.full_name || 'Pessoa',
        photoUrl: peopleById.get(l.member_id)?.photo_url || null,
      }))
      .sort((a, b) => Number(b.isHead) - Number(a.isHead));
    return mapped;
  });
}

async function listFamilies(churchId) {
  const { data, error } = await supabase
    .from('families')
    .select(FAMILY_SELECT)
    .eq('church_id', churchId)
    .order('name', { ascending: true });

  if (isMissingRelation(error)) throw migrationPending(FAMILIES_MIGRATION);
  if (error) throw new Error(error.message);
  return attachMembers(data || [], churchId);
}

async function getFamily(familyId, churchId) {
  const { data, error } = await supabase
    .from('families')
    .select(FAMILY_SELECT)
    .eq('id', familyId)
    .eq('church_id', churchId)
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(FAMILIES_MIGRATION);
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [withMembers] = await attachMembers([data], churchId);
  return withMembers;
}

async function createFamily(churchId, { name, notes, members }) {
  const { data, error } = await supabase
    .from('families')
    .insert({ church_id: churchId, name: String(name).trim(), notes: notes ? String(notes).trim() : null })
    .select(FAMILY_SELECT)
    .single();

  if (isMissingRelation(error)) throw migrationPending(FAMILIES_MIGRATION);
  if (error) throw new Error(error.message);

  // Vincula integrantes informados na criação (opcional).
  if (Array.isArray(members) && members.length > 0) {
    const rows = members.map((m) => ({
      church_id: churchId,
      family_id: data.id,
      member_id: m.memberId,
      role: m.role || 'other',
      is_head: Boolean(m.isHead),
    }));
    await supabase.from('family_members').insert(rows);
  }

  return getFamily(data.id, churchId);
}

async function updateFamily(familyId, churchId, { name, notes }) {
  const payload = {};
  if (name !== undefined) payload.name = String(name).trim();
  if (notes !== undefined) payload.notes = notes ? String(notes).trim() : null;
  if (Object.keys(payload).length === 0) return getFamily(familyId, churchId);

  const { data, error } = await supabase
    .from('families')
    .update(payload)
    .eq('id', familyId)
    .eq('church_id', churchId)
    .select('id')
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(FAMILIES_MIGRATION);
  if (error) throw new Error(error.message);
  if (!data) return null;
  return getFamily(familyId, churchId);
}

async function deleteFamily(familyId, churchId) {
  // family_members tem ON DELETE CASCADE → some junto.
  const { data, error } = await supabase
    .from('families')
    .delete()
    .eq('id', familyId)
    .eq('church_id', churchId)
    .select('id')
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(FAMILIES_MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function addFamilyMember(familyId, churchId, { memberId, role, isHead }) {
  // Confirma que a família pertence ao tenant antes de vincular.
  const family = await supabase
    .from('families')
    .select('id')
    .eq('id', familyId)
    .eq('church_id', churchId)
    .maybeSingle();
  if (isMissingRelation(family.error)) throw migrationPending(FAMILIES_MIGRATION);
  if (!family.data) return null;

  const { error } = await supabase
    .from('family_members')
    .insert({
      church_id: churchId,
      family_id: familyId,
      member_id: memberId,
      role: role || 'other',
      is_head: Boolean(isHead),
    });

  // 23505 = unique_violation (pessoa já está na família): tratamos como idempotente.
  if (error && error.code !== '23505') throw new Error(error.message);
  return getFamily(familyId, churchId);
}

async function updateFamilyMember(linkId, churchId, { role, isHead }) {
  const payload = {};
  if (role !== undefined) payload.role = role;
  if (isHead !== undefined) payload.is_head = Boolean(isHead);
  if (Object.keys(payload).length === 0) return null;

  const { data, error } = await supabase
    .from('family_members')
    .update(payload)
    .eq('id', linkId)
    .eq('church_id', churchId)
    .select('family_id')
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(FAMILIES_MIGRATION);
  if (error) throw new Error(error.message);
  if (!data) return null;
  return getFamily(data.family_id, churchId);
}

async function removeFamilyMember(linkId, churchId) {
  const { data, error } = await supabase
    .from('family_members')
    .delete()
    .eq('id', linkId)
    .eq('church_id', churchId)
    .select('family_id')
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(FAMILIES_MIGRATION);
  if (error) throw new Error(error.message);
  return data ? data.family_id : null;
}

module.exports = {
  listFamilies,
  getFamily,
  createFamily,
  updateFamily,
  deleteFamily,
  addFamilyMember,
  updateFamilyMember,
  removeFamilyMember,
};
