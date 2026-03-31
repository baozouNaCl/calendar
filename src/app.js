const STORAGE_KEY = "chronicle-calendar-v1";
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DEFAULT_SETTINGS = {
  parseMode: "local",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  apiModel: "gpt-4o-mini",
};

const state = {
  db: loadState(),
  visibleMonth: startOfMonth(new Date()),
  visibleWeek: startOfWeek(new Date()),
  selectedDate: isoDate(new Date()),
  activeView: "month",
  editingEventId: null,
  editingTodoId: null,
};

const refs = {
  monthLabel: document.querySelector("#month-label"),
  selectedDateLabel: document.querySelector("#selected-date-label"),
  calendarWeekdays: document.querySelector("#calendar-weekdays"),
  calendarGrid: document.querySelector("#calendar-grid"),
  dailyEventList: document.querySelector("#daily-event-list"),
  tracePanel: document.querySelector("#trace-panel"),
  draftList: document.querySelector("#draft-list"),
  draftCount: document.querySelector("#draft-count"),
  statusLine: document.querySelector("#status-line"),
  eventForm: document.querySelector("#event-form"),
  eventId: document.querySelector("#event-id"),
  eventTitle: document.querySelector("#event-title"),
  eventDate: document.querySelector("#event-date"),
  eventAllDay: document.querySelector("#event-all-day"),
  eventStartTime: document.querySelector("#event-start-time"),
  eventEndTime: document.querySelector("#event-end-time"),
  eventLocation: document.querySelector("#event-location"),
  eventNotes: document.querySelector("#event-notes"),
  eventRawInput: document.querySelector("#event-raw-input"),
  importFile: document.querySelector("#import-file"),
  parseMode: document.querySelector("#parse-mode"),
  apiBaseUrl: document.querySelector("#api-base-url"),
  apiKey: document.querySelector("#api-key"),
  apiModel: document.querySelector("#api-model"),
  viewButtons: document.querySelectorAll("[data-view-target]"),
  monthView: document.querySelector("#month-view"),
  weekView: document.querySelector("#week-view"),
  todoView: document.querySelector("#todo-view"),
  weekLabel: document.querySelector("#week-label"),
  weekGrid: document.querySelector("#week-grid"),
  todoForm: document.querySelector("#todo-form"),
  todoId: document.querySelector("#todo-id"),
  todoTitle: document.querySelector("#todo-title"),
  todoNotes: document.querySelector("#todo-notes"),
  todoPriority: document.querySelector("#todo-priority"),
  todoRawInput: document.querySelector("#todo-raw-input"),
  todoList: document.querySelector("#todo-list"),
  todoCount: document.querySelector("#todo-count"),
  chatHistory: document.querySelector("#chat-history"),
  chatInput: document.querySelector("#chat-input"),
  chatIntent: document.querySelector("#chat-intent"),
  dayModal: document.querySelector("#day-modal"),
  dayModalTitle: document.querySelector("#day-modal-title"),
  dayModalContent: document.querySelector("#day-modal-content"),
};

init();

function init() {
  renderWeekdays();
  bindEvents();
  seedSettingsForm();
  seedEmptyInputForm();
  seedEmptyTodoForm();
  render();
}

function bindEvents() {
  document.querySelector("#prev-month-btn").addEventListener("click", () => {
    state.visibleMonth = addMonths(state.visibleMonth, -1);
    renderCalendar();
  });
  document.querySelector("#next-month-btn").addEventListener("click", () => {
    state.visibleMonth = addMonths(state.visibleMonth, 1);
    renderCalendar();
  });
  document.querySelector("#today-btn").addEventListener("click", () => {
    const today = new Date();
    state.visibleMonth = startOfMonth(today);
    state.visibleWeek = startOfWeek(today);
    state.selectedDate = isoDate(today);
    render();
  });
  document.querySelector("#prev-week-btn").addEventListener("click", () => {
    state.visibleWeek = addDays(state.visibleWeek, -7);
    renderWeekView();
  });
  document.querySelector("#next-week-btn").addEventListener("click", () => {
    state.visibleWeek = addDays(state.visibleWeek, 7);
    renderWeekView();
  });
  document.querySelector("#current-week-btn").addEventListener("click", () => {
    state.visibleWeek = startOfWeek(new Date());
    renderWeekView();
  });

  refs.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.viewTarget;
      syncViewState();
    });
  });

  document.querySelector("#send-chat-btn").addEventListener("click", handleChatSubmit);
  refs.chatInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      handleChatSubmit();
    }
  });

  document.querySelector("#save-settings-btn").addEventListener("click", handleSaveSettings);
  document.querySelector("#export-btn").addEventListener("click", handleExport);
  document.querySelector("#import-btn").addEventListener("click", () => refs.importFile.click());
  document.querySelector("#seed-btn").addEventListener("click", seedDemoData);
  refs.importFile.addEventListener("change", handleImport);

  refs.eventForm.addEventListener("submit", handleSaveEvent);
  document.querySelector("#delete-event-btn").addEventListener("click", handleDeleteEvent);
  document.querySelector("#reset-form-btn").addEventListener("click", () => {
    state.editingEventId = null;
    seedEmptyInputForm();
  });

  refs.todoForm.addEventListener("submit", handleSaveTodo);
  document.querySelector("#delete-todo-btn").addEventListener("click", handleDeleteTodo);
  document.querySelector("#reset-todo-btn").addEventListener("click", () => {
    state.editingTodoId = null;
    seedEmptyTodoForm();
  });

  document.querySelector("#close-day-modal-btn").addEventListener("click", () => refs.dayModal.close());
}

function render() {
  syncViewState();
  renderCalendar();
  renderWeekView();
  renderDailyEvents();
  renderDrafts();
  renderTracePanel();
  renderTodos();
  renderChatHistory();
  updateSelectedDateLabel();
}

function syncViewState() {
  refs.viewButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.viewTarget === state.activeView));
  refs.monthView.classList.toggle("is-hidden", state.activeView !== "month");
  refs.weekView.classList.toggle("is-hidden", state.activeView !== "week");
  refs.todoView.classList.toggle("is-hidden", state.activeView !== "todo");
}

