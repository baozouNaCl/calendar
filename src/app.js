const STORAGE_KEY = "chronicle-calendar-v1";
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const DAY_SLOT_MINUTES = 30;
const WEEK_HOUR_HEIGHT = 48;
const DAY_HOUR_HEIGHT = 24;
const VIEW_SEQUENCE = ["day", "month", "week", "todo"];
const TEST_IMPORT_TAG = "test";
const TEST_IMPORT_COLOR = "#9f1239";
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
  activeTagFilter: "",
  editingEventId: null,
  editingTodoId: null,
  dayDrag: null,
  sidebarWidth: 360,
  viewSwipe: { accumulator: 0, lastAt: 0 },
};

const refs = {
  sidebarHandle: document.querySelector("#sidebar-resize-handle"),
  sidebar: document.querySelector(".sidebar"),
  workspaceFrame: document.querySelector("#workspace-frame"),
  topViewNav: document.querySelector("#top-view-nav"),
  tagFilterSelect: document.querySelector("#tag-filter-select"),
  dayView: document.querySelector("#day-view"),
  dayLabel: document.querySelector("#day-label"),
  dayColumnLabel: document.querySelector("#day-column-label"),
  dayTimeLabels: document.querySelector("#day-time-labels"),
  dayGridSurface: document.querySelector("#day-grid-surface"),
  dayAllDayStrip: document.querySelector("#day-all-day-strip"),
  monthLabel: document.querySelector("#month-label"),
  selectedDateLabel: document.querySelector("#selected-date-label"),
  calendarWeekdays: document.querySelector("#calendar-weekdays"),
  calendarGrid: document.querySelector("#calendar-grid"),
  dailyEventList: document.querySelector("#daily-event-list"),
  tracePanel: document.querySelector("#trace-panel"),
  selectedDaySummary: document.querySelector("#selected-day-summary"),
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
  eventTags: document.querySelector("#event-tags"),
  eventTagColor: document.querySelector("#event-tag-color"),
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
  todoTags: document.querySelector("#todo-tags"),
  todoTagColor: document.querySelector("#todo-tag-color"),
  todoList: document.querySelector("#todo-list"),
  todoCount: document.querySelector("#todo-count"),
  chatHistory: document.querySelector("#chat-history"),
  chatInput: document.querySelector("#chat-input"),
  chatIntent: document.querySelector("#chat-intent"),
  dayModal: document.querySelector("#day-modal"),
  dayModalTitle: document.querySelector("#day-modal-title"),
  dayModalContent: document.querySelector("#day-modal-content"),
  eventEditorModal: document.querySelector("#event-editor-modal"),
  eventEditorTitle: document.querySelector("#event-editor-title"),
  eventAiInput: document.querySelector("#event-ai-input"),
  settingsModal: document.querySelector("#settings-modal"),
  dataModal: document.querySelector("#data-modal"),
  importConfigModal: document.querySelector("#import-config-modal"),
  importConfigFileName: document.querySelector("#import-config-file-name"),
  importTagInput: document.querySelector("#import-tag-input"),
  importTagColor: document.querySelector("#import-tag-color"),
};

init();

function init() {
  applySidebarWidth(state.sidebarWidth);
  renderWeekdays();
  renderTagFilterOptions();
  bindEvents();
  seedSettingsForm();
  seedEmptyInputForm();
  seedEmptyTodoForm();
  render();
}

function bindEvents() {
  refs.sidebarHandle.addEventListener("mousedown", beginSidebarResize);
  refs.chatInput.addEventListener("focus", () => expandSidebarForAi());
  refs.eventAiInput.addEventListener("focus", () => expandSidebarForAi());
  refs.topViewNav.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      refs.topViewNav.scrollLeft += event.deltaY;
      event.preventDefault();
    }
  }, { passive: false });
  refs.tagFilterSelect?.addEventListener("change", () => {
    state.activeTagFilter = refs.tagFilterSelect.value;
    render();
  });
  document.querySelector("#clear-tag-filter-btn")?.addEventListener("click", () => {
    state.activeTagFilter = "";
    if (refs.tagFilterSelect) refs.tagFilterSelect.value = "";
    render();
  });
  refs.workspaceFrame.addEventListener("wheel", handleViewWheelSwitch, { passive: false });

  document.querySelector("#prev-day-btn").addEventListener("click", () => {
    state.selectedDate = isoDate(addDays(parseDate(state.selectedDate), -1));
    state.visibleWeek = startOfWeek(parseDate(state.selectedDate));
    state.visibleMonth = startOfMonth(parseDate(state.selectedDate));
    render();
  });
  document.querySelector("#next-day-btn").addEventListener("click", () => {
    state.selectedDate = isoDate(addDays(parseDate(state.selectedDate), 1));
    state.visibleWeek = startOfWeek(parseDate(state.selectedDate));
    state.visibleMonth = startOfMonth(parseDate(state.selectedDate));
    render();
  });
  document.querySelector("#current-day-btn").addEventListener("click", () => {
    const today = new Date();
    state.selectedDate = isoDate(today);
    state.visibleWeek = startOfWeek(today);
    state.visibleMonth = startOfMonth(today);
    render();
  });

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
  document.querySelector("#open-event-editor-btn").addEventListener("click", () => {
    state.editingEventId = null;
    seedEmptyInputForm({ date: state.selectedDate });
    openEventEditor("新建日程");
  });
  document.querySelector("#close-event-editor-btn").addEventListener("click", () => refs.eventEditorModal.close());
  document.querySelector("#event-ai-apply-btn").addEventListener("click", handleEventAiAssist);
  document.querySelector("#open-settings-btn").addEventListener("click", () => refs.settingsModal.showModal());
  document.querySelector("#open-data-btn").addEventListener("click", () => refs.dataModal.showModal());
  document.querySelector("#close-settings-btn").addEventListener("click", () => refs.settingsModal.close());
  document.querySelector("#close-data-btn").addEventListener("click", () => refs.dataModal.close());
  document.querySelector("#close-import-config-btn").addEventListener("click", closeImportConfigModal);
  document.querySelector("#cancel-import-btn").addEventListener("click", closeImportConfigModal);
  document.querySelector("#confirm-import-btn").addEventListener("click", handleConfirmImport);

  refs.eventForm.addEventListener("submit", handleSaveEvent);
  document.querySelector("#delete-event-btn").addEventListener("click", handleDeleteEvent);
  document.querySelector("#reset-form-btn").addEventListener("click", () => {
    state.editingEventId = null;
    seedEmptyInputForm({ date: state.selectedDate });
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
  renderTagFilterOptions();
  renderDayView();
  renderCalendar();
  renderWeekView();
  renderSelectedDaySummary();
  renderDailyEvents();
  renderDrafts();
  renderTracePanel();
  renderTodos();
  renderChatHistory();
  updateSelectedDateLabel();
}

function syncViewState() {
  refs.viewButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.viewTarget === state.activeView));
  refs.dayView.classList.toggle("is-hidden", state.activeView !== "day");
  refs.monthView.classList.toggle("is-hidden", state.activeView !== "month");
  refs.weekView.classList.toggle("is-hidden", state.activeView !== "week");
  refs.todoView.classList.toggle("is-hidden", state.activeView !== "todo");
}

function beginSidebarResize(event) {
  const startX = event.clientX;
  const startWidth = state.sidebarWidth;
  document.body.classList.add("is-resizing");
  const handleMove = (moveEvent) => {
    applySidebarWidth(startWidth + (moveEvent.clientX - startX));
  };
  const handleUp = () => {
    document.body.classList.remove("is-resizing");
    document.removeEventListener("mousemove", handleMove);
    document.removeEventListener("mouseup", handleUp);
  };
  document.addEventListener("mousemove", handleMove);
  document.addEventListener("mouseup", handleUp);
}

