-- v16: Add labels column to workflows table
-- Allows tagging workflows with multiple filterable labels

ALTER TABLE workflows ADD COLUMN IF NOT EXISTS labels varchar(50)[] NOT NULL DEFAULT '{}';

-- Index for efficient label filtering (GIN supports array containment queries)
CREATE INDEX IF NOT EXISTS workflows_labels_idx ON workflows USING gin (labels);