function renderWeekdays() {
  refs.calendarWeekdays.innerHTML = WEEKDAY_LABELS.map((label) => `<div>${label}</div>`).join("");
}

function renderCalendar() {
  const monthStart = startOfMonth(state.visibleMonth);
  const gridStart = startOfWeek(monthStart);
  refs.monthLabel.textContent = formatMonthLabel(monthStart);

  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  refs.calendarGrid.innerHTML = days.map((day) => renderMonthDay(day, monthStart)).join("");

  refs.calendarGrid.querySelectorAll(".calendar-day").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDate = button.dataset.date;
      state.visibleWeek = startOfWeek(parseDate(state.selectedDate));
      if (!state.editingEventId) {
        seedEmptyInputForm();
      }
      render();
    });
    button.addEventListener("dblclick", () => openDayModal(button.dataset.date));
  });
}

function renderMonthDay(day, monthStart) {
  const dayIso = isoDate(day);
  const events = getEventsForDate(dayIso).slice(0, 3);
  const isToday = dayIso === isoDate(new Date());
  const isSelected = dayIso === state.selectedDate;
  const isOtherMonth = day.getMonth() !== monthStart.getMonth();

  return `
    <button class="calendar-day ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""} ${isOtherMonth ? "is-other-month" : ""}" data-date="${dayIso}" type="button">
      <div class="calendar-day-header">
        <span>${day.getDate()}</span>
        <span class="chip">${getEventsForDate(dayIso).length}</span>
      </div>
      <div class="day-events">
        ${events.map((event) => `<span class="event-chip">${escapeHtml(formatEventChip(event))}</span>`).join("")}
      </div>
    </button>
  `;
}

function renderWeekView() {
  const weekStart = state.visibleWeek;
  refs.weekLabel.textContent = `${isoDate(weekStart)} 至 ${isoDate(addDays(weekStart, 6))}`;
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const rows = [];

  rows.push(`<div></div>${weekDays.map((day) => `<div class="week-header-cell" data-date="${isoDate(day)}">${formatWeekdayHeader(day)}</div>`).join("")}`);
  rows.push(`<div class="week-all-day-label">未定时/全天</div>${weekDays.map((day) => renderWeekAllDayCell(isoDate(day))).join("")}`);

  for (let hour = 6; hour <= 22; hour += 1) {
    rows.push(`<div class="week-time-cell">${String(hour).padStart(2, "0")}:00</div>${weekDays.map((day) => renderWeekSlot(isoDate(day), hour)).join("")}`);
  }

  refs.weekGrid.innerHTML = rows.join("");

  refs.weekGrid.querySelectorAll(".week-slot").forEach((slot) => {
    slot.addEventListener("click", () => quickCreateFromWeekSlot(slot.dataset.date, slot.dataset.hour));
  });

  refs.weekGrid.querySelectorAll(".week-all-day-cell").forEach((slot) => {
    slot.addEventListener("click", () => quickCreateAllDay(slot.dataset.date));
  });

  refs.weekGrid.querySelectorAll("[data-week-event-id]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      loadEventIntoForm(node.dataset.weekEventId);
      state.activeView = "month";
      syncViewState();
    });
  });
}

function renderWeekAllDayCell(dateIso) {
  const allDayEvents = getEventsForDate(dateIso).filter((event) => event.allDay || !event.startTime);
  return `
    <div class="week-all-day-cell" data-date="${dateIso}">
      ${allDayEvents.length
        ? allDayEvents.map((event) => `<div class="week-all-day-item" data-week-event-id="${event.id}">${escapeHtml(event.title)}</div>`).join("")
        : `<div class="slot-add-hint">点击添加</div>`}
    </div>
  `;
}

function renderWeekSlot(dateIso, hour) {
  const hourText = String(hour).padStart(2, "0");
  const timedEvents = getEventsForDate(dateIso).filter((event) => {
    if (!event.startTime || event.allDay) return false;
    return Number(event.startTime.slice(0, 2)) === hour;
  });
  return `
    <div class="week-slot" data-date="${dateIso}" data-hour="${hourText}">
      ${timedEvents.length
        ? timedEvents.map((event) => `<div class="week-event" data-week-event-id="${event.id}">${escapeHtml(formatEventChip(event))}</div>`).join("")
        : `<div class="slot-add-hint">点击添加</div>`}
    </div>
  `;
}

function renderDailyEvents() {
  const events = getEventsForDate(state.selectedDate);
  if (!events.length) {
    refs.dailyEventList.className = "daily-event-list empty-state";
    refs.dailyEventList.textContent = "当前日期还没有事项。";
    return;
  }

  refs.dailyEventList.className = "daily-event-list";
  refs.dailyEventList.innerHTML = events.map((event) => `
    <article class="daily-event-item" data-event-id="${event.id}">
      <h3>${escapeHtml(event.title || "未命名事项")}</h3>
      <div class="inline-meta">
        <span>${event.allDay ? "全天/未定时" : `${event.startTime || "未定"} - ${event.endTime || "未定"}`}</span>
        <span>${escapeHtml(event.location || "地点未填")}</span>
        <span>${escapeHtml(event.sourceType)}</span>
      </div>
      <p>${escapeHtml(event.notes || "暂无备注")}</p>
      <div class="daily-actions">
        <button class="secondary-btn" data-action="edit" type="button">编辑</button>
      </div>
    </article>
  `).join("");

  refs.dailyEventList.querySelectorAll("[data-action='edit']").forEach((button) => {
    button.addEventListener("click", (event) => {
      const card = event.target.closest("[data-event-id]");
      loadEventIntoForm(card.dataset.eventId);
    });
  });
}