function applySidebarWidth(width) {
  const next = Math.max(300, Math.min(560, Math.round(width)));
  state.sidebarWidth = next;
  document.documentElement.style.setProperty("--sidebar-width", `${next}px`);
}

function expandSidebarForAi() {
  if (state.sidebarWidth < 420) {
    applySidebarWidth(440);
  }
}

function handleViewWheelSwitch(event) {
  const interactive = event.target.closest("input, textarea, select, dialog");
  if (interactive) return;
  if (event.target.closest("#top-view-nav")) return;
  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);
  if (absX < 6) return;
  if (absX < absY * 0.66) return;
  const currentIndex = VIEW_SEQUENCE.indexOf(state.activeView);
  if (currentIndex === -1) return;
  const now = Date.now();
  if (now - state.viewSwipe.lastAt > 220) {
    state.viewSwipe.accumulator = 0;
  }
  state.viewSwipe.accumulator += event.deltaX;
  if (Math.abs(state.viewSwipe.accumulator) < 95) {
    event.preventDefault();
    return;
  }
  if (now - state.viewSwipe.lastAt < 420) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  const direction = state.viewSwipe.accumulator > 0 ? 1 : -1;
  const nextIndex = Math.max(0, Math.min(VIEW_SEQUENCE.length - 1, currentIndex + direction));
  if (nextIndex !== currentIndex) {
    state.activeView = VIEW_SEQUENCE[nextIndex];
    render();
  }
  state.viewSwipe.accumulator = 0;
  state.viewSwipe.lastAt = now;
}

function renderDayView() {
  const selected = parseDate(state.selectedDate);
  refs.dayLabel.textContent = formatDayLabel(selected);
  refs.dayColumnLabel.textContent = `${WEEKDAY_LABELS[(selected.getDay() + 6) % 7]} · ${selected.getMonth() + 1}/${selected.getDate()}`;
  renderDayTimeLabels();

  const events = getEventsForDate(state.selectedDate);
  const allDayEvents = events.filter((event) => event.allDay || !event.startTime);
  refs.dayAllDayStrip.innerHTML = allDayEvents.length
    ? allDayEvents.map((event) => `<button class="day-all-day-chip" data-day-event-id="${event.id}" type="button">${escapeHtml(event.title)}</button>`).join("")
    : `<button class="ghost-btn" id="day-all-day-create-btn" type="button">添加全天事项</button>`;

  const timedEvents = events.filter((event) => event.startTime && !event.allDay);
  const selectionMarkup = state.dayDrag && state.dayDrag.scope !== "week" && state.dayDrag.dateIso === state.selectedDate
    ? renderDaySelectionPreview(state.dayDrag.startMinutes, state.dayDrag.endMinutes)
    : "";

  refs.dayGridSurface.classList.toggle("is-dragging", state.dayDrag?.scope === "day");
  refs.dayGridSurface.innerHTML = `
    ${!timedEvents.length && !selectionMarkup ? `<div class="day-empty-hint">在右侧时间轴拖拽，即可直接创建一段日程。</div>` : ""}
    ${timedEvents.map((event) => renderDayEventBlock(event)).join("")}
    ${selectionMarkup}
  `;

  refs.dayAllDayStrip.querySelectorAll("[data-day-event-id]").forEach((button) => {
    button.addEventListener("click", () => {
      loadEventIntoForm(button.dataset.dayEventId);
    });
  });
  const createAllDayButton = document.querySelector("#day-all-day-create-btn");
  if (createAllDayButton) {
    createAllDayButton.addEventListener("click", () => quickCreateAllDay(state.selectedDate));
  }

  refs.dayGridSurface.querySelectorAll("[data-day-event-id]").forEach((block) => {
    block.addEventListener("click", (event) => {
      event.stopPropagation();
      loadEventIntoForm(block.dataset.dayEventId);
    });
  });

  refs.dayGridSurface.onmousedown = (event) => beginDayDrag(event);
}

function renderDayTimeLabels() {
  const totalHours = DAY_END_HOUR - DAY_START_HOUR;
  refs.dayTimeLabels.innerHTML = Array.from({ length: totalHours + 1 }, (_, index) => {
    const hour = DAY_START_HOUR + index;
    return `
      <div class="day-time-marker" style="top:${index * DAY_HOUR_HEIGHT}px;">
        <span>${String(hour).padStart(2, "0")}:00</span>
      </div>
    `;
  }).join("");
}

function renderDayEventBlock(event) {
  const startMinutes = timeToMinutes(event.startTime);
  const endMinutes = event.endTime ? timeToMinutes(event.endTime) : startMinutes + 60;
  const safeEnd = Math.max(endMinutes, startMinutes + 30);
  const top = minutesToOffset(startMinutes, DAY_HOUR_HEIGHT);
  const height = Math.max(minutesToOffset(safeEnd, DAY_HOUR_HEIGHT) - top, 28);
  return `
    <article class="day-event-block" data-day-event-id="${event.id}" style="top:${top}px;height:${height}px;">
      <h3>${escapeHtml(event.title)}</h3>
      <p>${escapeHtml(event.startTime)} - ${escapeHtml(event.endTime || "未定")}${event.location ? ` · ${escapeHtml(event.location)}` : ""}</p>
    </article>
  `;
}

function renderDaySelectionPreview(startMinutes, endMinutes) {
  const start = Math.min(startMinutes, endMinutes);
  const end = Math.max(startMinutes, endMinutes);
  const top = minutesToOffset(start, DAY_HOUR_HEIGHT);
  const height = Math.max(minutesToOffset(end, DAY_HOUR_HEIGHT) - top, 24);
  return `
    <div class="day-selection-preview" style="top:${top}px;height:${height}px;">
      ${formatMinutes(start)} - ${formatMinutes(end)}
    </div>
  `;
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
  const timedEvents = weekDays.flatMap((day) => getEventsForDate(isoDate(day)).filter((event) => event.startTime && !event.allDay));
  const selectionMarkup = state.dayDrag && state.dayDrag.scope === "week"
    ? renderWeekSelectionPreview(weekDays, state.dayDrag.dateIso, state.dayDrag.startMinutes, state.dayDrag.endMinutes)
    : "";

  refs.weekGrid.innerHTML = `
    <div class="week-board">
      <div class="week-header-row">
        <div class="week-corner"></div>
        ${weekDays.map((day) => `<div class="week-header-cell">${formatWeekdayHeader(day)}</div>`).join("")}
      </div>
      <div class="week-all-day-row">
        <div class="week-all-day-title">全天</div>
        ${weekDays.map((day) => renderWeekAllDayCell(isoDate(day))).join("")}
      </div>
      <div class="week-timeline-shell">
        <div class="week-time-labels">${renderWeekTimeLabels()}</div>
        <div id="week-grid-surface" class="week-grid-surface ${state.dayDrag && state.dayDrag.scope === "week" ? "is-dragging" : ""}">
          ${weekDays.map((_, index) => `<div class="week-column-guide" style="left:${(index / 7) * 100}%;"></div>`).join("")}
          ${renderWeekEventBlocks(weekDays)}
          ${selectionMarkup}
          ${!timedEvents.length && !selectionMarkup ? `<div class="week-empty-hint">在任意日期列内拖拽即可创建一段日程。</div>` : ""}
        </div>
      </div>
    </div>
  `;

  refs.weekGrid.querySelectorAll(".week-all-day-cell").forEach((slot) => {
    slot.addEventListener("click", () => quickCreateAllDay(slot.dataset.date));
  });

  refs.weekGrid.querySelectorAll("[data-week-event-id]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      loadEventIntoForm(node.dataset.weekEventId);
    });
  });

  const weekSurface = refs.weekGrid.querySelector("#week-grid-surface");
  weekSurface.onmousedown = (event) => beginWeekDrag(event, weekDays);
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

