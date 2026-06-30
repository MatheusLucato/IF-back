const { randomUUID } = require('crypto');
const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const {
  ALL_PERMISSION_KEYS,
  SUPER_ROLES,
  isSuperRole,
  sanitizePermissionKeys,
  defaultPermissionsForRole,
} = require('../lib/permissions');

const supabase = getSupabase();

// Postgres: tabela/relacao inexistente. Como o SQL é aplicado MANUALMENTE (a
// migração 0002 pode ainda não ter rodado), toleramos a ausência das tabelas de
// RBAC e caímos no mapa padrão por papel legado, sem quebrar a autenticação.
const UNDEFINED_TABLE = '42P01';
const UNDEFINED_COLUMN = '42703';

function isMissingRbacSchema(error) {
  return Boolean(error) && (error.code === UNDEFINED_TABLE || error.code === UNDEFINED_COLUMN);
}

function slugify(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Carrega as chaves de permissão de um papel configurável. Retorna `null` quando
// o schema de RBAC ainda não existe (sinaliza ao chamador para usar o fallback).
async function loadRolePermissionKeys(roleId, churchId) {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_id', roleId)
    .eq('church_id', churchId);

  if (isMissingRbacSchema(error)) return null;
  if (error) throw new Error(error.message);

  return (data || []).map((row) => row.permission_key);
}

// Resolve o conjunto de permissões EFETIVAS de um usuário.
//  1. Papéis "super" (admin/pastor/plataforma_admin) → tudo (atalho seguro).
//  2. Usuário com papel configurável (role_id) → permissões do banco.
//  3. Caso contrário (ou schema RBAC ausente) → mapa padrão pelo papel legado.
async function getUserPermissions(user) {
  if (!user) return new Set();
  if (isSuperRole(user.role)) return new Set(ALL_PERMISSION_KEYS);

  if (user.role_id) {
    const keys = await loadRolePermissionKeys(user.role_id, user.church_id);
    if (keys) return new Set(keys);
  }

  return new Set(defaultPermissionsForRole(user.role));
}

async function userHasPermission(user, permissionKey) {
  const permissions = await getUserPermissions(user);
  return permissions.has(permissionKey);
}

// --- Gestão de papéis (CRUD) -------------------------------------------------

// Quando as tabelas de RBAC não existem, a gestão de papéis exige a migração.
function requireRbacSchema(error) {
  if (isMissingRbacSchema(error)) {
    throw AppError.preconditionFailed(
      'Recurso de papéis indisponível: execute a migração 0002_rbac_roles_permissions.sql no Supabase.',
    );
  }
}

function mapRole(roleRow, permissionKeys) {
  return {
    id: roleRow.id,
    name: roleRow.name,
    slug: roleRow.slug,
    description: roleRow.description || null,
    isSystem: Boolean(roleRow.is_system),
    permissions: permissionKeys,
    createdAt: roleRow.created_at,
  };
}

async function listRoles(churchId) {
  const { data: roles, error } = await supabase
    .from('roles')
    .select('id,name,slug,description,is_system,created_at')
    .eq('church_id', churchId)
    .order('is_system', { ascending: false })
    .order('name', { ascending: true });

  requireRbacSchema(error);
  if (error) throw new Error(error.message);

  const roleRows = roles || [];
  const roleIds = roleRows.map((r) => r.id);

  const permsByRole = new Map();
  if (roleIds.length > 0) {
    const { data: perms, error: permsError } = await supabase
      .from('role_permissions')
      .select('role_id,permission_key')
      .eq('church_id', churchId)
      .in('role_id', roleIds);

    requireRbacSchema(permsError);
    if (permsError) throw new Error(permsError.message);

    for (const row of perms || []) {
      if (!permsByRole.has(row.role_id)) permsByRole.set(row.role_id, []);
      permsByRole.get(row.role_id).push(row.permission_key);
    }
  }

  return roleRows.map((row) => mapRole(row, permsByRole.get(row.id) || []));
}

async function getRoleOrThrow(churchId, roleId) {
  const { data, error } = await supabase
    .from('roles')
    .select('id,name,slug,description,is_system,created_at')
    .eq('id', roleId)
    .eq('church_id', churchId)
    .maybeSingle();

  requireRbacSchema(error);
  if (error) throw new Error(error.message);
  if (!data) throw AppError.notFound('Papel não encontrado.');
  return data;
}

// Substitui o conjunto de permissões de um papel (delete + insert das chaves
// saneadas). Centraliza o saneamento contra o catálogo.
async function replaceRolePermissions(churchId, roleId, permissionKeys) {
  const sanitized = sanitizePermissionKeys(permissionKeys);

  const { error: deleteError } = await supabase
    .from('role_permissions')
    .delete()
    .eq('role_id', roleId)
    .eq('church_id', churchId);

  requireRbacSchema(deleteError);
  if (deleteError) throw new Error(deleteError.message);

  if (sanitized.length > 0) {
    const rows = sanitized.map((key) => ({ role_id: roleId, permission_key: key, church_id: churchId }));
    const { error: insertError } = await supabase.from('role_permissions').insert(rows);
    requireRbacSchema(insertError);
    if (insertError) throw new Error(insertError.message);
  }

  return sanitized;
}

async function createRole(churchId, { name, description, permissions }) {
  const cleanName = String(name).trim();
  const slug = slugify(cleanName);
  if (!slug) throw AppError.badRequest('Nome de papel inválido.');

  const roleId = randomUUID();
  const { data: created, error } = await supabase
    .from('roles')
    .insert({
      id: roleId,
      church_id: churchId,
      name: cleanName,
      slug,
      description: description ? String(description).trim() : null,
      is_system: false,
    })
    .select('id,name,slug,description,is_system,created_at')
    .single();

  requireRbacSchema(error);
  if (error) {
    if (error.code === '23505') throw AppError.conflict('Já existe um papel com esse nome.');
    throw new Error(error.message);
  }

  const savedKeys = await replaceRolePermissions(churchId, created.id, permissions || []);
  return mapRole(created, savedKeys);
}

async function updateRole(churchId, roleId, { name, description, permissions }) {
  const role = await getRoleOrThrow(churchId, roleId);

  // Papéis "super" são sempre "tudo" por definição — não fazem sentido editar.
  if (role.is_system && SUPER_ROLES.includes(role.slug)) {
    throw AppError.forbidden('Este papel do sistema tem acesso total e não pode ser editado.');
  }

  const patch = {};
  // Papéis do sistema (lider/membro) podem ter permissões ajustadas, mas não
  // renomeados — o slug é usado como chave estável e no fallback por papel legado.
  if (!role.is_system) {
    if (typeof name === 'string' && name.trim()) patch.name = name.trim();
    if (description !== undefined) patch.description = description ? String(description).trim() : null;
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { error } = await supabase.from('roles').update(patch).eq('id', roleId).eq('church_id', churchId);
    requireRbacSchema(error);
    if (error) {
      if (error.code === '23505') throw AppError.conflict('Já existe um papel com esse nome.');
      throw new Error(error.message);
    }
  }

  let savedKeys = null;
  if (Array.isArray(permissions)) {
    savedKeys = await replaceRolePermissions(churchId, roleId, permissions);
  }

  const fresh = await getRoleOrThrow(churchId, roleId);
  if (savedKeys === null) {
    savedKeys = await loadRolePermissionKeys(roleId, churchId);
  }
  return mapRole(fresh, savedKeys || []);
}

async function deleteRole(churchId, roleId) {
  const role = await getRoleOrThrow(churchId, roleId);
  if (role.is_system) {
    throw AppError.forbidden('Papéis do sistema não podem ser excluídos.');
  }

  // role_permissions cai por ON DELETE CASCADE; users.role_id por ON DELETE SET NULL.
  const { error } = await supabase.from('roles').delete().eq('id', roleId).eq('church_id', churchId);
  requireRbacSchema(error);
  if (error) throw new Error(error.message);
  return true;
}

// Atribui (ou remove, com roleId null) um papel configurável a um usuário.
async function assignRoleToUser(churchId, userId, roleId) {
  if (roleId) {
    await getRoleOrThrow(churchId, roleId); // valida pertencimento ao tenant
  }

  const { data, error } = await supabase
    .from('users')
    .update({ role_id: roleId || null })
    .eq('id', userId)
    .eq('church_id', churchId)
    .select('id')
    .maybeSingle();

  requireRbacSchema(error);
  if (error) throw new Error(error.message);
  if (!data) throw AppError.notFound('Usuário não encontrado.');
  return true;
}

module.exports = {
  getUserPermissions,
  userHasPermission,
  loadRolePermissionKeys,
  isMissingRbacSchema,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  assignRoleToUser,
};