function renderDrafts() {
  const drafts = state.db.drafts.filter((draft) => draft.status === "pending");
  refs.draftCount.textContent = String(drafts.length);

  if (!drafts.length) {
    refs.draftList.className = "draft-list empty-state";
    refs.draftList.textContent = "还没有草稿。你可以先在左侧输入自然语言。";
    return;
  }

  refs.draftList.className = "draft-list";
  refs.draftList.innerHTML = drafts.map((draft) => `
    <article class="draft-item" data-draft-id="${draft.id}">
      <h3>${escapeHtml(draft.proposedTitle || "待确认事项")}</h3>
      <div class="inline-meta">
        <span>${escapeHtml(draft.proposedDate || "日期未识别")}</span>
        <span>${draft.allDay ? "全天/未定时" : `${draft.proposedStartTime || "未定"} - ${draft.proposedEndTime || "未定"}`}</span>
        <span>${escapeHtml(draft.proposedLocation || "地点未识别")}</span>
        <span>置信度 ${Math.round(draft.confidence * 100)}%</span>
      </div>
      <p>${escapeHtml(draft.proposedNotes || "暂无额外备注")}</p>
      <p class="muted">原始输入：${escapeHtml(draft.rawText)}</p>
      ${draft.ambiguities.length ? `<p class="muted">待确认：${escapeHtml(draft.ambiguities.join("；"))}</p>` : ""}
      <div class="draft-actions">
        <button class="primary-btn" data-action="commit" type="button">确认入库</button>
        <button class="secondary-btn" data-action="edit" type="button">载入表单</button>
        <button class="ghost-btn" data-action="discard" type="button">丢弃</button>
      </div>
    </article>
  `).join("");

  refs.draftList.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleDraftAction));
}

function renderTracePanel() {
  const event = state.db.events.find((item) => item.id === state.editingEventId);
  const todo = state.db.todos.find((item) => item.id === state.editingTodoId);
  const target = event || todo;
  if (!target) {
    refs.tracePanel.className = "trace-panel empty-state";
    refs.tracePanel.textContent = "选中一条事项或待办后，这里会显示原始输入、快照和变更记录。";
    return;
  }

  const rawInputs = state.db.rawInputs.filter((item) => item.recordId === target.id);
  const snapshots = state.db.snapshots.filter((item) => item.recordId === target.id);
  const changes = state.db.changeLog.filter((item) => item.recordId === target.id);

  refs.tracePanel.className = "trace-panel";
  refs.tracePanel.innerHTML = `
    <article class="trace-block">
      <h3>当前检索摘要</h3>
      <pre>${escapeHtml(target.searchDoc?.compactText || "暂无")}</pre>
    </article>
    <article class="trace-block">
      <h3>原始输入记录</h3>
      <pre>${escapeHtml(rawInputs.map((item) => `${formatDateTime(item.capturedAt)}\n${item.inputText}`).join("\n\n---\n\n") || "暂无")}</pre>
    </article>
    <article class="trace-block">
      <h3>快照</h3>
      <pre>${escapeHtml(snapshots.map((item) => `${item.snapshotType} | ${formatDateTime(item.savedAt)}\n${JSON.stringify(item.payload, null, 2)}`).join("\n\n---\n\n") || "暂无")}</pre>
    </article>
    <article class="trace-block">
      <h3>变更记录</h3>
      <pre>${escapeHtml(changes.map((item) => `${formatDateTime(item.changedAt)} | ${item.changedBy} | ${item.field}: ${item.oldValue ?? ""} -> ${item.newValue ?? ""}`).join("\n") || "暂无")}</pre>
    </article>
  `;
}

function renderTodos() {
  const todos = state.db.todos.filter((todo) => todo.status === "active");
  refs.todoCount.textContent = String(todos.length);
  if (!todos.length) {
    refs.todoList.className = "daily-event-list empty-state";
    refs.todoList.textContent = "还没有待办事项。";
    return;
  }
  refs.todoList.className = "daily-event-list";
  refs.todoList.innerHTML = todos.map((todo) => `
    <article class="daily-event-item ${todo.priority === "high" ? "priority-high" : ""} ${todo.priority === "low" ? "priority-low" : ""}" data-todo-id="${todo.id}">
      <h3>${escapeHtml(todo.title)}</h3>
      <div class="inline-meta">
        <span>优先级：${escapeHtml(todo.priority)}</span>
        <span>${escapeHtml(todo.sourceType)}</span>
      </div>
      <p>${escapeHtml(todo.notes || "暂无说明")}</p>
      <div class="daily-actions">
        <button class="secondary-btn" data-todo-action="edit" type="button">编辑</button>
      </div>
    </article>
  `).join("");
  refs.todoList.querySelectorAll("[data-todo-action='edit']").forEach((button) => {
    button.addEventListener("click", (event) => {
      const card = event.target.closest("[data-todo-id]");
      loadTodoIntoForm(card.dataset.todoId);
    });
  });
}

function renderChatHistory() {
  const messages = state.db.chatMessages.slice(-12);
  if (!messages.length) {
    refs.chatHistory.className = "chat-history empty-state";
    refs.chatHistory.textContent = "这里会显示解析、检索和系统反馈。";
    return;
  }
  refs.chatHistory.className = "chat-history";
  refs.chatHistory.innerHTML = messages.map((message) => `
    <article class="chat-message ${escapeHtml(message.role)}">
      <div class="chat-role">${escapeHtml(message.role === "user" ? "你" : "系统")}</div>
      <div>${escapeHtml(message.content)}</div>
    </article>
  `).join("");
  refs.chatHistory.scrollTop = refs.chatHistory.scrollHeight;
}

function updateSelectedDateLabel() {
  refs.selectedDateLabel.textContent = `当前日期：${state.selectedDate}`;
}

function seedEmptyInputForm(partial = {}) {
  refs.eventId.value = partial.id || "";
  refs.eventTitle.value = partial.title || "";
  refs.eventDate.value = partial.date || state.selectedDate;
  refs.eventAllDay.value = String(partial.allDay ?? false);
  refs.eventStartTime.value = partial.startTime || "";
  refs.eventEndTime.value = partial.endTime || "";
  refs.eventLocation.value = partial.location || "";
  refs.eventNotes.value = partial.notes || "";
  refs.eventRawInput.value = partial.rawInput || "";
}

