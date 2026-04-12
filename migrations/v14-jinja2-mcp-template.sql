-- v14: Add mcp_json_template to agents table, add simple_http_request to default builtin tools
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_json_template TEXT;

-- Update default builtin_tools_enabled to include simple_http_request for existing agents
-- (Only adds if the array doesn't already contain it)
UPDATE agents
SET builtin_tools_enabled = builtin_tools_enabled || '["simple_http_request"]'::jsonb
WHERE NOT (builtin_tools_enabled @> '"simple_http_request"'::jsonb);