function renderWeekTimeLabels() {
  const totalHours = DAY_END_HOUR - DAY_START_HOUR;
  return Array.from({ length: totalHours + 1 }, (_, index) => {
    const hour = DAY_START_HOUR + index;
    return `
      <div class="week-time-marker" style="top:${index * WEEK_HOUR_HEIGHT}px;">
        <span>${String(hour).padStart(2, "0")}:00</span>
      </div>
    `;
  }).join("");
}

function renderWeekEventBlocks(weekDays) {
  return weekDays.map((day, index) => {
    const dayIso = isoDate(day);
    const timedEvents = getEventsForDate(dayIso).filter((event) => event.startTime && !event.allDay);
    return timedEvents.map((event) => renderWeekEventBlock(event, index)).join("");
  }).join("");
}

function renderWeekEventBlock(event, dayIndex) {
  const startMinutes = timeToMinutes(event.startTime);
  const endMinutes = event.endTime ? timeToMinutes(event.endTime) : startMinutes + 60;
  const safeEnd = Math.max(endMinutes, startMinutes + 30);
  const top = minutesToOffset(startMinutes, WEEK_HOUR_HEIGHT);
  const height = Math.max(minutesToOffset(safeEnd, WEEK_HOUR_HEIGHT) - top, 36);
  const widthPercent = 100 / 7;
  return `
    <article class="week-event-block" data-week-event-id="${event.id}" style="left:calc(${dayIndex * widthPercent}% + 10px);width:calc(${widthPercent}% - 20px);top:${top}px;height:${height}px;">
      <h3>${escapeHtml(event.title)}</h3>
      <p>${escapeHtml(event.startTime)} - ${escapeHtml(event.endTime || "未定")}</p>
    </article>
  `;
}

function renderWeekSelectionPreview(weekDays, dateIso, startMinutes, endMinutes) {
  const dayIndex = weekDays.findIndex((day) => isoDate(day) === dateIso);
  if (dayIndex < 0) return "";
  const start = Math.min(startMinutes, endMinutes);
  const end = Math.max(startMinutes, endMinutes);
  const top = minutesToOffset(start, WEEK_HOUR_HEIGHT);
  const height = Math.max(minutesToOffset(end, WEEK_HOUR_HEIGHT) - top, 24);
  const widthPercent = 100 / 7;
  return `
    <article class="week-selection-preview" style="left:calc(${dayIndex * widthPercent}% + 10px);width:calc(${widthPercent}% - 20px);top:${top}px;height:${height}px;">
      <h3>${escapeHtml(dateIso)}</h3>
      <p>${formatMinutes(start)} - ${formatMinutes(end)}</p>
    </article>
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
      ${renderTagRow(event.tags, event.tagColor)}
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
  const event = getRecordById(state.editingEventId);
  const todo = getRecordById(state.editingTodoId);
  const target = event || todo;
  if (!target) {
    refs.tracePanel.className = "trace-panel empty-state";
    refs.tracePanel.textContent = "选中一条事项或待办后，这里会显示原始输入、快照和变更记录。";
    return;
  }

  const rawInputs = getRawInputsForRecord(target.id);
  const traceLogs = getTraceLogsForRecord(target.id);
  const snapshots = traceLogs.filter((item) => item.traceType === "snapshot");
  const changes = traceLogs.filter((item) => item.traceType === "field_change");
  const searchDoc = getSearchDocForRecord(target.id);

  refs.tracePanel.className = "trace-panel";
  refs.tracePanel.innerHTML = `
    <article class="trace-block">
      <h3>当前检索摘要</h3>
      <pre>${escapeHtml(searchDoc?.searchText || "暂无")}</pre>
    </article>
    <article class="trace-block">
      <h3>原始输入记录</h3>
      <pre>${escapeHtml(rawInputs.map((item) => `${formatDateTime(item.capturedAt)}\n${item.inputText}`).join("\n\n---\n\n") || "暂无")}</pre>
    </article>
    <article class="trace-block">
      <h3>快照</h3>
      <pre>${escapeHtml(snapshots.map((item) => `${item.snapshotType} | ${formatDateTime(item.createdAt)}\n${JSON.stringify(item.payload, null, 2)}`).join("\n\n---\n\n") || "暂无")}</pre>
    </article>
    <article class="trace-block">
      <h3>变更记录</h3>
      <pre>${escapeHtml(changes.map((item) => `${formatDateTime(item.createdAt)} | ${item.createdBy} | ${item.field}: ${item.oldValue ?? ""} -> ${item.newValue ?? ""}`).join("\n") || "暂无")}</pre>
    </article>
  `;
}

function renderTodos() {
  const todos = getActiveRecordsByType("task");
  refs.todoCount.textContent = String(todos.length);
  if (!todos.length) {
    refs.todoList.className = "daily-event-list empty-state";
    refs.todoList.textContent = "还没有待办事项。";
    return;
  }
  refs.todoList.className = "daily-event-list";
  refs.todoList.innerHTML = todos.map((todo) => `
    <article class="daily-event-item todo-item ${todo.priority === "high" ? "priority-high" : ""} ${todo.priority === "low" ? "priority-low" : ""} ${todo.completed ? "is-completed" : ""}" data-todo-id="${todo.id}">
      <div class="todo-header-row">
        <div>
          <h3>${escapeHtml(todo.title)}</h3>
          <div class="inline-meta">
            <span>优先级：${escapeHtml(todo.priority)}</span>
            <span>${escapeHtml(todo.sourceType)}</span>
          </div>
        </div>
        <label class="todo-check">
          <input type="checkbox" data-todo-action="toggle" ${todo.completed ? "checked" : ""}>
          <span>${todo.completed ? "已完成" : "待完成"}</span>
        </label>
      </div>
      ${renderTagRow(todo.tags, todo.tagColor)}
      <p>${escapeHtml(todo.notes || "暂无说明")}</p>
      <div class="daily-actions">
        <button class="secondary-btn" data-todo-action="edit" type="button">编辑</button>
      </div>
    </article>
  `).join("");
  refs.todoList.querySelectorAll("[data-todo-action='toggle']").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const card = event.target.closest("[data-todo-id]");
      toggleTodoCompleted(card.dataset.todoId, event.target.checked);
    });
  });
  refs.todoList.querySelectorAll("[data-todo-action='edit']").forEach((button) => {
    button.addEventListener("click", (event) => {
      const card = event.target.closest("[data-todo-id]");
      loadTodoIntoForm(card.dataset.todoId);
    });
  });
}

function renderTagRow(tags = [], tagColor = "#115e59") {
  if (!tags?.length) return "";
  return `<div class="tag-row">${tags.map((tag) => `<span class="tag-chip" style="${buildTagStyle(resolveTagColor(tag, tagColor))}">${escapeHtml(tag)}</span>`).join("")}</div>`;
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
    <article class="chat-message ${escapeHtml(message.role)} ${escapeHtml(message.agent || "")}">
      <div class="chat-role">${escapeHtml(resolveChatSpeakerLabel(message))}</div>
      <div>${escapeHtml(message.content)}</div>
    </article>
  `).join("");
  refs.chatHistory.scrollTop = refs.chatHistory.scrollHeight;
}

