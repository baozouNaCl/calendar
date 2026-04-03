/*
  Chronicle Calendar database store module

  这个模块负责承接 v3 中真正属于 database 层的基础能力：
  1. database 空状态的创建
  2. SQLite 初始化、读库与写库
  3. 导入数据的统一归一化
  4. 面向上层 UI / secretary 的基础读写 helper

  设计目标：
  - app.js 不再自己维护一整份 database 持久化实现
  - database 的真实读写逻辑集中在单一模块里
  - app.js 只保留薄适配层，避免 UI 层和数据库层继续耦合变重
*/

(function attachChronicleDatabaseStore(globalScope) {
function createDatabaseStore({
  defaultSettings,
  sqliteDbUrl,
  cloneValue,
  normalizeHexColor,
  createId,
  normalizeTagRegistry,
  setStatus,
}) {
  const runtime = {
    mode: "memory",
    sqlDb: null,
    ready: false,
    persistChain: Promise.resolve(),
    mountStatus: null,
  };

  function createEmptyState() {
    return {
      version: 3,
      tags: [],
      records: [],
      rawInputs: [],
      searchDocs: [],
      drafts: [],
      traceLogs: [],
      attachments: [],
      chatMessages: [],
      settings: { ...defaultSettings },
    };
  }

  async function initializeStorage() {
    if (!isTauriDesktopRuntime()) {
      runtime.ready = true;
      setStatus("当前运行在浏览器模式：不会写 localStorage，数据只保留在内存里；桌面版会使用 SQLite 持久化。");
      return createEmptyState();
    }

    try {
      runtime.mountStatus = await invokeDesktopCommand("prepare_database_mount");
      const { default: Database } = await import("@tauri-apps/plugin-sql");
      runtime.sqlDb = await Database.load(sqliteDbUrl);
      await ensureSqliteSchema(runtime.sqlDb);
      const dbState = await loadStateFromSql(runtime.sqlDb);
      runtime.mode = "sqlite";
      runtime.ready = true;
      return dbState;
    } catch (error) {
      runtime.ready = true;
      runtime.mode = "memory";
      setStatus(`SQLite 初始化失败，当前只在内存中运行。原因：${error.message}`);
      return createEmptyState();
    }
  }

  function persistState(dbState) {
    if (runtime.mode !== "sqlite" || !runtime.sqlDb) return;
    const snapshot = cloneValue(dbState);
    runtime.persistChain = runtime.persistChain
      .then(() => persistStateToSql(snapshot))
      .catch((error) => {
        console.error("Persist to SQLite failed:", error);
        setStatus(`SQLite 保存失败：${error.message}`);
      });
  }

  function normalizeImportedState(data) {
    const normalizedTags = normalizeTagRegistry(data);
    const rawInputs = Array.isArray(data.rawInputs)
      ? data.rawInputs.map((item) => ({ ...item, recordId: item.recordId || item.eventId || item.todoId }))
      : [];

    if (Array.isArray(data.records)) {
      return {
        version: 3,
        tags: normalizedTags,
        records: data.records.map((item) => ({
          ...item,
          tags: item.tags || [],
          tagColor: normalizeHexColor(item.tagColor || "#115e59"),
        })),
        rawInputs,
        searchDocs: Array.isArray(data.searchDocs) ? data.searchDocs : [],
        drafts: Array.isArray(data.drafts) ? data.drafts : [],
        traceLogs: Array.isArray(data.traceLogs) ? data.traceLogs : [],
        attachments: Array.isArray(data.attachments) ? data.attachments : [],
        chatMessages: Array.isArray(data.chatMessages) ? data.chatMessages : [],
        settings: { ...defaultSettings, ...(data.settings || {}) },
      };
    }

    const legacyEvents = Array.isArray(data.events) ? data.events : [];
    const legacyTodos = Array.isArray(data.todos) ? data.todos : [];
    const records = [
      ...legacyEvents.map((item) => ({
        ...item,
        recordType: "calendar",
        tags: item.tags || [],
        tagColor: normalizeHexColor(item.tagColor || "#115e59"),
      })),
      ...legacyTodos.map((item) => ({
        ...item,
        recordType: "task",
        completed: Boolean(item.completed),
        tags: item.tags || [],
        tagColor: normalizeHexColor(item.tagColor || "#115e59"),
      })),
    ];
    const searchDocs = records.map((record) => ({
      id: createId("search"),
      recordId: record.id,
      rawInputId: record.rawInputId || null,
      searchTypeHint: record.recordType,
      searchText: buildLegacySearchText(record),
      importance: record.recordType === "task" ? 0.72 : 0.8,
      updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
    }));
    const traceLogs = [
      ...(Array.isArray(data.snapshots) ? data.snapshots.map((item) => ({
        id: item.id || createId("trace"),
        recordId: item.recordId || item.eventId || item.todoId,
        traceType: "snapshot",
        snapshotType: item.snapshotType || "legacy_snapshot",
        payload: item.payload,
        createdAt: item.savedAt || new Date().toISOString(),
        createdBy: item.savedBy || "legacy_import",
      })) : []),
      ...(Array.isArray(data.changeLog) ? data.changeLog.map((item) => ({
        id: item.id || createId("trace"),
        recordId: item.recordId || item.eventId || item.todoId,
        traceType: "field_change",
        field: item.field,
        oldValue: item.oldValue,
        newValue: item.newValue,
        createdBy: item.changedBy || "legacy_import",
        createdAt: item.changedAt || new Date().toISOString(),
      })) : []),
    ];

    return {
      version: 3,
      tags: normalizedTags,
      records,
      rawInputs,
      searchDocs,
      drafts: Array.isArray(data.drafts) ? data.drafts : [],
      traceLogs,
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
      chatMessages: Array.isArray(data.chatMessages) ? data.chatMessages : [],
      settings: { ...defaultSettings, ...(data.settings || {}) },
    };
  }

  function getRecordById(dbState, recordId) {
    if (!recordId) return null;
    return dbState.records.find((item) => String(item.id) === String(recordId)) || null;
  }

  function getRawInputById(dbState, rawInputId) {
    if (!rawInputId) return null;
    return dbState.rawInputs.find((item) => String(item.id) === String(rawInputId)) || null;
  }

  function getRawInputsForRecord(dbState, recordId) {
    return dbState.rawInputs.filter((item) => String(item.recordId) === String(recordId));
  }

  function getLatestRawInputForRecord(dbState, recordId) {
    return getRawInputsForRecord(dbState, recordId)[0] || null;
  }

  function getTraceLogsForRecord(dbState, recordId) {
    return dbState.traceLogs.filter((item) => String(item.recordId) === String(recordId));
  }

  function getSearchDocForRecord(dbState, recordId) {
    return dbState.searchDocs.find((item) => String(item.recordId) === String(recordId)) || null;
  }

  function upsertSearchDoc(dbState, searchDoc) {
    const existingIndex = dbState.searchDocs.findIndex((item) => String(item.id) === String(searchDoc.id));
    if (existingIndex >= 0) {
      dbState.searchDocs[existingIndex] = searchDoc;
      return;
    }
    dbState.searchDocs.unshift(searchDoc);
  }

  function removeSearchDocsForRecord(dbState, recordId) {
    dbState.searchDocs = dbState.searchDocs.filter((item) => String(item.recordId) !== String(recordId));
  }

  return {
    createEmptyState,
    initializeStorage,
    persistState,
    getMountStatus,
    configureDatabaseMount,
    clearDatabaseMount,
    normalizeImportedState,
    getRecordById,
    getRawInputById,
    getRawInputsForRecord,
    getLatestRawInputForRecord,
    getTraceLogsForRecord,
    getSearchDocForRecord,
    upsertSearchDoc,
    removeSearchDocsForRecord,
  };

  function buildLegacySearchText(record) {
    return [
      record.date || "",
      record.startTime || "",
      record.endTime || "",
      record.title || "",
      record.location || "",
      record.notes || "",
      ...(record.tags || []),
      record.priority || "",
      record.searchDoc?.compactText || "",
    ].filter(Boolean).join(" ");
  }

  function isTauriDesktopRuntime() {
    return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
  }

  async function getMountStatus() {
    if (!isTauriDesktopRuntime()) {
      return {
        configured: false,
        packageRoot: "",
        appDbPath: "",
        activeDbUrl: sqliteDbUrl,
        note: "当前运行在浏览器模式，没有桌面端外部挂载能力。",
      };
    }
    const raw = await invokeDesktopCommand("get_database_mount_status");
    runtime.mountStatus = normalizeMountStatus(raw);
    return runtime.mountStatus;
  }

  async function configureDatabaseMount(packageRoot) {
    if (!isTauriDesktopRuntime()) {
      throw new Error("当前不是桌面端环境，无法配置外部数据库挂载。");
    }
    const raw = await invokeDesktopCommand("configure_database_mount", { packageRoot });
    runtime.mountStatus = normalizeMountStatus(raw);
    return runtime.mountStatus;
  }

  async function clearDatabaseMount() {
    if (!isTauriDesktopRuntime()) {
      throw new Error("当前不是桌面端环境，无法取消外部数据库挂载。");
    }
    const raw = await invokeDesktopCommand("clear_database_mount");
    runtime.mountStatus = normalizeMountStatus(raw);
    return runtime.mountStatus;
  }

  async function invokeDesktopCommand(command, args = {}) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(command, args);
  }

  function normalizeMountStatus(value) {
    return {
      configured: Boolean(value?.configured),
      packageRoot: String(value?.packageRoot ?? value?.package_root ?? ""),
      appDbPath: String(value?.appDbPath ?? value?.app_db_path ?? ""),
      activeDbUrl: String(value?.activeDbUrl ?? value?.active_db_url ?? sqliteDbUrl),
      note: String(value?.note || ""),
    };
  }

  async function ensureSqliteSchema(db) {
    const statements = [
      `CREATE TABLE IF NOT EXISTS tags (
        name TEXT PRIMARY KEY,
        color TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS records (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_records_type_status ON records(record_type, status)`,
      `CREATE INDEX IF NOT EXISTS idx_records_date ON records(date)`,
      `CREATE TABLE IF NOT EXISTS raw_inputs (
        id TEXT PRIMARY KEY,
        record_id TEXT,
        input_text TEXT NOT NULL,
        input_format TEXT NOT NULL DEFAULT 'manual_text',
        input_language TEXT NOT NULL DEFAULT 'zh-CN',
        captured_at TEXT NOT NULL,
        parse_status TEXT NOT NULL DEFAULT 'parsed',
        parse_error TEXT,
        user_confirmed INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE INDEX IF NOT EXISTS idx_raw_inputs_record_id ON raw_inputs(record_id)`,
      `CREATE TABLE IF NOT EXISTS search_docs (
        id TEXT PRIMARY KEY,
        record_id TEXT,
        raw_input_id TEXT,
        search_type_hint TEXT NOT NULL,
        search_text TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_search_docs_record_id ON search_docs(record_id)`,
      `CREATE TABLE IF NOT EXISTS drafts (
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
      )`,
      `CREATE TABLE IF NOT EXISTS trace_logs (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_trace_logs_record_type ON trace_logs(record_id, trace_type)`,
      `CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_hash TEXT,
        title TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        ocr_text TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        agent TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        parse_mode TEXT NOT NULL,
        api_base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        api_model TEXT NOT NULL
      )`,
    ];

    for (const statement of statements) {
      await db.execute(statement);
    }
  }

  async function loadStateFromSql(db) {
    const [tags, records, rawInputs, searchDocs, drafts, traceLogs, attachments, chatMessages, settingsRows] = await Promise.all([
      db.select("SELECT name, color FROM tags ORDER BY name ASC"),
      db.select("SELECT * FROM records ORDER BY updated_at DESC"),
      db.select("SELECT * FROM raw_inputs ORDER BY captured_at DESC"),
      db.select("SELECT * FROM search_docs ORDER BY updated_at DESC"),
      db.select("SELECT * FROM drafts ORDER BY created_at DESC"),
      db.select("SELECT * FROM trace_logs ORDER BY created_at DESC"),
      db.select("SELECT * FROM attachments ORDER BY created_at DESC"),
      db.select("SELECT * FROM chat_messages ORDER BY created_at ASC"),
      db.select("SELECT * FROM settings LIMIT 1"),
    ]);

    return normalizeImportedState({
      version: 3,
      tags: tags.map((item) => ({ name: item.name, color: item.color })),
      records: records.map(deserializeSqlRecord),
      rawInputs: rawInputs.map(deserializeSqlRawInput),
      searchDocs: searchDocs.map(deserializeSqlSearchDoc),
      drafts: drafts.map(deserializeSqlDraft),
      traceLogs: traceLogs.map(deserializeSqlTraceLog),
      attachments: attachments.map(deserializeSqlAttachment),
      chatMessages: chatMessages.map(deserializeSqlChatMessage),
      settings: settingsRows[0] ? deserializeSqlSettings(settingsRows[0]) : { ...defaultSettings },
    });
  }

  async function persistStateToSql(snapshot) {
    const db = runtime.sqlDb;
    if (!db) return;

    await db.execute("DELETE FROM tags");
    await db.execute("DELETE FROM records");
    await db.execute("DELETE FROM raw_inputs");
    await db.execute("DELETE FROM search_docs");
    await db.execute("DELETE FROM drafts");
    await db.execute("DELETE FROM trace_logs");
    await db.execute("DELETE FROM attachments");
    await db.execute("DELETE FROM chat_messages");
    await db.execute("DELETE FROM settings");

    for (const tag of snapshot.tags) {
      await db.execute("INSERT INTO tags (name, color) VALUES (?, ?)", [tag.name, normalizeHexColor(tag.color)]);
    }

    for (const record of snapshot.records) {
      await db.execute(
        `INSERT INTO records (
          id, record_type, status, title, created_at, updated_at, version, source_type, raw_input_id,
          timezone, date, start_time, end_time, all_day, location, notes, priority, completed, tags_json, tag_color, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        serializeSqlRecord(record),
      );
    }

    for (const rawInput of snapshot.rawInputs) {
      await db.execute(
        `INSERT INTO raw_inputs (
          id, record_id, input_text, input_format, input_language, captured_at, parse_status, parse_error, user_confirmed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        serializeSqlRawInput(rawInput),
      );
    }

    for (const searchDoc of snapshot.searchDocs) {
      await db.execute(
        `INSERT INTO search_docs (id, record_id, raw_input_id, search_type_hint, search_text, importance, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        serializeSqlSearchDoc(searchDoc),
      );
    }

    for (const draft of snapshot.drafts) {
      await db.execute(
        `INSERT INTO drafts (
          id, record_type, status, raw_text, proposed_title, proposed_date, proposed_start_time, proposed_end_time,
          proposed_location, proposed_notes, all_day, priority, confidence, ambiguities_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        serializeSqlDraft(draft),
      );
    }

    for (const trace of snapshot.traceLogs) {
      await db.execute(
        `INSERT INTO trace_logs (
          id, record_id, trace_type, snapshot_type, field, old_value, new_value, payload_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        serializeSqlTraceLog(trace),
      );
    }

    for (const attachment of snapshot.attachments) {
      await db.execute(
        `INSERT INTO attachments (
          id, record_id, file_path, file_type, file_hash, title, note, ocr_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        serializeSqlAttachment(attachment),
      );
    }

    for (const message of snapshot.chatMessages) {
      await db.execute(
        `INSERT INTO chat_messages (id, role, agent, content, created_at) VALUES (?, ?, ?, ?, ?)`,
        serializeSqlChatMessage(message),
      );
    }

    await db.execute(
      `INSERT INTO settings (id, parse_mode, api_base_url, api_key, api_model) VALUES (1, ?, ?, ?, ?)`,
      serializeSqlSettings(snapshot.settings),
    );
  }

  function serializeSqlRecord(record) {
    return [
      record.id,
      record.recordType,
      record.status || "active",
      record.title || "",
      record.createdAt || new Date().toISOString(),
      record.updatedAt || new Date().toISOString(),
      record.version || 1,
      record.sourceType || "manual_ui",
      record.rawInputId || null,
      record.timezone || null,
      record.date || null,
      record.startTime || null,
      record.endTime || null,
      record.allDay ? 1 : 0,
      record.location || "",
      record.notes || "",
      record.priority || null,
      record.completed ? 1 : 0,
      JSON.stringify(record.tags || []),
      normalizeHexColor(record.tagColor || "#115e59"),
      record.metadata ? JSON.stringify(record.metadata) : null,
    ];
  }

  function deserializeSqlRecord(row) {
    return {
      id: row.id,
      recordType: row.record_type,
      status: row.status,
      title: row.title || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: Number(row.version || 1),
      sourceType: row.source_type || "manual_ui",
      rawInputId: row.raw_input_id || null,
      timezone: row.timezone || null,
      date: row.date || "",
      startTime: row.start_time || "",
      endTime: row.end_time || "",
      allDay: Boolean(row.all_day),
      location: row.location || "",
      notes: row.notes || "",
      priority: row.priority || null,
      completed: Boolean(row.completed),
      tags: safeJsonParse(row.tags_json, []),
      tagColor: normalizeHexColor(row.tag_color || "#115e59"),
      metadata: safeJsonParse(row.metadata_json, null),
    };
  }

  function serializeSqlRawInput(rawInput) {
    return [
      rawInput.id,
      rawInput.recordId || null,
      rawInput.inputText || "",
      rawInput.inputFormat || "manual_text",
      rawInput.inputLanguage || "zh-CN",
      rawInput.capturedAt || new Date().toISOString(),
      rawInput.parseStatus || "parsed",
      rawInput.parseError || null,
      rawInput.userConfirmed ? 1 : 0,
    ];
  }

  function deserializeSqlRawInput(row) {
    return {
      id: row.id,
      recordId: row.record_id || null,
      inputText: row.input_text || "",
      inputFormat: row.input_format || "manual_text",
      inputLanguage: row.input_language || "zh-CN",
      capturedAt: row.captured_at,
      parseStatus: row.parse_status || "parsed",
      parseError: row.parse_error || null,
      userConfirmed: Boolean(row.user_confirmed),
    };
  }

  function serializeSqlSearchDoc(searchDoc) {
    return [
      searchDoc.id,
      searchDoc.recordId || null,
      searchDoc.rawInputId || null,
      searchDoc.searchTypeHint || "",
      searchDoc.searchText || "",
      searchDoc.importance ?? 0.5,
      searchDoc.updatedAt || new Date().toISOString(),
    ];
  }

  function deserializeSqlSearchDoc(row) {
    return {
      id: row.id,
      recordId: row.record_id || null,
      rawInputId: row.raw_input_id || null,
      searchTypeHint: row.search_type_hint || "",
      searchText: row.search_text || "",
      importance: Number(row.importance ?? 0.5),
      updatedAt: row.updated_at || new Date().toISOString(),
    };
  }

  function serializeSqlDraft(draft) {
    return [
      draft.id,
      draft.recordType,
      draft.status || "pending",
      draft.rawText || "",
      draft.proposedTitle || "",
      draft.proposedDate || null,
      draft.proposedStartTime || null,
      draft.proposedEndTime || null,
      draft.proposedLocation || "",
      draft.proposedNotes || "",
      draft.allDay ? 1 : 0,
      draft.priority || null,
      draft.confidence ?? 0.6,
      JSON.stringify(draft.ambiguities || []),
      draft.createdAt || new Date().toISOString(),
    ];
  }

  function deserializeSqlDraft(row) {
    return {
      id: row.id,
      recordType: row.record_type,
      status: row.status || "pending",
      rawText: row.raw_text || "",
      proposedTitle: row.proposed_title || "",
      proposedDate: row.proposed_date || "",
      proposedStartTime: row.proposed_start_time || "",
      proposedEndTime: row.proposed_end_time || "",
      proposedLocation: row.proposed_location || "",
      proposedNotes: row.proposed_notes || "",
      allDay: Boolean(row.all_day),
      priority: row.priority || null,
      confidence: Number(row.confidence ?? 0.6),
      ambiguities: safeJsonParse(row.ambiguities_json, []),
      createdAt: row.created_at || new Date().toISOString(),
    };
  }

  function serializeSqlTraceLog(trace) {
    return [
      trace.id,
      trace.recordId,
      trace.traceType,
      trace.snapshotType || null,
      trace.field || null,
      trace.oldValue ?? null,
      trace.newValue ?? null,
      trace.payload ? JSON.stringify(trace.payload) : null,
      trace.createdBy || "system",
      trace.createdAt || new Date().toISOString(),
    ];
  }

  function deserializeSqlTraceLog(row) {
    return {
      id: row.id,
      recordId: row.record_id,
      traceType: row.trace_type,
      snapshotType: row.snapshot_type || null,
      field: row.field || null,
      oldValue: row.old_value ?? null,
      newValue: row.new_value ?? null,
      payload: safeJsonParse(row.payload_json, null),
      createdBy: row.created_by || "system",
      createdAt: row.created_at || new Date().toISOString(),
    };
  }

  function serializeSqlAttachment(attachment) {
    return [
      attachment.id,
      attachment.recordId,
      attachment.filePath || "",
      attachment.fileType || "",
      attachment.fileHash || null,
      attachment.title || "",
      attachment.note || "",
      attachment.ocrText || null,
      attachment.createdAt || new Date().toISOString(),
    ];
  }

  function deserializeSqlAttachment(row) {
    return {
      id: row.id,
      recordId: row.record_id,
      filePath: row.file_path || "",
      fileType: row.file_type || "",
      fileHash: row.file_hash || null,
      title: row.title || "",
      note: row.note || "",
      ocrText: row.ocr_text || null,
      createdAt: row.created_at || new Date().toISOString(),
    };
  }

  function serializeSqlChatMessage(message) {
    return [
      message.id,
      message.role || "assistant",
      message.agent || (message.role === "user" ? "user" : "bot"),
      message.content || "",
      message.createdAt || new Date().toISOString(),
    ];
  }

  function deserializeSqlChatMessage(row) {
    return {
      id: row.id,
      role: row.role || "assistant",
      agent: row.agent || (row.role === "user" ? "user" : "bot"),
      content: row.content || "",
      createdAt: row.created_at || new Date().toISOString(),
    };
  }

  function serializeSqlSettings(settings) {
    return [
      settings.parseMode || defaultSettings.parseMode,
      settings.apiBaseUrl || defaultSettings.apiBaseUrl,
      settings.apiKey || "",
      settings.apiModel || defaultSettings.apiModel,
    ];
  }

  function deserializeSqlSettings(row) {
    return {
      parseMode: row.parse_mode || defaultSettings.parseMode,
      apiBaseUrl: row.api_base_url || defaultSettings.apiBaseUrl,
      apiKey: row.api_key || "",
      apiModel: row.api_model || defaultSettings.apiModel,
    };
  }

  function safeJsonParse(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;

    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn("JSON parse fallback triggered:", error);
      return fallback;
    }
  }
}

globalScope.ChronicleDatabaseStore = {
  createDatabaseStore,
};
})(window);
