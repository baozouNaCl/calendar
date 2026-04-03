/*
  Chronicle Calendar secretary module

  这个模块承接 AI secretary 本体能力：
  - LLM 路由判断
  - 自然语言解析为草稿
  - 工具调用规划
  - 调用 database query 工具
  - 整理最终秘书回复

  它不直接保存数据库真相，只通过注入的 database / UI 接口工作。
*/

(function attachChronicleSecretaryAssistant(globalScope) {
function createSecretaryAssistant({
  getDb,
  queryApi,
  parseNaturalLanguage,
  createDraftId,
  normalizeDraftDate,
  normalizeDraftTime,
  normalizeDraftConfidence,
  buildChatCompletionsEndpoint,
  buildModelRequestErrorMessage,
  persistState,
  render,
  renderDrafts,
  appendChatMessage,
  setStatus,
  expandSidebarForAi,
  inferChatIntent,
}) {
  const SECRETARY_TOOL_README = `
你是 Chronicle Calendar 的秘书助理。日程数据库是你的工具，不是你的全部身份。

你的职责：
1. 先像普通 LLM 一样理解用户自然语言并聊天。
2. 只有在确实需要时，才调用日历工具。
3. 查询时要找“真正满足语义条件的记录”，不要只做关键词命中。
4. 录入时默认生成待确认草稿，而不是直接把不确定内容写死入库。

你可以使用的工具：
- search_records
  作用：按自然语言语义搜索数据库。
  参数：query(string), limit(number, optional), recordTypes(array, optional)
  要求：返回真正相关的事项，而不是仅仅提到关键词的事项。

- list_records
  作用：按时间范围、类型或数量列出记录。
  参数：dateFrom(string, optional), dateTo(string, optional), limit(number, optional), recordTypes(array, optional)

- get_record_detail
  作用：读取某条记录的完整上下文，适合用户追问具体事项。
  参数：recordId(string)

- create_drafts_from_text
  作用：把用户输入解析成待确认草稿。
  参数：text(string)
  要求：把固定时间事项解析成 calendar draft，把模糊任务解析成 todo draft。

使用原则：
- 如果用户只是闲聊、追问、解释、让你总结观点，不必调用工具。
- 不要围绕某个固定类别硬编码搜索词，重点是理解用户自然语言，再决定是否查数据库、怎么查数据库。
- 工具是你的执行层，不是你的思考本身。
- 回答时保留秘书助理的自然表达，不要把自己降级成检索脚本。
`.trim();

  function canUseLlmRouting() {
    const settings = getDb().settings;
    return settings.parseMode === "llm" && Boolean(settings.apiKey?.trim());
  }

  async function resolveChatIntent(text) {
    if (canUseLlmRouting()) {
      try {
        const intent = await classifyChatIntentWithLlm(text);
        return { intent, routeAgent: "ai", notice: "" };
      } catch (error) {
        return {
          intent: inferChatIntent(text),
          routeAgent: "bot",
          notice: `AI 意图判断暂时不可用，已回退到机器人规则。原因：${error.message}`,
        };
      }
    }

    const settings = getDb().settings;
    if (settings.parseMode === "llm" && !settings.apiKey?.trim()) {
      return {
        intent: inferChatIntent(text),
        routeAgent: "bot",
        notice: "当前是大模型模式，但还没有可用的 API Key。已回退到机器人规则判断意图。",
      };
    }

    return { intent: inferChatIntent(text), routeAgent: "bot", notice: "" };
  }

  async function handleSecretaryAssistantTurn(text) {
    expandSidebarForAi();
    setStatus("AI 秘书正在理解你的需求...");
    const plan = await planSecretaryToolUsage(text);

    if (!Array.isArray(plan.toolCalls) || plan.toolCalls.length === 0) {
      appendChatMessage("assistant", plan.reply || "我在这里，继续告诉我你想处理什么就好。", { agent: "ai" });
      setStatus("AI 已回复。");
      return;
    }

    const toolResults = [];
    for (const toolCall of plan.toolCalls.slice(0, 3)) {
      toolResults.push(await executeSecretaryToolCall(toolCall, text));
    }

    const finalReply = await composeSecretaryReply(text, plan, toolResults);
    appendChatMessage("assistant", finalReply, { agent: "ai" });
    render();
    setStatus("AI 已完成本轮处理。");
  }

  async function handleUnifiedAdd(text, routeAgent = "bot") {
    expandSidebarForAi();
    setStatus("正在解析新增事项...");
    const useLlmParser = getDb().settings.parseMode === "llm";
    const drafts = useLlmParser ? await parseNaturalLanguageWithLlm(text) : parseNaturalLanguage(text);
    drafts.forEach((draft) => getDb().drafts.unshift(draft));
    persistState();
    renderDrafts();
    appendChatMessage("assistant", `已生成 ${drafts.length} 条草稿，请在“待确认草稿”中确认或编辑。`, {
      agent: useLlmParser || routeAgent === "ai" ? "ai" : "bot",
    });
    setStatus(`已生成 ${drafts.length} 条草稿。`);
  }

  async function handleUnifiedSearch(text, routeAgent = "bot") {
    expandSidebarForAi();
    setStatus("正在检索事项与待办...");
    const localResults = queryApi.localSearch(text);
    let summary = queryApi.buildSearchSummary(localResults, text);
    let responseAgent = routeAgent === "ai" ? "ai" : "bot";
    if (getDb().settings.parseMode === "llm" && getDb().settings.apiKey) {
      try {
        summary = await summarizeSearchWithLlm(text, localResults);
        responseAgent = "ai";
      } catch (error) {
        summary += `\n\n模型总结失败，已回退到本地结果。原因：${error.message}`;
        responseAgent = "bot";
      }
    }
    appendChatMessage("assistant", summary, { agent: responseAgent });
    setStatus("检索已完成。");
  }

  async function parseNaturalLanguageWithLlm(text) {
    const settings = getDb().settings;
    if (!settings.apiKey) {
      throw new Error("当前解析模式是大模型 API，但还没有填写 API Key。");
    }
    const now = new Date();
    const todayIso = formatTodayIso(now);
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
            {
              role: "system",
              content: "你是一个日程与待办解析器。你的任务是把用户输入拆分为多个草稿。相对时间必须以用户当前本地时间为准。输出 JSON 对象：{\"drafts\":[...]}。每个 draft 包含 recordType(event或todo), rawText, proposedTitle, proposedDate, proposedStartTime, proposedEndTime, proposedLocation, proposedNotes, allDay, priority, confidence, ambiguities。",
            },
            {
              role: "user",
              content: `当前本地时间是 ${now.toISOString()}，当前日期是 ${todayIso}。\n请解析以下输入：\n${text}`,
            },
          ],
        }),
      });
    } catch (error) {
      throw new Error(buildModelRequestErrorMessage(endpoint, error));
    }
    if (!response.ok) {
      throw new Error(`API 请求失败：${response.status}，接口地址 ${endpoint}，返回内容：${await response.text()}`);
    }
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("模型没有返回可解析内容。");

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("模型返回的不是合法 JSON。");
    }
    const drafts = Array.isArray(parsed.drafts) ? parsed.drafts : [];
    if (!drafts.length) throw new Error("模型没有生成草稿。");
    return drafts.map((draft) => ({
      id: createDraftId(),
      createdAt: new Date().toISOString(),
      status: "pending",
      recordType: draft.recordType === "todo" ? "todo" : "event",
      rawText: String(draft.rawText || ""),
      proposedTitle: String(draft.proposedTitle || draft.rawText || "待确认事项"),
      proposedDate: normalizeDraftDate(draft.proposedDate, todayIso),
      proposedStartTime: normalizeDraftTime(draft.proposedStartTime),
      proposedEndTime: normalizeDraftTime(draft.proposedEndTime),
      proposedLocation: String(draft.proposedLocation || ""),
      proposedNotes: String(draft.proposedNotes || ""),
      allDay: Boolean(draft.allDay),
      priority: String(draft.priority || "normal"),
      confidence: normalizeDraftConfidence(draft.confidence),
      ambiguities: Array.isArray(draft.ambiguities) ? draft.ambiguities.map(String) : [],
    }));
  }

  async function classifyChatIntentWithLlm(text) {
    const settings = getDb().settings;
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
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "你是日历应用的意图路由器。请判断用户这句话更适合走 add 还是 search。add 用于新增日程/待办/安排；search 用于查询、回顾、统计、总结、询问最近/最早/是否有某类记录。只输出 JSON：{\"intent\":\"add\"} 或 {\"intent\":\"search\"}。",
            },
            { role: "user", content: text },
          ],
        }),
      });
    } catch (error) {
      throw new Error(buildModelRequestErrorMessage(endpoint, error));
    }
    if (!response.ok) {
      throw new Error(`AI 意图判断失败：${response.status}`);
    }
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI 没有返回意图判断结果。");
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("AI 返回的意图判断不是合法 JSON。");
    }
    return parsed.intent === "add" ? "add" : "search";
  }

  async function planSecretaryToolUsage(text) {
    const settings = getDb().settings;
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
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `${SECRETARY_TOOL_README}\n\n请先判断用户是否需要调用工具。如果不需要，直接给出自然回复。如果需要，请输出 JSON：{"reply":"给用户的简短过渡语","toolCalls":[{"tool":"search_records","arguments":{"query":"...","limit":6,"recordTypes":["calendar","task"]}},{"tool":"list_records","arguments":{"dateFrom":"2026-04-01","dateTo":"2026-04-07","limit":10,"recordTypes":["calendar"]}},{"tool":"get_record_detail","arguments":{"recordId":"evt_xxx"}},{"tool":"create_drafts_from_text","arguments":{"text":"..."}}]}。toolCalls 为空数组表示不调用工具。`,
            },
            { role: "user", content: text },
          ],
        }),
      });
    } catch (error) {
      throw new Error(buildModelRequestErrorMessage(endpoint, error));
    }
    if (!response.ok) {
      throw new Error(`AI 秘书规划失败：${response.status}`);
    }
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI 秘书没有返回可解析内容。");
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("AI 秘书规划结果不是合法 JSON。");
    }
    return {
      reply: String(parsed.reply || ""),
      toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [],
    };
  }

  async function executeSecretaryToolCall(toolCall, originalText) {
    const tool = String(toolCall?.tool || "").trim();
    const args = toolCall?.arguments || {};

    if (tool === "search_records") {
      const query = String(args.query || originalText || "").trim() || originalText;
      const limit = Math.max(1, Math.min(12, Number(args.limit) || 8));
      const recordTypes = queryApi.normalizeAssistantRecordTypes(args.recordTypes);
      const matches = await queryApi.searchRecordsSemantically(query, limit, recordTypes);
      return { tool, query, limit, recordTypes, matches };
    }

    if (tool === "list_records") {
      const dateFrom = queryApi.normalizeAssistantDate(args.dateFrom);
      const dateTo = queryApi.normalizeAssistantDate(args.dateTo);
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 10));
      const recordTypes = queryApi.normalizeAssistantRecordTypes(args.recordTypes);
      const records = queryApi.listRecordsForAssistant({ dateFrom, dateTo, limit, recordTypes });
      return { tool, dateFrom, dateTo, limit, recordTypes, records };
    }

    if (tool === "get_record_detail") {
      const recordId = String(args.recordId || "").trim();
      const detail = queryApi.getRecordDetailForAssistant(recordId);
      return { tool, recordId, detail };
    }

    if (tool === "create_drafts_from_text") {
      const text = String(args.text || originalText || "").trim() || originalText;
      const drafts = await buildDraftsFromText(text);
      drafts.forEach((draft) => getDb().drafts.unshift(draft));
      persistState();
      renderDrafts();
      return {
        tool,
        text,
        drafts: drafts.map((draft) => ({
          id: draft.id,
          recordType: draft.recordType,
          title: draft.proposedTitle,
          date: draft.proposedDate,
          startTime: draft.proposedStartTime,
          endTime: draft.proposedEndTime,
          location: draft.proposedLocation,
          priority: draft.priority || null,
          allDay: draft.allDay,
          ambiguities: draft.ambiguities,
        })),
      };
    }

    return {
      tool: tool || "unknown",
      error: "AI 选择了当前未支持的工具。",
    };
  }

  async function buildDraftsFromText(text) {
    const settings = getDb().settings;
    if (settings.parseMode === "llm" && settings.apiKey) {
      try {
        return await parseNaturalLanguageWithLlm(text);
      } catch {
        return parseNaturalLanguage(text);
      }
    }
    return parseNaturalLanguage(text);
  }

  async function composeSecretaryReply(userText, plan, toolResults) {
    const settings = getDb().settings;
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
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content: `${SECRETARY_TOOL_README}\n\n你已经拿到了工具执行结果。现在请像一个自然、可靠的秘书助理那样直接回答用户。若搜索结果里有误导项，要主动排除并说明原因。若创建了草稿，要说明已经放入待确认草稿。`,
            },
            {
              role: "user",
              content: `用户原话：${userText}\nAI 初步计划：${JSON.stringify(plan)}\n工具结果：${JSON.stringify(toolResults)}`,
            },
          ],
        }),
      });
    } catch (error) {
      throw new Error(buildModelRequestErrorMessage(endpoint, error));
    }
    if (!response.ok) {
      throw new Error(`AI 整理最终回复失败：${response.status}`);
    }
    const json = await response.json();
    return json.choices?.[0]?.message?.content || buildSecretaryFallbackReply(toolResults, plan.reply);
  }

  function buildSecretaryFallbackReply(toolResults, replyPrefix = "") {
    const parts = [];
    if (replyPrefix) parts.push(replyPrefix);

    toolResults.forEach((result) => {
      if (result.tool === "create_drafts_from_text") {
        parts.push(`我已经帮你生成 ${result.drafts.length} 条待确认草稿，你可以在“待确认草稿”里继续确认或编辑。`);
      }
      if (result.tool === "search_records") {
        if (!result.matches.length) {
          parts.push(`我暂时没有在日程数据库里找到和“${result.query}”真正匹配的记录。`);
        } else {
          const first = result.matches[0];
          parts.push(`我先帮你筛到 ${result.matches.length} 条相关记录，最相关的是 ${queryApi.formatAssistantRecord(first.record)}。`);
        }
      }
      if (result.tool === "list_records") {
        if (!result.records.length) {
          parts.push("我暂时没有列出符合当前范围条件的记录。");
        } else {
          parts.push(`我先列出了 ${result.records.length} 条记录，最前面的是 ${queryApi.formatAssistantRecord(result.records[0])}。`);
        }
      }
      if (result.tool === "get_record_detail") {
        if (!result.detail) {
          parts.push("我暂时没有找到你指定的那条记录详情。");
        } else {
          parts.push(`我已经读到了《${result.detail.title}》的完整上下文。`);
        }
      }
      if (result.error) {
        parts.push(result.error);
      }
    });

    return parts.filter(Boolean).join("\n\n") || "我已经处理完这轮请求。";
  }

  async function summarizeSearchWithLlm(query, results) {
    const settings = getDb().settings;
    const endpoint = buildChatCompletionsEndpoint(settings.apiBaseUrl);
    const candidates = results.map(({ record, searchDoc, rawInput }) => ({
      type: record?.recordType || searchDoc.searchTypeHint,
      title: record?.title || "记忆线索",
      date: record?.date || null,
      time: record?.startTime ? `${record.startTime}-${record.endTime || ""}` : null,
      notes: record?.notes || rawInput?.inputText || "",
      location: record?.location || "",
      priority: record?.priority || null,
      searchText: searchDoc.searchText,
    }));
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
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: "你是一个日程检索助手。基于给定候选项，用中文给出简短总结，指出最相关的记录并说明理由。不要编造候选外的信息。",
            },
            {
              role: "user",
              content: `用户查询：${query}\n候选记录：${JSON.stringify(candidates)}`,
            },
          ],
        }),
      });
    } catch (error) {
      throw new Error(buildModelRequestErrorMessage(endpoint, error));
    }
    if (!response.ok) {
      throw new Error(`模型检索总结失败：${response.status}`);
    }
    const json = await response.json();
    return json.choices?.[0]?.message?.content || queryApi.buildSearchSummary(results, query);
  }

  return {
    canUseLlmRouting,
    resolveChatIntent,
    handleSecretaryAssistantTurn,
    handleUnifiedAdd,
    handleUnifiedSearch,
    summarizeSearchWithLlm,
    parseNaturalLanguageWithLlm,
    classifyChatIntentWithLlm,
    planSecretaryToolUsage,
    executeSecretaryToolCall,
    buildDraftsFromText,
    composeSecretaryReply,
    buildSecretaryFallbackReply,
  };

  function formatTodayIso(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

globalScope.ChronicleSecretaryAssistant = {
  createSecretaryAssistant,
};
})(window);
