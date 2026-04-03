-- Chronicle Calendar v3 initial migration
-- This migration defines the desktop SQLite schema for the database layer.
-- It mirrors the frontend v3 state shape so UI, database tools, and secretary
-- can all read and write the same canonical model.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tags (
  name TEXT PRIMARY KEY,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'manual_ui',
  raw_input_id TEXT,
  timezone TEXT,
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  priority TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]',
  tag_color TEXT NOT NULL DEFAULT '#115e59',
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_records_type_status ON records(record_type, status);
CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);

CREATE TABLE IF NOT EXISTS raw_inputs (
  id TEXT PRIMARY KEY,
  record_id TEXT,
  input_text TEXT NOT NULL,
  input_format TEXT NOT NULL DEFAULT 'manual_text',
  input_language TEXT NOT NULL DEFAULT 'zh-CN',
  captured_at TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'parsed',
  parse_error TEXT,
  user_confirmed INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_raw_inputs_record_id ON raw_inputs(record_id);
CREATE INDEX IF NOT EXISTS idx_raw_inputs_captured_at ON raw_inputs(captured_at);

CREATE TABLE IF NOT EXISTS search_docs (
  id TEXT PRIMARY KEY,
  record_id TEXT,
  raw_input_id TEXT,
  search_type_hint TEXT NOT NULL,
  search_text TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_docs_record_id ON search_docs(record_id);
CREATE INDEX IF NOT EXISTS idx_search_docs_raw_input_id ON search_docs(raw_input_id);
CREATE INDEX IF NOT EXISTS idx_search_docs_type_updated_at ON search_docs(search_type_hint, updated_at);

CREATE VIRTUAL TABLE IF NOT EXISTS search_docs_fts USING fts5(
  search_text,
  content='search_docs',
  content_rowid='id'
);

CREATE TABLE IF NOT EXISTS trace_logs (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  trace_type TEXT NOT NULL,
  snapshot_type TEXT,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  payload_json TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trace_logs_record_type ON trace_logs(record_id, trace_type);
CREATE INDEX IF NOT EXISTS idx_trace_logs_created_at ON trace_logs(created_at);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  raw_text TEXT NOT NULL,
  proposed_title TEXT NOT NULL DEFAULT '',
  proposed_date TEXT,
  proposed_start_time TEXT,
  proposed_end_time TEXT,
  proposed_location TEXT NOT NULL DEFAULT '',
  proposed_notes TEXT NOT NULL DEFAULT '',
  all_day INTEGER NOT NULL DEFAULT 0,
  priority TEXT,
  confidence REAL NOT NULL DEFAULT 0.6,
  ambiguities_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_hash TEXT,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  ocr_text TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_record_id ON attachments(record_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  agent TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  parse_mode TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_model TEXT NOT NULL
);
