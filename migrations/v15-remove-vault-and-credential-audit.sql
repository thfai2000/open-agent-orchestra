-- v15: Remove vault feature tables and credential audit tables
-- These were added while on feature/vault branch, then abandoned.
-- Also removes credential_access_logs and workspace_security_settings 
-- which were part of the old credential audit system (now replaced by Jinja2 templates).

-- Drop vault-related tables (from feature/vault branch)
DROP TABLE IF EXISTS endpoint_access_logs CASCADE;
DROP TABLE IF EXISTS endpoint_access CASCADE;
DROP TABLE IF EXISTS endpoints CASCADE;
DROP TABLE IF EXISTS vault_configs CASCADE;

-- Drop credential audit tables (from main branch, now removed)
DROP TABLE IF EXISTS credential_access_logs CASCADE;
DROP TABLE IF EXISTS workspace_security_settings CASCADE;

-- Drop vault-related enums (from feature/vault branch)
DROP TYPE IF EXISTS endpoint_type CASCADE;
DROP TYPE IF EXISTS endpoint_auth_method CASCADE;
DROP TYPE IF EXISTS vault_backend CASCADE;

-- Remove 'get_credentials_into_env' from agents.builtin_tools_enabled defaults
-- and add 'simple_http_request' if missing (already done in v14, but ensure consistency)
UPDATE agents
SET builtin_tools_enabled = (
  SELECT jsonb_agg(elem)
  FROM jsonb_array_elements(builtin_tools_enabled) AS elem
  WHERE elem::text NOT IN (
    '"get_credentials_into_env"',
    '"request_vault_token"',
    '"list_endpoints"',
    '"call_endpoint"',
    '"get_endpoint_status"'
  )
)
WHERE builtin_tools_enabled @> '"get_credentials_into_env"'::jsonb
   OR builtin_tools_enabled @> '"request_vault_token"'::jsonb
   OR builtin_tools_enabled @> '"list_endpoints"'::jsonb
   OR builtin_tools_enabled @> '"call_endpoint"'::jsonb
   OR builtin_tools_enabled @> '"get_endpoint_status"'::jsonb;

-- Ensure simple_http_request is in the list for all agents
UPDATE agents
SET builtin_tools_enabled = builtin_tools_enabled || '["simple_http_request"]'::jsonb
WHERE NOT (builtin_tools_enabled @> '"simple_http_request"'::jsonb);