function resolveChatSpeakerLabel(message) {
  if (message.role === "user") return "你";
  if (message.agent === "ai") return "AI";
  return "机器人";
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
  refs.eventTags.value = formatTagsForInput(partial.tags || []);
  refs.eventTagColor.value = partial.tagColor || "#115e59";
  refs.eventNotes.value = partial.notes || "";
  refs.eventRawInput.value = partial.rawInput || "";
  if (!partial.keepAiInput) {
    refs.eventAiInput.value = partial.rawInput || "";
  }
}

function seedEmptyTodoForm(partial = {}) {
  refs.todoId.value = partial.id || "";
  refs.todoTitle.value = partial.title || "";
  refs.todoNotes.value = partial.notes || "";
  refs.todoPriority.value = partial.priority || "normal";
  refs.todoTags.value = formatTagsForInput(partial.tags || []);
  refs.todoTagColor.value = partial.tagColor || "#115e59";
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
  try {
    const decision = await resolveChatIntent(text);
    if (decision.notice) {
      appendChatMessage("assistant", decision.notice, { agent: "bot" });
    }
    const intent = decision.intent;
    if (intent === "add") {
      await handleUnifiedAdd(text, decision.routeAgent);
    } else {
      await handleUnifiedSearch(text, decision.routeAgent);
    }
  } catch (error) {
    appendChatMessage("assistant", `处理失败：${error.message}`, { agent: "bot" });
    setStatus(`处理失败：${error.message}`);
  }
}

async function resolveChatIntent(text) {
  if (refs.chatIntent.value !== "auto") {
    return { intent: refs.chatIntent.value, routeAgent: "bot", notice: "" };
  }

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

  if (state.db.settings.parseMode === "llm" && !state.db.settings.apiKey?.trim()) {
    return {
      intent: inferChatIntent(text),
      routeAgent: "bot",
      notice: "当前是大模型模式，但还没有可用的 API Key。已回退到机器人规则判断意图。",
    };
  }

  return { intent: inferChatIntent(text), routeAgent: "bot", notice: "" };
}

function canUseLlmRouting() {
  return state.db.settings.parseMode === "llm" && Boolean(state.db.settings.apiKey?.trim());
}

