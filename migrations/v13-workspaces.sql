-- v13.0 Migration: Workspace multi-tenancy
-- Applies to: agent_db
BEGIN;

-- 1. Update user_role enum: add new values, remove old ones
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'workspace_admin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'creator_user';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'view_user';

COMMIT;
BEGIN;

-- 2. Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  slug varchar(50) NOT NULL UNIQUE,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Insert Default Workspace
INSERT INTO workspaces (name, slug, description, is_default)
VALUES ('Default Workspace', 'default', 'Default workspace for all users', true)
ON CONFLICT (slug) DO NOTHING;

-- 4. Add workspace_id to users (nullable — super_admin may not have one initially)
ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);

-- Assign all existing users to the Default Workspace
UPDATE users SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'default') WHERE workspace_id IS NULL;

-- Migrate existing roles: 'admin' → 'super_admin', 'user' → 'creator_user'
UPDATE users SET role = 'super_admin' WHERE role = 'admin';
UPDATE users SET role = 'creator_user' WHERE role = 'user';

-- 5. Add workspace_id to agents (NOT NULL with cascade)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE agents SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'default') WHERE workspace_id IS NULL;
ALTER TABLE agents ALTER COLUMN workspace_id SET NOT NULL;

-- 6. Add workspace_id to workflows (NOT NULL with cascade)
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE workflows SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'default') WHERE workspace_id IS NULL;
ALTER TABLE workflows ALTER COLUMN workspace_id SET NOT NULL;

-- 7. Add workspace_id to plugins (NOT NULL with cascade)
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE plugins SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'default') WHERE workspace_id IS NULL;
ALTER TABLE plugins ALTER COLUMN workspace_id SET NOT NULL;

-- 8. Add workspace_id to models (NOT NULL with cascade)
ALTER TABLE models ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE models SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'default') WHERE workspace_id IS NULL;
ALTER TABLE models ALTER COLUMN workspace_id SET NOT NULL;

-- 9. Add workspace_id to credit_usage (NOT NULL with cascade)
ALTER TABLE credit_usage ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE credit_usage SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'default') WHERE workspace_id IS NULL;
ALTER TABLE credit_usage ALTER COLUMN workspace_id SET NOT NULL;

-- 10. Rename global_quota_settings → workspace_quota_settings
ALTER TABLE global_quota_settings RENAME TO workspace_quota_settings;

-- Add workspace_id column to workspace_quota_settings
ALTER TABLE workspace_quota_settings ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE workspace_quota_settings SET workspace_id = (SELECT id FROM workspaces WHERE slug = 'default') WHERE workspace_id IS NULL;
ALTER TABLE workspace_quota_settings ALTER COLUMN workspace_id SET NOT NULL;
-- Add unique constraint on workspace_id
ALTER TABLE workspace_quota_settings ADD CONSTRAINT workspace_quota_settings_workspace_id_unique UNIQUE (workspace_id);

-- 11. Create workspace_variables table
CREATE TABLE IF NOT EXISTS workspace_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key varchar(100) NOT NULL,
  value_encrypted text NOT NULL,
  variable_type variable_type NOT NULL DEFAULT 'credential',
  inject_as_env_variable boolean NOT NULL DEFAULT false,
  description varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_variables_ws_key_idx ON workspace_variables(workspace_id, key);

-- 12. Set default role to 'creator_user'
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'creator_user';

COMMIT;