function seedEmptyTodoForm(partial = {}) {
  refs.todoId.value = partial.id || "";
  refs.todoTitle.value = partial.title || "";
  refs.todoNotes.value = partial.notes || "";
  refs.todoPriority.value = partial.priority || "normal";
  refs.todoRawInput.value = partial.rawInput || "";
}

function seedSettingsForm() {
  refs.parseMode.value = state.db.settings.parseMode;
  refs.apiBaseUrl.value = state.db.settings.apiBaseUrl;
  refs.apiKey.value = state.db.settings.apiKey;
  refs.apiModel.value = state.db.settings.apiModel;
}

async function handleChatSubmit() {
  const text = refs.chatInput.value.trim();
  if (!text) {
    setStatus("先输入一些内容再发送。");
    return;
  }
  appendChatMessage("user", text);
  refs.chatInput.value = "";
  const intent = refs.chatIntent.value === "auto" ? inferChatIntent(text) : refs.chatIntent.value;
  try {
    if (intent === "add") {
      await handleUnifiedAdd(text);
    } else {
      await handleUnifiedSearch(text);
    }
  } catch (error) {
    appendChatMessage("system", `处理失败：${error.message}`);
    setStatus(`处理失败：${error.message}`);
  }
}

async function handleUnifiedAdd(text) {
  setStatus("正在解析新增事项...");
  const drafts = state.db.settings.parseMode === "llm" ? await parseNaturalLanguageWithLlm(text) : parseNaturalLanguage(text);
  drafts.forEach((draft) => state.db.drafts.unshift(draft));
  persistState();
  renderDrafts();
  appendChatMessage("system", `已生成 ${drafts.length} 条草稿，请在“待确认草稿”中确认或编辑。`);
  setStatus(`已生成 ${drafts.length} 条草稿。`);
}

async function handleUnifiedSearch(text) {
  setStatus("正在检索事项与待办...");
  const localResults = localSearch(text);
  let summary = buildSearchSummary(localResults, text);
  if (state.db.settings.parseMode === "llm" && state.db.settings.apiKey) {
    try {
      summary = await summarizeSearchWithLlm(text, localResults);
    } catch (error) {
      summary += `\n\n模型总结失败，已回退到本地结果。原因：${error.message}`;
    }
  }
  appendChatMessage("system", summary);
  setStatus("检索已完成。");
}

function inferChatIntent(text) {
  const searchHints = ["找", "检索", "统计", "总结", "哪些", "过去", "回顾", "筛选"];
  return searchHints.some((hint) => text.includes(hint)) ? "search" : "add";
}

function appendChatMessage(role, content) {
  state.db.chatMessages.push({
    id: createId("msg"),
    role,
    content,
    createdAt: new Date().toISOString(),
  });
  persistState();
  renderChatHistory();
}

function handleSaveSettings() {
  state.db.settings = {
    parseMode: refs.parseMode.value,
    apiBaseUrl: refs.apiBaseUrl.value.trim() || DEFAULT_SETTINGS.apiBaseUrl,
    apiKey: refs.apiKey.value.trim(),
    apiModel: refs.apiModel.value.trim() || DEFAULT_SETTINGS.apiModel,
  };
  persistState();
  appendChatMessage("system", "模型解析设置已保存。");
  setStatus("模型解析设置已保存。");
}

function handleSaveEvent(event) {
  event.preventDefault();
  const payload = collectEventFormData();
  if (!payload.title.trim()) {
    setStatus("请先填写标题。");
    refs.eventTitle.focus();
    return;
  }
  if (payload.id) {
    updateExistingEvent(payload);
    setStatus("事项已更新，并保留了快照与变更记录。");
  } else {
    createEventFromForm(payload);
    setStatus("事项已创建。");
  }
  persistState();
  state.selectedDate = payload.date;
  state.visibleMonth = startOfMonth(parseDate(payload.date));
  state.visibleWeek = startOfWeek(parseDate(payload.date));
  render();
}

function handleDeleteEvent() {
  const eventId = refs.eventId.value;
  if (!eventId) {
    setStatus("当前没有可删除的事项。");
    return;
  }
  const event = state.db.events.find((item) => item.id === eventId);
  if (!event) return;
  saveSnapshot(event, "before_delete");
  state.db.events = state.db.events.filter((item) => item.id !== eventId);
  logChange(eventId, "record", JSON.stringify(event), "[deleted]", "manual_ui");
  state.editingEventId = null;
  seedEmptyInputForm();
  persistState();
  render();
  setStatus("事项已删除，历史追溯信息仍然保留。");
}

function handleSaveTodo(event) {
  event.preventDefault();
  const payload = collectTodoFormData();
  if (!payload.title.trim()) {
    setStatus("请先填写待办标题。");
    return;
  }
  if (payload.id) {
    updateExistingTodo(payload);
    setStatus("待办已更新。");
  } else {
    createTodoFromForm(payload);
    setStatus("待办已创建。");
  }
  persistState();
  render();
}

function handleDeleteTodo() {
  const todoId = refs.todoId.value;
  if (!todoId) {
    setStatus("当前没有可删除的待办。");
    return;
  }
  const todo = state.db.todos.find((item) => item.id === todoId);
  if (!todo) return;
  saveSnapshot(todo, "before_delete");
  state.db.todos = state.db.todos.filter((item) => item.id !== todoId);
  logChange(todoId, "record", JSON.stringify(todo), "[deleted]", "manual_ui");
  state.editingTodoId = null;
  seedEmptyTodoForm();
  persistState();
  render();
  setStatus("待办已删除。");
}