async function handleUnifiedAdd(text, routeAgent = "bot") {
  expandSidebarForAi();
  setStatus("正在解析新增事项...");
  const useLlmParser = state.db.settings.parseMode === "llm";
  const drafts = useLlmParser ? await parseNaturalLanguageWithLlm(text) : parseNaturalLanguage(text);
  drafts.forEach((draft) => state.db.drafts.unshift(draft));
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
  const localResults = localSearch(text);
  let summary = buildSearchSummary(localResults, text);
  let responseAgent = routeAgent === "ai" ? "ai" : "bot";
  if (state.db.settings.parseMode === "llm" && state.db.settings.apiKey) {
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

function inferChatIntent(text) {
  return looksLikeSearchQuery(text) ? "search" : "add";
}

function looksLikeSearchQuery(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return false;

  const explicitSearchHints = [
    "找", "检索", "查询", "查", "统计", "总结", "哪些", "哪个", "哪一个",
    "过去", "回顾", "筛选", "最近", "最早", "最晚", "有没有", "什么",
    "ddl", "deadline", "due", "截止", "到期",
  ];
  if (explicitSearchHints.some((hint) => normalized.includes(hint))) {
    return true;
  }

  if (/[?？]$/.test(normalized) && !looksLikeScheduleInstruction(normalized)) {
    return true;
  }

  return /什么|多少|几号|几点|哪|最近|最早|最晚|有没有/.test(normalized)
    && !looksLikeScheduleInstruction(normalized);
}

function looksLikeScheduleInstruction(text) {
  return /(今天|明天|后天|周[一二三四五六日天]|本周|下周|\d{1,2}月\d{1,2}[日号]?|\d{1,2}[:点：]\d{0,2}|上午|下午|晚上|中午|早上|傍晚|今晚|安排|开会|上课|去|到)/.test(String(text || ""));
}

function appendChatMessage(role, content, options = {}) {
  state.db.chatMessages.push({
    id: createId("msg"),
    role,
    agent: options.agent || (role === "user" ? "user" : "bot"),
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
  appendChatMessage("assistant", "模型解析设置已保存。", { agent: "bot" });
  setStatus("模型解析设置已保存。");
  refs.settingsModal.close();
}

async function handleEventAiAssist() {
  const text = refs.eventAiInput.value.trim();
  if (!text) {
    setStatus("先输入一句自然语言描述，再让 AI 帮你整理。");
    refs.eventAiInput.focus();
    return;
  }

  try {
    setStatus("正在为当前日程弹窗解析内容...");
    const drafts = state.db.settings.parseMode === "llm"
      ? await parseNaturalLanguageWithLlm(text)
      : parseNaturalLanguage(text);
    const eventDraft = drafts.find((draft) => draft.recordType === "event") || drafts[0];
    if (!eventDraft || eventDraft.recordType !== "event") {
      setStatus("这段输入更像待办，我先没有直接塞进日程弹窗。你可以换一种更明确的时间描述。");
      return;
    }

    seedEmptyInputForm({
      id: refs.eventId.value,
      title: eventDraft.proposedTitle || "",
      date: eventDraft.proposedDate || refs.eventDate.value || state.selectedDate,
      allDay: eventDraft.allDay,
      startTime: eventDraft.proposedStartTime || "",
      endTime: eventDraft.proposedEndTime || "",
      location: eventDraft.proposedLocation || "",
      notes: eventDraft.proposedNotes || refs.eventNotes.value || "",
      rawInput: text,
      keepAiInput: true,
    });
    setStatus("AI 已把时间、地点和标题填进弹窗，你再快速确认一下就可以保存。");
  } catch (error) {
    setStatus(`AI 辅助填充失败：${error.message}`);
  }
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
  refs.eventEditorModal.close();
  render();
}

function handleDeleteEvent() {
  const eventId = refs.eventId.value;
  if (!eventId) {
    setStatus("当前没有可删除的事项。");
    return;
  }
  const event = getRecordById(eventId);
  if (!event) return;
  saveSnapshot(event, "before_delete");
  state.db.records = state.db.records.filter((item) => item.id !== eventId);
  removeSearchDocsForRecord(eventId);
  logChange(eventId, "record", JSON.stringify(event), "[deleted]", "manual_ui");
  state.editingEventId = null;
  seedEmptyInputForm();
  persistState();
  refs.eventEditorModal.close();
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
  const todo = getRecordById(todoId);
  if (!todo) return;
  saveSnapshot(todo, "before_delete");
  state.db.records = state.db.records.filter((item) => item.id !== todoId);
  removeSearchDocsForRecord(todoId);
  logChange(todoId, "record", JSON.stringify(todo), "[deleted]", "manual_ui");
  state.editingTodoId = null;
  seedEmptyTodoForm();
  persistState();
  render();
  setStatus("待办已删除。");
}

function toggleTodoCompleted(todoId, completed) {
  const todo = getRecordById(todoId);
  if (!todo) return;
  const oldValue = todo.completed;
  todo.completed = completed;
  todo.updatedAt = new Date().toISOString();
  todo.version += 1;
  logChange(todo.id, "completed", oldValue, completed, "manual_ui");
  persistState();
  renderTodos();
  setStatus(completed ? "待办已标记为完成。" : "待办已恢复为未完成。");
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
      openEventEditor("编辑草稿日程");
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
  refs.dataModal.close();
}

function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  state.pendingImport = {
    fileName: file.name,
    fileType: file.type,
    fileExt: file.name.split(".").pop()?.toLowerCase() || "",
    file,
  };
  refs.importConfigFileName.textContent = `即将导入：${file.name}`;
  refs.importTagInput.value = TEST_IMPORT_TAG;
  refs.importTagColor.value = TEST_IMPORT_COLOR;
  refs.importConfigModal.showModal();
  event.target.value = "";
}

function closeImportConfigModal() {
  state.pendingImport = null;
  refs.importConfigModal.close();
}

function handleConfirmImport() {
  if (!state.pendingImport?.file) {
    setStatus("当前没有待导入的文件。");
    return;
  }
  const importTag = refs.importTagInput.value.trim();
  const importTagColor = normalizeHexColor(refs.importTagColor.value);
  const file = state.pendingImport.file;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const content = String(reader.result);
      if (isIcsImport(file.name, content)) {
        const importedCount = importIcsText(content, file.name, {
          importTag,
          importTagColor,
        });
        persistState();
        render();
        setStatus(importTag
          ? `已从 ICS 导入 ${importedCount} 条日程，并加上标签 ${importTag}。`
          : `已从 ICS 导入 ${importedCount} 条日程。`);
        refs.dataModal.close();
      } else {
        state.db = normalizeImportedState(JSON.parse(content));
        state.editingEventId = null;
        state.editingTodoId = null;
        persistState();
        seedEmptyInputForm();
        seedEmptyTodoForm();
        render();
        setStatus("导入成功。");
        refs.dataModal.close();
      }
      refs.importConfigModal.close();
      state.pendingImport = null;
    } catch (error) {
      setStatus(`导入失败：${error.message}`);
    }
  };
  reader.readAsText(file);
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
  state.selectedDate = dateIso;
  seedEmptyInputForm({
    date: dateIso,
    startTime: `${hour}:00`,
    endTime: `${String(Number(hour) + 1).padStart(2, "0")}:00`,
    allDay: false,
  });
  openEventEditor("新建日程");
  setStatus(`已在表单中预填 ${dateIso} ${hour}:00 的时间段。`);
}

function quickCreateAllDay(dateIso) {
  state.selectedDate = dateIso;
  seedEmptyInputForm({
    date: dateIso,
    allDay: true,
    startTime: "",
    endTime: "",
  });
  openEventEditor("新建全天事项");
  setStatus(`已在表单中预填 ${dateIso} 的全天/未定时事项。`);
}

function beginDayDrag(event) {
  if (event.button !== 0) return;
  const startMinutes = eventToTimelineMinutes(event);
  state.dayDrag = {
    scope: "day",
    dateIso: state.selectedDate,
    startMinutes,
    endMinutes: startMinutes + DAY_SLOT_MINUTES,
  };
  renderDayView();

  const handleMove = (moveEvent) => {
    if (!state.dayDrag) return;
    state.dayDrag.endMinutes = eventToTimelineMinutes(moveEvent);
    renderDayView();
  };

  const handleUp = () => {
    document.removeEventListener("mousemove", handleMove);
    document.removeEventListener("mouseup", handleUp);
    finalizeDayDrag();
  };

  document.addEventListener("mousemove", handleMove);
  document.addEventListener("mouseup", handleUp);
}

function finalizeDayDrag() {
  if (!state.dayDrag) return;
  const start = Math.min(state.dayDrag.startMinutes, state.dayDrag.endMinutes);
  const end = Math.max(state.dayDrag.startMinutes, state.dayDrag.endMinutes);
  const safeEnd = end === start ? start + DAY_SLOT_MINUTES : end;
  const dateIso = state.dayDrag.dateIso;
  state.dayDrag = null;
  state.selectedDate = dateIso;
  seedEmptyInputForm({
    date: dateIso,
    startTime: formatMinutes(start),
    endTime: formatMinutes(safeEnd),
    allDay: false,
  });
  openEventEditor("新建日程");
  renderDayView();
  setStatus(`已预填 ${dateIso} ${formatMinutes(start)} - ${formatMinutes(safeEnd)}，继续填写标题即可保存。`);
}

function beginWeekDrag(event, weekDays) {
  if (event.button !== 0) return;
  const hit = eventToWeekTimelinePosition(event, weekDays);
  if (!hit) return;
  state.dayDrag = {
    scope: "week",
    dateIso: hit.dateIso,
    startMinutes: hit.minutes,
    endMinutes: hit.minutes + DAY_SLOT_MINUTES,
  };
  renderWeekView();

  const handleMove = (moveEvent) => {
    if (!state.dayDrag) return;
    const nextHit = eventToWeekTimelinePosition(moveEvent, weekDays);
    if (!nextHit) return;
    state.dayDrag.dateIso = nextHit.dateIso;
    state.dayDrag.endMinutes = nextHit.minutes;
    renderWeekView();
  };

  const handleUp = () => {
    document.removeEventListener("mousemove", handleMove);
    document.removeEventListener("mouseup", handleUp);
    finalizeWeekDrag();
  };

  document.addEventListener("mousemove", handleMove);
  document.addEventListener("mouseup", handleUp);
}

function finalizeWeekDrag() {
  if (!state.dayDrag) return;
  const start = Math.min(state.dayDrag.startMinutes, state.dayDrag.endMinutes);
  const end = Math.max(state.dayDrag.startMinutes, state.dayDrag.endMinutes);
  const safeEnd = end === start ? start + DAY_SLOT_MINUTES : end;
  const dateIso = state.dayDrag.dateIso;
  state.dayDrag = null;
  state.selectedDate = dateIso;
  seedEmptyInputForm({
    date: dateIso,
    startTime: formatMinutes(start),
    endTime: formatMinutes(safeEnd),
    allDay: false,
  });
  openEventEditor("新建日程");
  renderWeekView();
  renderDayView();
  setStatus(`已预填 ${dateIso} ${formatMinutes(start)} - ${formatMinutes(safeEnd)}，继续填写标题即可保存。`);
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
    tags: parseTagInput(refs.eventTags.value),
    tagColor: refs.eventTagColor.value,
    notes: refs.eventNotes.value,
    rawInput: refs.eventRawInput.value,
    sourceType: "manual_ui",
  };
}

