CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  classification TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  strong_auth_required BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, tenant_id, case_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL,
  request_id TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deletion_registry (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  proof JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tenants (id, name)
VALUES ('tenant-demo', 'Organisation demo fictive')
ON CONFLICT DO NOTHING;

INSERT INTO cases (id, tenant_id, name, classification)
VALUES ('case-demo-001', 'tenant-demo', 'Dossier demo fictif', 'restricted')
ON CONFLICT DO NOTHING;

INSERT INTO users (id, tenant_id, display_name, role)
VALUES
  ('demo-analyste', 'tenant-demo', 'Analyste Demo', 'analyste'),
  ('demo-enqueteur', 'tenant-demo', 'Enqueteur Demo', 'enqueteur'),
  ('demo-superviseur', 'tenant-demo', 'Superviseur Demo', 'superviseur')
ON CONFLICT DO NOTHING;

INSERT INTO case_memberships (user_id, tenant_id, case_id, role)
VALUES
  ('demo-analyste', 'tenant-demo', 'case-demo-001', 'analyste'),
  ('demo-enqueteur', 'tenant-demo', 'case-demo-001', 'enqueteur'),
  ('demo-superviseur', 'tenant-demo', 'case-demo-001', 'superviseur')
ON CONFLICT DO NOTHING;