function handleDraftAction(event) {
  const action = event.target.dataset.action;
  const draftId = event.target.closest("[data-draft-id]").dataset.draftId;
  const draft = state.db.drafts.find((item) => item.id === draftId);
  if (!draft) return;

  if (action === "commit") {
    if (draft.recordType === "todo") {
      createTodoFromDraft(draft);
    } else {
      createEventFromDraft(draft);
    }
    draft.status = "committed";
    setStatus("草稿已确认入库。");
  }
  if (action === "edit") {
    if (draft.recordType === "todo") {
      state.activeView = "todo";
      seedEmptyTodoForm({
        title: draft.proposedTitle,
        notes: draft.proposedNotes,
        priority: draft.priority || "normal",
        rawInput: draft.rawText,
      });
      syncViewState();
    } else {
      state.activeView = "month";
      seedEmptyInputForm({
        title: draft.proposedTitle,
        date: draft.proposedDate || state.selectedDate,
        allDay: draft.allDay,
        startTime: draft.proposedStartTime,
        endTime: draft.proposedEndTime,
        location: draft.proposedLocation,
        notes: draft.proposedNotes,
        rawInput: draft.rawText,
      });
      syncViewState();
    }
    setStatus("草稿内容已载入表单，你可以再细调。");
  }
  if (action === "discard") {
    draft.status = "discarded";
    setStatus("草稿已丢弃。");
  }
  persistState();
  render();
}