function collectTodoFormData() {
  const rawInput = `${refs.todoTitle.value}\n${refs.todoNotes.value}`.trim();
  return {
    id: refs.todoId.value,
    title: refs.todoTitle.value,
    notes: refs.todoNotes.value,
    priority: refs.todoPriority.value,
    tags: parseTagInput(refs.todoTags.value),
    tagColor: refs.todoTagColor.value,
    rawInput,
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
  ensureGlobalTags(payload.tags || [], payload.tagColor);
  const event = {
    id: eventId,
    recordType: "calendar",
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
    tags: payload.tags || [],
    tagColor: normalizeHexColor(payload.tagColor || "#115e59"),
    sourceType: payload.sourceType || "manual_ui",
    rawInputId,
    currentInferenceId: null,
    metadata: options.parseMetadata || null,
  };
  state.db.records.unshift(event);
  state.db.rawInputs.unshift(buildRawInput(rawInputId, eventId, payload.rawInput, payload.title, options.rawInputCapturedAt || now));
  upsertSearchDoc(buildSearchDocEntry(event, payload, "calendar", rawInputId));
  saveSnapshot(event, "created");
  state.editingEventId = eventId;
  state.editingTodoId = null;
  seedEmptyInputForm({ ...payload, id: eventId });
}

function createTodoFromForm(payload, options = {}) {
  const now = new Date().toISOString();
  const todoId = createId("todo");
  const rawInputId = createId("raw");
  ensureGlobalTags(payload.tags || [], payload.tagColor);
  const todo = {
    id: todoId,
    recordType: "task",
    createdAt: now,
    updatedAt: now,
    version: 1,
    status: "active",
    completed: false,
    title: payload.title.trim(),
    notes: payload.notes.trim(),
    priority: payload.priority,
    tags: payload.tags || [],
    tagColor: normalizeHexColor(payload.tagColor || "#115e59"),
    sourceType: payload.sourceType || "manual_ui",
    rawInputId,
    metadata: options.parseMetadata || null,
  };
  state.db.records.unshift(todo);
  state.db.rawInputs.unshift(buildRawInput(rawInputId, todoId, payload.rawInput, payload.title, options.rawInputCapturedAt || now));
  upsertSearchDoc(buildSearchDocEntry(todo, payload, "task", rawInputId));
  saveSnapshot(todo, "created");
  state.editingTodoId = todoId;
  state.editingEventId = null;
  seedEmptyTodoForm({ ...payload, id: todoId });
}

function updateExistingEvent(payload) {
  const event = getRecordById(payload.id);
  if (!event) return;
  saveSnapshot(event, "before_update");
  ensureGlobalTags(payload.tags || [], payload.tagColor);
  const oldFields = { title: event.title, date: event.date, startTime: event.startTime, endTime: event.endTime, allDay: event.allDay, location: event.location, notes: event.notes, tags: JSON.stringify(event.tags || []), tagColor: event.tagColor };
  event.title = payload.title.trim();
  event.date = payload.date;
  event.startTime = payload.startTime;
  event.endTime = payload.endTime;
  event.allDay = payload.allDay;
  event.location = payload.location.trim();
  event.notes = payload.notes.trim();
  event.tags = payload.tags || [];
  event.tagColor = normalizeHexColor(payload.tagColor || event.tagColor || "#115e59");
  event.updatedAt = new Date().toISOString();
  event.version += 1;
  Object.entries(oldFields).forEach(([field, oldValue]) => {
    const newValue = field === "tags" ? JSON.stringify(event.tags || []) : event[field];
    if (String(oldValue ?? "") !== String(newValue ?? "")) {
      logChange(event.id, field, oldValue, newValue, "manual_ui");
    }
  });
  let effectiveRawInputId = event.rawInputId;
  if (payload.rawInput.trim()) {
    effectiveRawInputId = createId("raw");
    event.rawInputId = effectiveRawInputId;
    state.db.rawInputs.unshift(buildRawInput(effectiveRawInputId, event.id, payload.rawInput, payload.title, new Date().toISOString()));
  }
  upsertSearchDoc(buildSearchDocEntry(event, payload, "calendar", effectiveRawInputId));
  state.editingEventId = event.id;
  state.editingTodoId = null;
}

function updateExistingTodo(payload) {
  const todo = getRecordById(payload.id);
  if (!todo) return;
  saveSnapshot(todo, "before_update");
  ensureGlobalTags(payload.tags || [], payload.tagColor);
  const oldFields = { title: todo.title, notes: todo.notes, priority: todo.priority, tags: JSON.stringify(todo.tags || []), tagColor: todo.tagColor };
  todo.title = payload.title.trim();
  todo.notes = payload.notes.trim();
  todo.priority = payload.priority;
  todo.tags = payload.tags || [];
  todo.tagColor = normalizeHexColor(payload.tagColor || todo.tagColor || "#115e59");
  todo.updatedAt = new Date().toISOString();
  todo.version += 1;
  Object.entries(oldFields).forEach(([field, oldValue]) => {
    const newValue = field === "tags" ? JSON.stringify(todo.tags || []) : todo[field];
    if (String(oldValue ?? "") !== String(newValue ?? "")) {
      logChange(todo.id, field, oldValue, newValue, "manual_ui");
    }
  });
  let effectiveRawInputId = todo.rawInputId;
  if (payload.rawInput.trim()) {
    effectiveRawInputId = createId("raw");
    todo.rawInputId = effectiveRawInputId;
    state.db.rawInputs.unshift(buildRawInput(effectiveRawInputId, todo.id, payload.rawInput, payload.title, new Date().toISOString()));
  }
  upsertSearchDoc(buildSearchDocEntry(todo, payload, "task", effectiveRawInputId));
  state.editingTodoId = todo.id;
  state.editingEventId = null;
}

function loadEventIntoForm(eventId) {
  const event = getRecordById(eventId);
  if (!event) return;
  const latestRaw = getLatestRawInputForRecord(event.id);
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
    tags: event.tags || [],
    tagColor: event.tags?.[0] ? resolveTagColor(event.tags[0]) : "#115e59",
    notes: event.notes,
    rawInput: latestRaw?.inputText || "",
  });
  renderTracePanel();
  openEventEditor("编辑日程");
}

