/*
  Chronicle Calendar database query module

  这个模块承接 database 层中的读取与检索能力：
  - 本地召回
  - 语义搜索
  - 记录列表化
  - 单条记录详情读取

  它属于 database layer，而不是 secretary layer。
  secretary 只决定要不要调用这些能力，不负责实现这些能力本身。
*/

(function attachChronicleDatabaseQuery(globalScope) {
function createDatabaseQuery({
  getDb,
  getRecordById,
  getRawInputById,
  getRawInputsForRecord,
  getLatestRawInputForRecord,
  getTraceLogsForRecord,
  recordMatchesActiveTagFilter,
  normalizeDraftConfidence,
  buildChatCompletionsEndpoint,
  buildModelRequestErrorMessage,
  expandSearchTerms,
  rankSearchResults,
  isoDate,
}) {
  const SEARCH_SYSTEM_PROMPT = [
    "你是 Chronicle Calendar 的数据库检索增强器。",
    "你的任务是从已有记录中找出真正符合用户语义条件的项。",
    "不要因为记录里出现了某个词就误判为相关。",
    "输出 JSON：{\"matches\":[{\"recordId\":\"...\",\"confidence\":0.92,\"reason\":\"...\"}]}。",
  ].join(" ");

  function localSearch(query) {
    const db = getDb();
    const terms = expandSearchTerms(query);
    return rankSearchResults(db.searchDocs
      .map((searchDoc) => {
        const haystack = String(searchDoc.searchText || "").toLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        const record = searchDoc.recordId ? getRecordById(searchDoc.recordId) : null;
        const rawInput = searchDoc.rawInputId ? getRawInputById(searchDoc.rawInputId) : null;
        return { searchDoc, record, rawInput, score };
      })
      .filter((item) => item.score > 0)
      .filter((item) => item.record ? item.record.status === "active" && recordMatchesActiveTagFilter(item.record) : true)
    , query).slice(0, 12);
  }

  async function searchRecordsSemantically(query, limit = 8, recordTypes = []) {
    const db = getDb();
    const activeRecords = db.records
      .filter((record) => record.status === "active" && recordMatchesActiveTagFilter(record))
      .filter((record) => !recordTypes.length || recordTypes.includes(record.recordType))
      .map((record) => serializeRecordForAssistant(record));

    if (!activeRecords.length) return [];

    const settings = db.settings;
    if (!(settings.parseMode === "llm" && settings.apiKey)) {
      return localSearch(query)
        .filter((item) => !recordTypes.length || recordTypes.includes(item.record?.recordType))
        .slice(0, limit)
        .map((item) => ({
          record: item.record,
          confidence: normalizeDraftConfidence(item.score / 4),
          reason: "机器人关键词召回结果",
        }));
    }

    const endpoint = buildChatCompletionsEndpoint(settings.apiBaseUrl);
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.apiModel,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SEARCH_SYSTEM_PROMPT },
            {
              role: "user",
              content: `当前日期：${isoDate(new Date())}\n用户查询：${query}\n记录列表：${JSON.stringify(activeRecords)}`,
            },
          ],
        }),
      });
    } catch (error) {
      throw new Error(buildModelRequestErrorMessage(endpoint, error));
    }
    if (!response.ok) {
      throw new Error(`AI 语义搜索失败：${response.status}`);
    }
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI 语义搜索没有返回结果。");
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("AI 语义搜索结果不是合法 JSON。");
    }

    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    return matches
      .map((item) => {
        const record = getRecordById(item.recordId);
        if (!record || record.status !== "active") return null;
        return {
          record,
          confidence: normalizeDraftConfidence(item.confidence),
          reason: String(item.reason || ""),
        };
      })
      .filter(Boolean)
      .slice(0, limit);
  }

  function serializeRecordForAssistant(record) {
    const latestRaw = getLatestRawInputForRecord(record.id);
    return {
      id: record.id,
      type: record.recordType,
      recordType: record.recordType,
      title: record.title,
      date: record.date || null,
      startTime: record.startTime || null,
      endTime: record.endTime || null,
      allDay: Boolean(record.allDay),
      location: record.location || "",
      notes: record.notes || "",
      priority: record.priority || null,
      tags: record.tags || [],
      rawInput: latestRaw?.inputText || "",
    };
  }

  function listRecordsForAssistant(options = {}) {
    const db = getDb();
    const { dateFrom, dateTo, limit = 10, recordTypes = [] } = options;
    return db.records
      .filter((record) => record.status === "active" && recordMatchesActiveTagFilter(record))
      .filter((record) => !recordTypes.length || recordTypes.includes(record.recordType))
      .filter((record) => recordMatchesDateRange(record, dateFrom, dateTo))
      .sort(compareAssistantRecords)
      .slice(0, limit)
      .map((record) => serializeRecordForAssistant(record));
  }

  function getRecordDetailForAssistant(recordId) {
    const record = getRecordById(recordId);
    if (!record) return null;
    const rawInputs = getRawInputsForRecord(record.id);
    const traces = getTraceLogsForRecord(record.id);
    return {
      ...serializeRecordForAssistant(record),
      rawInputs: rawInputs.map((item) => ({
        capturedAt: item.capturedAt,
        inputText: item.inputText,
        inputFormat: item.inputFormat,
      })),
      traces: traces.slice(0, 12).map((item) => ({
        traceType: item.traceType,
        field: item.field || null,
        snapshotType: item.snapshotType || null,
        oldValue: item.oldValue ?? null,
        newValue: item.newValue ?? null,
        createdAt: item.createdAt,
      })),
    };
  }

  function normalizeAssistantRecordTypes(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item || "").trim())
      .filter((item) => ["calendar", "task", "memory"].includes(item));
  }

  function normalizeAssistantDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  }

  function buildSearchSummary(results, query) {
    if (!results.length) {
      return `没有找到与“${query}”明显匹配的事项或待办。`;
    }
    const lines = results.map(({ record, searchDoc, score }) => {
      if (!record) {
        return `线索 | ${searchDoc.searchText} | 匹配分:${score}`;
      }
      if (record.recordType === "task") {
        return `待办 | ${record.title} | 优先级:${record.priority} | 匹配分:${score}`;
      }
      if (record.recordType === "memory") {
        return `记忆 | ${record.title} | 匹配分:${score}`;
      }
      return `日程 | ${record.date} ${record.allDay ? "全天/未定时" : `${record.startTime || "未定"}-${record.endTime || "未定"}`} | ${record.title} | 匹配分:${score}`;
    });
    return `围绕“${query}”检索到 ${results.length} 条候选：\n${lines.join("\n")}`;
  }

  function formatAssistantRecord(record) {
    if (!record) return "一条记录";
    if (record.recordType === "task" || record.type === "task") {
      return `待办《${record.title}》`;
    }
    return `${record.date || "未定日期"} ${record.startTime || ""}《${record.title}》`.trim();
  }

  return {
    localSearch,
    searchRecordsSemantically,
    serializeRecordForAssistant,
    listRecordsForAssistant,
    getRecordDetailForAssistant,
    normalizeAssistantRecordTypes,
    normalizeAssistantDate,
    buildSearchSummary,
    formatAssistantRecord,
  };

  function recordMatchesDateRange(record, dateFrom, dateTo) {
    if (!dateFrom && !dateTo) return true;
    if (!record.date) return false;
    if (dateFrom && record.date < dateFrom) return false;
    if (dateTo && record.date > dateTo) return false;
    return true;
  }

  function compareAssistantRecords(left, right) {
    const leftDate = left.date || "9999-12-31";
    const rightDate = right.date || "9999-12-31";
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    const leftTime = left.startTime || "99:99";
    const rightTime = right.startTime || "99:99";
    return leftTime.localeCompare(rightTime);
  }
}

globalScope.ChronicleDatabaseQuery = {
  createDatabaseQuery,
};
})(window);