function handleExport() {
  const blob = new Blob([JSON.stringify(state.db, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `chronicle-calendar-export-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("已导出当前本地数据。");
}

function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state.db = normalizeImportedState(JSON.parse(String(reader.result)));
      state.editingEventId = null;
      state.editingTodoId = null;
      persistState();
      seedEmptyInputForm();
      seedEmptyTodoForm();
      render();
      setStatus("导入成功。");
    } catch (error) {
      setStatus(`导入失败：${error.message}`);
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function openDayModal(dateIso) {
  const events = getEventsForDate(dateIso);
  refs.dayModalTitle.textContent = `${dateIso} 的安排`;
  if (!events.length) {
    refs.dayModalContent.className = "daily-event-list empty-state";
    refs.dayModalContent.textContent = "这一天还没有事项。";
  } else {
    refs.dayModalContent.className = "daily-event-list";
    refs.dayModalContent.innerHTML = events.map((event) => `
      <article class="daily-event-item" data-modal-event-id="${event.id}">
        <h3>${escapeHtml(event.title)}</h3>
        <div class="inline-meta">
          <span>${event.allDay ? "全天/未定时" : `${event.startTime || "未定"} - ${event.endTime || "未定"}`}</span>
          <span>${escapeHtml(event.location || "地点未填")}</span>
        </div>
        <p>${escapeHtml(event.notes || "暂无备注")}</p>
      </article>
    `).join("");
  }
  refs.dayModal.showModal();
}

function quickCreateFromWeekSlot(dateIso, hour) {
  state.activeView = "month";
  state.selectedDate = dateIso;
  syncViewState();
  seedEmptyInputForm({
    date: dateIso,
    startTime: `${hour}:00`,
    endTime: `${String(Number(hour) + 1).padStart(2, "0")}:00`,
    allDay: false,
  });
  refs.eventTitle.focus();
  setStatus(`已在表单中预填 ${dateIso} ${hour}:00 的时间段。`);
}

function quickCreateAllDay(dateIso) {
  state.activeView = "month";
  state.selectedDate = dateIso;
  syncViewState();
  seedEmptyInputForm({
    date: dateIso,
    allDay: true,
    startTime: "",
    endTime: "",
  });
  refs.eventTitle.focus();
  setStatus(`已在表单中预填 ${dateIso} 的全天/未定时事项。`);
}

function collectEventFormData() {
  return {
    id: refs.eventId.value,
    title: refs.eventTitle.value,
    date: refs.eventDate.value || state.selectedDate,
    allDay: refs.eventAllDay.value === "true",
    startTime: refs.eventStartTime.value,
    endTime: refs.eventEndTime.value,
    location: refs.eventLocation.value,
    notes: refs.eventNotes.value,
    rawInput: refs.eventRawInput.value,
    sourceType: "manual_ui",
  };
}

function collectTodoFormData() {
  return {
    id: refs.todoId.value,
    title: refs.todoTitle.value,
    notes: refs.todoNotes.value,
    priority: refs.todoPriority.value,
    rawInput: refs.todoRawInput.value,
    sourceType: "manual_ui",
  };
}

function createEventFromDraft(draft) {
  createEventFromForm({
    id: "",
    title: draft.proposedTitle || "未命名事项",
    date: draft.proposedDate || isoDate(new Date()),
    allDay: draft.allDay,
    startTime: draft.proposedStartTime || "",
    endTime: draft.proposedEndTime || "",
    location: draft.proposedLocation || "",
    notes: draft.proposedNotes || "",
    rawInput: draft.rawText,
    sourceType: "chat_draft",
  }, {
    rawInputCapturedAt: draft.createdAt,
    parseMetadata: { draftId: draft.id, confidence: draft.confidence, ambiguities: draft.ambiguities },
  });
}

function createTodoFromDraft(draft) {
  createTodoFromForm({
    id: "",
    title: draft.proposedTitle || "未命名待办",
    notes: draft.proposedNotes || "",
    priority: draft.priority || "normal",
    rawInput: draft.rawText,
    sourceType: "chat_draft",
  }, {
    rawInputCapturedAt: draft.createdAt,
    parseMetadata: { draftId: draft.id, confidence: draft.confidence, ambiguities: draft.ambiguities },
  });
}

function createEventFromForm(payload, options = {}) {
  const now = new Date().toISOString();
  const eventId = createId("evt");
  const rawInputId = createId("raw");
  const event = {
    id: eventId,
    recordType: "event",
    createdAt: now,
    updatedAt: now,
    version: 1,
    status: "active",
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    allDay: payload.allDay,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    title: payload.title.trim(),
    notes: payload.notes.trim(),
    location: payload.location.trim(),
    sourceType: payload.sourceType || "manual_ui",
    rawInputId,
    currentInferenceId: null,
    searchDoc: buildSearchDoc(payload, "event"),
    metadata: options.parseMetadata || null,
  };
  state.db.events.unshift(event);
  state.db.rawInputs.unshift(buildRawInput(rawInputId, eventId, payload.rawInput, payload.title, options.rawInputCapturedAt || now));
  saveSnapshot(event, "created");
  state.editingEventId = eventId;
  state.editingTodoId = null;
  seedEmptyInputForm({ ...payload, id: eventId });
}

function createTodoFromForm(payload, options = {}) {
  const now = new Date().toISOString();
  const todoId = createId("todo");
  const rawInputId = createId("raw");
  const todo = {
    id: todoId,
    recordType: "todo",
    createdAt: now,
    updatedAt: now,
    version: 1,
    status: "active",
    title: payload.title.trim(),
    notes: payload.notes.trim(),
    priority: payload.priority,
    sourceType: payload.sourceType || "manual_ui",
    rawInputId,
    searchDoc: buildSearchDoc(payload, "todo"),
    metadata: options.parseMetadata || null,
  };
  state.db.todos.unshift(todo);
  state.db.rawInputs.unshift(buildRawInput(rawInputId, todoId, payload.rawInput, payload.title, options.rawInputCapturedAt || now));
  saveSnapshot(todo, "created");
  state.editingTodoId = todoId;
  state.editingEventId = null;
  seedEmptyTodoForm({ ...payload, id: todoId });
}

function updateExistingEvent(payload) {
  const event = state.db.events.find((item) => item.id === payload.id);
  if (!event) return;
  saveSnapshot(event, "before_update");
  const oldFields = { title: event.title, date: event.date, startTime: event.startTime, endTime: event.endTime, allDay: event.allDay, location: event.location, notes: event.notes };
  event.title = payload.title.trim();
  event.date = payload.date;
  event.startTime = payload.startTime;
  event.endTime = payload.endTime;
  event.allDay = payload.allDay;
  event.location = payload.location.trim();
  event.notes = payload.notes.trim();
  event.updatedAt = new Date().toISOString();
  event.version += 1;
  event.searchDoc = buildSearchDoc(payload, "event");
  Object.entries(oldFields).forEach(([field, oldValue]) => {
    const newValue = event[field];
    if (String(oldValue ?? "") !== String(newValue ?? "")) {
      logChange(event.id, field, oldValue, newValue, "manual_ui");
    }
  });
  if (payload.rawInput.trim()) {
    state.db.rawInputs.unshift(buildRawInput(createId("raw"), event.id, payload.rawInput, payload.title, new Date().toISOString()));
  }
  state.editingEventId = event.id;
  state.editingTodoId = null;
}

function updateExistingTodo(payload) {
  const todo = state.db.todos.find((item) => item.id === payload.id);
  if (!todo) return;
  saveSnapshot(todo, "before_update");
  const oldFields = { title: todo.title, notes: todo.notes, priority: todo.priority };
  todo.title = payload.title.trim();
  todo.notes = payload.notes.trim();
  todo.priority = payload.priority;
  todo.updatedAt = new Date().toISOString();
  todo.version += 1;
  todo.searchDoc = buildSearchDoc(payload, "todo");
  Object.entries(oldFields).forEach(([field, oldValue]) => {
    const newValue = todo[field];
    if (String(oldValue ?? "") !== String(newValue ?? "")) {
      logChange(todo.id, field, oldValue, newValue, "manual_ui");
    }
  });
  if (payload.rawInput.trim()) {
    state.db.rawInputs.unshift(buildRawInput(createId("raw"), todo.id, payload.rawInput, payload.title, new Date().toISOString()));
  }
  state.editingTodoId = todo.id;
  state.editingEventId = null;
}

function loadEventIntoForm(eventId) {
  const event = state.db.events.find((item) => item.id === eventId);
  if (!event) return;
  const latestRaw = state.db.rawInputs.find((item) => item.recordId === event.id);
  state.editingEventId = event.id;
  state.editingTodoId = null;
  seedEmptyInputForm({
    id: event.id,
    title: event.title,
    date: event.date,
    allDay: event.allDay,
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location,
    notes: event.notes,
    rawInput: latestRaw?.inputText || "",
  });
  renderTracePanel();
}

function loadTodoIntoForm(todoId) {
  const todo = state.db.todos.find((item) => item.id === todoId);
  if (!todo) return;
  const latestRaw = state.db.rawInputs.find((item) => item.recordId === todo.id);
  state.editingTodoId = todo.id;
  state.editingEventId = null;
  seedEmptyTodoForm({
    id: todo.id,
    title: todo.title,
    notes: todo.notes,
    priority: todo.priority,
    rawInput: latestRaw?.inputText || "",
  });
  renderTracePanel();
}

function buildRawInput(rawInputId, recordId, rawInput, title, capturedAt) {
  return {
    id: rawInputId,
    recordId,
    inputText: rawInput?.trim() || title.trim(),
    inputFormat: rawInput?.trim() ? "manual_text" : "form_compose",
    inputLanguage: "zh-CN",
    capturedAt,
    parseStatus: "parsed",
    parseError: null,
    userConfirmed: true,
  };
}

function parseNaturalLanguage(text) {
  const now = new Date();
  return text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parsedDate = extractDate(line, now);
    const parsedTime = extractTimeRange(line);
    const locationMatch = line.match(/(?:在|去|到)([A-Za-z0-9\u4e00-\u9fa5\- ]{1,20}(?:教室|楼|馆|室|区|厅|实验室|图书馆|操场|105|205|305)?)/);
    const ambiguities = [];
    if (!parsedDate && !looksLikeTodo(line)) ambiguities.push("日期未完全识别");
    if (!parsedTime.startTime && !line.includes("全天") && !looksLikeTodo(line)) ambiguities.push("时间未完全识别");

    if (looksLikeTodo(line)) {
      return {
        id: createId("draft"),
        createdAt: new Date().toISOString(),
        status: "pending",
        recordType: "todo",
        rawText: line,
        proposedTitle: line,
        proposedDate: "",
        proposedStartTime: "",
        proposedEndTime: "",
        proposedLocation: "",
        proposedNotes: "",
        allDay: false,
        priority: inferTodoPriority(line),
        confidence: 0.72,
        ambiguities: ["更像待办而不是固定时段日程"],
      };
    }

    const cleanedTitle = line
      .replace(/明天|今天|后天|周[一二三四五六日天]|下周[一二三四五六日天]?|本周[一二三四五六日天]?|今晚|下午|上午|中午|傍晚|晚上|早上/g, "")
      .replace(/\d{1,2}[:点：]\d{0,2}(?:\s*(?:到|至|-|~)\s*\d{1,2}[:点：]?\d{0,2})?/g, "")
      .replace(/(?:在|去|到)[A-Za-z0-9\u4e00-\u9fa5\- ]{1,20}(?:教室|楼|馆|室|区|厅|实验室|图书馆|操场|105|205|305)?/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return {
      id: createId("draft"),
      createdAt: new Date().toISOString(),
      status: "pending",
      recordType: "event",
      rawText: line,
      proposedTitle: cleanedTitle || line,
      proposedDate: parsedDate ? isoDate(parsedDate) : isoDate(now),
      proposedStartTime: parsedTime.startTime,
      proposedEndTime: parsedTime.endTime,
      proposedLocation: locationMatch?.[1]?.trim() || "",
      proposedNotes: "",
      allDay: !parsedTime.startTime,
      confidence: inferConfidence(parsedDate, parsedTime, locationMatch),
      ambiguities,
    };
  });
}

async function parseNaturalLanguageWithLlm(text) {
  const settings = state.db.settings;
  if (!settings.apiKey) {
    throw new Error("当前解析模式是大模型 API，但还没有填写 API Key。");
  }
  const now = new Date();
  const todayIso = isoDate(now);
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
    throw new Error(`请求未发出成功。当前接口地址是 ${endpoint}。原始错误：${error instanceof Error ? error.message : String(error)}`);
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
    id: createId("draft"),
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

function localSearch(query) {
  const terms = uniqueTerms(query.toLowerCase());
  const records = [
    ...state.db.events.filter((item) => item.status === "active").map((item) => ({ ...item, searchType: "event" })),
    ...state.db.todos.filter((item) => item.status === "active").map((item) => ({ ...item, searchType: "todo" })),
  ];
  return records
    .map((record) => {
      const haystack = `${record.title} ${record.notes || ""} ${record.location || ""} ${record.searchDoc?.fullText || ""}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { record, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function buildSearchSummary(results, query) {
  if (!results.length) {
    return `没有找到与“${query}”明显匹配的事项或待办。`;
  }
  const lines = results.map(({ record, score }) => {
    if (record.searchType === "todo") {
      return `待办 | ${record.title} | 优先级:${record.priority} | 匹配分:${score}`;
    }
    return `日程 | ${record.date} ${record.allDay ? "全天/未定时" : `${record.startTime || "未定"}-${record.endTime || "未定"}`} | ${record.title} | 匹配分:${score}`;
  });
  return `围绕“${query}”检索到 ${results.length} 条候选：\n${lines.join("\n")}`;
}

async function summarizeSearchWithLlm(query, results) {
  const settings = state.db.settings;
  const endpoint = buildChatCompletionsEndpoint(settings.apiBaseUrl);
  const candidates = results.map(({ record }) => ({
    type: record.searchType,
    title: record.title,
    date: record.date || null,
    time: record.startTime ? `${record.startTime}-${record.endTime || ""}` : null,
    notes: record.notes || "",
    location: record.location || "",
    priority: record.priority || null,
  }));
  const response = await fetch(endpoint, {
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
  if (!response.ok) {
    throw new Error(`模型检索总结失败：${response.status}`);
  }
  const json = await response.json();
  return json.choices?.[0]?.message?.content || buildSearchSummary(results, query);
}

function buildSearchDoc(payload, type) {
  const compactText = type === "todo"
    ? [payload.title || "", payload.notes || "", payload.rawInput || "", payload.priority || ""].filter(Boolean).join("；")
    : [payload.date || "", payload.allDay ? "全天/未定时" : `${payload.startTime || "未定"}-${payload.endTime || "未定"}`, payload.title || "", payload.location || "", payload.notes || "", payload.rawInput || ""].filter(Boolean).join("；");
  return {
    compactText,
    fullText: compactText,
    keywords: uniqueTerms(compactText),
  };
}

function saveSnapshot(record, snapshotType) {
  state.db.snapshots.unshift({
    id: createId("snap"),
    recordId: record.id,
    snapshotType,
    payload: cloneValue(record),
    savedAt: new Date().toISOString(),
    savedBy: "system",
  });
}

function logChange(recordId, field, oldValue, newValue, changedBy) {
  state.db.changeLog.unshift({
    id: createId("chg"),
    recordId,
    field,
    oldValue,
    newValue,
    changedBy,
    changedAt: new Date().toISOString(),
  });
}

function getEventsForDate(dateIso) {
  return state.db.events
    .filter((event) => event.status === "active" && event.date === dateIso)
    .sort((a, b) => {
      if (!a.startTime && b.startTime) return -1;
      if (a.startTime && !b.startTime) return 1;
      return (a.startTime || "99:99").localeCompare(b.startTime || "99:99");
    });
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createEmptyState();
  try {
    return normalizeImportedState(JSON.parse(raw));
  } catch {
    return createEmptyState();
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.db));
}

function createEmptyState() {
  return {
    version: 2,
    events: [],
    todos: [],
    rawInputs: [],
    drafts: [],
    snapshots: [],
    changeLog: [],
    chatMessages: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function normalizeImportedState(data) {
  return {
    version: 2,
    events: Array.isArray(data.events) ? data.events.map((item) => ({ ...item, recordType: "event" })) : [],
    todos: Array.isArray(data.todos) ? data.todos.map((item) => ({ ...item, recordType: "todo" })) : [],
    rawInputs: Array.isArray(data.rawInputs) ? data.rawInputs.map((item) => ({ ...item, recordId: item.recordId || item.eventId || item.todoId })) : [],
    drafts: Array.isArray(data.drafts) ? data.drafts : [],
    snapshots: Array.isArray(data.snapshots) ? data.snapshots.map((item) => ({ ...item, recordId: item.recordId || item.eventId || item.todoId })) : [],
    changeLog: Array.isArray(data.changeLog) ? data.changeLog.map((item) => ({ ...item, recordId: item.recordId || item.eventId || item.todoId })) : [],
    chatMessages: Array.isArray(data.chatMessages) ? data.chatMessages : [],
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
  };
}

function seedDemoData() {
  if (state.db.events.length > 0 || state.db.todos.length > 0) {
    setStatus("当前已有数据，若想体验示例可以先导出后再清空本地存储。");
    return;
  }
  createEventFromForm({
    title: "高数课",
    date: isoDate(new Date()),
    allDay: false,
    startTime: "14:00",
    endTime: "16:00",
    location: "105",
    notes: "课堂讲概率论，记得带作业。",
    rawInput: "今天下午2点到4点去105上高数课，记得带作业",
    sourceType: "manual_seed",
  });
  createEventFromForm({
    title: "组会讨论比赛报名",
    date: isoDate(addDays(new Date(), 2)),
    allDay: false,
    startTime: "18:30",
    endTime: "20:00",
    location: "图书馆 302",
    notes: "确认报名材料和分工。",
    rawInput: "周三晚上18:30和组员在图书馆302讨论比赛报名",
    sourceType: "manual_seed",
  });
  createTodoFromForm({
    title: "整理综测证明材料",
    notes: "包括讲座截图、志愿活动照片和报名回执。",
    priority: "high",
    rawInput: "有空的时候整理综测证明材料",
    sourceType: "manual_seed",
  });
  persistState();
  render();
  setStatus("示例数据已载入。");
}

function setStatus(message) {
  refs.statusLine.textContent = message;
}

function formatEventChip(event) {
  return `${event.startTime || "全天"} ${event.title}`;
}

function formatMonthLabel(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function formatWeekdayHeader(date) {
  return `${WEEKDAY_LABELS[(date.getDay() + 6) % 7]}\n${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDateTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function isoDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function parseDate(dateIso) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function extractDate(line, now) {
  if (line.includes("今天")) return now;
  if (line.includes("明天")) return addDays(now, 1);
  if (line.includes("后天")) return addDays(now, 2);
  const weekdayMatch = line.match(/(本周|下周)?周([一二三四五六日天])/);
  if (weekdayMatch) {
    const offset = weekdayToIndex(weekdayMatch[2]);
    const start = startOfWeek(weekdayMatch[1] === "下周" ? addDays(now, 7) : now);
    return addDays(start, offset);
  }
  const explicitDate = line.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (explicitDate) {
    return new Date(now.getFullYear(), Number(explicitDate[1]) - 1, Number(explicitDate[2]));
  }
  return null;
}

function extractTimeRange(line) {
  const period = detectPeriod(line);
  const rangeMatch = line.match(/(\d{1,2})(?:[:点：](\d{1,2}))?\s*(?:到|至|-|~)\s*(\d{1,2})(?:[:点：](\d{1,2}))?/);
  if (rangeMatch) {
    return {
      startTime: normalizeTime(applyPeriodToHour(Number(rangeMatch[1]), period), rangeMatch[2]),
      endTime: normalizeTime(applyPeriodToHour(Number(rangeMatch[3]), period), rangeMatch[4]),
    };
  }
  const singleMatch = line.match(/(\d{1,2})(?:[:点：](\d{1,2}))?/);
  if (singleMatch) {
    const startHour = applyPeriodToHour(Number(singleMatch[1]), period);
    return {
      startTime: normalizeTime(startHour, singleMatch[2]),
      endTime: normalizeTime(Math.min(startHour + 1, 23), singleMatch[2] || "00"),
    };
  }
  if (line.includes("下午") && !line.match(/\d{1,2}/)) return { startTime: "14:00", endTime: "16:00" };
  return { startTime: "", endTime: "" };
}

function detectPeriod(line) {
  if (line.includes("下午") || line.includes("晚上") || line.includes("傍晚") || line.includes("今晚")) return "pm";
  if (line.includes("中午")) return "noon";
  if (line.includes("上午") || line.includes("早上")) return "am";
  return "unknown";
}

function applyPeriodToHour(hour, period) {
  if (period === "pm" && hour < 12) return hour + 12;
  if (period === "noon" && hour < 11) return hour + 12;
  if (period === "am" && hour === 12) return 0;
  return hour;
}

function inferConfidence(parsedDate, parsedTime, locationMatch) {
  let confidence = 0.45;
  if (parsedDate) confidence += 0.2;
  if (parsedTime.startTime) confidence += 0.2;
  if (locationMatch) confidence += 0.1;
  return Math.min(confidence, 0.95);
}

function looksLikeTodo(line) {
  return /(有空|之后|记得|待办|需要|整理|准备|查一下|看看|处理一下|补充|完善)/.test(line) && !/(今天|明天|后天|周[一二三四五六日天]|\d{1,2}[:点：]\d{0,2})/.test(line);
}

function inferTodoPriority(line) {
  if (/(尽快|马上|尽早|重要)/.test(line)) return "high";
  if (/(以后|有空|顺手)/.test(line)) return "low";
  return "normal";
}

function normalizeTime(hour, minute = "00") {
  return `${String(Number(hour)).padStart(2, "0")}:${String(Number(minute)).padStart(2, "0")}`;
}

function buildChatCompletionsEndpoint(baseUrl) {
  const normalized = String(baseUrl || "").trim();
  if (!normalized) throw new Error("请先填写 API Base URL。");
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`API Base URL 不合法：${normalized}`);
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) return url.toString();
  if (pathname.endsWith("/v1")) {
    url.pathname = `${pathname}/chat/completions`;
    return url.toString();
  }
  if (pathname === "" || pathname === "/") {
    url.pathname = "/v1/chat/completions";
    return url.toString();
  }
  url.pathname = `${pathname}/chat/completions`;
  return url.toString();
}

function normalizeDraftDate(value, fallbackDate) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallbackDate;
}

function normalizeDraftTime(value) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : "";
}

function normalizeDraftConfidence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.6;
}

function weekdayToIndex(weekday) {
  return { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }[weekday];
}

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function uniqueTerms(text) {
  return Array.from(new Set(String(text).toLowerCase().split(/[\s，。；、,.:\n]+/).filter(Boolean)));
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