function loadTodoIntoForm(todoId) {
  const todo = getRecordById(todoId);
  if (!todo) return;
  const latestRaw = getLatestRawInputForRecord(todo.id);
  state.editingTodoId = todo.id;
  state.editingEventId = null;
  seedEmptyTodoForm({
    id: todo.id,
    title: todo.title,
    notes: todo.notes,
    priority: todo.priority,
    tags: todo.tags || [],
    tagColor: todo.tags?.[0] ? resolveTagColor(todo.tags[0]) : "#115e59",
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

async function classifyChatIntentWithLlm(text) {
  const settings = state.db.settings;
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
          {
            role: "user",
            content: text,
          },
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

function localSearch(query) {
  const terms = expandSearchTerms(query);
  return rankSearchResults(state.db.searchDocs
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

async function summarizeSearchWithLlm(query, results) {
  const settings = state.db.settings;
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
  return json.choices?.[0]?.message?.content || buildSearchSummary(results, query);
}

function buildSearchDocEntry(record, payload, type, rawInputId) {
  const searchText = type === "task"
    ? [payload.title || "", payload.notes || "", payload.rawInput || "", payload.priority || "", ...(payload.tags || [])].filter(Boolean).join(" ")
    : [payload.date || "", payload.allDay ? "全天" : `${payload.startTime || "未定"} ${payload.endTime || ""}`, payload.title || "", payload.location || "", payload.notes || "", payload.rawInput || "", ...(payload.tags || [])].filter(Boolean).join(" ");
  const existing = getSearchDocForRecord(record.id);
  return {
    id: existing?.id || createId("search"),
    recordId: record.id,
    rawInputId,
    searchTypeHint: type,
    searchText: searchText.trim(),
    importance: type === "task" ? 0.72 : 0.8,
    updatedAt: new Date().toISOString(),
  };
}

function saveSnapshot(record, snapshotType) {
  state.db.traceLogs.unshift({
    id: createId("trace"),
    recordId: record.id,
    traceType: "snapshot",
    snapshotType,
    payload: cloneValue(record),
    createdAt: new Date().toISOString(),
    createdBy: "system",
  });
}

function logChange(recordId, field, oldValue, newValue, changedBy) {
  state.db.traceLogs.unshift({
    id: createId("trace"),
    recordId,
    traceType: "field_change",
    field,
    oldValue,
    newValue,
    createdBy: changedBy,
    createdAt: new Date().toISOString(),
  });
}

function getEventsForDate(dateIso) {
  return getActiveRecordsByType("calendar")
    .filter((event) => event.status === "active" && event.date === dateIso)
    .sort((a, b) => {
      if (!a.startTime && b.startTime) return -1;
      if (a.startTime && !b.startTime) return 1;
      return (a.startTime || "99:99").localeCompare(b.startTime || "99:99");
    });
}

function getActiveRecordsByType(recordType) {
  return state.db.records.filter((item) => item.recordType === recordType && item.status === "active" && recordMatchesActiveTagFilter(item));
}

function getRecordById(recordId) {
  if (!recordId) return null;
  return state.db.records.find((item) => String(item.id) === String(recordId)) || null;
}

function getRawInputById(rawInputId) {
  if (!rawInputId) return null;
  return state.db.rawInputs.find((item) => String(item.id) === String(rawInputId)) || null;
}

function getRawInputsForRecord(recordId) {
  return state.db.rawInputs.filter((item) => String(item.recordId) === String(recordId));
}

function getLatestRawInputForRecord(recordId) {
  return getRawInputsForRecord(recordId)[0] || null;
}

function getTraceLogsForRecord(recordId) {
  return state.db.traceLogs.filter((item) => String(item.recordId) === String(recordId));
}

function getSearchDocForRecord(recordId) {
  return state.db.searchDocs.find((item) => String(item.recordId) === String(recordId)) || null;
}

function upsertSearchDoc(searchDoc) {
  const existingIndex = state.db.searchDocs.findIndex((item) => String(item.id) === String(searchDoc.id));
  if (existingIndex >= 0) {
    state.db.searchDocs[existingIndex] = searchDoc;
    return;
  }
  state.db.searchDocs.unshift(searchDoc);
}

function removeSearchDocsForRecord(recordId) {
  state.db.searchDocs = state.db.searchDocs.filter((item) => String(item.recordId) !== String(recordId));
}

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
    version: 3,
    tags: [],
    records: [],
    rawInputs: [],
    searchDocs: [],
    drafts: [],
    traceLogs: [],
    attachments: [],
    chatMessages: [],
    settings: { ...DEFAULT_SETTINGS },
  };
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
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
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
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
  };
}

function seedDemoData() {
  if (state.db.records.length > 0) {
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
  refs.dataModal.close();
}

function renderSelectedDaySummary() {
  const dateIso = state.selectedDate;
  const events = getEventsForDate(dateIso);
  const timedCount = events.filter((event) => event.startTime && !event.allDay).length;
  const allDayCount = events.filter((event) => event.allDay || !event.startTime).length;
  const firstTimed = events.find((event) => event.startTime && !event.allDay);
  refs.selectedDaySummary.className = "selected-day-summary";
  refs.selectedDaySummary.innerHTML = `
    <div class="summary-stat-grid">
      <article class="summary-stat">
        <span class="muted">当前日期</span>
        <strong>${escapeHtml(dateIso)}</strong>
      </article>
      <article class="summary-stat">
        <span class="muted">定时日程</span>
        <strong>${timedCount}</strong>
      </article>
      <article class="summary-stat">
        <span class="muted">全天 / 未定时</span>
        <strong>${allDayCount}</strong>
      </article>
    </div>
    <article class="summary-note">
      ${events.length
        ? `最早一条定时事项：${escapeHtml(firstTimed ? `${firstTimed.startTime} ${firstTimed.title}` : "今天以全天事项为主")}。新增和编辑现在统一通过弹窗完成。`
        : "这一天还没有事项。你可以点“新建日程”，或直接在日视图 / 周视图里拖拽创建时间段。"}
    </article>
  `;
}

function openEventEditor(title) {
  refs.eventEditorTitle.textContent = title;
  if (!refs.eventEditorModal.open) {
    refs.eventEditorModal.showModal();
  }
  if (!refs.eventAiInput.value && refs.eventRawInput.value) {
    refs.eventAiInput.value = refs.eventRawInput.value;
  }
  refs.eventTitle.focus();
}

function setStatus(message) {
  refs.statusLine.textContent = message;
}

function formatEventChip(event) {
  return `${event.startTime || "全天"} ${event.title}`;
}

function formatTagsForInput(tags = []) {
  return Array.isArray(tags) ? tags.join(", ") : "";
}

function parseTagInput(value) {
  return Array.from(new Set(String(value || "")
    .split(/[，,、]/)
    .map((item) => item.trim())
    .filter(Boolean)));
}

function normalizeTagRegistry(data) {
  const registry = new Map();
  const seed = Array.isArray(data.tags) ? data.tags : [];
  seed.forEach((tag) => {
    if (!tag?.name) return;
    registry.set(tag.name, { name: tag.name, color: normalizeHexColor(tag.color || "#115e59") });
  });
  const records = [
    ...(Array.isArray(data.records) ? data.records : []),
    ...(Array.isArray(data.events) ? data.events : []),
    ...(Array.isArray(data.todos) ? data.todos : []),
  ];
  records.forEach((record) => {
    (record.tags || []).forEach((tag) => {
      if (!registry.has(tag)) {
        registry.set(tag, { name: tag, color: normalizeHexColor(record.tagColor || "#115e59") });
      }
    });
  });
  return Array.from(registry.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function ensureGlobalTags(tags = [], preferredColor = "#115e59") {
  if (!Array.isArray(state.db.tags)) state.db.tags = [];
  tags.forEach((tag) => {
    if (!tag) return;
    const existing = state.db.tags.find((item) => item.name === tag);
    if (!existing) {
      state.db.tags.push({ name: tag, color: normalizeHexColor(preferredColor) });
    } else if (preferredColor) {
      existing.color = normalizeHexColor(preferredColor);
    }
  });
  state.db.tags.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function resolveTagColor(tag, fallback = "#115e59") {
  const found = state.db.tags?.find((item) => item.name === tag);
  return normalizeHexColor(found?.color || fallback);
}

function buildTagStyle(color) {
  const hex = normalizeHexColor(color || "#115e59");
  return `--tag-bg:${hex}22;--tag-text:${pickTextColor(hex)};--tag-border:${hex}55;`;
}

function normalizeHexColor(color) {
  const value = String(color || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#115e59";
}

function pickTextColor(hex) {
  const normalized = normalizeHexColor(hex).slice(1);
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.7 ? "#1f2937" : normalized === "115e59" ? "#134743" : "#ffffff";
}

function formatMonthLabel(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function formatDayLabel(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
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

function timeToMinutes(time) {
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  return hour * 60 + minute;
}

function formatMinutes(minutes) {
  const safe = Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60, minutes));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function minutesToOffset(minutes, hourHeight) {
  const clamped = Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60, minutes));
  return ((clamped - DAY_START_HOUR * 60) / 60) * hourHeight;
}

function eventToTimelineMinutes(event) {
  const rect = refs.dayGridSurface.getBoundingClientRect();
  const relativeY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const rawMinutes = DAY_START_HOUR * 60 + Math.round(relativeY / (DAY_HOUR_HEIGHT / 2)) * DAY_SLOT_MINUTES;
  return Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60, rawMinutes));
}

function eventToWeekTimelinePosition(event, weekDays) {
  const surface = refs.weekGrid.querySelector("#week-grid-surface");
  if (!surface) return null;
  const rect = surface.getBoundingClientRect();
  const relativeX = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left));
  const relativeY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const dayIndex = Math.max(0, Math.min(6, Math.floor((relativeX / rect.width) * 7)));
  const rawMinutes = DAY_START_HOUR * 60 + Math.round(relativeY / (WEEK_HOUR_HEIGHT / 2)) * DAY_SLOT_MINUTES;
  return {
    dateIso: isoDate(weekDays[dayIndex]),
    minutes: Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60, rawMinutes)),
  };
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

function buildModelRequestErrorMessage(endpoint, error) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (/The string did not match the expected pattern/i.test(rawMessage)) {
    return `模型请求没有成功发出。当前接口地址是 ${endpoint}。这通常是 API Base URL 写法不完整，或浏览器无法接受该地址格式。`;
  }
  return `模型请求没有成功发出。当前接口地址是 ${endpoint}。原始错误：${rawMessage}`;
}

function rankSearchResults(results, query) {
  const deadlineQuery = isDeadlineQuery(query);
  return [...results].sort((left, right) => {
    if (deadlineQuery) {
      const deadlineOrder = compareDeadlineCandidates(left, right);
      if (deadlineOrder !== 0) return deadlineOrder;
    }
    return right.score - left.score;
  });
}

function isDeadlineQuery(text) {
  return /(ddl|deadline|due|截止|到期)/i.test(String(text || ""));
}

function compareDeadlineCandidates(left, right) {
  const leftSignal = hasDeadlineSignal(left);
  const rightSignal = hasDeadlineSignal(right);
  if (leftSignal !== rightSignal) return rightSignal - leftSignal;

  const leftTime = getUpcomingRecordTimestamp(left.record);
  const rightTime = getUpcomingRecordTimestamp(right.record);
  const leftHasDate = Number.isFinite(leftTime);
  const rightHasDate = Number.isFinite(rightTime);
  if (leftHasDate !== rightHasDate) return leftHasDate ? -1 : 1;
  if (leftHasDate && rightHasDate && leftTime !== rightTime) return leftTime - rightTime;
  return 0;
}

function hasDeadlineSignal(result) {
  const source = [
    result.record?.title || "",
    result.record?.notes || "",
    result.searchDoc?.searchText || "",
    result.rawInput?.inputText || "",
  ].join(" ");
  return /(ddl|deadline|due|截止|到期|报名截止|提交截止)/i.test(source) ? 1 : 0;
}

function getUpcomingRecordTimestamp(record) {
  if (!record?.date) return Number.POSITIVE_INFINITY;
  const date = parseDate(record.date);
  if (record.startTime) {
    const [hour, minute] = record.startTime.split(":").map(Number);
    date.setHours(hour || 0, minute || 0, 0, 0);
  } else {
    date.setHours(23, 59, 59, 999);
  }
  return date.getTime();
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

function isIcsImport(fileName, content) {
  return /\.ics$/i.test(String(fileName || "").trim()) || String(content || "").includes("BEGIN:VCALENDAR");
}

function importIcsText(content, sourceName = "import.ics", options = {}) {
  const events = parseIcsEvents(content);
  if (!events.length) {
    throw new Error("ICS 中没有解析到可导入的 VEVENT。");
  }
  const importTags = parseTagInput(options.importTag || "");
  const importTagColor = normalizeHexColor(options.importTagColor || TEST_IMPORT_COLOR);
  if (importTags.length) {
    ensureGlobalTags(importTags, importTagColor);
  }
  let importedCount = 0;
  let firstDate = null;
  events.forEach((item) => {
    const rawText = buildIcsRawText(item, sourceName);
    createEventFromForm({
      title: item.summary || "ICS 导入事项",
      date: isoDate(item.start),
      allDay: item.allDay,
      startTime: item.allDay ? "" : formatIcsTime(item.start),
      endTime: item.allDay ? "" : formatIcsTime(item.end || item.start),
      location: item.location || "",
      tags: importTags,
      tagColor: importTagColor,
      notes: item.description || "",
      rawInput: rawText,
      sourceType: "ics_import",
    }, {
      rawInputCapturedAt: item.start.toISOString(),
      parseMetadata: {
        importedFrom: sourceName,
        originalUid: item.uid || null,
        originalStart: item.start.toISOString(),
      },
    });
    importedCount += 1;
    if (!firstDate || item.start < firstDate) {
      firstDate = item.start;
    }
  });
  if (firstDate) {
    state.selectedDate = isoDate(firstDate);
    state.visibleMonth = startOfMonth(firstDate);
    state.visibleWeek = startOfWeek(firstDate);
  }
  return importedCount;
}

function parseIcsEvents(content) {
  const unfoldedLines = unfoldIcsLines(content);
  const events = [];
  let current = null;
  unfoldedLines.forEach((line) => {
    if (line === "BEGIN:VEVENT") {
      current = {};
      return;
    }
    if (line === "END:VEVENT") {
      if (current?.dtStart) {
        events.push(buildParsedIcsEvent(current));
      }
      current = null;
      return;
    }
    if (!current) return;
    const property = parseIcsProperty(line);
    if (!property) return;
    const name = property.name.toUpperCase();
    if (name === "SUMMARY") current.summary = property.value;
    if (name === "DESCRIPTION") current.description = property.value.replaceAll("\\n", "\n");
    if (name === "LOCATION") current.location = property.value;
    if (name === "UID") current.uid = property.value;
    if (name === "DTSTART") current.dtStart = property;
    if (name === "DTEND") current.dtEnd = property;
  });
  return events;
}

function unfoldIcsLines(content) {
  const rawLines = String(content || "").replaceAll("\r\n", "\n").split("\n");
  const lines = [];
  rawLines.forEach((line) => {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  });
  return lines;
}

function parseIcsProperty(line) {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) return null;
  const left = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  const [name, ...params] = left.split(";");
  const paramMap = {};
  params.forEach((item) => {
    const [key, paramValue] = item.split("=");
    if (key) paramMap[key.toUpperCase()] = paramValue || "";
  });
  return { name, params: paramMap, value };
}

function buildParsedIcsEvent(event) {
  const start = parseIcsDateValue(event.dtStart);
  const end = event.dtEnd ? parseIcsDateValue(event.dtEnd) : null;
  return {
    uid: event.uid || "",
    summary: event.summary || "",
    description: event.description || "",
    location: event.location || "",
    start,
    end: end || new Date(start.getTime() + 60 * 60 * 1000),
    allDay: Boolean(event.dtStart?.params?.VALUE === "DATE"),
  };
}

function parseIcsDateValue(property) {
  const value = String(property?.value || "").trim();
  if (!value) throw new Error("ICS 日期字段为空。");
  if (property?.params?.VALUE === "DATE") {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    return new Date(year, month - 1, day, 0, 0, 0, 0);
  }
  const compact = value.replace(/Z$/, "");
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const hour = Number(compact.slice(9, 11));
  const minute = Number(compact.slice(11, 13));
  const second = Number(compact.slice(13, 15) || "0");
  return new Date(year, month - 1, day, hour, minute, second, 0);
}

function buildIcsRawText(event, sourceName) {
  return [
    `来源文件：${sourceName}`,
    `原标题：${event.summary || "ICS 导入事项"}`,
    `原始日期：${formatDateTime(event.start.toISOString())}`,
    event.location ? `地点：${event.location}` : "",
    event.description ? `描述：${event.description}` : "",
    event.uid ? `UID：${event.uid}` : "",
  ].filter(Boolean).join("\n");
}

function formatIcsTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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

function expandSearchTerms(text) {
  const normalized = String(text || "").toLowerCase();
  const terms = new Set(uniqueTerms(normalized));
  const latinTokens = normalized.match(/[a-z0-9]+/g) || [];
  latinTokens.forEach((token) => terms.add(token));

  if (/(ddl|deadline|due)/i.test(normalized)) {
    ["ddl", "deadline", "due", "截止", "到期", "报名截止", "提交截止"].forEach((term) => terms.add(term));
  }

  return Array.from(terms).filter(Boolean);
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

function renderTagFilterOptions() {
  if (!refs.tagFilterSelect) return;
  const currentValue = state.activeTagFilter || "";
  refs.tagFilterSelect.innerHTML = [
    `<option value="">显示全部</option>`,
    ...(state.db.tags || []).map((tag) => `<option value="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}</option>`),
  ].join("");
  refs.tagFilterSelect.value = currentValue;
}

function recordMatchesActiveTagFilter(record) {
  if (!state.activeTagFilter) return true;
  return Array.isArray(record.tags) && record.tags.includes(state.activeTagFilter);
}
