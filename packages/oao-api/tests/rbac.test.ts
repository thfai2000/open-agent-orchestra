/**
 * Unit tests for RBAC v2 — pure helpers and catalog integrity.
 * The DB-backed resolver is exercised in E2E tests against a live deployment.
 */
import { describe, it, expect } from 'vitest';
import {
  FUNCTIONALITY_CATALOG,
  SYSTEM_ROLES,
  SYSTEM_ROLE_NAMES,
  getSystemRoleDefaultFunctionalities,
  mapLegacyRoleToSystemRoleName,
} from '../src/services/rbac-functionalities.js';
import { setHasFunctionality } from '../src/services/rbac.js';

describe('FUNCTIONALITY_CATALOG', () => {
  it('every entry has a unique key', () => {
    const keys = FUNCTIONALITY_CATALOG.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry follows resource:action key shape (or super flag)', () => {
    for (const f of FUNCTIONALITY_CATALOG) {
      if (f.key === '*') continue;
      const parts = f.key.split(':');
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(f.resource).toBeTruthy();
      expect(f.action).toBeTruthy();
      expect(f.label).toBeTruthy();
      expect(f.category).toBeTruthy();
    }
  });
});

describe('SYSTEM_ROLES', () => {
  it('contains exactly the 4 expected roles', () => {
    const names = SYSTEM_ROLES.map((r) => r.name).sort();
    expect(names).toEqual(['creator', 'super_admin', 'viewer', 'workspace_admin']);
    expect(SYSTEM_ROLE_NAMES).toEqual(expect.arrayContaining(names));
  });

  it('super_admin owns the super flag', () => {
    const sa = SYSTEM_ROLES.find((r) => r.name === 'super_admin')!;
    expect(sa.functionalities).toContain('*');
  });

  it('viewer has no destructive actions (conversations:create is allowed by design)', () => {
    const viewer = SYSTEM_ROLES.find((r) => r.name === 'viewer')!;
    for (const fk of viewer.functionalities) {
      if (fk === 'conversations:create') continue;
      expect(fk).not.toMatch(/:(delete|update|create)/);
    }
  });

  it('creator can create agents/workflows/conversations but not manage admin', () => {
    const creator = SYSTEM_ROLES.find((r) => r.name === 'creator')!;
    expect(creator.functionalities).toContain('agents:create');
    expect(creator.functionalities).toContain('workflows:create');
    expect(creator.functionalities).toContain('conversations:create');
    expect(creator.functionalities.find((f) => f.startsWith('admin:'))).toBeUndefined();
  });

  it('every role functionality references an existing catalog key', () => {
    const validKeys = new Set(FUNCTIONALITY_CATALOG.map((f) => f.key));
    for (const r of SYSTEM_ROLES) {
      for (const fk of r.functionalities) {
        expect(validKeys.has(fk), `unknown key ${fk} on ${r.name}`).toBe(true);
      }
    }
  });

  it('maps legacy user roles onto the matching system roles', () => {
    expect(mapLegacyRoleToSystemRoleName('super_admin')).toBe('super_admin');
    expect(mapLegacyRoleToSystemRoleName('workspace_admin')).toBe('workspace_admin');
    expect(mapLegacyRoleToSystemRoleName('creator_user')).toBe('creator');
    expect(mapLegacyRoleToSystemRoleName('view_user')).toBe('viewer');
    expect(mapLegacyRoleToSystemRoleName('unknown_role')).toBeNull();
  });

  it('exposes default functionality fallbacks for legacy admin roles', () => {
    expect(getSystemRoleDefaultFunctionalities('super_admin')).toContain('*');
    expect(getSystemRoleDefaultFunctionalities('workspace_admin')).toContain('admin:rbac:read');
    expect(getSystemRoleDefaultFunctionalities('workspace_admin')).toContain('admin:rbac:manage');
    expect(getSystemRoleDefaultFunctionalities('unknown_role')).toEqual([]);
  });
});

describe('setHasFunctionality', () => {
  it('returns true when the super flag is present (any key matches)', () => {
    const set = new Set(['*']);
    expect(setHasFunctionality(set, 'agents:read')).toBe(true);
    expect(setHasFunctionality(set, 'admin:rbac:manage')).toBe(true);
  });

  it('returns true for an exact match', () => {
    const set = new Set(['agents:read', 'workflows:read']);
    expect(setHasFunctionality(set, 'agents:read')).toBe(true);
  });

  it('returns false when the key is absent', () => {
    const set = new Set(['agents:read']);
    expect(setHasFunctionality(set, 'agents:delete')).toBe(false);
  });

  it('returns false on an empty set', () => {
    expect(setHasFunctionality(new Set(), 'agents:read')).toBe(false);
  });
});
