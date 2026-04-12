const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;
/* 时间轴的交互吸附粒度统一收口在这里。
   现在改成 15 分钟后，以下交互都会一起变细：
   - 日视图空白拖拽创建
   - 周视图空白拖拽创建
   - 日视图拖动已有定时卡片
   - 周视图拖动已有定时卡片
   视觉网格暂时仍保留现有密度，不强制把所有辅助线也同步加密。 */
const DAY_SLOT_MINUTES = 15;
const WEEK_HOUR_HEIGHT = 48;
const DAY_HOUR_HEIGHT = 32;
const VIEW_SEQUENCE = ["day", "month", "week", "todo"];
const TEST_IMPORT_TAG = "test";
const TEST_IMPORT_COLOR = "#9f1239";
const KARIN_SHELL_CACHE_KEY = "karin-shell-cache-v1";
const DEFAULT_EVENT_TAG_NAME = "默认日程";
const DEFAULT_TASK_TAG_NAME = "默认待办";
const TAG_COLOR_PRESETS = [
  "#115e59", "#0f766e", "#0ea5e9", "#2563eb", "#7c3aed", "#c026d3",
  "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#65a30d", "#15803d",
  "#4d7c0f", "#a16207", "#92400e", "#7f1d1d", "#475569", "#111827",
];
const UI_THEME_OPTIONS = ["atelier-warm", "soft-sculpt"];

let pickFolderDialog = null;
let pickChatAttachmentsCommand = null;
let emitRuntimeLogCommand = null;
let appendLlmTraceLogCommand = null;
let getLlmTraceLogPathCommand = null;
let clearLlmTraceLogCommand = null;
let getKaedeContextDocsCommand = null;
let eventDetailViewportSyncFrame = 0;
// 这个指针目标用于“月 / 周视图全天事项快速输入”的 blur 时序协调。
// 鼠标点击外部时，blur 会早于 click 触发；这里只记录那次 pointer，避免 blur 阶段提前 render。
let allDayQuickEntryPointerTarget = null;
/*
  Karin workspace runtime

  这一层负责承接当前工作台的 UI 事件、渲染、表单写入与对 assistant/database 模块的接线。
  它不再是应用入口；真正的启动流程由 v4 bootstrap/session 接管。
*/
const DEFAULT_SETTINGS = {
  parseMode: "local",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  apiModel: "gpt-4o-mini",
};

const { createKarinContextEngine } = window.KarinContextEngine || window.ChronicleContextEngine;
const { createDatabaseStore } = window.KarinDatabaseStore || window.ChronicleDatabaseStore;
const { createDatabaseQuery } = window.KarinDatabaseQuery || window.ChronicleDatabaseQuery;
const { createSecretaryAssistant } = window.KarinSecretaryAssistant || window.ChronicleSecretaryAssistant;

const databaseStore = createDatabaseStore({
  defaultSettings: DEFAULT_SETTINGS,
  cloneValue,
  normalizeHexColor,
  createId,
  normalizeTagRegistry,
  setStatus,
});

const karinContextEngine = createKarinContextEngine({
  getDb: () => state.db,
  getLatestRawInputForRecord,
  getKaedeContextDocs: () => state.kaedeContextDocs,
});

const databaseQuery = createDatabaseQuery({
  getDb: () => state.db,
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
  traceRuntime,
  contextEngine: karinContextEngine,
  recordLlmExchange,
});

const secretaryAssistant = createSecretaryAssistant({
  getDb: () => state.db,
  queryApi: databaseQuery,
  parseNaturalLanguage,
  createDraftId: () => createId("draft"),
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
  traceRuntime,
  contextEngine: karinContextEngine,
  recordLlmExchange,
});

// 当前原型把核心 UI 状态和数据状态都收口在这里。
// 这轮改动新增的重点是 AI 工作台宽度、横向滑动状态机、全局标签表，
// 所以下一个同事排查交互问题时，优先检查这些字段是否被意外改写。
const state = {
  db: databaseStore.createEmptyState(),
  visibleMonth: startOfMonth(new Date()),
  visibleWeek: startOfWeek(new Date()),
  selectedDate: isoDate(new Date()),
  activeView: "month",
  activeSidebarPane: "karin",
  activeTagFilters: [],
  editingEventId: null,
  editingTodoId: null,
  dayDrag: null,
  timedCardDrag: null,
  /* 拖拽完成后，浏览器仍可能补发一次 click。
     这里短暂记录“下一次详情点击要吞掉”，避免用户拖完卡片后又立刻弹出详情。 */
  suppressDetailOpen: {
    recordId: "",
    until: 0,
  },
  suppressSurfaceClickUntil: 0,
  pendingWeekClick: {
    token: 0,
    target: "",
    kind: "",
  },
  sidebarWidth: 360,
  /*
    周视图连续横向滚动状态：
    1. rangeAnchor 表示当前 35 天虚拟窗口从哪一天开始渲染。
    2. leftEdgeDate 表示当前 7 天可视窗口最左侧完整显示的是哪一天。
       现在周视图横向恢复只认“整天锚点”，不再保留半天 / 半列的像素偏移。
    3. restoreScrollTop 用来在 DOM 重建后恢复纵向时间位置。
    4. suppressNextScroll 用来吞掉程序化 scrollLeft 写入产生的那一次 scroll 事件，
       避免刚重建完又立刻触发下一次重建。
    5. snapFrame / lastScrollLeft 用来监听横向惯性尾段，
       在滚动速度明显降下来时就提前接管并吸附到最近整天，
       避免出现“先彻底停住，再补一段吸附动画”的割裂感。 */
  weekPaneScroll: {
    rangeAnchor: addDays(startOfWeek(new Date()), -7),
    leftEdgeDate: isoDate(startOfWeek(new Date())),
    initialized: false,
    syncToken: 0,
    syncFrame: 0,
    restoreScrollTop: 0,
    previewLockActive: false,
    previewScrollLeft: 0,
    previewScrollTop: 0,
    suppressNextScroll: false,
    animateOnNextSync: false,
    snapFrame: 0,
    snapAnimationFrame: 0,
    lastScrollLeft: 0,
    dayCount: 35,
  },
  /*
    月视图连续滚动状态：
    1. rangeAnchor 决定当前渲染的 9 个月窗口以哪一个月为中心。
    2. focusMonth 记录“视觉上仍应停留”的月份，重渲染后要滚回它。
    3. restoreOffset 记录当前活动月份标题相对滚动容器顶部的偏移，作为月份级回退锚点。
    4. restoreWeekStart / restoreWeekOffset 记录“当前视口顶部附近那一周”的锚点。
       删除全天事项后周高会变化，仅靠月份标题不够稳，所以这里优先按周恢复。
    5. suppressNextScroll 用来吞掉程序化 scrollTop 写入触发的那一次 scroll 事件，否则会立刻再次重建月份窗口。 */
  monthScroll: {
    rangeAnchor: startOfMonth(new Date()),
    focusMonth: isoDate(startOfMonth(new Date())),
    initialized: false,
    syncToken: 0,
    restoreOffset: 0,
    restoreWeekStart: "",
    restoreWeekOffset: 0,
    suppressNextScroll: false,
    edgeLock: null,
  },
  runtimeLogs: [],
  llmTraceLogPath: "",
  kaedeContextDocs: createEmptyKaedeContextDocs(),
  mountStatus: null,
  shellCache: loadKarinShellCache(),
  pendingChatAttachments: [],
  eventDetailPopover: null,
  eventDetailDraft: {
    recordId: "",
    values: null,
  },
  detailAiState: {
    recordId: "",
    running: false,
    changedFields: [],
    message: "",
    inputText: "",
  },
  detailTagPicker: {
    recordId: "",
    open: false,
  },
  detailTemporalUi: {
    recordId: "",
    expanded: false,
  },
  /*
    月视图“清单式快速输入”临时状态：
    1. recordId 是当前正在月视图里直接改标题的那条全天事项。
    2. date 用来记住它属于哪一天，后续回车连续新增时继续落到同一天。
    3. draftTitle 是输入框里的实时值；在按 Enter / 点击外部前都不直接写库。
    4. focusToken 用于“重绘后重新把光标放回输入框”，避免 render 后焦点丢失。 */
  monthQuickEntry: {
    recordId: "",
    date: "",
    draftTitle: "",
    focusToken: 0,
  },
  /*
    周视图顶部全天栏的快速输入状态：
    结构与 monthQuickEntry 保持一致，但服务对象是周视图顶上的跨列全天条带。
    之所以没有和 monthQuickEntry 硬合并，是因为周 / 月两种视图的滚动恢复策略不同：
    - 月视图要保“周锚点”
    - 周视图要保“横向左边界日期 + 纵向 scrollTop”
    拆开后更容易保持各自滚动语义稳定。 */
  weekQuickEntry: {
    recordId: "",
    date: "",
    draftTitle: "",
    focusToken: 0,
  },
  appBootstrapped: false,
  lastMigrationNoticeKey: "",
  pendingKaedeOpenRequest: null,
  tagFilterInitialized: false,
  derivedView: {
    signature: "",
    calendarsByDate: new Map(),
    activeByType: new Map(),
  },
  uiLayout: {
    dayAllDayHeight: 96,
    dayAllDayManual: false,
    weekAllDayHeight: 96,
    weekAllDayManual: false,
  },
};

// 所有 DOM 引用统一集中在这里，避免后续在业务逻辑里到处 querySelector。
const refs = {
  sidebarHandle: document.querySelector("#sidebar-resize-handle"),
  sidebar: document.querySelector(".sidebar"),
  sidebarPaneNav: document.querySelector("#sidebar-pane-nav"),
  sidebarPaneHighlight: document.querySelector("#sidebar-pane-highlight"),
  sidebarPaneButtons: document.querySelectorAll("[data-sidebar-target]"),
  sidebarPanes: document.querySelectorAll("[data-sidebar-pane]"),
  workspaceFrame: document.querySelector("#workspace-frame"),
  topViewNav: document.querySelector("#top-view-nav"),
  topViewHighlight: document.querySelector("#top-view-highlight"),
  tagFilterTrigger: document.querySelector("#tag-filter-trigger"),
  tagFilterPanel: document.querySelector("#tag-filter-panel"),
  tagFilterOptions: document.querySelector("#tag-filter-options"),
  tagFilterSelectAllBtn: document.querySelector("#tag-filter-select-all-btn"),
  tagFilterSelectNoneBtn: document.querySelector("#tag-filter-select-none-btn"),
  openTagManagerBtn: document.querySelector("#open-tag-manager-btn"),
  dayView: document.querySelector("#day-view"),
  dayLabel: document.querySelector("#day-label"),
  dayColumnLabel: document.querySelector("#day-column-label"),
  dayAllDayStrip: document.querySelector("#day-all-day-strip"),
  dayTimeLabels: document.querySelector("#day-time-labels"),
  dayGridSurface: document.querySelector("#day-grid-surface"),
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
  eventEndDate: document.querySelector("#event-end-date"),
  eventAllDay: document.querySelector("#event-all-day"),
  eventStartTime: document.querySelector("#event-start-time"),
  eventEndTime: document.querySelector("#event-end-time"),
  eventLocation: document.querySelector("#event-location"),
  eventTags: document.querySelector("#event-tags"),
  eventTagTrigger: document.querySelector("#event-tag-trigger"),
  eventTagSelected: document.querySelector("#event-tag-selected"),
  eventTagPanel: document.querySelector("#event-tag-panel"),
  eventTagEntry: document.querySelector("#event-tag-entry"),
  eventTagSuggestions: document.querySelector("#event-tag-suggestions"),
  eventTagCreateBtn: document.querySelector("#event-tag-create-btn"),
  eventTagColor: document.querySelector("#event-tag-color"),
  eventTagColorTrigger: document.querySelector("#event-tag-color-trigger"),
  eventTagColorPalette: document.querySelector("#event-tag-color-palette"),
  eventNotes: document.querySelector("#event-notes"),
  eventRawInput: document.querySelector("#event-raw-input"),
  importFile: document.querySelector("#import-file"),
  parseMode: document.querySelector("#parse-mode"),
  apiBaseUrl: document.querySelector("#api-base-url"),
  apiKey: document.querySelector("#api-key"),
  apiModel: document.querySelector("#api-model"),
  uiTheme: document.querySelector("#ui-theme"),
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
  todoTagTrigger: document.querySelector("#todo-tag-trigger"),
  todoTagSelected: document.querySelector("#todo-tag-selected"),
  todoTagPanel: document.querySelector("#todo-tag-panel"),
  todoTagEntry: document.querySelector("#todo-tag-entry"),
  todoTagSuggestions: document.querySelector("#todo-tag-suggestions"),
  todoTagCreateBtn: document.querySelector("#todo-tag-create-btn"),
  todoTagColor: document.querySelector("#todo-tag-color"),
  todoTagColorTrigger: document.querySelector("#todo-tag-color-trigger"),
  todoTagColorPalette: document.querySelector("#todo-tag-color-palette"),
  todoList: document.querySelector("#todo-list"),
  todoCount: document.querySelector("#todo-count"),
  chatHistory: document.querySelector("#chat-history"),
  chatInput: document.querySelector("#chat-input"),
  chatIntent: document.querySelector("#chat-intent"),
  chatAttachmentList: document.querySelector("#chat-attachment-list"),
  eventEditorModal: document.querySelector("#event-editor-modal"),
  eventEditorTitle: document.querySelector("#event-editor-title"),
  eventAiInput: document.querySelector("#event-ai-input"),
  settingsModal: document.querySelector("#settings-modal"),
  dataModal: document.querySelector("#data-modal"),
  importConfigModal: document.querySelector("#import-config-modal"),
  debugModal: document.querySelector("#debug-modal"),
  tagManagerModal: document.querySelector("#tag-manager-modal"),
  tagManagerEventList: document.querySelector("#tag-manager-event-list"),
  tagManagerTaskList: document.querySelector("#tag-manager-task-list"),
  migrationNoticeModal: document.querySelector("#migration-notice-modal"),
  migrationNoticeTitle: document.querySelector("#migration-notice-title"),
  migrationNoticeBody: document.querySelector("#migration-notice-body"),
  migrationNoticeMeta: document.querySelector("#migration-notice-meta"),
  migrationNoticeSteps: document.querySelector("#migration-notice-steps"),
  eventDetailPopover: document.querySelector("#event-detail-popover"),
  eventDetailPopoverContent: document.querySelector("#event-detail-popover-content"),
  importConfigFileName: document.querySelector("#import-config-file-name"),
  importTagInput: document.querySelector("#import-tag-input"),
  importTagColor: document.querySelector("#import-tag-color"),
  mountPackageRoot: document.querySelector("#mount-package-root"),
  mountStatus: document.querySelector("#mount-status"),
  runtimeLogList: document.querySelector("#runtime-log-list"),
  runtimeLogCount: document.querySelector("#runtime-log-count"),
  llmTraceLogPath: document.querySelector("#llm-trace-log-path"),
};

window.KarinLegacyApp = {
  bootstrap: bootstrapLegacyKarinApp,
  syncSession: syncKarinSession,
  getSessionSnapshot: buildKarinSessionSnapshot,
};

/* ---------- App bootstrap ---------- */
async function bootstrapLegacyKarinApp() {
  if (state.appBootstrapped) return state;
  state.appBootstrapped = true;
  try {
    await init();
    syncKarinSession("workspace_bootstrap");
    return state;
  } catch (error) {
    state.appBootstrapped = false;
    console.error("Karin init failed:", error);
    throw error;
  }
}

async function init() {
  state.db = await databaseStore.initializeStorage();
  ensureAllRecordsHaveTags();
  syncTagFilterSelection({ forceAll: true });
  await initializeLlmTraceLogPath();
  await refreshKaedeContextDocs();
  applyShellCache();
  await restoreCachedKaedeMountIfNeeded();
  await refreshKaedeContextDocs();
  await reopenCachedKaedeIfNeeded();
  await refreshKaedeContextDocs();
  applySidebarWidth(state.sidebarWidth);
  renderWeekdays();
  renderTagFilterOptions();
  bindEvents();
  seedSettingsForm();
  seedEmptyInputForm();
  seedEmptyTodoForm();
  render();
  const runtimeMode = databaseStore.getRuntimeMode?.() || "unknown";
  traceRuntime("storage", "当前存储模式", { mode: runtimeMode });
  if (runtimeMode === "memory") {
    appendChatMessage("assistant", "当前 Karin 还没有真正写入 Kaede/SQLite，正在以内存模式运行。重启后你在 UI 里编辑的数据不会保留。", { agent: "bot" });
  } else if (runtimeMode === "mounted") {
    appendChatMessage("assistant", "Kaede Notebook 路径已挂载，但还没有打开内容。现在 Karin 会先挂载，再由你显式打开 notebook。", { agent: "bot" });
  }
  traceRuntime("app", "Karin 初始化完成", { mode: "ready" });
  refreshDatabaseMountStatus().catch((error) => {
    console.warn("Failed to refresh database mount status:", error);
  });
}

async function restoreCachedKaedeMountIfNeeded() {
  const runtimeMode = databaseStore.getRuntimeMode?.();
  const cachedMountPath = state.shellCache?.mountPackageRoot?.trim();
  if (runtimeMode === "kaede_sqlite" || runtimeMode === "mounted" || !cachedMountPath) return;

  try {
    await databaseStore.configureDatabaseMount(cachedMountPath);
    await refreshKaedeContextDocs();
    traceRuntime("storage", "已自动恢复缓存的 Kaede 挂载", {
      packageRoot: cachedMountPath,
    });
  } catch (error) {
    traceRuntime("storage", "自动恢复 Kaede 挂载失败", {
      packageRoot: cachedMountPath,
      error: error.message,
    });
    setStatus(`自动恢复 Kaede 挂载失败：${error.message}`);
  }
}

async function reopenCachedKaedeIfNeeded() {
  const runtimeMode = databaseStore.getRuntimeMode?.();
  if (runtimeMode !== "mounted" || !state.shellCache?.autoOpenKaede) return;

  try {
    traceRuntime("storage", "开始自动重新打开缓存的 Kaede", {
      packageRoot: state.shellCache.mountPackageRoot,
    });
    const reopened = await handleOpenMountedKaede({ silent: true, source: "auto_restore" });
    traceRuntime("storage", reopened ? "已自动重新打开缓存的 Kaede" : "自动打开已暂停，等待升级确认", {
      packageRoot: state.shellCache.mountPackageRoot,
    });
  } catch (error) {
    traceRuntime("storage", "自动重新打开 Kaede 失败", {
      packageRoot: state.shellCache.mountPackageRoot,
      error: error.message,
    });
  }
}

/* ---------- Event binding ----------
   这里负责把 UI 手势、按钮、弹窗与 state / database 接口接线。
   它只处理“触发入口”，不在这里写复杂业务判断。
*/
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
  refs.tagFilterTrigger?.addEventListener("click", (event) => {
    event.preventDefault();
    const shouldOpen = Boolean(refs.tagFilterPanel?.classList.contains("is-hidden"));
    if (shouldOpen) {
      refs.tagFilterPanel.classList.remove("is-hidden");
      refs.tagFilterPanel?.setAttribute("aria-hidden", "false");
      refs.tagFilterTrigger?.setAttribute("aria-expanded", "true");
      positionTagFilterPanel();
    } else {
      closeTagFilterPanel();
    }
  });
  refs.tagFilterOptions?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-tag-filter-id]");
    if (!input) return;
    const checked = Array.from(refs.tagFilterOptions.querySelectorAll("[data-tag-filter-id]:checked"))
      .map((node) => String(node.dataset.tagFilterId || ""))
      .filter(Boolean);
    state.activeTagFilters = checked;
    render();
  });
  refs.tagFilterSelectAllBtn?.addEventListener("click", () => {
    state.activeTagFilters = getAllVisibleTagIds();
    render();
  });
  refs.tagFilterSelectNoneBtn?.addEventListener("click", () => {
    state.activeTagFilters = [];
    render();
  });
  refs.openTagManagerBtn?.addEventListener("click", () => {
    renderTagManager();
    refs.tagManagerModal?.showModal();
  });
  window.addEventListener("keydown", handleViewKeySwitch, { capture: true });

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
    resetWeekPaneToWeekStart(addDays(state.visibleWeek, -7), { preserveScrollTop: true });
    renderWeekView();
  });
  document.querySelector("#next-week-btn").addEventListener("click", () => {
    resetWeekPaneToWeekStart(addDays(state.visibleWeek, 7), { preserveScrollTop: true });
    renderWeekView();
  });
  document.querySelector("#current-week-btn").addEventListener("click", () => {
    const today = new Date();
    state.selectedDate = isoDate(today);
    resetWeekPaneToWeekStart(today, { preserveScrollTop: true });
    renderWeekView();
  });

  refs.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.viewTarget;
      render();
    });
  });
  refs.sidebarPaneButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSidebarPane = button.dataset.sidebarTarget;
      syncSidebarPaneState();
    });
  });
  refs.topViewNav?.addEventListener("scroll", updateTopViewHighlight, { passive: true });
  refs.sidebarPaneNav?.addEventListener("scroll", updateSidebarPaneHighlight, { passive: true });
  window.addEventListener("resize", updateTopViewHighlight);
  window.addEventListener("resize", updateSidebarPaneHighlight);

  document.querySelector("#send-chat-btn").addEventListener("click", handleChatSubmit);
  document.querySelector("#pick-chat-attachment-btn").addEventListener("click", handlePickChatAttachments);
  refs.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleChatSubmit();
    }
  });
  document.querySelector("#clear-runtime-log-btn").addEventListener("click", clearRuntimeLogs);
  document.querySelector("#clear-llm-trace-btn")?.addEventListener("click", clearLlmTraceLogs);

  document.querySelector("#save-settings-btn").addEventListener("click", handleSaveSettings);
  document.querySelector("#export-btn").addEventListener("click", handleExport);
  document.querySelector("#import-btn").addEventListener("click", () => refs.importFile.click());
  document.querySelector("#seed-btn").addEventListener("click", seedDemoData);
  document.querySelector("#open-mounted-kaede-btn").addEventListener("click", handleMountAndOpenKaede);
  document.querySelector("#pick-mount-folder-btn").addEventListener("click", handlePickDatabaseMountFolder);
  document.querySelector("#clear-mount-btn").addEventListener("click", handleClearDatabaseMount);
  document.querySelector("#refresh-mount-btn").addEventListener("click", refreshDatabaseMountStatus);
  refs.importFile.addEventListener("change", handleImport);
  document.querySelector("#close-event-editor-btn").addEventListener("click", () => refs.eventEditorModal.close());
  document.querySelector("#event-ai-apply-btn").addEventListener("click", handleEventAiAssist);
  document.querySelector("#open-settings-btn").addEventListener("click", () => refs.settingsModal.showModal());
  document.querySelector("#open-data-from-settings-btn").addEventListener("click", () => {
    refs.settingsModal.close();
    refs.dataModal.showModal();
  });
  document.querySelector("#open-debug-from-settings-btn").addEventListener("click", () => {
    refs.settingsModal.close();
    refs.debugModal.showModal();
  });
  document.querySelector("#close-tag-manager-btn")?.addEventListener("click", () => refs.tagManagerModal?.close());
  document.querySelector("#close-settings-btn").addEventListener("click", () => refs.settingsModal.close());
  document.querySelector("#close-data-btn").addEventListener("click", () => refs.dataModal.close());
  document.querySelector("#close-debug-modal-btn").addEventListener("click", () => refs.debugModal.close());
  document.querySelector("#close-migration-notice-btn")?.addEventListener("click", handleMigrationNoticeClose);
  document.querySelector("#ack-migration-notice-btn")?.addEventListener("click", handleMigrationNoticeAcknowledge);
  document.querySelector("#close-import-config-btn").addEventListener("click", closeImportConfigModal);
  document.querySelector("#cancel-import-btn").addEventListener("click", closeImportConfigModal);
  document.querySelector("#confirm-import-btn").addEventListener("click", handleConfirmImport);
  refs.tagManagerEventList?.addEventListener("click", handleTagManagerClick);
  refs.tagManagerTaskList?.addEventListener("click", handleTagManagerClick);
  refs.tagManagerEventList?.addEventListener("input", handleTagManagerColorInput);
  refs.tagManagerTaskList?.addEventListener("input", handleTagManagerColorInput);
  bindFormTagPicker("calendar", refs.eventTags, refs.eventTagTrigger, refs.eventTagEntry, refs.eventTagSelected, refs.eventTagPanel, refs.eventTagSuggestions, refs.eventTagCreateBtn, refs.eventTagColor, refs.eventTagColorTrigger, refs.eventTagColorPalette);
  bindFormTagPicker("task", refs.todoTags, refs.todoTagTrigger, refs.todoTagEntry, refs.todoTagSelected, refs.todoTagPanel, refs.todoTagSuggestions, refs.todoTagCreateBtn, refs.todoTagColor, refs.todoTagColorTrigger, refs.todoTagColorPalette);

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

  document.addEventListener("click", handleGlobalPointerForEventDetail, true);
  document.addEventListener("pointerdown", handleGlobalPointerDownForMonthQuickEntry, true);
  document.addEventListener("click", (event) => {
    if (event.target.closest(".tag-color-picker")) return;
    if (event.target.closest(".tag-inline-control")) return;
    if (event.target.closest(".tag-filter-picker")) return;
    if (!event.target.closest(".event-detail-tag-picker") && state.detailTagPicker.open) {
      state.detailTagPicker = { recordId: "", open: false };
      if (state.eventDetailPopover?.recordId && refs.eventDetailPopoverContent && !refs.eventDetailPopover.classList.contains("is-hidden")) {
        rerenderDetailSurface(refs.eventDetailPopoverContent, state.eventDetailPopover.recordId, { mode: "popover" });
      }
    }
    closeAllTagColorPalettes();
    closeAllFormTagPanels();
    closeTagFilterPanel();
  });
  document.addEventListener("click", handleGlobalClickForMonthQuickEntry);
  document.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", closeEventDetailPopover);
  window.addEventListener("resize", closeTagFilterPanel);
  window.addEventListener("scroll", scheduleEventDetailViewportSync, true);
  window.addEventListener("scroll", closeTagFilterPanel, true);
}

function handleGlobalPointerForEventDetail(event) {
  if (!state.eventDetailPopover) return;
  const clickedPopover = event.target.closest("#event-detail-popover");
  const clickedTrigger = event.target.closest("[data-event-detail-trigger]");
  if (clickedPopover || clickedTrigger) return;
  closeEventDetailPopover();
}

function handleGlobalPointerDownForMonthQuickEntry(event) {
  /* 月视图快速输入在 blur 时不能立刻退出：
     鼠标点击别处会先触发 blur，再触发 click；如果 blur 阶段就 render，
     页面会在真正的 click 逻辑执行前跳一下。所以这里先记住这次 pointer，
     让 blur 知道“这是一次外部点击导致的失焦”，真正退出放到 click 阶段统一做。 */
  allDayQuickEntryPointerTarget = event.target;
  window.setTimeout(() => {
    allDayQuickEntryPointerTarget = null;
  }, 0);
}

function handleGlobalClickForMonthQuickEntry(event) {
  // 点击“月 / 周视图全天事项快速输入框”外部时，统一在 click 阶段收起，避免 blur / render 抢时序。
  const insideQuickInput = event.target.closest("[data-month-quick-entry], [data-month-quick-input], [data-week-quick-entry], [data-week-quick-input]");
  if (insideQuickInput) return;
  if (state.activeView === "month" && state.monthQuickEntry.recordId) {
    finishMonthQuickEntry();
  }
  if (state.activeView === "week" && state.weekQuickEntry.recordId) {
    finishWeekQuickEntry();
  }
}

function handleGlobalKeydown(event) {
  /* 键盘删除的统一入口：
     - 月视图快速输入中，空标题的 Backspace/Delete 由输入框自己处理
     - 其他场景下，只要当前存在选中的 calendar 卡片，就允许直接删掉它 */
  if ((event.key === "Backspace" || event.key === "Delete") && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const activeElement = document.activeElement;
    const typingSurface = activeElement?.matches?.("input, textarea, select, [contenteditable='true']");
    const isMonthQuickInput = activeElement?.matches?.("[data-month-quick-input]");
    if (!typingSurface || isMonthQuickInput) {
      const selectedEvent = getRecordById(state.editingEventId);
      if (selectedEvent?.recordType === "calendar" && !state.monthQuickEntry.recordId) {
        event.preventDefault();
        deleteEventRecordById(selectedEvent.id, {
          closePopover: true,
          resetEventForm: state.activeView !== "month",
          statusMessage: "事项已删除。",
        });
        return;
      }
    }
  }
  if (event.key === "Escape") {
    if (state.monthQuickEntry.recordId) {
      finishMonthQuickEntry();
    }
    if (state.weekQuickEntry.recordId) {
      finishWeekQuickEntry();
    }
    closeEventDetailPopover();
    closeAllTagColorPalettes();
    closeAllFormTagPanels();
  }
}

function scheduleEventDetailViewportSync() {
  if (!state.eventDetailPopover?.recordId || !refs.eventDetailPopover || refs.eventDetailPopover.classList.contains("is-hidden")) return;
  cancelAnimationFrame(eventDetailViewportSyncFrame);
  eventDetailViewportSyncFrame = requestAnimationFrame(() => {
    const recordId = state.eventDetailPopover?.recordId;
    if (!recordId) return;
    const anchor = findEventDetailAnchorElement(recordId, { view: state.activeView });
    if (!anchor) {
      closeEventDetailPopover({ statusMessage: "" });
      return;
    }
    const viewport = getAnchorViewport(anchor);
    if (viewport && !isAnchorVisibleInViewport(anchor, viewport, 6)) {
      closeEventDetailPopover({ statusMessage: "" });
      return;
    }
    state.eventDetailPopover.anchorRect = getPopoverAnchorRect(anchor);
    positionEventDetailPopover(state.eventDetailPopover.anchorRect);
  });
}

function bindFormTagPicker(scope, hiddenInput, triggerButton, entryInput, summaryContainer, panel, optionsContainer, createButton, colorInput, colorTrigger, colorPalette) {
  if (!hiddenInput || !triggerButton || !entryInput || !summaryContainer || !panel || !optionsContainer || !createButton || !colorInput || !colorTrigger || !colorPalette) return;

  triggerButton.addEventListener("click", (event) => {
    event.preventDefault();
    const shouldOpen = panel.classList.contains("is-hidden");
    closeAllFormTagPanels();
    if (shouldOpen) {
      openFormTagPanel(triggerButton, panel);
      renderFormTagPicker(scope, hiddenInput, entryInput, summaryContainer, optionsContainer, createButton, colorInput);
      window.requestAnimationFrame(() => entryInput.focus());
    }
  });
  entryInput.addEventListener("focus", () => {
    openFormTagPanel(triggerButton, panel);
    renderFormTagPicker(scope, hiddenInput, entryInput, summaryContainer, optionsContainer, createButton, colorInput);
  });
  entryInput.addEventListener("input", () => renderFormTagPicker(scope, hiddenInput, entryInput, summaryContainer, optionsContainer, createButton, colorInput));
  entryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      addTagFromEntry(scope, hiddenInput, entryInput, colorInput, summaryContainer, optionsContainer, createButton);
      return;
    }
    if (event.key === "Backspace" && !entryInput.value.trim()) {
      const tags = parseTagInput(hiddenInput.value);
      if (!tags.length) return;
      hiddenInput.value = formatTagsForInput(tags.slice(0, -1));
      renderFormTagPicker(scope, hiddenInput, entryInput, summaryContainer, optionsContainer, createButton, colorInput);
    }
  });
  optionsContainer.addEventListener("click", (event) => {
    const button = event.target.closest("[data-form-tag-toggle]");
    if (!button) return;
    const tagName = button.dataset.formTagToggle;
    const selectedTags = parseTagInput(hiddenInput.value);
    const nextTags = selectedTags.includes(tagName)
      ? selectedTags.filter((item) => item !== tagName)
      : [...selectedTags, tagName];
    hiddenInput.value = formatTagsForInput(nextTags);
    renderFormTagPicker(scope, hiddenInput, entryInput, summaryContainer, optionsContainer, createButton, colorInput);
  });
  createButton.addEventListener("click", (event) => {
    event.preventDefault();
    addTagFromEntry(scope, hiddenInput, entryInput, colorInput, summaryContainer, optionsContainer, createButton);
    renderFormTagColorPicker(colorInput, colorTrigger, colorPalette);
  });
  colorTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    const isHidden = colorPalette.classList.contains("is-hidden");
    closeAllTagColorPalettes();
    if (isHidden) {
      colorPalette.classList.remove("is-hidden");
      colorPalette.setAttribute("aria-hidden", "false");
    }
  });
  colorPalette.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tag-color-value]");
    if (!button) return;
    colorInput.value = normalizeHexColor(button.dataset.tagColorValue);
    renderFormTagColorPicker(colorInput, colorTrigger, colorPalette);
    renderFormTagPicker(scope, hiddenInput, entryInput, summaryContainer, optionsContainer, createButton, colorInput);
    closeAllTagColorPalettes();
  });

  renderFormTagPicker(scope, hiddenInput, entryInput, summaryContainer, optionsContainer, createButton, colorInput);
  renderFormTagColorPicker(colorInput, colorTrigger, colorPalette);
}

function addTagFromEntry(scope, hiddenInput, entryInput, colorInput, summaryContainer, optionsContainer, createButton) {
  const nextTag = normalizeTagName(entryInput.value);
  if (!nextTag) return;
  const selectedTags = parseTagInput(hiddenInput.value);
  hiddenInput.value = formatTagsForInput([...selectedTags, nextTag]);
  entryInput.value = "";
  const existing = resolveScopedTagObject(scope, nextTag);
  if (existing?.color) {
    colorInput.value = normalizeHexColor(existing.color);
  }
  renderFormTagPicker(scope, hiddenInput, entryInput, summaryContainer, optionsContainer, createButton, colorInput);
  const trigger = scope === "task" ? refs.todoTagColorTrigger : refs.eventTagColorTrigger;
  const palette = scope === "task" ? refs.todoTagColorPalette : refs.eventTagColorPalette;
  renderFormTagColorPicker(colorInput, trigger, palette);
}

function renderFormTagPicker(scope, hiddenInput, entryInput, summaryContainer, optionsContainer, createButton, colorInput) {
  const selectedTags = parseTagInput(hiddenInput.value);
  if (!selectedTags.length) {
    summaryContainer.className = "tag-inline-summary empty-state";
    summaryContainer.textContent = "选择已有标签或新建标签";
  } else {
    summaryContainer.className = "tag-inline-summary";
    summaryContainer.innerHTML = selectedTags.map((tagName) => {
      const color = normalizeHexColor(resolveScopedTagObject(scope, tagName)?.color || colorInput.value || getDefaultTagColor(scope));
      return `<span class="tag-chip tag-inline-summary-chip" style="${buildTagStyle(color)}">${escapeHtml(tagName)}</span>`;
    }).join("");
  }

  const query = normalizeTagName(entryInput.value).toLowerCase();
  const candidates = getScopedTagRegistry(scope)
    .filter((tag) => !query || tag.name.toLowerCase().includes(query))
    .slice(0, 16);
  const normalizedEntry = normalizeTagName(entryInput.value);
  const hasNewTag = normalizedEntry
    && !selectedTags.some((tag) => tag.toLowerCase() === normalizedEntry.toLowerCase())
    && !getScopedTagRegistry(scope).some((tag) => tag.name.toLowerCase() === normalizedEntry.toLowerCase());

  if (!candidates.length) {
    optionsContainer.className = "tag-inline-options empty-state";
    optionsContainer.textContent = scope === "task" ? "这里会显示已有待办标签。" : "这里会显示已有日程标签。";
  } else {
    optionsContainer.className = "tag-inline-options";
    optionsContainer.innerHTML = candidates.map((tag) => {
      const active = selectedTags.includes(tag.name);
      return `
        <button
          class="tag-inline-option${active ? " is-active" : ""}"
          type="button"
          data-form-tag-toggle="${escapeHtml(tag.name)}"
        >
          <span class="tag-inline-option-mark" aria-hidden="true">${active ? "✓" : ""}</span>
          <span class="tag-inline-option-dot" style="--tag-dot:${escapeHtml(normalizeHexColor(tag.color))}"></span>
          <span class="tag-inline-option-label">${escapeHtml(tag.name)}</span>
        </button>
      `;
    }).join("");
  }

  createButton.disabled = !normalizedEntry;
  createButton.textContent = hasNewTag ? `新建“${normalizedEntry}”` : "新建";
}

function renderFormTagColorPicker(colorInput, colorTrigger, colorPalette) {
  const color = normalizeHexColor(colorInput.value || "#115e59");
  colorTrigger.style.setProperty("--tag-color-current", color);
  colorTrigger.setAttribute("aria-label", `当前标签颜色 ${color}`);
  colorPalette.innerHTML = TAG_COLOR_PRESETS.map((value) => `
    <button
      class="tag-color-swatch${normalizeHexColor(value) === color ? " is-active" : ""}"
      type="button"
      data-tag-color-value="${escapeHtml(value)}"
      style="--swatch:${escapeHtml(value)}"
      aria-label="选择颜色 ${escapeHtml(value)}"
    ></button>
  `).join("");
}

function closeAllTagColorPalettes() {
  [refs.eventTagColorPalette, refs.todoTagColorPalette].forEach((palette) => {
    if (!palette) return;
    palette.classList.add("is-hidden");
    palette.setAttribute("aria-hidden", "true");
  });
}

function closeAllFormTagPanels() {
  [
    [refs.eventTagPanel, refs.eventTagTrigger],
    [refs.todoTagPanel, refs.todoTagTrigger],
  ].forEach(([panel, trigger]) => {
    if (!panel || !trigger) return;
    panel.classList.add("is-hidden");
    panel.setAttribute("aria-hidden", "true");
    trigger.setAttribute("aria-expanded", "false");
  });
}

function openFormTagPanel(trigger, panel) {
  if (!trigger || !panel) return;
  panel.classList.remove("is-hidden");
  panel.setAttribute("aria-hidden", "false");
  trigger.setAttribute("aria-expanded", "true");
}

function closeTagFilterPanel() {
  if (!refs.tagFilterPanel || !refs.tagFilterTrigger) return;
  refs.tagFilterPanel.classList.add("is-hidden");
  refs.tagFilterPanel.setAttribute("aria-hidden", "true");
  refs.tagFilterTrigger.setAttribute("aria-expanded", "false");
  refs.tagFilterPanel.style.removeProperty("left");
  refs.tagFilterPanel.style.removeProperty("right");
  refs.tagFilterPanel.style.removeProperty("top");
}

function positionTagFilterPanel() {
  if (!refs.tagFilterPanel || !refs.tagFilterTrigger) return;
  const triggerRect = refs.tagFilterTrigger.getBoundingClientRect();
  const panelWidth = Math.min(320, window.innerWidth - 24);
  const leftOffset = Math.min(triggerRect.width - panelWidth, 0);
  refs.tagFilterPanel.style.left = `${leftOffset}px`;
  refs.tagFilterPanel.style.right = "auto";
  refs.tagFilterPanel.style.top = "calc(100% + 8px)";
}

function handleTagManagerClick(event) {
  const button = event.target.closest("[data-tag-action]");
  if (!button) return;
  const scope = button.dataset.tagScope;
  const tagId = button.dataset.tagId;
  if (!scope || !tagId) return;
  if (button.dataset.tagAction !== "delete") return;

  const tag = resolveScopedTagObject(scope, tagId);
  if (!tag) return;
  const confirmed = window.confirm(`要删除标签“${tag.name}”吗？对应事项上的这个标签也会一起移除。`);
  if (!confirmed) return;
  deleteScopedTag(scope, tagId);
  setStatus(`已删除${scope === "task" ? "待办" : "日程"}标签：${tag.name}`);
}

function handleTagManagerColorInput(event) {
  const input = event.target.closest("[data-tag-color-input]");
  if (!input) return;
  const scope = input.dataset.tagScope;
  const tagId = input.dataset.tagId;
  const tag = resolveScopedTagObject(scope, tagId);
  if (!tag) return;
  tag.color = normalizeHexColor(input.value);
  tag.updatedAt = new Date().toISOString();
  persistState();
  render();
}

function render() {
  const stop = startRuntimeTimer("render", "全量渲染");
  rebuildDerivedViewState();
  syncViewState();
  syncSidebarPaneState();
  renderSharedPanels();
  renderActiveWorkspace();
  renderChatHistory();
  renderChatAttachments();
  renderRuntimeLogs();
  renderLlmTraceStatus();
  updateSelectedDateLabel();
  stop();
  syncKarinSession("render");
}

function renderSharedPanels() {
  renderTagFilterOptions();
  renderTagManager();
  renderDrafts();
  renderTracePanel();
}

function renderActiveWorkspace() {
  if (state.activeView !== "month" && state.monthQuickEntry.recordId) {
    finishMonthQuickEntry({ render: false });
  }
  if (state.activeView !== "week" && state.weekQuickEntry.recordId) {
    finishWeekQuickEntry({ render: false });
  }
  closeEventDetailPopover({ autoSave: false });
  if (state.activeView === "day") {
    renderDayView();
    renderSelectedDaySummary();
    renderDailyEvents();
    return;
  }

  if (state.activeView === "week") {
    renderWeekView();
    return;
  }

  if (state.activeView === "todo") {
    renderTodos();
    return;
  }

  renderCalendar();
}

/* 顶层 render 负责把当前状态投影到页面，不直接承担数据判断或 AI 推理。 */
function syncViewState() {
  refs.viewButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.viewTarget === state.activeView));
  updateTopViewHighlight();
  refs.dayView.classList.toggle("is-hidden", state.activeView !== "day");
  refs.monthView.classList.toggle("is-hidden", state.activeView !== "month");
  refs.weekView.classList.toggle("is-hidden", state.activeView !== "week");
  refs.todoView.classList.toggle("is-hidden", state.activeView !== "todo");
}

function syncSidebarPaneState() {
  refs.sidebarPaneButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.sidebarTarget === state.activeSidebarPane));
  refs.sidebarPanes.forEach((pane) => pane.classList.toggle("is-active", pane.dataset.sidebarPane === state.activeSidebarPane));
  updateSidebarPaneHighlight();
}

function updateTopViewHighlight() {
  if (!refs.topViewNav || !refs.topViewHighlight) return;
  const activeButton = refs.topViewNav.querySelector("[data-view-target].is-active");
  if (!activeButton) return;
  const navRect = refs.topViewNav.getBoundingClientRect();
  const buttonRect = activeButton.getBoundingClientRect();
  const offset = buttonRect.left - navRect.left + refs.topViewNav.scrollLeft;
  refs.topViewHighlight.style.setProperty("--top-view-highlight-x", `${offset}px`);
  refs.topViewHighlight.style.setProperty("--top-view-highlight-width", `${buttonRect.width}px`);
}

function updateSidebarPaneHighlight() {
  if (!refs.sidebarPaneNav || !refs.sidebarPaneHighlight) return;
  const activeButton = refs.sidebarPaneNav.querySelector("[data-sidebar-target].is-active");
  if (!activeButton) return;
  const navRect = refs.sidebarPaneNav.getBoundingClientRect();
  const buttonRect = activeButton.getBoundingClientRect();
  const offset = buttonRect.left - navRect.left + refs.sidebarPaneNav.scrollLeft;
  refs.sidebarPaneHighlight.style.setProperty("--sidebar-pane-highlight-x", `${offset}px`);
  refs.sidebarPaneHighlight.style.setProperty("--sidebar-pane-highlight-width", `${buttonRect.width}px`);
}

// 侧栏既要支持自动放大，也要允许用户手动微调，所以拖拽入口仍然保留。
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

// 所有侧栏宽度变化统一走这里，避免自动扩展和手动拖拽使用不同边界值。
function applySidebarWidth(width) {
  const next = Math.max(300, Math.min(560, Math.round(width)));
  state.sidebarWidth = next;
  document.documentElement.style.setProperty("--sidebar-width", `${next}px`);
}

// 当用户聚焦 AI 输入时主动给更多空间，强调 AI 是核心工作流的一部分。
function expandSidebarForAi() {
  if (state.sidebarWidth < 420) {
    applySidebarWidth(440);
  }
}

// 全局视图切换改为键盘左右键，避免和周视图自己的横向滚动手势冲突。
function handleViewKeySwitch(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (event.target.closest("input, textarea, select, dialog, [contenteditable='true']")) return;

  const currentIndex = VIEW_SEQUENCE.indexOf(state.activeView);
  if (currentIndex === -1) return;

  const direction = event.key === "ArrowRight" ? 1 : -1;
  const nextIndex = Math.max(0, Math.min(VIEW_SEQUENCE.length - 1, currentIndex + direction));
  if (nextIndex === currentIndex) return;

  event.preventDefault();
  state.activeView = VIEW_SEQUENCE[nextIndex];
  render();
}

// 日视图现在是“紧凑型工作台”，负责当天摘要、列表与轻量拖拽创建，不再追求铺满整页时间轴。
function renderDayView() {
  const selected = parseDate(state.selectedDate);
  refs.dayLabel.textContent = formatDayLabel(selected);
  refs.dayColumnLabel.textContent = `${WEEKDAY_LABELS[(selected.getDay() + 6) % 7]} · ${selected.getMonth() + 1}/${selected.getDate()}`;
  renderDayTimeLabels();

  const events = getEventsForDate(state.selectedDate);
  const allDayEvents = events.filter((event) => event.allDay || !event.startTime);
  const timedSegments = getTimedEventSegmentsForDate(state.selectedDate);
  if (state.editingEventId) {
    const selectedSegment = timedSegments.find((segment) => segment.record.id === state.editingEventId);
    const matchesCurrentDay = Boolean(selectedSegment);
    if (!matchesCurrentDay) {
      state.editingEventId = timedSegments[0]?.record.id || null;
    }
  } else if (timedSegments.length) {
    state.editingEventId = timedSegments[0].record.id;
  }

  const selectionMarkup = state.dayDrag && state.dayDrag.scope !== "week" && state.dayDrag.dateIso === state.selectedDate
    ? renderDaySelectionPreview(state.dayDrag.startMinutes, state.dayDrag.endMinutes)
    : "";
  refs.dayGridSurface.classList.toggle("is-dragging", state.dayDrag?.scope === "day");
  refs.dayGridSurface.innerHTML = `
    ${!timedSegments.length && !selectionMarkup ? `<div class="day-empty-hint">在右侧时间轴拖拽，即可直接创建一段日程。</div>` : ""}
    ${timedSegments.map((segment) => renderDayEventBlock(segment)).join("")}
    ${selectionMarkup}
  `;

  refs.dayAllDayStrip.classList.remove("is-scrollable");
  refs.dayAllDayStrip.innerHTML = allDayEvents.length
    ? allDayEvents.map((event) => {
      const viewModel = buildCalendarCardViewModel(event, { cardKind: "day_all_day", dragKind: "move_all_day" });
      return `
      <button class="day-all-day-chip${state.editingEventId === event.id ? " is-selected" : ""}" data-day-event-id="${event.id}" ${buildCalendarCardDataAttributes(viewModel)} type="button" style="${viewModel.accentStyle}">
        <span class="day-all-day-chip-title">${escapeHtml(viewModel.title)}</span>
      </button>
    `;
    }).join("")
    : `<div class="slot-add-hint">双击这里添加全天事项</div>`;

  refs.dayAllDayStrip.querySelectorAll("[data-day-event-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openEventDetailPopover(button.dataset.dayEventId, button);
    });
  });
  refs.dayAllDayStrip.ondblclick = (event) => handleDayAllDayDoubleClick(event);
  refs.dayView?.querySelector(".day-all-day-head")?.addEventListener("dblclick", (event) => {
    if (event.target.closest("[data-day-event-id]")) return;
    handleDayAllDayDoubleClick(event);
  });

  refs.dayGridSurface.querySelectorAll("[data-day-event-id]").forEach((block) => {
    block.addEventListener("click", (event) => {
      event.stopPropagation();
      if (shouldSuppressDetailOpen(block.dataset.dayEventId)) return;
      openEventDetailPopover(block.dataset.dayEventId, block);
    });
  });

  refs.dayGridSurface.onmousedown = (event) => beginDayDrag(event);
  refs.dayGridSurface.ondblclick = (event) => handleDayTimelineDoubleClick(event);
  applyDayAllDayHeight();
  bindDayAllDayResizeHandle();
  updateDayAllDayOverflowState();
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

function renderDayEventBlock(segment) {
  const event = segment.record;
  /* 日视图事项卡片改为先生成共享 view-model。
     这样后续实现拖拽时，命中层只需要认 cardKind / dragKind，
     不用再分别读取 day/week/month 各自不同的 HTML 结构。 */
  const viewModel = buildCalendarCardViewModel(event, { cardKind: "day_timed", dragKind: "move_timed" });
  const startMinutes = segment.startMinutes;
  const endMinutes = segment.endMinutes;
  const safeEnd = Math.max(endMinutes, startMinutes + 30);
  const top = minutesToOffset(startMinutes, DAY_HOUR_HEIGHT);
  const height = Math.max(minutesToOffset(safeEnd, DAY_HOUR_HEIGHT) - top, 28);
  return `
    <article class="day-event-block${state.editingEventId === event.id ? " is-selected" : ""}" data-day-event-id="${event.id}" data-segment-date="${segment.dateIso}" data-event-detail-trigger="day-timeline" ${buildCalendarCardDataAttributes(viewModel)} style="top:${top}px;height:${height}px;${viewModel.accentStyle}">
      <h3>${escapeHtml(viewModel.title)}</h3>
      <p>${escapeHtml(viewModel.displayTimeText)}${viewModel.location ? ` · ${escapeHtml(viewModel.location)}` : ""}</p>
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
  refs.monthLabel.textContent = formatMonthLabel(monthStart);
  // 首次进入月视图时，用当前可见月份作为连续滚动窗口的锚点。
  if (!state.monthScroll.initialized) {
    state.monthScroll.rangeAnchor = monthStart;
    state.monthScroll.initialized = true;
  }
  const rangeOffset = monthDiff(state.monthScroll.rangeAnchor, monthStart);
  // 如果当前可见月份已经跑出预渲染窗口，就把窗口整体挪回它附近。
  if (rangeOffset < -1 || rangeOffset > 6) {
    state.monthScroll.rangeAnchor = monthStart;
  }
  state.monthScroll.focusMonth = isoDate(monthStart);

  // 预渲染“前 2 个月 + 当前窗口 7 个月”，实现苹果日历式的连续上下滚动。
  const months = Array.from({ length: 9 }, (_, index) => addMonths(state.monthScroll.rangeAnchor, index - 2));
  refs.calendarGrid.className = "calendar-grid calendar-month-scroller";
  refs.calendarGrid.innerHTML = months.map((month) => renderMonthSection(month)).join("");

  /* 月视图这里有三套点击语义并存：
     1. 单击日期格：只更新选中日期，不跳视图
     2. 双击标题行：跳到日视图
     3. 双击内容区空白：直接进入“单天全天事项”的快速输入 */
  refs.calendarGrid.querySelectorAll(".calendar-day").forEach((button) => {
    button.addEventListener("click", () => {
      selectMonthDateInPlace(button.dataset.date);
      state.visibleWeek = startOfWeek(parseDate(state.selectedDate));
      if (!state.editingEventId) {
        seedEmptyInputForm();
      }
    });
    button.addEventListener("dblclick", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(".calendar-day-header")) {
        finishMonthQuickEntry({ render: false });
        navigateToDateDetail(button.dataset.date, { preferredView: "day" });
        return;
      }
      if (event.target.closest("[data-month-event-id], .month-inline-chip")) return;
      finishMonthQuickEntry({ render: false });
      const created = createSingleDayAllDayQuickEntry(button.dataset.date, {
        initialTitle: "新建日程",
        sourceType: "month_quick_entry",
      });
      activateMonthQuickEntry(created, { draftTitle: "", render: true });
    });
  });

  refs.calendarGrid.querySelectorAll("[data-month-event-id]:not([data-month-quick-entry])").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectMonthDateInPlace(button.dataset.anchorDate || state.selectedDate);
      navigateToRecordInWorkspace(button.dataset.monthEventId, {
        preferredView: "month",
        forceRender: false,
        forceScroll: false,
        behavior: "auto",
      });
    });
  });

  refs.calendarGrid.querySelectorAll("[data-month-all-day-event-id][data-month-single-all-day='true']").forEach((button) => {
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const recordId = button.dataset.monthAllDayEventId;
      const record = getRecordById(recordId);
      if (!record || !isMonthQuickEditableRecord(record)) return;
      selectMonthDateInPlace(record.date || state.selectedDate);
      navigateToRecordInWorkspace(recordId, {
        preferredView: "month",
        forceRender: false,
        forceScroll: false,
        behavior: "auto",
      });
      activateMonthQuickEntry(record, { draftTitle: record.title || "", render: true });
    });
  });

  refs.calendarGrid.querySelectorAll("[data-month-quick-input]").forEach((input) => {
    const recordId = input.dataset.monthQuickInput;
    input.addEventListener("input", () => {
      state.monthQuickEntry = {
        ...state.monthQuickEntry,
        recordId,
        draftTitle: input.value,
      };
      // 一旦用户开始键入，就认为他进入“快速改标题”语义，详情弹层应自动让位。
      if (state.eventDetailPopover?.recordId === recordId) {
        closeEventDetailPopover({ statusMessage: "" });
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleMonthQuickEntrySubmit(recordId, input.value);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const moved = moveMonthQuickEntryFocus(recordId, event.key === "ArrowUp" ? -1 : 1, input.value);
        if (moved) {
          event.preventDefault();
        }
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !input.value.trim()) {
        event.preventDefault();
        // 空标题再次删除，直接删掉这条空白事项，做出列表应用里常见的“退空项”手感。
        const deleted = deleteEventRecordById(recordId, {
          closePopover: true,
          statusMessage: "已删除空白全天事项。",
        });
        if (deleted) {
          clearMonthQuickEntry();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finishMonthQuickEntry();
      }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (activeElement?.matches?.("[data-month-quick-input]")) return;
        if (allDayQuickEntryPointerTarget) return;
        // 只有在确认不是“鼠标点击触发的失焦”时，blur 才允许兜底退出。
        if (state.monthQuickEntry.recordId === recordId) {
          finishMonthQuickEntry({ title: input.value });
        }
      }, 0);
    });
  });

  const focusToken = state.monthQuickEntry.focusToken;
  if (focusToken && state.monthQuickEntry.recordId) {
    requestAnimationFrame(() => {
      if (focusToken !== state.monthQuickEntry.focusToken) return;
      const input = refs.calendarGrid?.querySelector(`[data-month-quick-input="${state.monthQuickEntry.recordId}"]`);
      if (!input) return;
      input.focus();
      if (input.value) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }

  syncMonthScrollerToFocusedMonth();
  refs.calendarGrid.onscroll = handleMonthScrollerScroll;
}

function selectMonthDateInPlace(dateIso) {
  state.selectedDate = dateIso;
  updateSelectedDateLabel();
  if (!refs.calendarGrid) return;
  refs.calendarGrid.querySelectorAll(".calendar-day.is-selected").forEach((node) => node.classList.remove("is-selected"));
  refs.calendarGrid.querySelector(`.calendar-day[data-date="${dateIso}"]`)?.classList.add("is-selected");
}

function isMonthQuickEditableRecord(record) {
  // 第一阶段只允许“单天全天事项”进入月视图快速输入。
  // 跨天事项和定时事项仍然走详情弹层，避免月视图里的编辑语义变复杂。
  return Boolean(
    record
    && record.recordType === "calendar"
    && isAllDayLikeRecord(record)
    && String(getEventEndDateIso(record) || "") === String(record.date || "")
  );
}

function getMonthQuickEntryRecord() {
  return state.monthQuickEntry.recordId ? getRecordById(state.monthQuickEntry.recordId) : null;
}

function clearMonthQuickEntry() {
  // 只清临时 UI 态，不负责保存；保存由 finishMonthQuickEntry / handleMonthQuickEntrySubmit 负责。
  state.monthQuickEntry = {
    recordId: "",
    date: "",
    draftTitle: "",
    focusToken: 0,
  };
}

/* 月视图删除全天事项后，真正变化的是“周条带高度”，不是月份标题本身。
   所以这里先记录当前视口顶部附近那一周，再记录月份级偏移作为回退。
   后续重绘时优先按周恢复，能让用户感觉“我正在看的这片区域没跳走”。 */
function preserveMonthScrollerPosition() {
  if (!refs.calendarGrid || state.activeView !== "month") return;
  const sections = Array.from(refs.calendarGrid.querySelectorAll(".month-section"));
  if (!sections.length) return;
  const topLine = refs.calendarGrid.scrollTop + 24;
  let activeSection = sections[0];
  for (const section of sections) {
    if (section.offsetTop <= topLine) activeSection = section;
  }
  const monthIso = activeSection?.dataset.monthStart;
  if (monthIso) {
    state.monthScroll.focusMonth = monthIso;
    state.visibleMonth = parseDate(monthIso);
  }
  state.monthScroll.restoreOffset = refs.calendarGrid.scrollTop - activeSection.offsetTop;
  const weekRows = Array.from(refs.calendarGrid.querySelectorAll(".month-week-row"));
  if (!weekRows.length) {
    state.monthScroll.restoreWeekStart = "";
    state.monthScroll.restoreWeekOffset = 0;
    return;
  }
  let activeWeekRow = weekRows[0];
  for (const row of weekRows) {
    if (row.offsetTop <= topLine) activeWeekRow = row;
  }
  state.monthScroll.restoreWeekStart = String(activeWeekRow?.dataset.weekStart || "");
  state.monthScroll.restoreWeekOffset = refs.calendarGrid.scrollTop - activeWeekRow.offsetTop;
}

/* calendar 卡片的共享可变 payload 基座：
   任何“修改已有事项”的交互，无论来自详情、快速输入还是未来的拖拽，
   都应该先从这里拿一份完整 payload，再只覆写真正变化的字段。
   这样不会把标签、颜色、地点、备注等非时间信息意外清空。 */
function buildMutableEventPayload(record, overrides = {}) {
  return {
    id: record.id,
    title: record.title || "新建日程",
    date: record.date || state.selectedDate,
    endDate: getEventEndDateIso(record),
    allDay: isAllDayLikeRecord(record),
    startTime: record.startTime || "",
    endTime: record.endTime || "",
    location: record.location || "",
    tags: ensureDefaultTags("calendar", Array.isArray(record.tags) ? record.tags : []),
    tagColor: record.tagColor || getPrimaryRecordColor(record),
    importance: record.importance || "normal",
    notes: record.notes || "",
    rawInput: "",
    sourceType: record.sourceType || "manual_ui",
    ...overrides,
  };
}

/* 共享 calendar 卡片 view-model：
   目标不是把所有视图强行改成同一个 DOM，而是给不同视图都提供同一种“交互语义描述”。
   这样拖拽层、命中层、埋点层都可以只看这份模型，而不用分别解析 day/week/month 的 HTML。 */
function buildCalendarCardViewModel(record, context = {}) {
  const isAllDay = isAllDayLikeRecord(record);
  const startDate = record?.date || state.selectedDate;
  const endDate = getEventEndDateIso(record);
  const startTime = isAllDay ? "" : normalizeTimeOnly(record?.startTime) || extractTimePart(record?.startAt || "");
  const endTime = isAllDay ? "" : normalizeTimeOnly(record?.endTime) || extractTimePart(record?.endAt || "");
  const accentColor = getPrimaryRecordColor(record);
  const cardKind = String(context.cardKind || (isAllDay ? "week_all_day" : "week_timed"));
  const dragKind = String(context.dragKind || (isAllDay ? "move_all_day" : "move_timed"));
  return {
    recordId: String(record?.id || ""),
    title: String(record?.title || ""),
    location: String(record?.location || ""),
    notes: String(record?.notes || ""),
    accentColor,
    accentStyle: buildRecordAccentStyle(record),
    isAllDay,
    startDate,
    endDate,
    startAt: normalizeLocalDateTime(record?.startAt) || `${startDate}T${isAllDay ? "00:00" : (startTime || "00:00")}`,
    endAt: normalizeLocalDateTime(record?.endAt) || `${isAllDay ? addDaysToIsoDate(endDate, 1) : endDate}T${isAllDay ? "00:00" : (endTime || startTime || "00:00")}`,
    startTime,
    endTime,
    /* 卡片里的时间文本统一绑定“原始 record 的真实起止时间”，
       而不是当前视图拆分出来的 segment 起止时间。
       这样跨天定时事项即使被拆成多张卡片显示，每一张卡片里也会展示同一组真实起止。 */
    displayTimeText: formatCalendarCardTimeRange({
      isAllDay,
      startDate,
      endDate,
      startTime,
      endTime,
    }),
    cardKind,
    dragKind,
  };
}

/* 把共享 view-model 投影成稳定的 data-* 标记。
   第一阶段先只做元数据接入，不改变外观；
   后续拖拽命中与自动化测试都可以直接依赖这些标记。 */
function buildCalendarCardDataAttributes(viewModel) {
  return [
    `data-record-id="${escapeHtml(viewModel.recordId)}"`,
    `data-card-kind="${escapeHtml(viewModel.cardKind)}"`,
    `data-drag-kind="${escapeHtml(viewModel.dragKind)}"`,
    `data-all-day="${viewModel.isAllDay ? "true" : "false"}"`,
    `data-start-date="${escapeHtml(viewModel.startDate)}"`,
    `data-end-date="${escapeHtml(viewModel.endDate)}"`,
  ].join(" ");
}

/* 统一时间变更 helper：
   未来拖拽、吸附、跨区转换都不应直接拼 date/startTime/endTime，
   而是先描述“我想怎么改时间”，由这一层负责生成安全 payload。 */
function mutateCalendarTemporal(record, mutation = {}) {
  if (!record || record.recordType !== "calendar") return null;
  const base = buildMutableEventPayload(record);
  const nextAllDay = mutation.allDay == null ? base.allDay : Boolean(mutation.allDay);
  const nextDate = normalizeDateOnly(mutation.date || base.date) || base.date;
  const nextEndDateRaw = normalizeDateOnly(mutation.endDate || base.endDate || nextDate) || nextDate;
  const nextEndDate = nextEndDateRaw < nextDate ? nextDate : nextEndDateRaw;
  const nextStartTime = nextAllDay ? "" : normalizeTimeOnly(mutation.startTime != null ? mutation.startTime : base.startTime);
  const nextEndTime = nextAllDay ? "" : normalizeTimeOnly(mutation.endTime != null ? mutation.endTime : base.endTime);
  return {
    ...base,
    allDay: nextAllDay,
    date: nextDate,
    endDate: nextEndDate,
    startTime: nextStartTime,
    endTime: nextEndTime || nextStartTime,
    startAt: mutation.startAt || "",
    endAt: mutation.endAt || "",
  };
}

/* 定时事项按分钟平移。
   这会保留原时长，只改变开始/结束时刻，是日/周视图拖拽移动最常见的底层操作。 */
function moveTimedEventByMinutes(record, deltaMinutes) {
  if (!record || record.recordType !== "calendar" || isAllDayLikeRecord(record)) return null;
  const startAt = new Date(`${record.date}T${normalizeTimeOnly(record.startTime) || "00:00"}:00`);
  const endAt = new Date(`${getEventEndDateIso(record)}T${normalizeTimeOnly(record.endTime) || normalizeTimeOnly(record.startTime) || "00:00"}:00`);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
  startAt.setMinutes(startAt.getMinutes() + deltaMinutes);
  endAt.setMinutes(endAt.getMinutes() + deltaMinutes);
  return mutateCalendarTemporal(record, {
    allDay: false,
    date: isoDate(startAt),
    endDate: isoDate(endAt),
    startTime: `${String(startAt.getHours()).padStart(2, "0")}:${String(startAt.getMinutes()).padStart(2, "0")}`,
    endTime: `${String(endAt.getHours()).padStart(2, "0")}:${String(endAt.getMinutes()).padStart(2, "0")}`,
  });
}

function timelineHitToTimestamp(dateIso, minutes) {
  const safeDate = normalizeDateOnly(dateIso);
  if (!safeDate) return NaN;
  const date = parseDate(safeDate);
  date.setHours(0, 0, 0, 0);
  date.setMinutes(Number(minutes) || 0);
  return date.getTime();
}

/* 全天 -> 定时 的转换 payload。
   先不直接接 UI，只把规则固定下来：
   - 落在哪一天、哪一分钟开始
   - 默认时长 60 分钟
   这样后面日/周视图把全天卡片拖进时间轴时，可以直接复用。 */
function convertAllDayRecordToTimedPayload(record, targetDateIso, startMinutes, durationMinutes = 60) {
  if (!record || record.recordType !== "calendar") return null;
  const safeDate = normalizeDateOnly(targetDateIso) || record.date || state.selectedDate;
  const start = Math.max(0, Math.min(24 * 60 - 15, Number(startMinutes) || 0));
  const duration = Math.max(15, Number(durationMinutes) || 60);
  const end = Math.min(24 * 60, start + duration);
  return mutateCalendarTemporal(record, {
    allDay: false,
    date: safeDate,
    endDate: safeDate,
    startTime: formatMinutes(start),
    endTime: formatMinutes(end),
  });
}

/* 定时 -> 全天 的转换 payload。
   当前规则保持最保守：
   - 清空时间
   - 日期范围按现有 start/end 的日粒度投影
   后面如果需要引入“保留天数跨度”的更复杂策略，可以继续在这里扩展。 */
function convertTimedRecordToAllDayPayload(record, targetDateIso = "") {
  if (!record || record.recordType !== "calendar") return null;
  const startDate = normalizeDateOnly(targetDateIso) || record.date || state.selectedDate;
  const endDate = getEventEndDateIso(record);
  return mutateCalendarTemporal(record, {
    allDay: true,
    date: startDate,
    endDate: endDate < startDate ? startDate : endDate,
    startTime: "",
    endTime: "",
  });
}

function persistMonthQuickEntryTitle(recordId, rawTitle) {
  const record = getRecordById(recordId);
  if (!record || !isMonthQuickEditableRecord(record)) return null;
  const normalizedTitle = String(rawTitle || "").trim() || "新建日程";
  if (normalizedTitle === String(record.title || "").trim()) {
    return record;
  }
  // 标题真正落库只走这一处，保持月视图快速输入和传统编辑共用同一套写路径。
  updateExistingEvent(buildMutableEventPayload(record, { title: normalizedTitle }));
  persistState();
  return getRecordById(recordId);
}

function moveRecordAfterAnchor(recordId, anchorRecordId) {
  /* 回车连续新增时，希望“新条目紧跟当前条目下面出现”。
     这里不改排序规则本身，只在 records 数组里把新建项移动到锚点后面，
     用最小代价做出清单式连续录入的体感。 */
  if (!recordId || !anchorRecordId || recordId === anchorRecordId) return;
  const list = Array.isArray(state.db.records) ? state.db.records : [];
  const recordIndex = list.findIndex((item) => item.id === recordId);
  const anchorIndex = list.findIndex((item) => item.id === anchorRecordId);
  if (recordIndex < 0 || anchorIndex < 0) return;
  const [record] = list.splice(recordIndex, 1);
  const nextAnchorIndex = list.findIndex((item) => item.id === anchorRecordId);
  list.splice(nextAnchorIndex + 1, 0, record);
}

/* 轻量全天事项的统一新建入口：
   - 月视图和周视图的“快速输入”都用它
   - 只创建单天全天事项，不在这里处理跨天事项
   - 如有 afterRecordId，会把新项移动到锚点后面，做出清单式“紧跟上一条继续输入”的顺序感 */
function createSingleDayAllDayQuickEntry(dateIso, options = {}) {
  const anchorRecordId = options.afterRecordId || "";
  const event = createEventFromForm({
    id: "",
    title: options.initialTitle || "新建日程",
    date: dateIso,
    endDate: dateIso,
    allDay: true,
    startTime: "",
    endTime: "",
    location: "",
    tags: [],
    tagColor: getDefaultTagColor("calendar"),
    importance: "normal",
    notes: "",
    rawInput: "",
    sourceType: options.sourceType || "month_quick_entry",
  }, {
    seedForm: false,
  });
  if (anchorRecordId) {
    moveRecordAfterAnchor(event.id, anchorRecordId);
  }
  state.selectedDate = dateIso;
  state.visibleMonth = startOfMonth(parseDate(dateIso));
  state.visibleWeek = startOfWeek(parseDate(dateIso));
  persistState();
  return event;
}

function activateMonthQuickEntry(record, options = {}) {
  if (!record || !isMonthQuickEditableRecord(record)) return;
  /* 进入快速输入前先记住当前月视图滚动位置。
     因为接下来会 renderCalendar，若不先存锚点，视口可能被恢复到错误的月份/周。 */
  if (options.render !== false) {
    preserveMonthScrollerPosition();
  }
  state.monthQuickEntry = {
    recordId: record.id,
    date: record.date || state.selectedDate,
    draftTitle: options.draftTitle ?? String(record.title || ""),
    focusToken: state.monthQuickEntry.focusToken + 1,
  };
  if (options.render !== false) {
    renderCalendar();
  }
}

function finishMonthQuickEntry(options = {}) {
  const active = getMonthQuickEntryRecord();
  if (!active) {
    clearMonthQuickEntry();
    return;
  }
  /* “退出快速输入”有两步：
     1. 用当前草稿标题落库；如果是空标题，内部会用默认名兜底
     2. 清掉月视图临时输入态，并按周锚点把滚动位置恢复回去 */
  if (options.render !== false) {
    preserveMonthScrollerPosition();
  }
  const draftTitle = options.title ?? state.monthQuickEntry.draftTitle;
  persistMonthQuickEntryTitle(active.id, draftTitle);
  clearMonthQuickEntry();
  if (options.render !== false) {
    renderCalendar();
  }
}

function handleMonthQuickEntrySubmit(recordId, rawTitle = state.monthQuickEntry.draftTitle) {
  const current = getRecordById(recordId);
  if (!current || !isMonthQuickEditableRecord(current)) {
    clearMonthQuickEntry();
    preserveMonthScrollerPosition();
    renderCalendar();
    return;
  }
  /* 回车连续创建时，优先读取当前 input 的实时值，而不是完全依赖 state 里的草稿。
     这样可以避开输入法确认 / 高频键入时 input 事件与重绘之间的时序差，避免“只连续创建一次就退出”。 */
  const typedTitle = String(rawTitle || "").trim();
  const normalized = typedTitle || "新建日程";
  preserveMonthScrollerPosition();
  persistMonthQuickEntryTitle(recordId, normalized);
  /* 月视图 quick-entry 现在遵循“回车永远继续下一条”：
     即使当前标题为空，也先用默认标题落库，再在同一天继续创建下一条，
     让整套交互更接近清单应用里的连续录入。 */
  const next = createSingleDayAllDayQuickEntry(current.date, {
    afterRecordId: recordId,
    initialTitle: "新建日程",
    sourceType: "month_quick_entry",
  });
  activateMonthQuickEntry(next, { draftTitle: "", render: true });
}

function moveMonthQuickEntryFocus(recordId, offset, rawTitle = state.monthQuickEntry.draftTitle) {
  if (!refs.calendarGrid) return false;
  /* 上下键切换沿用“当前屏幕上看到的条带顺序”：
     直接从 DOM 中收集可快速编辑的全天事项，比再维护一份平行排序更稳，
     也能保证月视图里光标移动方向和用户视觉顺序一致。 */
  const entries = Array.from(refs.calendarGrid.querySelectorAll("[data-month-all-day-event-id][data-month-single-all-day='true'], [data-month-quick-entry]"));
  const currentIndex = entries.findIndex((node) => String(node.dataset.monthAllDayEventId || node.dataset.monthQuickEntry || "") === String(recordId));
  if (currentIndex < 0) return false;
  const nextIndex = currentIndex + offset;
  if (nextIndex < 0 || nextIndex >= entries.length) return false;
  persistMonthQuickEntryTitle(recordId, rawTitle);
  const targetId = String(entries[nextIndex].dataset.monthAllDayEventId || entries[nextIndex].dataset.monthQuickEntry || "");
  const targetRecord = getRecordById(targetId);
  if (!targetRecord || !isMonthQuickEditableRecord(targetRecord)) return false;
  activateMonthQuickEntry(targetRecord, { draftTitle: String(targetRecord.title || ""), render: true });
  return true;
}

function getWeekQuickEntryRecord() {
  return state.weekQuickEntry.recordId ? getRecordById(state.weekQuickEntry.recordId) : null;
}

function clearWeekQuickEntry() {
  state.weekQuickEntry = {
    recordId: "",
    date: "",
    draftTitle: "",
    focusToken: 0,
  };
}

/* 周视图滚动骨架分成三层：
   - topPane 负责横向
   - scrollBody 同时负责横向与纵向
   - timePane 负责纵向
   所以在重绘顶部全天栏前，要先把“当前最左侧完整显示的日期 + 当前纵向 scrollTop”
   都记下来。周视图现在只按整天恢复，避免旧的像素偏移在重绘后累积成错位。 */
function preserveWeekPanePosition() {
  const topPane = getWeekHorizontalPane();
  const bodyPane = getWeekScrollBody();
  if (!topPane || !bodyPane || state.activeView !== "week") return;
  const leftEdgeDate = getWeekLeftEdgeDateFromScrollLeft(bodyPane.scrollLeft);
  state.weekPaneScroll.leftEdgeDate = leftEdgeDate;
  state.visibleWeek = startOfWeek(parseDate(leftEdgeDate));
  state.weekPaneScroll.restoreScrollTop = bodyPane.scrollTop;
}

function captureWeekPreviewViewport() {
  const bodyPane = getWeekScrollBody();
  if (!bodyPane || state.activeView !== "week") return;
  /* 拖拽创建预览不是“跳转到某一天”，只是同一视口里的临时覆盖层。
     因此这里直接记录原始 scrollLeft / scrollTop，
     后续重绘时按像素恢复，而不是再经过“左边界整天吸附”的常规恢复逻辑。 */
  clearWeekSnapMonitor();
  clearWeekSnapAnimation();
  state.weekPaneScroll.previewLockActive = true;
  state.weekPaneScroll.previewScrollLeft = bodyPane.scrollLeft;
  state.weekPaneScroll.previewScrollTop = bodyPane.scrollTop;
}

function clearWeekPreviewViewportLock() {
  state.weekPaneScroll.previewLockActive = false;
}

function restoreWeekPreviewViewport() {
  const topPane = getWeekHorizontalPane();
  const timePane = getWeekTimePane();
  const bodyPane = getWeekScrollBody();
  if (!topPane || !timePane || !bodyPane) return;
  state.weekPaneScroll.syncingAxes = true;
  topPane.scrollLeft = state.weekPaneScroll.previewScrollLeft || 0;
  bodyPane.scrollLeft = state.weekPaneScroll.previewScrollLeft || 0;
  timePane.scrollTop = state.weekPaneScroll.previewScrollTop || 0;
  bodyPane.scrollTop = state.weekPaneScroll.previewScrollTop || 0;
  state.weekPaneScroll.suppressNextScroll = true;
  requestAnimationFrame(() => {
    state.weekPaneScroll.syncingAxes = false;
  });
}

function activateWeekQuickEntry(record, options = {}) {
  if (!record || !isMonthQuickEditableRecord(record)) return;
  if (options.render !== false) {
    preserveWeekPanePosition();
  }
  state.weekQuickEntry = {
    recordId: record.id,
    date: record.date || state.selectedDate,
    draftTitle: options.draftTitle ?? String(record.title || ""),
    focusToken: state.weekQuickEntry.focusToken + 1,
  };
  if (options.render !== false) {
    renderWeekView();
  }
}

function finishWeekQuickEntry(options = {}) {
  const active = getWeekQuickEntryRecord();
  if (!active) {
    clearWeekQuickEntry();
    return;
  }
  if (options.render !== false) {
    preserveWeekPanePosition();
  }
  const draftTitle = options.title ?? state.weekQuickEntry.draftTitle;
  persistMonthQuickEntryTitle(active.id, draftTitle);
  clearWeekQuickEntry();
  if (options.render !== false) {
    renderWeekView();
  }
}

function handleWeekQuickEntrySubmit(recordId, rawTitle = state.weekQuickEntry.draftTitle) {
  const current = getRecordById(recordId);
  if (!current || !isMonthQuickEditableRecord(current)) {
    clearWeekQuickEntry();
    preserveWeekPanePosition();
    renderWeekView();
    return;
  }
  /* 周视图顶部全天栏和月视图共享同一套“回车继续生下一条”的手感目标。
     这里同样优先读取当前输入框的实时值，避免第二条开始后因为 state 草稿滞后而被误判为空标题。 */
  const typedTitle = String(rawTitle || "").trim();
  const normalized = typedTitle || "新建日程";
  preserveWeekPanePosition();
  persistMonthQuickEntryTitle(recordId, normalized);
  /* 周视图顶部全天栏与月视图保持同一规则：空标题回车也继续下一条。 */
  const next = createSingleDayAllDayQuickEntry(current.date, {
    afterRecordId: recordId,
    initialTitle: "新建日程",
    sourceType: "week_quick_entry",
  });
  activateWeekQuickEntry(next, { draftTitle: "", render: true });
}

function moveWeekQuickEntryFocus(recordId, offset, rawTitle = state.weekQuickEntry.draftTitle) {
  if (!refs.weekGrid) return false;
  /* 周视图顶部全天栏同样按当前渲染顺序移动光标。
     这里只在现有单天全天事项之间切换；越界时什么都不做，保持原位。 */
  const entries = Array.from(refs.weekGrid.querySelectorAll("[data-week-all-day-event-id][data-week-single-all-day='true'], [data-week-quick-entry]"));
  const currentIndex = entries.findIndex((node) => String(node.dataset.weekAllDayEventId || node.dataset.weekQuickEntry || "") === String(recordId));
  if (currentIndex < 0) return false;
  const nextIndex = currentIndex + offset;
  if (nextIndex < 0 || nextIndex >= entries.length) return false;
  persistMonthQuickEntryTitle(recordId, rawTitle);
  const targetId = String(entries[nextIndex].dataset.weekAllDayEventId || entries[nextIndex].dataset.weekQuickEntry || "");
  const targetRecord = getRecordById(targetId);
  if (!targetRecord || !isMonthQuickEditableRecord(targetRecord)) return false;
  activateWeekQuickEntry(targetRecord, { draftTitle: String(targetRecord.title || ""), render: true });
  return true;
}

function renderMonthDay(day, monthStart, laneCount = 0) {
  const dayIso = isoDate(day);
  const events = getEventsForDate(dayIso).filter((event) => !isAllDayLikeRecord(event)).slice(0, 2);
  const isToday = dayIso === isoDate(new Date());
  const isSelected = dayIso === state.selectedDate;
  const isOtherMonth = day.getMonth() !== monthStart.getMonth();

  return `
    <article class="calendar-day ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""} ${isOtherMonth ? "is-other-month" : ""}" data-date="${dayIso}" style="--month-bar-slot-height:${Math.max(0, laneCount) * 20}px;">
      <div class="calendar-day-header">
        <span>${day.getDate()}</span>
        <span class="chip">${getEventsForDate(dayIso).length}</span>
      </div>
      <div class="month-bar-slot" aria-hidden="true"></div>
      <div class="day-events">
        ${events.map((event) => {
          const viewModel = buildCalendarCardViewModel(event, { cardKind: "month_inline", dragKind: "move_timed" });
          return `<button class="event-chip month-inline-chip" data-month-event-id="${event.id}" data-anchor-date="${dayIso}" data-event-detail-trigger="month-inline" ${buildCalendarCardDataAttributes(viewModel)} type="button" style="${viewModel.accentStyle}">${escapeHtml(formatEventChip(viewModel))}</button>`;
        }).join("")}
      </div>
    </article>
  `;
}

function renderMonthSection(monthStart) {
  const gridStart = startOfWeek(monthStart);
  const nextMonth = addMonths(monthStart, 1);
  const days = [];
  let cursor = new Date(gridStart);
  while (cursor < nextMonth || cursor.getDay() !== 1) {
    days.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }

  const weeks = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  return `
    <section class="month-section" data-month-start="${isoDate(monthStart)}">
      <h3 class="month-section-title">${escapeHtml(formatMonthLabel(monthStart))}</h3>
      ${weeks.map((weekDays) => renderMonthWeekRow(weekDays, monthStart)).join("")}
    </section>
  `;
}

function renderMonthWeekRow(weekDays, monthStart) {
  const { bars, laneCount } = buildMonthWeekBars(weekDays);
  const weekStartIso = isoDate(weekDays[0]);
  return `
    <!-- data-week-start 是月视图滚动恢复锚点：
         删除全天事项后整周高度会变化，重绘时需要靠“这周的起始日期”把视口拉回原位置。 -->
    <div class="month-week-row" data-week-start="${weekStartIso}" style="--month-bar-lanes:${Math.max(laneCount, 0)};">
      <div class="month-section-grid month-week-grid">
        ${weekDays.map((day) => renderMonthDay(day, monthStart, laneCount)).join("")}
      </div>
      ${bars ? `<div class="month-week-bars">${bars}</div>` : ""}
    </div>
  `;
}

function buildMonthWeekBars(weekDays) {
  const weekStartIso = isoDate(weekDays[0]);
  const weekEndIso = isoDate(weekDays[weekDays.length - 1]);
  /* 全天条带排序沿用现有规则：
     - 跨天更长的优先占上层
     - 同跨度时按开始日期排序
     月视图快速输入只是复用这层渲染，不单独发明第二套“全天布局系统”。 */
  const allDayRecords = getActiveRecordsByType("calendar")
    .filter((record) => record.date && isAllDayLikeRecord(record) && getEventEndDateIso(record) >= weekStartIso && record.date <= weekEndIso)
    .sort((left, right) => {
      const leftSpan = dayDiff(parseDate(left.date), parseDate(getEventEndDateIso(left))) + 1;
      const rightSpan = dayDiff(parseDate(right.date), parseDate(getEventEndDateIso(right))) + 1;
      if (leftSpan !== rightSpan) return rightSpan - leftSpan;
      return left.date.localeCompare(right.date);
    });

  const lanes = [];
  const bars = allDayRecords.map((record) => {
    const viewModel = buildCalendarCardViewModel(record, { cardKind: "month_span", dragKind: "move_all_day" });
    const startIso = record.date;
    const endIso = getEventEndDateIso(record);
    const singleDayQuickEditable = isMonthQuickEditableRecord(record);
    const quickEditing = singleDayQuickEditable && state.monthQuickEntry.recordId === record.id;
    const anchorIso = startIso < weekStartIso ? weekStartIso : startIso;
    const startIndex = Math.max(0, dayDiff(parseDate(weekStartIso), parseDate(startIso)));
    const endIndex = Math.min(6, dayDiff(parseDate(weekStartIso), parseDate(endIso)));
    if (endIndex < 0 || startIndex > 6) return "";

    let lane = 0;
    while (lanes[lane] && lanes[lane] >= startIndex) lane += 1;
    lanes[lane] = endIndex;

    // 同一条记录在月视图里有两种外观：
    // 普通态是 button，支持点击看详情；快速输入态是 input，支持直接改标题。
    const gridStyle = `grid-column:${startIndex + 1} / ${endIndex + 2};grid-row:${lane + 1};${viewModel.accentStyle}`;
    if (quickEditing) {
      return `
        <div
          class="month-span-bar is-editing${startIso < weekStartIso ? " is-continued-left" : ""}${endIso > weekEndIso ? " is-continued-right" : ""}"
          data-month-event-id="${record.id}"
          data-month-quick-entry="${record.id}"
          data-anchor-date="${anchorIso}"
          ${buildCalendarCardDataAttributes(viewModel)}
          style="${gridStyle}"
        >
          <input
            class="month-quick-entry-input"
            data-month-quick-input="${record.id}"
            type="text"
            value="${escapeHtml(state.monthQuickEntry.draftTitle)}"
            placeholder="新建日程"
            aria-label="快速输入全天事项标题"
          >
        </div>
      `;
    }
    return `
      <button
        class="month-span-bar${singleDayQuickEditable ? " is-quick-editable" : ""}${startIso < weekStartIso ? " is-continued-left" : ""}${endIso > weekEndIso ? " is-continued-right" : ""}"
        data-month-event-id="${record.id}"
        data-month-all-day-event-id="${record.id}"
        data-month-single-all-day="${singleDayQuickEditable ? "true" : "false"}"
        data-anchor-date="${anchorIso}"
        data-event-detail-trigger="month-span"
        ${buildCalendarCardDataAttributes(viewModel)}
        type="button"
        style="${gridStyle}"
      >
        <span>${escapeHtml(viewModel.title)}</span>
        ${(endIso === startIso && viewModel.endTime) ? `<span class="month-span-meta">${escapeHtml(`结束时间：${viewModel.endTime}`)}</span>` : ""}
      </button>
    `;
  }).filter(Boolean).join("");

  return {
    bars,
    laneCount: lanes.length,
  };
}

function syncMonthScrollerToFocusedMonth() {
  if (!refs.calendarGrid) return;
  const token = ++state.monthScroll.syncToken;
  requestAnimationFrame(() => {
    if (token !== state.monthScroll.syncToken) return;
    /* 恢复顺序：
       1. 先尝试按“当前视口顶部附近那一周”恢复，专门用于删除全天事项后的稳定回位
       2. 如果周锚点不存在，再退回原来的“按月份标题恢复” */
    const weekStart = String(state.monthScroll.restoreWeekStart || "");
    if (weekStart) {
      const weekRow = refs.calendarGrid.querySelector(`.month-week-row[data-week-start="${weekStart}"]`);
      if (weekRow) {
        refs.calendarGrid.scrollTop = Math.max(0, weekRow.offsetTop + (state.monthScroll.restoreWeekOffset || 0));
        state.monthScroll.restoreWeekStart = "";
        state.monthScroll.restoreWeekOffset = 0;
        state.monthScroll.restoreOffset = 0;
        state.monthScroll.suppressNextScroll = true;
        return;
      }
      state.monthScroll.restoreWeekStart = "";
      state.monthScroll.restoreWeekOffset = 0;
    }
    const section = refs.calendarGrid.querySelector(`[data-month-start="${state.monthScroll.focusMonth}"]`);
    if (!section) return;
    // 重建月份窗口后，把滚动位置恢复到“活动月份标题 + 原相对偏移”。
    refs.calendarGrid.scrollTop = Math.max(0, section.offsetTop + (state.monthScroll.restoreOffset || 0));
    state.monthScroll.restoreOffset = 0;
    state.monthScroll.suppressNextScroll = true;
  });
}

function handleMonthScrollerScroll() {
  if (!refs.calendarGrid) return;
  if (state.monthScroll.suppressNextScroll) {
    state.monthScroll.suppressNextScroll = false;
    return;
  }
  const sections = Array.from(refs.calendarGrid.querySelectorAll(".month-section"));
  if (!sections.length) return;
  const topLine = refs.calendarGrid.scrollTop + 24;
  let activeSection = sections[0];
  for (const section of sections) {
    if (section.offsetTop <= topLine) activeSection = section;
  }

  const monthIso = activeSection.dataset.monthStart;
  if (monthIso) {
    const monthDate = parseDate(monthIso);
    state.visibleMonth = monthDate;
    refs.monthLabel.textContent = formatMonthLabel(monthDate);
  }

  const threshold = 320;
  const nearTop = refs.calendarGrid.scrollTop < threshold;
  const nearBottom = refs.calendarGrid.scrollHeight - refs.calendarGrid.clientHeight - refs.calendarGrid.scrollTop < threshold;
  if (!nearTop && !nearBottom) {
    state.monthScroll.edgeLock = null;
    return;
  }

  const edge = nearTop ? "top" : "bottom";
  // 仍停留在同一边缘区间时不重复重建，避免在极限位置反复抖动。
  if (state.monthScroll.edgeLock === edge) return;
  state.monthScroll.edgeLock = edge;

  const activeMonth = monthIso ? parseDate(monthIso) : state.visibleMonth;
  /* 窗口重建前同时记录：
     1. 当前活动月份离顶部的偏移，作为月份级回退
     2. 当前视口顶部附近那一周的偏移，作为更稳定的首选锚点
     这样无论是普通连续滚动，还是删除导致的周高变化，都尽量保持当前视野稳定。 */
  preserveMonthScrollerPosition();
  /*
    无论用户是从顶部还是底部逼近边缘，重建后的月份窗口都把当前活动月份重新放回中间区域。
    这样上下两端都会重新获得缓冲带，不会出现“底部重建后活动月份仍贴着底边”的连锁触发。 */
  state.monthScroll.rangeAnchor = addMonths(activeMonth, -2);
  state.monthScroll.focusMonth = isoDate(activeMonth);
  renderCalendar();
}

function dayDiff(baseDate, targetDate) {
  const base = new Date(baseDate);
  const target = new Date(targetDate);
  base.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function getWeekHorizontalPane() {
  return refs.weekGrid?.querySelector("#week-top-pane") || null;
}

function getWeekScrollBody() {
  return refs.weekGrid?.querySelector("#week-scroll-body") || null;
}

function getWeekTimePane() {
  return refs.weekGrid?.querySelector("#week-time-pane") || null;
}

function getDayScrollShell() {
  return refs.dayView?.querySelector(".day-scroll-shell") || null;
}

function getEventAnchorRoot(view = state.activeView) {
  if (view === "day") return refs.dayView;
  if (view === "week") return refs.weekView;
  if (view === "month") return refs.monthView;
  return document;
}

function getAnchorViewport(element) {
  if (!element) return null;
  if (element.matches(".week-event-block")) {
    return getWeekScrollBody();
  }
  if (element.matches(".week-all-day-item")) {
    return getWeekHorizontalPane();
  }
  if (element.matches(".day-event-block")) {
    return getDayScrollShell();
  }
  if (element.matches(".day-all-day-chip")) {
    return refs.dayAllDayStrip;
  }
  if (element.matches(".month-inline-chip, .month-span-bar, .calendar-day")) {
    return refs.calendarGrid;
  }
  return null;
}

/* 详情卡片的动效锚点不能直接拿原始 DOM rect。
   例如：
   1. 周视图卡片可能只露出半张
   2. 月视图事项可能被滚动容器裁切
   如果直接拿完整 rect，缩放中心会落在用户看不到的区域里。
   这里先把锚点和它所属滚动视口做一次求交，只保留“当前实际可见”的视觉框。 */
function getPopoverAnchorRect(anchorElement) {
  if (!anchorElement) return null;
  const rect = anchorElement.getBoundingClientRect();
  const viewport = getAnchorViewport(anchorElement);
  if (!viewport) {
    return rect;
  }
  const viewportRect = viewport.getBoundingClientRect();
  const left = Math.max(rect.left, viewportRect.left);
  const right = Math.min(rect.right, viewportRect.right);
  const top = Math.max(rect.top, viewportRect.top);
  const bottom = Math.min(rect.bottom, viewportRect.bottom);
  if (right <= left || bottom <= top) {
    return rect;
  }
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function isAnchorVisibleInViewport(element, viewport, padding = 12) {
  if (!element || !viewport) return false;
  const elementRect = element.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  return (
    elementRect.left >= viewportRect.left + padding &&
    elementRect.right <= viewportRect.right - padding &&
    elementRect.top >= viewportRect.top + padding &&
    elementRect.bottom <= viewportRect.bottom - padding
  );
}

function isRecordVisibleInView(recordId, view = state.activeView) {
  const anchor = findEventDetailAnchorElement(recordId, { view });
  if (!anchor) return false;
  const viewport = getAnchorViewport(anchor);
  if (!viewport) return false;
  return isAnchorVisibleInViewport(anchor, viewport);
}

function resolveRecordNavigationView(preferredView = state.activeView) {
  return preferredView === "todo" ? "week" : preferredView;
}

function prepareViewForRecord(record, view) {
  if (!record?.date) return;
  const nextView = view === "day" ? "day" : (view === "month" ? "month" : "week");
  const viewChanged = state.activeView !== nextView;
  if (viewChanged) {
    state.activeView = nextView;
  }
  state.selectedDate = record.date;
  state.visibleWeek = startOfWeek(parseDate(record.date));
  state.visibleMonth = startOfMonth(parseDate(record.date));
  if (state.activeView === "week") {
    /* AI 卡片 / 搜索结果跳到周视图时，继续保留“目标日期尽量位于视窗中部”的体验。
       但现在不是记一个半列像素偏移，而是直接把 7 天窗口的左边界挪到目标日前 3 天。 */
    syncWeekViewportState(getWeekCenteredLeftEdgeDate(record.date), { resetRangeAnchor: viewChanged });
    if (viewChanged) {
      state.weekPaneScroll.restoreScrollTop = record.startTime
        ? Math.max(0, minutesToOffset(timeToMinutes(record.startTime), WEEK_HOUR_HEIGHT) - WEEK_HOUR_HEIGHT * 2)
        : 0;
      state.weekPaneScroll.animateOnNextSync = false;
      state.weekPaneScroll.suppressNextScroll = false;
    }
  }
  if (state.activeView === "month") {
    state.monthScroll.focusMonth = isoDate(startOfMonth(parseDate(record.date)));
    if (viewChanged) {
      state.monthScroll.restoreOffset = 0;
      state.monthScroll.restoreWeekStart = "";
      state.monthScroll.restoreWeekOffset = 0;
    }
  }
}

function flashRecordAnchor(anchor) {
  if (!anchor) return;
  anchor.classList.remove("is-nav-flashing");
  // 重新触发动画，连续点击同一张卡片时仍然能给到明确反馈。
  void anchor.offsetWidth;
  anchor.classList.add("is-nav-flashing");
  window.setTimeout(() => {
    anchor.classList.remove("is-nav-flashing");
  }, 700);
}

/* 既然已经放弃跳转动画，这里的目标就回到“稳定地把事项放到用户能继续工作的区域”。
   当前策略：
   1. 周视图：横向尽量居中；定时事项纵向也尽量居中；全天事项保留当前竖向位置
   2. 日视图：只调竖向，不改横向
   3. 月视图：只调竖向，让目标周/格子落回可读位置
   这里全部是即时写入，不再做任何插值动画。 */
function scrollAnchorIntoViewInstant(view, anchor) {
  const viewport = getAnchorViewport(anchor);
  if (!viewport) return;
  const elementRect = anchor.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const targetLeft = anchor.matches(".week-event-block, .week-all-day-item")
    ? Math.min(maxLeft, Math.max(0, viewport.scrollLeft + (elementRect.left - viewportRect.left) - (viewport.clientWidth - elementRect.width) / 2))
    : viewport.scrollLeft;
  const targetTop = anchor.matches(".week-event-block, .day-event-block, .month-inline-chip, .month-span-bar, .calendar-day")
    ? Math.min(maxTop, Math.max(0, viewport.scrollTop + (elementRect.top - viewportRect.top) - (viewport.clientHeight - elementRect.height) / 2))
    : viewport.scrollTop;

  if (view === "week") {
    const topPane = getWeekHorizontalPane();
    const bodyPane = getWeekScrollBody();
    const timePane = getWeekTimePane();
    if (!topPane || !bodyPane || !timePane) return;
    const anchorDate = anchor.dataset.weekHeaderDate || anchor.dataset.anchorDate || state.weekPaneScroll.leftEdgeDate;
    const leftEdgeDate = getWeekCenteredLeftEdgeDate(anchorDate);
    syncWeekViewportState(leftEdgeDate, { resetRangeAnchor: false });
    const snappedLeft = getWeekScrollLeftForDate(leftEdgeDate);
    state.weekPaneScroll.syncingAxes = true;
    topPane.scrollLeft = snappedLeft;
    bodyPane.scrollLeft = snappedLeft;
    if (!anchor.matches(".week-all-day-item")) {
      timePane.scrollTop = targetTop;
      bodyPane.scrollTop = targetTop;
      state.weekPaneScroll.restoreScrollTop = targetTop;
    }
    state.weekPaneScroll.suppressNextScroll = true;
    state.weekPaneScroll.syncingAxes = false;
    return;
  }

  viewport.scrollLeft = targetLeft;
  viewport.scrollTop = targetTop;
}

/* 所有“把某条 calendar record 带到右侧工作区”的行为统一走这里。
   它负责三件事：
   1. 把当前工作区切到合适视图/日期
   2. 把对应事项即时滚到可见位置
   3. 打开同一套详情卡片
   现在它已经不承担任何过场动画，只负责稳定的定位和打开。 */
function navigateToRecordInWorkspace(recordId, options = {}) {
  const record = getRecordById(recordId);
  if (!record || record.recordType !== "calendar" || !record.date) return null;
  const targetView = resolveRecordNavigationView(options.preferredView || state.activeView);
  const shouldRebuildView = options.forceRender
    || state.activeView !== targetView
    || state.selectedDate !== record.date;

  if (shouldRebuildView) {
    prepareViewForRecord(record, targetView);
    render();
  }

  let anchor = findEventDetailAnchorElement(record.id, { view: targetView });
  if (!anchor) {
    prepareViewForRecord(record, targetView);
    if (targetView === "week") {
      renderWeekView();
    } else if (targetView === "month") {
      renderCalendar();
    } else if (targetView === "day") {
      renderDayView();
    }
    anchor = findEventDetailAnchorElement(record.id, { view: targetView });
  }
  if (!anchor) return null;

  const viewport = getAnchorViewport(anchor);
  const alreadyVisible = viewport ? isAnchorVisibleInViewport(anchor, viewport) : true;
  if (!options.forceScroll && alreadyVisible) {
    if (options.flashVisible) {
      flashRecordAnchor(anchor);
    }
    openEventDetailPopover(record.id, anchor);
    return anchor;
  }

  scrollAnchorIntoViewInstant(targetView, anchor);
  anchor = findEventDetailAnchorElement(record.id, { view: targetView }) || anchor;
  openEventDetailPopover(record.id, anchor);
  return anchor;
}

function getWeekDayWidthPx() {
  // 周视图要求“一屏正好显示 7 天”。
  // 因此每一天的宽度不再由最小宽度兜底，而是直接按当前可视内容区宽度七等分。
  const weekGridWidth = refs.weekGrid?.clientWidth || 0;
  const gutterWidth = 58;
  const paneWidth = Math.max(0, weekGridWidth - gutterWidth);
  return paneWidth > 0 ? paneWidth / 7 : 140;
}

function getWeekVisibleDaySpan() {
  // 这里单独封装成函数，而不是在各处直接写死 7，
  // 是为了以后如果要支持 3 天 / 5 天 / 自定义列数时，
  // 周视图横向吸附、标题、范围重建可以一起跟着变。
  return 7;
}

function clampWeekLeftEdgeIndex(index) {
  return Math.max(0, Math.min(state.weekPaneScroll.dayCount - getWeekVisibleDaySpan(), index));
}

function getWeekLeftEdgeDateFromScrollLeft(scrollLeft) {
  /* 当前周视图横向滚动条虽然允许连续拖动，
     但逻辑语义只认“最后停在哪一天的整列起点”。
     所以这里统一把 scrollLeft 映射成最近的整天索引。 */
  const dayWidth = Math.max(1, getWeekDayWidthPx());
  const snappedIndex = clampWeekLeftEdgeIndex(Math.round((scrollLeft || 0) / dayWidth));
  return isoDate(addDays(state.weekPaneScroll.rangeAnchor, snappedIndex));
}

function getWeekScrollLeftForDate(dateIso) {
  // 反向映射：给定某一天作为左边界，计算它在当前 35 天轨道里的精确像素位置。
  const leftIndex = clampWeekLeftEdgeIndex(dayDiff(state.weekPaneScroll.rangeAnchor, parseDate(dateIso)));
  return leftIndex * getWeekDayWidthPx();
}

function getWeekCenteredLeftEdgeDate(dateIso) {
  /* 周视图现在要求“窗口永远完整显示 7 天”，因此不能再用像素级居中。
     想把目标日尽量放到中间，就改为让它落在 7 天窗口的第 4 列，
     也就是把左边界锚到“目标日前 3 天”。 */
  return isoDate(addDays(parseDate(dateIso), -Math.floor(getWeekVisibleDaySpan() / 2)));
}

function syncWeekViewportState(dateIso, options = {}) {
  /* 这是周视图横向状态的唯一写入口：
     1. 写入当前 7 天窗口的左边界日期
     2. 推导 visibleWeek，供“本周 / 上周 / 下周”等更高层导航复用
     3. 必要时重建 35 天虚拟轨道的锚点
     这样以后不论是普通滚动、AI 跳转、删除、拖拽预览结束，都不会各自维护一套横向状态。 */
  if (!dateIso) return;
  const leftEdgeIso = isoDate(parseDate(dateIso));
  state.weekPaneScroll.leftEdgeDate = leftEdgeIso;
  state.visibleWeek = startOfWeek(parseDate(leftEdgeIso));
  const leftIndex = dayDiff(state.weekPaneScroll.rangeAnchor, parseDate(leftEdgeIso));
  if (options.resetRangeAnchor || leftIndex < 0 || leftIndex > state.weekPaneScroll.dayCount - getWeekVisibleDaySpan()) {
    state.weekPaneScroll.rangeAnchor = addDays(parseDate(leftEdgeIso), -getWeekWindowLeadDays());
  }
  state.weekPaneScroll.initialized = true;
}

function clearWeekSnapMonitor() {
  if (!state.weekPaneScroll.snapFrame) return;
  window.cancelAnimationFrame(state.weekPaneScroll.snapFrame);
  state.weekPaneScroll.snapFrame = 0;
}

function clearWeekSnapAnimation() {
  if (!state.weekPaneScroll.snapAnimationFrame) return;
  window.cancelAnimationFrame(state.weekPaneScroll.snapAnimationFrame);
  state.weekPaneScroll.snapAnimationFrame = 0;
}

function updateWeekLabelFromLeftEdge(leftEdgeDate) {
  if (!refs.weekLabel || !leftEdgeDate) return;
  refs.weekLabel.textContent = `${leftEdgeDate} 至 ${isoDate(addDays(parseDate(leftEdgeDate), getWeekVisibleDaySpan() - 1))}`;
}

function hasWeekPreviewInteraction() {
  /* 周视图里有两种临时预览态：
     - 空白区拖拽创建新定时事项
     - 拖拽已有定时卡片改时间
     这两种状态下都不应该触发“滚动结束后自动吸附”，
     否则用户还在拖，底层轨道却自己往最近整天回弹，会直接破坏拖拽手感。 */
  return state.dayDrag?.scope === "week"
    || state.timedCardDrag?.scope === "week"
    || state.weekPaneScroll.previewLockActive;
}

function shouldSnapWeekPane(scrollLeft, previousScrollLeft, dayWidth) {
  /* 吸附触发条件不再是“固定等 120ms”。
     现在改成观察横向惯性是否已经进入尾段：
     - currentDelta 表示这一帧相对上一帧还在移动多少像素
     - snapDistance 表示离最近整天边界还差多少像素
     当“当前速度已经很慢，但离整天边界还有一段距离”时，就提前接管并吸附。
     这样用户感受到的是同一条惯性动画自然收束，而不是停一下再启动第二段动画。 */
  const safeDayWidth = Math.max(1, dayWidth || getWeekDayWidthPx());
  const currentDelta = Math.abs((scrollLeft || 0) - (previousScrollLeft || 0));
  const snappedLeft = Math.round((scrollLeft || 0) / safeDayWidth) * safeDayWidth;
  const snapDistance = Math.abs(snappedLeft - (scrollLeft || 0));
  const velocityThreshold = Math.max(0.9, safeDayWidth * 0.008);
  const distanceThreshold = Math.max(0.5, safeDayWidth * 0.02);
  return currentDelta <= velocityThreshold && snapDistance >= distanceThreshold;
}

function ensureWeekSnapMonitor() {
  if (state.weekPaneScroll.snapFrame || hasWeekPreviewInteraction()) return;
  const bodyPane = getWeekScrollBody();
  if (!bodyPane) return;
  const tick = () => {
    state.weekPaneScroll.snapFrame = 0;
    const liveBodyPane = getWeekScrollBody();
    if (!liveBodyPane || hasWeekPreviewInteraction()) return;
    const currentLeft = liveBodyPane.scrollLeft || 0;
    const previousLeft = state.weekPaneScroll.lastScrollLeft || 0;
    const dayWidth = getWeekDayWidthPx();
    if (shouldSnapWeekPane(currentLeft, previousLeft, dayWidth)) {
      snapWeekPaneToNearestDay({ animate: true });
      return;
    }
    state.weekPaneScroll.lastScrollLeft = currentLeft;
    state.weekPaneScroll.snapFrame = window.requestAnimationFrame(tick);
  };
  state.weekPaneScroll.snapFrame = window.requestAnimationFrame(tick);
}

function animateWeekPaneTo(topPane, bodyPane, timePane, nextLeft, nextTop, duration = 260) {
  /* 浏览器原生 smooth scroll 的速度不可控，所以周视图整天吸附改成手写补间。
     这样可以把“吸附收尾”调得比默认更慢一点，也能保证顶部日期栏、主网格和左侧时间轴严格同帧。 */
  clearWeekSnapAnimation();
  const startLeft = bodyPane.scrollLeft;
  const startTop = bodyPane.scrollTop;
  const deltaLeft = nextLeft - startLeft;
  const deltaTop = nextTop - startTop;
  const startAt = performance.now();
  const easeOutCubic = (value) => 1 - ((1 - value) ** 3);

  const tick = (now) => {
    const progress = Math.min(1, (now - startAt) / duration);
    const eased = easeOutCubic(progress);
    const currentLeft = startLeft + deltaLeft * eased;
    const currentTop = startTop + deltaTop * eased;
    topPane.scrollLeft = currentLeft;
    bodyPane.scrollLeft = currentLeft;
    timePane.scrollTop = currentTop;
    bodyPane.scrollTop = currentTop;
    if (progress < 1) {
      state.weekPaneScroll.snapAnimationFrame = window.requestAnimationFrame(tick);
      return;
    }
    state.weekPaneScroll.snapAnimationFrame = 0;
  };

  state.weekPaneScroll.snapAnimationFrame = window.requestAnimationFrame(tick);
}

function snapWeekPaneToNearestDay(options = {}) {
  /* “连续滚动 + 停止后整天吸附”的最终执行器：
     用户滚动过程中允许 scrollLeft 暂时落在整天之间，
     但一旦滚动停住，就立刻回到最近的整天起点。
     这样既保留触摸板 / 鼠标滚轮的连续手感，又保证重绘后永远只出现完整 7 天。 */
  const topPane = getWeekHorizontalPane();
  const timePane = getWeekTimePane();
  const bodyPane = getWeekScrollBody();
  if (!topPane || !timePane || !bodyPane) return;
  const leftEdgeDate = getWeekLeftEdgeDateFromScrollLeft(bodyPane.scrollLeft);
  const nextLeft = getWeekScrollLeftForDate(leftEdgeDate);
  const nextTop = state.weekPaneScroll.restoreScrollTop || bodyPane.scrollTop || 0;
  const shouldAnimate = options.animate !== false;

  clearWeekSnapMonitor();
  clearWeekSnapAnimation();

  state.weekPaneScroll.leftEdgeDate = leftEdgeDate;
  state.visibleWeek = startOfWeek(parseDate(leftEdgeDate));
  updateWeekLabelFromLeftEdge(leftEdgeDate);
  state.weekPaneScroll.syncingAxes = true;
  if (shouldAnimate) {
    animateWeekPaneTo(topPane, bodyPane, timePane, nextLeft, nextTop, 260);
  } else {
    topPane.scrollLeft = nextLeft;
    bodyPane.scrollLeft = nextLeft;
    timePane.scrollTop = nextTop;
    bodyPane.scrollTop = nextTop;
  }
  state.weekPaneScroll.suppressNextScroll = true;
  requestAnimationFrame(() => {
    state.weekPaneScroll.syncingAxes = false;
  });
}

function getWeekWindowLeadDays() {
  // 35 天窗口中，默认把当前焦点日期放在前方 14 天的位置。
  // 这样左右两边都会保留足够缓冲，横向滚动时不容易感知到“物理边界”。
  return 14;
}

function applyDayAllDayHeight() {
  const board = refs.dayView?.querySelector(".day-board.is-embedded");
  if (!board) return;
  requestAnimationFrame(() => {
    const head = board.querySelector(".day-all-day-head");
    const label = board.querySelector(".day-column-label");
    const strip = refs.dayAllDayStrip;
    if (!head || !label || !strip) return;

    const styles = window.getComputedStyle(head);
    const gap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;
    const paddingTop = Number.parseFloat(styles.paddingTop || "0") || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom || "0") || 0;
    const stripStyles = window.getComputedStyle(strip);
    const stripGap = Number.parseFloat(stripStyles.rowGap || stripStyles.gap || "0") || 0;
    const stripChildren = Array.from(strip.children);
    const stripContentHeight = stripChildren.length
      ? stripChildren.reduce((sum, node) => sum + node.getBoundingClientRect().height, 0) + stripGap * Math.max(0, stripChildren.length - 1)
      : strip.scrollHeight;
    const autoHeight = Math.max(
      52,
      Math.ceil(label.offsetHeight + gap + stripContentHeight + paddingTop + paddingBottom),
    );
    const effectiveHeight = state.uiLayout.dayAllDayManual
      ? state.uiLayout.dayAllDayHeight
      : Math.min(Math.max(autoHeight, 52), 180);

    // 日视图默认按内容自适应，避免事项不多时留下一整块空白；
    // 只有用户手动拖拽过分界线后，才固定使用用户指定高度。
    board.style.setProperty("--day-all-day-height", `${Math.round(effectiveHeight)}px`);
    updateDayAllDayOverflowState();
  });
}

function applyWeekAllDayHeight() {
  refs.weekGrid?.style.setProperty("--week-all-day-height", `${Math.round(state.uiLayout.weekAllDayHeight)}px`);
  updateWeekAllDayOverflowState();
}

function bindResizeHandle(handle, options) {
  if (!handle) return;
  handle.onmousedown = (startEvent) => {
    startEvent.preventDefault();
    const startY = startEvent.clientY;
    const startHeight = options.getValue();
    let nextHeight = startHeight;
    let rafId = 0;

    const flush = () => {
      rafId = 0;
      options.applyValue(nextHeight);
    };

    const onMove = (moveEvent) => {
      // 高度拖拽统一用 rAF 合帧，避免 mousemove 每次都直接改 DOM 带来抖动。
      nextHeight = options.clampValue(startHeight + (moveEvent.clientY - startY));
      if (!rafId) {
        rafId = requestAnimationFrame(flush);
      }
    };

    const onUp = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        flush();
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
  };
}

function bindDayAllDayResizeHandle() {
  bindResizeHandle(document.querySelector("#day-all-day-resize-handle"), {
    getValue: () => state.uiLayout.dayAllDayHeight,
    clampValue: (value) => Math.max(68, Math.min(220, value)),
    applyValue: (value) => {
      state.uiLayout.dayAllDayHeight = value;
      state.uiLayout.dayAllDayManual = true;
      applyDayAllDayHeight();
    },
  });
}

function bindWeekAllDayResizeHandle() {
  bindResizeHandle(document.querySelector("#week-all-day-resize-handle"), {
    getValue: () => state.uiLayout.weekAllDayHeight,
    clampValue: (value) => Math.max(68, Math.min(240, value)),
    applyValue: (value) => {
      state.uiLayout.weekAllDayHeight = value;
      state.uiLayout.weekAllDayManual = true;
      applyWeekAllDayHeight();
    },
  });
}

function scheduleWeekPaneSync() {
  if (state.weekPaneScroll.syncFrame) return;
  state.weekPaneScroll.syncFrame = requestAnimationFrame(() => {
    // 周视图把“顶部横滚同步”和“左侧竖滚同步”都压到同一帧里执行，
    // 这样时间轴、全天栏和主网格更不容易出现轻微错位或卡顿。
    state.weekPaneScroll.syncFrame = 0;
    handleWeekPaneScroll();
  });
}

function updateDayAllDayOverflowState() {
  const strip = refs.dayAllDayStrip;
  if (!strip) return;
  requestAnimationFrame(() => {
    const hasOverflow = strip.scrollHeight > strip.clientHeight + 1;
    // 日视图全天栏和周视图保持同一规则：
    // 空间够就完整显示，只有真实溢出时才切换到内部滚动。
    strip.classList.toggle("is-scrollable", hasOverflow);
  });
}

function updateWeekAllDayOverflowState() {
  if (!refs.weekGrid) return;
  requestAnimationFrame(() => {
    const row = refs.weekGrid.querySelector(".week-all-day-row");
    if (!row) return;
    const hasOverflow = row.scrollHeight > row.clientHeight + 1;
    // 周视图改成“整条全天轨道统一滚动”后，滚动状态也只按整条轨道判断。
    row.classList.toggle("is-scrollable", hasOverflow);
  });
}

function getWeekRecenterBounds() {
  // 只要当前正在看的日期还落在这个安全区间内，就不重建虚拟窗口。
  // 一旦漂出中段，立刻把 35 天窗口重新围绕它摆回去。
  return {
    min: 7,
    max: 27,
  };
}

function resetWeekPaneToWeekStart(targetDate, options = {}) {
  // 所有“按周跳转”的入口都走这一条：
  // 1. visibleWeek 固定落到目标周周一
  // 2. leftEdgeDate 也固定为周一，保证视口左边缘从周一开始
  // 3. rangeAnchor 重置到围绕该周的虚拟窗口位置，避免标题和实际列错位
  const weekStart = startOfWeek(targetDate);
  state.visibleWeek = weekStart;
  syncWeekViewportState(isoDate(weekStart), { resetRangeAnchor: true });
  state.weekPaneScroll.suppressNextScroll = false;
  if (!options.preserveScrollTop) {
    state.weekPaneScroll.restoreScrollTop = 0;
  }
}

function syncWeekPaneScrollerToLeftEdge() {
  /* renderWeekView 结束后的标准回位逻辑：
     它不再尝试恢复“某一天在视口中占多少像素”，
     而是直接把滚动条放回当前 leftEdgeDate 对应的整列起点。
     为了让“重绘后回位”和“滚动吸附”的体感一致，这里也复用同一套自定义补间。 */
  const topPane = getWeekHorizontalPane();
  const timePane = getWeekTimePane();
  const bodyPane = getWeekScrollBody();
  if (!topPane || !timePane || !bodyPane) return;
  const token = ++state.weekPaneScroll.syncToken;
  requestAnimationFrame(() => {
    if (token !== state.weekPaneScroll.syncToken) return;
    const leftEdgeDate = state.weekPaneScroll.leftEdgeDate || isoDate(state.visibleWeek);
    syncWeekViewportState(leftEdgeDate, { resetRangeAnchor: false });
    const nextLeft = getWeekScrollLeftForDate(leftEdgeDate);
    const nextTop = state.weekPaneScroll.restoreScrollTop || 0;
    const shouldAnimate = Boolean(state.weekPaneScroll.animateOnNextSync);
    state.weekPaneScroll.syncingAxes = true;
    clearWeekSnapAnimation();
    if (shouldAnimate) {
      animateWeekPaneTo(topPane, bodyPane, timePane, nextLeft, nextTop, 260);
    } else {
      topPane.scrollLeft = nextLeft;
      bodyPane.scrollLeft = nextLeft;
      timePane.scrollTop = nextTop;
      bodyPane.scrollTop = nextTop;
    }
    state.weekPaneScroll.animateOnNextSync = false;
    state.weekPaneScroll.suppressNextScroll = true;
    requestAnimationFrame(() => {
      state.weekPaneScroll.syncingAxes = false;
    });
  });
}

function handleWeekPaneScroll() {
  const topPane = getWeekHorizontalPane();
  const timePane = getWeekTimePane();
  const bodyPane = getWeekScrollBody();
  if (!topPane || !timePane || !bodyPane) return;
  if (state.weekPaneScroll.syncingAxes) return;
  if (state.weekPaneScroll.suppressNextScroll) {
    state.weekPaneScroll.suppressNextScroll = false;
    return;
  }

  state.weekPaneScroll.syncingAxes = true;
  if (topPane.scrollLeft !== bodyPane.scrollLeft) {
    topPane.scrollLeft = bodyPane.scrollLeft;
  }
  if (timePane.scrollTop !== bodyPane.scrollTop) {
    timePane.scrollTop = bodyPane.scrollTop;
  }
  requestAnimationFrame(() => {
    state.weekPaneScroll.syncingAxes = false;
  });

  clearWeekSnapMonitor();
  clearWeekSnapAnimation();
  const leftEdgeDate = getWeekLeftEdgeDateFromScrollLeft(bodyPane.scrollLeft);
  state.weekPaneScroll.leftEdgeDate = leftEdgeDate;
  state.visibleWeek = startOfWeek(parseDate(leftEdgeDate));
  updateWeekLabelFromLeftEdge(leftEdgeDate);
  state.weekPaneScroll.restoreScrollTop = bodyPane.scrollTop;
  state.weekPaneScroll.lastScrollLeft = bodyPane.scrollLeft;
  const activeIndex = dayDiff(state.weekPaneScroll.rangeAnchor, parseDate(leftEdgeDate));
  const bounds = getWeekRecenterBounds();

  // 周视图横向虚拟滚动现在也按“左边界整天”来维护：
  // 一旦当前可视窗口最左边那一天逼近 35 天轨道边缘，就把整条轨道重新围绕它摆回去。
  if (activeIndex < bounds.min || activeIndex > bounds.max) {
    syncWeekViewportState(leftEdgeDate, { resetRangeAnchor: true });
    renderWeekView();
    return;
  }

  if (hasWeekPreviewInteraction()) {
    return;
  }

  /* 不再用固定延时等待滚动“彻底结束”。
     这里改为启动一个轻量 rAF 监听器，持续观察横向惯性是否已经进入尾段，
     一旦速度降下来就立刻吸到最近整天，让吸附融进原本的滚动收尾。 */
  ensureWeekSnapMonitor();
}

function renderWeekView() {
  // 周视图保留完整连续时间轴，因为它承担更高密度的排程任务；
  // 结构上拆成两层：
  // 1. 左侧固定 rail：角标 / 全天标题 / 小时列
  // 2. 右侧可横向滚动 pane：日期表头 / 全天事项 / 时间网格
  // 这样左侧小时列不会参与横向滑动，而右侧内容区可以做连续横向虚拟滚动。
  clearWeekSnapMonitor();
  clearWeekSnapAnimation();
  const leftEdgeDate = state.weekPaneScroll.leftEdgeDate || isoDate(state.visibleWeek);
  updateWeekLabelFromLeftEdge(leftEdgeDate);
  if (!state.weekPaneScroll.initialized) {
    syncWeekViewportState(leftEdgeDate, { resetRangeAnchor: true });
  } else {
    syncWeekViewportState(leftEdgeDate, { resetRangeAnchor: false });
  }

  const dayCount = state.weekPaneScroll.dayCount;
  const weekDays = Array.from({ length: dayCount }, (_, index) => addDays(state.weekPaneScroll.rangeAnchor, index));
  const timedSegments = weekDays.flatMap((day) => getTimedEventSegmentsForDate(isoDate(day)));
  const hasWeekSelectionPreview = state.dayDrag && state.dayDrag.scope === "week";
  const hasWeekTimedCardPreview = state.timedCardDrag?.scope === "week" && state.timedCardDrag.previewPayload;
  const selectionMarkup = hasWeekSelectionPreview
    ? renderWeekSelectionPreview(weekDays, state.dayDrag)
    : "";
  const dayWidthPx = getWeekDayWidthPx();
  const trackStyle = `--week-day-count:${dayCount};--week-day-width:${dayWidthPx.toFixed(3)}px;grid-template-columns:repeat(${dayCount}, minmax(0, var(--week-day-width)));width:calc(${dayCount} * var(--week-day-width));`;

  refs.weekGrid.innerHTML = `
    <div class="week-board">
      <div class="week-corner-stack">
        <div class="week-corner"></div>
        <div class="week-all-day-title">全天</div>
      </div>
      <div id="week-top-pane" class="week-top-pane">
        <div class="week-header-row" style="${trackStyle}">
          ${weekDays.map((day) => `
            <div class="week-header-cell" data-week-header-date="${isoDate(day)}">
              <span class="week-header-main">${escapeHtml(WEEKDAY_LABELS[(day.getDay() + 6) % 7])}</span>
              <span class="week-header-date">${day.getMonth() + 1}/${day.getDate()}</span>
            </div>
          `).join("")}
        </div>
        ${renderWeekAllDayRow(weekDays, trackStyle)}
      </div>
      <div id="week-all-day-resize-handle" class="timeline-resize-handle week-resize-handle" role="separator" aria-orientation="horizontal" aria-label="调整全天区域高度"></div>
      <div id="week-time-pane" class="week-time-pane">
        <div class="week-time-labels">${renderWeekTimeLabels()}</div>
      </div>
      <div id="week-scroll-body" class="week-scroll-body">
        <div id="week-grid-surface" class="week-grid-surface ${hasWeekSelectionPreview || hasWeekTimedCardPreview ? "is-dragging" : ""}" style="${trackStyle}">
          ${weekDays.map((_, index) => `<div class="week-column-guide" style="left:calc(${index} * var(--week-day-width));width:var(--week-day-width);"></div>`).join("")}
          ${renderWeekEventBlocks(weekDays)}
          ${selectionMarkup}
          ${!timedSegments.length && !selectionMarkup ? `<div class="week-empty-hint">在任意日期列内拖拽即可创建一段日程。</div>` : ""}
        </div>
      </div>
    </div>
  `;

  refs.weekGrid.querySelectorAll("[data-week-all-day-slot]").forEach((slot) => {
    slot.addEventListener("click", (event) => {
      if (shouldSuppressSurfaceClick()) return;
      if (event.target.closest("[data-week-event-id]")) return;
      scheduleWeekSingleClick("all_day_slot", slot.dataset.date, () => {
        state.selectedDate = slot.dataset.date;
        render();
      });
    });
    slot.addEventListener("dblclick", (event) => {
      cancelPendingWeekSingleClick("all_day_slot", slot.dataset.date);
      handleWeekAllDayDoubleClick(event, slot.dataset.date);
    });
  });

  refs.weekGrid.querySelectorAll("[data-week-header-date]").forEach((cell) => {
    cell.addEventListener("click", () => {
      if (shouldSuppressSurfaceClick()) return;
      scheduleWeekSingleClick("week_header", cell.dataset.weekHeaderDate, () => {
        state.selectedDate = cell.dataset.weekHeaderDate;
        state.visibleWeek = startOfWeek(parseDate(state.selectedDate));
        render();
      });
    });
    cell.addEventListener("dblclick", () => {
      cancelPendingWeekSingleClick("week_header", cell.dataset.weekHeaderDate);
      navigateToDateDetail(cell.dataset.weekHeaderDate, { preferredView: "day" });
    });
  });

  refs.weekGrid.querySelectorAll("[data-week-event-id]:not([data-week-quick-entry])").forEach((node) => {
    if (node.matches(".week-event-block")) {
      node.addEventListener("mousedown", (event) => beginWeekTimedCardDrag(event, node, weekDays));
    }
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      if (shouldSuppressDetailOpen(node.dataset.weekEventId)) return;
      openEventDetailPopover(node.dataset.weekEventId, node);
    });
  });

  refs.weekGrid.querySelectorAll("[data-week-all-day-event-id][data-week-single-all-day='true']").forEach((button) => {
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const recordId = button.dataset.weekAllDayEventId;
      const record = getRecordById(recordId);
      if (!record || !isMonthQuickEditableRecord(record)) return;
      state.selectedDate = record.date || state.selectedDate;
      navigateToRecordInWorkspace(recordId, {
        preferredView: "week",
        forceRender: false,
        forceScroll: false,
        behavior: "auto",
      });
      activateWeekQuickEntry(record, { draftTitle: record.title || "", render: true });
    });
  });

  refs.weekGrid.querySelectorAll("[data-week-quick-input]").forEach((input) => {
    const recordId = input.dataset.weekQuickInput;
    input.addEventListener("input", () => {
      state.weekQuickEntry = {
        ...state.weekQuickEntry,
        recordId,
        draftTitle: input.value,
      };
      if (state.eventDetailPopover?.recordId === recordId) {
        closeEventDetailPopover({ statusMessage: "" });
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleWeekQuickEntrySubmit(recordId, input.value);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const moved = moveWeekQuickEntryFocus(recordId, event.key === "ArrowUp" ? -1 : 1, input.value);
        if (moved) {
          event.preventDefault();
        }
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !input.value.trim()) {
        event.preventDefault();
        const deleted = deleteEventRecordById(recordId, {
          closePopover: true,
          statusMessage: "已删除空白全天事项。",
        });
        if (deleted) {
          clearWeekQuickEntry();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finishWeekQuickEntry();
      }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (activeElement?.matches?.("[data-week-quick-input]")) return;
        if (allDayQuickEntryPointerTarget) return;
        if (state.weekQuickEntry.recordId === recordId) {
          finishWeekQuickEntry({ title: input.value });
        }
      }, 0);
    });
  });

  const weekQuickFocusToken = state.weekQuickEntry.focusToken;
  if (weekQuickFocusToken && state.weekQuickEntry.recordId) {
    requestAnimationFrame(() => {
      if (weekQuickFocusToken !== state.weekQuickEntry.focusToken) return;
      const input = refs.weekGrid?.querySelector(`[data-week-quick-input="${state.weekQuickEntry.recordId}"]`);
      if (!input) return;
      input.focus();
      if (input.value) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }

  const weekSurface = refs.weekGrid.querySelector("#week-grid-surface");
  const bodyPane = refs.weekGrid.querySelector("#week-scroll-body");
  const topPane = refs.weekGrid.querySelector("#week-top-pane");
  const timePane = refs.weekGrid.querySelector("#week-time-pane");
  weekSurface.onmousedown = (event) => beginWeekDrag(event, weekDays);
  weekSurface.ondblclick = (event) => handleWeekTimelineDoubleClick(event, weekDays);
  bodyPane.onscroll = scheduleWeekPaneSync;
  topPane.onscroll = () => {
    if (state.weekPaneScroll.syncingAxes) return;
    if (bodyPane.scrollLeft !== topPane.scrollLeft) {
      state.weekPaneScroll.syncingAxes = true;
      bodyPane.scrollLeft = topPane.scrollLeft;
      requestAnimationFrame(() => {
        state.weekPaneScroll.syncingAxes = false;
        scheduleWeekPaneSync();
      });
    }
  };
  timePane.onscroll = () => {
    if (state.weekPaneScroll.syncingAxes) return;
    if (bodyPane.scrollTop !== timePane.scrollTop) {
      state.weekPaneScroll.syncingAxes = true;
      bodyPane.scrollTop = timePane.scrollTop;
      requestAnimationFrame(() => {
        state.weekPaneScroll.syncingAxes = false;
        scheduleWeekPaneSync();
      });
    }
  };
  applyWeekAllDayHeight();
  bindWeekAllDayResizeHandle();
  updateWeekAllDayOverflowState();
  /* 周视图里有两类“拖拽预览”：
     1. 空白区拖拽创建新事项，状态存在 state.dayDrag
     2. 拖拽已有定时卡片改时间，状态存在 state.timedCardDrag
     这两种预览都只是“当前视口上的临时覆盖层”，不应该参与标准的整天吸附恢复。
     如果这里漏掉 timedCardDrag，就会重新落回 syncWeekPaneScrollerToLeftEdge()，
     于是页面按日期列重新对齐，看起来像“开始拖拽时固定往左滑两格”。 */
  if (hasWeekPreviewInteraction() && state.weekPaneScroll.previewLockActive) {
    restoreWeekPreviewViewport();
  } else {
    syncWeekPaneScrollerToLeftEdge();
  }
}

function renderWeekAllDayRow(weekDays, trackStyle) {
  const { bars, laneCount } = buildWeekAllDayBars(weekDays);
  const contentHeight = Math.max(Math.round(state.uiLayout.weekAllDayHeight), Math.max(1, laneCount) * 20 + 8);
  return `
    <div class="week-all-day-row">
      <div class="week-all-day-content" style="height:${contentHeight}px;">
        <div class="week-all-day-hit-grid" style="${trackStyle}">
          ${weekDays.map((day) => `
            <button class="week-all-day-slot" data-week-all-day-slot type="button" data-date="${isoDate(day)}" aria-label="${isoDate(day)} 全天事项区域"></button>
          `).join("")}
        </div>
        <div class="week-all-day-bars" style="${trackStyle}">
          ${bars || ""}
        </div>
      </div>
    </div>
  `;
}

function buildWeekAllDayBars(weekDays) {
  const weekStartIso = isoDate(weekDays[0]);
  const weekEndIso = isoDate(weekDays[weekDays.length - 1]);
  /* 周视图顶部全天栏现在与月视图采用同一套“跨列条带”布局：
     - 单天事项显示为单列条带，可进入快速改标题
     - 跨天事项直接跨多列显示，保证在周视图横向虚拟轨道上连续不断裂 */
  const allDayRecords = getActiveRecordsByType("calendar")
    .filter((record) => record.date && isAllDayLikeRecord(record) && getEventEndDateIso(record) >= weekStartIso && record.date <= weekEndIso)
    .sort((left, right) => {
      const leftSpan = dayDiff(parseDate(left.date), parseDate(getEventEndDateIso(left))) + 1;
      const rightSpan = dayDiff(parseDate(right.date), parseDate(getEventEndDateIso(right))) + 1;
      if (leftSpan !== rightSpan) return rightSpan - leftSpan;
      return left.date.localeCompare(right.date);
    });

  const lanes = [];
  const bars = allDayRecords.map((record) => {
    const viewModel = buildCalendarCardViewModel(record, { cardKind: "week_all_day", dragKind: "move_all_day" });
    const startIso = record.date;
    const endIso = getEventEndDateIso(record);
    const singleDayQuickEditable = isMonthQuickEditableRecord(record);
    const quickEditing = singleDayQuickEditable && state.weekQuickEntry.recordId === record.id;
    const anchorIso = startIso < weekStartIso ? weekStartIso : startIso;
    const startIndex = Math.max(0, dayDiff(parseDate(weekStartIso), parseDate(startIso)));
    const endIndex = Math.min(weekDays.length - 1, dayDiff(parseDate(weekStartIso), parseDate(endIso)));
    if (endIndex < 0 || startIndex > weekDays.length - 1) return "";

    let lane = 0;
    while (lanes[lane] && lanes[lane] >= startIndex) lane += 1;
    lanes[lane] = endIndex;

    const gridStyle = `grid-column:${startIndex + 1} / ${endIndex + 2};grid-row:${lane + 1};${viewModel.accentStyle}`;
    if (quickEditing) {
      return `
        <div
          class="week-all-day-item is-editing${startIso < weekStartIso ? " is-continued-left" : ""}${endIso > weekEndIso ? " is-continued-right" : ""}"
          data-week-event-id="${record.id}"
          data-week-quick-entry="${record.id}"
          data-anchor-date="${anchorIso}"
          ${buildCalendarCardDataAttributes(viewModel)}
          style="${gridStyle}"
        >
          <input
            class="week-quick-entry-input"
            data-week-quick-input="${record.id}"
            type="text"
            value="${escapeHtml(state.weekQuickEntry.draftTitle)}"
            placeholder="新建日程"
            aria-label="快速输入全天事项标题"
          >
        </div>
      `;
    }
    return `
      <button
        class="week-all-day-item${singleDayQuickEditable ? " is-quick-editable" : ""}${startIso < weekStartIso ? " is-continued-left" : ""}${endIso > weekEndIso ? " is-continued-right" : ""}${state.editingEventId === record.id ? " is-selected" : ""}"
        data-week-event-id="${record.id}"
        data-week-all-day-event-id="${record.id}"
        data-week-single-all-day="${singleDayQuickEditable ? "true" : "false"}"
        data-anchor-date="${anchorIso}"
        data-event-detail-trigger="week-all-day"
        ${buildCalendarCardDataAttributes(viewModel)}
        type="button"
        style="${gridStyle}"
      >
        <span>${escapeHtml(viewModel.title)}</span>
      </button>
    `;
  }).filter(Boolean).join("");

  return {
    bars,
    laneCount: lanes.length,
  };
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
  const dayCount = weekDays.length;
  const previewPayload = state.timedCardDrag?.scope === "week" ? state.timedCardDrag.previewPayload : null;
  const previewRecord = previewPayload ? {
    recordType: "calendar",
    id: previewPayload.id || state.timedCardDrag.recordId || "drag_preview",
    title: previewPayload.title || "",
    date: previewPayload.date,
    endDate: previewPayload.endDate,
    startTime: previewPayload.startTime,
    endTime: previewPayload.endTime,
    allDay: false,
    location: previewPayload.location || "",
    notes: previewPayload.notes || "",
    tags: previewPayload.tags || [],
    tagColor: previewPayload.tagColor || "",
    startAt: previewPayload.startAt || "",
    endAt: previewPayload.endAt || "",
  } : null;
  const markup = weekDays.map((day, index) => {
    const dayIso = isoDate(day);
    const timedSegments = getTimedEventSegmentsForDate(dayIso)
      .filter((segment) => segment.record.id !== state.timedCardDrag?.recordId);
    // 周视图里的“事项卡片”不是直接一条条渲染的，
    // 而是先把同一天的定时事项做一次布局计算：
    // 1. 识别哪些事项彼此重叠
    // 2. 给每条事项分配一个 column
    // 3. 把这组重叠事项的总列数 columns 一起传给渲染函数
    // 后面的 renderWeekEventBlock 会基于 column / columns 决定轻微缩进、透明度和层级。
    const layouts = buildWeekEventLayouts(timedSegments);
    let html = layouts.map(({ segment, column, columns }) => renderWeekEventBlock(segment, index, dayCount, { column, columns })).join("");
    if (previewRecord) {
      const previewSegment = buildTimedEventSegmentForDate(previewRecord, dayIso);
      if (previewSegment) {
        html += renderWeekEventBlock(previewSegment, index, dayCount, { column: 0, columns: 1 }, { preview: true });
      }
    }
    return html;
  }).join("");
  return markup;
}

function buildWeekEventLayouts(segments) {
  // 这一步负责把原始事项变成“可排版数据”：
  // - start / end 是分钟数，方便后面判断重叠关系
  // - end 至少比 start 多 30 分钟，避免极短事项在视图里几乎看不见
  // - 排序顺序会直接影响同组重叠事项谁在前谁在后，所以这里固定按开始时间、结束时间、标题排序
  const normalized = [...segments]
    .map((segment) => {
      const start = segment.startMinutes;
      const end = segment.endMinutes;
      return {
        segment,
        start,
        end: Math.max(end, start + 30),
      };
    })
    .sort((left, right) => {
      if (left.start !== right.start) return left.start - right.start;
      if (left.end !== right.end) return left.end - right.end;
      return String(left.segment.record.title || "").localeCompare(String(right.segment.record.title || ""), "zh-CN");
    });

  const layouts = [];
  let cluster = [];
  let clusterEnd = -1;

  normalized.forEach((item) => {
    // cluster 表示“一组有时间交叉关系的事项”。
    // 只要当前事项的开始时间仍然早于这组事项的最晚结束时间，
    // 就说明它还属于同一个重叠簇，需要一起参与排版。
    if (!cluster.length || item.start < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
      return;
    }
    layouts.push(...finalizeWeekEventCluster(cluster));
    cluster = [item];
    clusterEnd = item.end;
  });

  if (cluster.length) {
    layouts.push(...finalizeWeekEventCluster(cluster));
  }

  return layouts;
}

function finalizeWeekEventCluster(cluster) {
  // 这里是真正决定“重叠事项谁往右缩进一点”的地方。
  // 做法并不是把列平均切开，而是先分配逻辑列号：
  // - active: 当前仍然覆盖在时间线上的事项
  // - usedColumns: 当前已经被占用的列号
  // - maxColumns: 这一整组重叠事项最多重叠到几列
  // 后面的 renderWeekEventBlock 会把这个逻辑列号转成轻微缩进和透明度，而不是硬切宽度。
  const active = [];
  const usedColumns = new Set();
  let maxColumns = 1;
  const assigned = cluster.map((item) => {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].end <= item.start) {
        usedColumns.delete(active[index].column);
        active.splice(index, 1);
      }
    }

    let column = 0;
    while (usedColumns.has(column)) column += 1;
    usedColumns.add(column);
    active.push({ end: item.end, column });
    maxColumns = Math.max(maxColumns, usedColumns.size);

    return {
      segment: item.segment,
      start: item.start,
      end: item.end,
      column,
    };
  });

  return assigned.map((item) => ({
    segment: item.segment,
    column: item.column,
    columns: maxColumns,
  }));
}

function renderWeekEventBlock(segment, dayIndex, dayCount, layout = { column: 0, columns: 1 }, options = {}) {
  const event = segment.record;
  // 这是“周视图事项卡片”的核心 HTML 定义。
  // 如果你想改卡片内容结构，比如标题下面显示什么、显示几行，
  // 主要看这一个函数。
  //
  // 这里生成出来的是：
  // <article class="week-event-block ...">
  //   <h3>标题</h3>
  //   <p class="week-event-time">时间</p>
  //   <p class="week-event-location">地点，可选</p>
  // </article>
  //
  // 位置和观感相关的几个变量：
  // - top / height: 决定卡片在时间轴里的纵向位置和高度
  // - column / columns: 决定它属于当前重叠组里的第几层
  // - leftInset / rightInset: 只做轻微横向缩进，不做完全分栏
  // - overlapAlpha: 同组后面的卡片稍微更透明，形成系统日历那种层叠感
  // - compact / tight: 高度不足时自动切换到更紧凑的显示模式
  const viewModel = buildCalendarCardViewModel(event, { cardKind: "week_timed", dragKind: "move_timed" });
  const startMinutes = segment.startMinutes;
  const endMinutes = segment.endMinutes;
  const safeEnd = Math.max(endMinutes, startMinutes + 30);
  const top = minutesToOffset(startMinutes, WEEK_HOUR_HEIGHT);
  const height = Math.max(minutesToOffset(safeEnd, WEEK_HOUR_HEIGHT) - top, 34);
  const widthPercent = 100 / Math.max(1, dayCount || 7);
  const columns = Math.max(1, Number(layout.columns) || 1);
  const column = Math.max(0, Math.min(columns - 1, Number(layout.column) || 0));
  const compact = height < 52;
  const tight = height < 42;
  const isDragSource = state.timedCardDrag?.recordId === event.id && !options.preview;
  const isPreview = Boolean(options.preview);
  const overlapIndent = Math.min(8, 4 + (columns - 1) * 2);
  const leftInset = 6 + column * overlapIndent;
  const rightInset = 8 + Math.max(0, columns - 1) * overlapIndent;
  const overlapAlpha = isPreview
    ? 0.96
    : (columns > 1 ? Math.max(0.72, 0.92 - column * 0.08) : 0.94);
  return `
    <article class="week-event-block${compact ? " is-compact" : ""}${tight ? " is-tight" : ""}${state.editingEventId === event.id ? " is-selected" : ""}${isDragSource ? " is-drag-source" : ""}${isPreview ? " is-drag-preview" : ""}" data-week-event-id="${event.id}" data-segment-date="${segment.dateIso}" data-event-detail-trigger="week-timeline" ${buildCalendarCardDataAttributes(viewModel)} style="left:calc(${dayIndex * widthPercent}% + ${leftInset}px);width:calc(${widthPercent}% - ${leftInset + rightInset}px);top:${top}px;height:${height}px;z-index:${isPreview ? 48 : (20 + column)};opacity:${overlapAlpha};${viewModel.accentStyle}">
      <h3>${escapeHtml(viewModel.title)}</h3>
      <p class="week-event-time">${escapeHtml(viewModel.displayTimeText)}</p>
      ${viewModel.location ? `<p class="week-event-location">${escapeHtml(viewModel.location)}</p>` : ""}
    </article>
  `;
}

/* 周视图拖拽态的统一归一化：
   用户可能从早拖到晚，也可能从晚拖到早；也可能跨天反向拖回前一天。
   这里统一产出一个“真实起点 <= 真实终点”的结构，供预览和最终创建共用。 */
function normalizeWeekDragRange(drag) {
  if (!drag) return null;
  const startDateIso = normalizeDateOnly(drag.startDateIso || drag.dateIso);
  const endDateIso = normalizeDateOnly(drag.endDateIso || drag.dateIso || startDateIso);
  if (!startDateIso || !endDateIso) return null;
  if (startDateIso === endDateIso) {
    return {
      startDateIso,
      endDateIso,
      startMinutes: Math.min(drag.startMinutes, drag.endMinutes),
      endMinutes: Math.max(drag.startMinutes, drag.endMinutes),
    };
  }
  if (startDateIso < endDateIso) {
    return {
      startDateIso,
      endDateIso,
      startMinutes: drag.startMinutes,
      endMinutes: drag.endMinutes,
    };
  }
  return {
    startDateIso: endDateIso,
    endDateIso: startDateIso,
    startMinutes: drag.endMinutes,
    endMinutes: drag.startMinutes,
  };
}

/* 周视图拖拽预览按真实跨天范围渲染：
   - 单天时只画一列
   - 跨天时按天切成多个预览片段
   这样预览观感会和最终跨天定时日程的分段显示保持一致。 */
function renderWeekSelectionPreview(weekDays, drag) {
  const normalized = normalizeWeekDragRange(drag);
  if (!normalized) return "";
  const widthPercent = 100 / Math.max(1, weekDays.length || 7);
  const previews = [];
  for (let index = 0; index < weekDays.length; index += 1) {
    const dayIso = isoDate(weekDays[index]);
    if (dayIso < normalized.startDateIso || dayIso > normalized.endDateIso) continue;
    const segmentStart = dayIso === normalized.startDateIso ? normalized.startMinutes : 0;
    const segmentEnd = dayIso === normalized.endDateIso ? normalized.endMinutes : DAY_END_HOUR * 60;
    const safeEnd = Math.max(segmentEnd, segmentStart + DAY_SLOT_MINUTES);
    const top = minutesToOffset(segmentStart, WEEK_HOUR_HEIGHT);
    const height = Math.max(minutesToOffset(safeEnd, WEEK_HOUR_HEIGHT) - top, 24);
    const label = normalized.startDateIso === normalized.endDateIso
      ? `${formatMinutes(normalized.startMinutes)} - ${formatMinutes(normalized.endMinutes)}`
      : formatCalendarCardTimeRange({
        isAllDay: false,
        startDate: normalized.startDateIso,
        endDate: normalized.endDateIso,
        startTime: formatMinutes(normalized.startMinutes),
        endTime: formatMinutes(normalized.endMinutes),
      });
    previews.push(`
      <article class="week-selection-preview" style="left:calc(${index * widthPercent}% + 10px);width:calc(${widthPercent}% - 20px);top:${top}px;height:${height}px;">
        <h3>${escapeHtml(dayIso)}</h3>
        <p>${escapeHtml(label)}</p>
      </article>
    `);
  }
  return previews.join("");
}

function renderDailyEvents() {
  const segments = getTimedEventSegmentsForDate(state.selectedDate);
  const selectedEvent = getRecordById(state.editingEventId);
  const event = selectedEvent?.recordType === "calendar" && segments.some((segment) => segment.record.id === selectedEvent.id)
    ? selectedEvent
    : segments[0]?.record;

  if (!event) {
    refs.dailyEventList.className = "daily-event-list empty-state";
    refs.dailyEventList.textContent = "先从时间轴里点选一个定时日程，这里会显示它的详细信息。";
    return;
  }

  refs.dailyEventList.className = "daily-event-list";
  refs.dailyEventList.innerHTML = `
    <article class="daily-event-item is-detail event-detail-panel" data-event-id="${event.id}" style="${buildRecordCardStyle(event)}">
      ${buildEventDetailPopoverMarkup(event)}
    </article>
  `;
  bindEventDetailActions(refs.dailyEventList, event.id, { mode: "panel" });
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
    <article class="daily-event-item todo-item ${todo.priority === "high" ? "priority-high" : ""} ${todo.priority === "low" ? "priority-low" : ""} ${todo.completed ? "is-completed" : ""}" data-todo-id="${todo.id}" style="${buildRecordCardStyle(todo)}">
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
      ${renderTagRow(resolveRecordTagObjects(todo), getPrimaryRecordColor(todo))}
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
  return `<div class="tag-row">${tags.map((tag) => {
    const tagObject = typeof tag === "string" ? { name: tag, color: tagColor } : tag;
    return `<span class="tag-chip" style="${buildTagStyle(tagObject.color || tagColor)}">${escapeHtml(tagObject.name || "")}</span>`;
  }).join("")}</div>`;
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
      <div class="chat-message-body">${renderChatMessageBody(message)}</div>
      ${renderChatRecordCards(message)}
    </article>
  `).join("");
  refs.chatHistory.querySelectorAll("[data-chat-record-id]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateToRecordDetail(button.dataset.chatRecordId);
    });
  });
  refs.chatHistory.scrollTop = refs.chatHistory.scrollHeight;
}

function renderRuntimeLogs() {
  if (!refs.runtimeLogList || !refs.runtimeLogCount) return;
  refs.runtimeLogCount.textContent = String(state.runtimeLogs.length);
  if (!state.runtimeLogs.length) {
    refs.runtimeLogList.className = "runtime-log-list empty-state";
    refs.runtimeLogList.textContent = "这里会显示 Karin 的后台步骤、LLM 请求和耗时。";
    return;
  }

  refs.runtimeLogList.className = "runtime-log-list";
  refs.runtimeLogList.innerHTML = state.runtimeLogs.map((entry) => `
    <article class="runtime-log-item">
      <div class="runtime-log-meta">
        <span>${escapeHtml(entry.at)}</span>
        <span>${escapeHtml(entry.scope)}</span>
        ${entry.durationMs !== null ? `<span>${escapeHtml(formatDuration(entry.durationMs))}</span>` : ""}
        ${entry.meta ? `<span>${escapeHtml(entry.meta)}</span>` : ""}
      </div>
      <p class="runtime-log-message">${escapeHtml(entry.message)}</p>
    </article>
  `).join("");
}

function renderLlmTraceStatus() {
  if (!refs.llmTraceLogPath) return;
  refs.llmTraceLogPath.textContent = state.llmTraceLogPath || "正在准备本地 LLM trace 文件...";
}

function createEmptyKaedeContextDocs() {
  return {
    packageRoot: "",
    readme: "",
    operatorReadme: "",
    tools: "",
    operations: "",
  };
}

function renderChatAttachments() {
  if (!refs.chatAttachmentList) return;
  if (!state.pendingChatAttachments.length) {
    refs.chatAttachmentList.className = "chat-attachment-list is-hidden";
    refs.chatAttachmentList.textContent = "";
    return;
  }

  refs.chatAttachmentList.className = "chat-attachment-list";
  refs.chatAttachmentList.innerHTML = state.pendingChatAttachments.map((attachment, index) => `
    <article class="chat-attachment-item">
      <div class="chat-attachment-head">
        <div class="chat-attachment-title">${escapeHtml(attachment.name)}</div>
        <button class="ghost-btn" type="button" data-chat-attachment-remove="${index}">移除</button>
      </div>
      <div class="chat-attachment-meta">
        <span>${escapeHtml(attachment.kind)}</span>
        <span>${escapeHtml(formatFileSize(attachment.size || 0))}</span>
      </div>
      <p class="chat-attachment-note">${escapeHtml(attachment.note || "已添加到当前对话。")}</p>
    </article>
  `).join("");

  refs.chatAttachmentList.querySelectorAll("[data-chat-attachment-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-chat-attachment-remove"));
      state.pendingChatAttachments.splice(index, 1);
      renderChatAttachments();
    });
  });
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
  refs.eventEndDate.value = partial.endDate || partial.date || state.selectedDate;
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
  renderFormTagPicker("calendar", refs.eventTags, refs.eventTagEntry, refs.eventTagSelected, refs.eventTagSuggestions, refs.eventTagCreateBtn, refs.eventTagColor);
  renderFormTagColorPicker(refs.eventTagColor, refs.eventTagColorTrigger, refs.eventTagColorPalette);
}

function seedEmptyTodoForm(partial = {}) {
  refs.todoId.value = partial.id || "";
  refs.todoTitle.value = partial.title || "";
  refs.todoNotes.value = partial.notes || "";
  refs.todoPriority.value = partial.priority || "normal";
  refs.todoTags.value = formatTagsForInput(partial.tags || []);
  refs.todoTagColor.value = partial.tagColor || "#115e59";
  renderFormTagPicker("task", refs.todoTags, refs.todoTagEntry, refs.todoTagSelected, refs.todoTagSuggestions, refs.todoTagCreateBtn, refs.todoTagColor);
  renderFormTagColorPicker(refs.todoTagColor, refs.todoTagColorTrigger, refs.todoTagColorPalette);
}

function seedSettingsForm() {
  refs.parseMode.value = state.db.settings.parseMode;
  refs.apiBaseUrl.value = state.db.settings.apiBaseUrl;
  refs.apiKey.value = state.db.settings.apiKey;
  refs.apiModel.value = state.db.settings.apiModel;
  if (refs.uiTheme) refs.uiTheme.value = normalizeUiTheme(state.shellCache?.uiTheme || "atelier-warm");
}

async function handleChatSubmit() {
  const text = refs.chatInput.value.trim();
  const attachments = state.pendingChatAttachments.map((item) => ({ ...item }));
  if (!text && !attachments.length) {
    setStatus("先输入一些内容或添加附件再发送。");
    return;
  }
  const stopChatTurn = startRuntimeTimer("chat_turn", "开始处理一轮对话", {
    intentMode: refs.chatIntent.value,
    attachments: attachments.length,
  });
  traceRuntime("chat_turn", "当前对话模式", {
    parseMode: state.db.settings.parseMode,
    hasApiKey: Boolean(state.db.settings.apiKey),
    model: state.db.settings.apiModel,
  });
  appendChatMessage("user", buildUserMessageSummary(text, attachments), { persist: false });
  refs.chatInput.value = "";
  state.pendingChatAttachments = [];
  renderChatAttachments();
  try {
    if (attachments.length && !(state.db.settings.parseMode === "llm" && state.db.settings.apiKey)) {
      throw new Error("当前附件理解依赖大模型。请先配置可用的多模态/文本模型接口。");
    }
    if (refs.chatIntent.value === "auto" && canUseLlmRouting()) {
      try {
        await handleSecretaryAssistantTurn(text, attachments);
        stopChatTurn({ outcome: "assistant_ok" });
        return;
      } catch (error) {
        appendChatMessage("assistant", `AI 秘书暂时不可用，已回退到机器人流程。原因：${error.message}`, { agent: "bot", persist: false });
        traceRuntime("chat_turn", "AI 秘书失败，回退到机器人流程", { error: error.message });
      }
    }
    const decision = await resolveChatIntent(text, attachments);
    if (decision.notice) {
      appendChatMessage("assistant", decision.notice, { agent: "bot", persist: false });
    }
    const intent = decision.intent;
    if (intent === "add") {
      await handleUnifiedAdd(text, decision.routeAgent, attachments);
    } else {
      await handleUnifiedSearch(text, decision.routeAgent, attachments);
    }
    stopChatTurn({ outcome: intent });
  } catch (error) {
    appendChatMessage("assistant", `处理失败：${error.message}`, { agent: "bot", persist: false });
    setStatus(`处理失败：${error.message}`);
    stopChatTurn({ outcome: "failed", error: error.message });
    persistState();
  }
}

/*
  v3 的秘书入口。
  自动模式下优先让 LLM 扮演秘书：
  - 先理解用户有没有必要调用 database
  - 再决定调用哪个工具
  - 最后组织自然回复
*/
async function handleSecretaryAssistantTurn(text, attachments = []) {
  return secretaryAssistant.handleSecretaryAssistantTurn(text, attachments);
}

async function resolveChatIntent(text, attachments = []) {
  if (refs.chatIntent.value !== "auto") {
    return { intent: refs.chatIntent.value, routeAgent: "bot", notice: "" };
  }
  return secretaryAssistant.resolveChatIntent(text, attachments);
}

function canUseLlmRouting() {
  return secretaryAssistant.canUseLlmRouting();
}

async function handleUnifiedAdd(text, routeAgent = "bot", attachments = []) {
  return secretaryAssistant.handleUnifiedAdd(text, routeAgent, attachments);
}

async function handleUnifiedSearch(text, routeAgent = "bot", attachments = []) {
  return secretaryAssistant.handleUnifiedSearch(text, routeAgent, attachments);
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
    recordCards: Array.isArray(options.recordCards) ? options.recordCards : [],
    createdAt: new Date().toISOString(),
  });
  if (options.persist !== false) {
    persistState();
  }
  renderChatHistory();
}

function renderChatMessageBody(message) {
  const normalized = normalizeChatMessageText(message);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!paragraphs.length) {
    return `<p>${escapeHtml(normalized)}</p>`;
  }
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
}

function normalizeChatMessageText(message) {
  const content = String(message?.content || "").replace(/\r\n/g, "\n").trim();
  if (message?.role !== "assistant") return content;
  return content
    .replace(/^\s*[*-]\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/(^|[^\*])\*([^\n*]+)\*(?!\*)/g, "$1$2")
    .replace(/^#{1,6}\s*/gm, "")
    .trim();
}

function renderChatRecordCards(message) {
  const cards = Array.isArray(message?.recordCards) ? message.recordCards : [];
  if (!cards.length) return "";
  return `
    <div class="chat-record-card-list">
      ${cards.map((card) => `
        <button class="chat-record-card" type="button" data-chat-record-id="${escapeHtml(card.recordId)}">
          <div class="chat-record-card-top">
            <strong>${escapeHtml(card.title || "未命名日程")}</strong>
            <span>${escapeHtml(card.date || "")}</span>
          </div>
          <div class="chat-record-card-meta">
            <span>${escapeHtml(formatRecordCardTime(card))}</span>
            ${card.location ? `<span>${escapeHtml(card.location)}</span>` : ""}
          </div>
          ${card.notes ? `<p>${escapeHtml(card.notes)}</p>` : ""}
        </button>
      `).join("")}
    </div>
  `;
}

function formatRecordCardTime(card) {
  if (!card?.startTime) return "全天 / 未定时";
  return `${card.startTime}${card.endTime ? ` - ${card.endTime}` : ""}`;
}

/* 左侧聊天区里的引用事项卡片统一通过这里跳转。
   重点不是“切日期”，而是让右侧当前工作视图也一起跟着定位：
   - 周视图保留周视图，只移动视角并激活详情弹窗
   - 日视图保留日视图并激活详情弹窗
   - 月视图本身信息密度太高，不适合直接承接详情弹窗，因此会下钻到周视图
   这样聊天引用和右侧工作区就共享同一套“打开某条记录”的逻辑。 */
function navigateToRecordDetail(recordId, options = {}) {
  const record = getRecordById(recordId);
  if (!record || !record.date) {
    setStatus("这条引用记录当前没有可跳转的日期。");
    return;
  }

  const targetView = resolveRecordNavigationView(options.preferredView || state.activeView);
  const visibleInCurrentView = state.activeView === targetView && isRecordVisibleInView(record.id, targetView);
  navigateToRecordInWorkspace(record.id, {
    preferredView: targetView,
    forceRender: !visibleInCurrentView,
    forceScroll: !visibleInCurrentView,
    flashVisible: visibleInCurrentView,
    behavior: visibleInCurrentView ? "auto" : "smooth",
  });
  setStatus(options.statusMessage || (visibleInCurrentView
    ? `已打开 ${record.date} 的事项详情。`
    : `已跳转到 ${record.date} 的详情。`));
}

function handleSaveSettings() {
  state.db.settings = {
    parseMode: refs.parseMode.value,
    apiBaseUrl: refs.apiBaseUrl.value.trim() || DEFAULT_SETTINGS.apiBaseUrl,
    apiKey: refs.apiKey.value.trim(),
    apiModel: refs.apiModel.value.trim() || DEFAULT_SETTINGS.apiModel,
  };
  applyUiTheme(refs.uiTheme?.value || "atelier-warm");
  saveKarinShellCache();
  traceRuntime("shell_cache", "已保存 Karin 壳层设置缓存", {
    parseMode: state.db.settings.parseMode,
    hasApiKey: Boolean(state.db.settings.apiKey),
    model: state.db.settings.apiModel,
    uiTheme: normalizeUiTheme(refs.uiTheme?.value || "atelier-warm"),
  });
  setStatus("模型解析设置已保存。");
  refs.settingsModal.close();
}

async function handleApplyDatabaseMount() {
  const packageRoot = refs.mountPackageRoot.value.trim();
  if (!packageRoot) {
    setStatus("请先填写 Kaede Notebook 的绝对路径。");
    refs.mountPackageRoot.focus();
    return;
  }

  const stopMount = startRuntimeTimer("mount", "挂载 Kaede Notebook", {
    packageRoot,
  });
  try {
    traceRuntime("mount", "开始验证 Kaede 结构", { packageRoot });
    const mountStatus = await databaseStore.configureDatabaseMount(packageRoot);
    await refreshKaedeContextDocs();
    traceRuntime("mount", "Kaede 结构验证完成", {
      packageRoot,
      dbPath: mountStatus?.appDbPath || "",
    });
    renderDatabaseMountStatus(mountStatus);
    state.shellCache.mountPackageRoot = packageRoot;
    state.shellCache.autoOpenKaede = false;
    saveKarinShellCache();
    setStatus("Kaede Notebook 已挂载。下一步请点击“打开 Kaede”，再把 notebook 内容载入 Karin。");
    stopMount({ outcome: "mounted_only" });
  } catch (error) {
    stopMount({ outcome: "failed", error: error.message });
    setStatus(`挂载 Kaede Notebook 失败：${error.message}`);
  }
}

async function handleMountAndOpenKaede() {
  await handleApplyDatabaseMount();
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  const runtimeMode = databaseStore.getRuntimeMode?.();
  if (runtimeMode !== "mounted" && runtimeMode !== "kaede_sqlite") {
    return;
  }

  await handleOpenMountedKaede();
}

async function handleOpenMountedKaede(options = {}) {
  const { silent = false, source = "manual", skipCompatibilityPrompt = false } = options;
  const packageRoot = refs.mountPackageRoot.value.trim() || state.shellCache.mountPackageRoot || "";
  const stopOpen = startRuntimeTimer("open_kaede", "打开 Kaede Notebook", {
    packageRoot,
    source,
  });

  try {
    if (!skipCompatibilityPrompt) {
      const compatibility = await databaseStore.getMountedKaedeCompatibility();
      const blocked = await maybePauseOpenForCompatibility(compatibility, { silent, source });
      if (blocked) {
        stopOpen({ outcome: "awaiting_migration_confirmation", openMode: compatibility?.openMode || "" });
        return false;
      }
    }
    if (!silent) {
      setStatus("正在打开 Kaede Notebook...");
    }
    traceRuntime("open_kaede", "开始读取 Kaede 摘要", { packageRoot });
    const summary = await databaseStore.getMountedKaedeSummary();
    traceRuntime("open_kaede", "Kaede 摘要读取完成", summary || {});

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    traceRuntime("open_kaede", "开始载入 Kaede 工作区", {
      packageRoot,
      records: summary?.records ?? "",
    });
    state.db = await databaseStore.openMountedKaedeState();
    ensureAllRecordsHaveTags({ persist: true });
    syncTagFilterSelection({ forceAll: true });
    await refreshKaedeContextDocs();
    traceRuntime("open_kaede", "Kaede 工作区载入完成", {
      records: state.db.records.length,
      drafts: state.db.drafts.length,
      chatMessages: state.db.chatMessages.length,
    });

    applyShellCache();
    seedSettingsForm();
    render();
    renderDatabaseMountStatus(await databaseStore.getMountStatus());
    state.shellCache.autoOpenKaede = true;
    saveKarinShellCache();
    if (!silent) {
      setStatus("Kaede Notebook 已打开，当前内容已载入 Karin。");
    }
    stopOpen({ outcome: "ok", records: state.db.records.length });
    return true;
  } catch (error) {
    state.shellCache.autoOpenKaede = false;
    saveKarinShellCache();
    stopOpen({ outcome: "failed", error: error.message });
    if (!silent) {
      setStatus(`打开 Kaede Notebook 失败：${error.message}`);
    }
    throw error;
  }
}

async function handlePickDatabaseMountFolder() {
  try {
    const selected = await pickKaedeFolderPath();

    if (!selected) {
      setStatus("已取消选择 Kaede 文件夹。");
      return;
    }

    const selectedPath = Array.isArray(selected) ? selected[0] : selected;
    if (!selectedPath) {
      setStatus("没有读取到有效的文件夹路径。");
      return;
    }

    refs.mountPackageRoot.value = String(selectedPath);
    setStatus("已选中文件夹，可以直接挂载当前 Kaede。");
  } catch (error) {
    setStatus(`打开文件夹选择器失败：${error.message}`);
  }
}

async function handlePickChatAttachments() {
  try {
    const attachments = await pickChatAttachments();
    if (!attachments.length) {
      setStatus("已取消选择附件。");
      return;
    }

    state.pendingChatAttachments.push(...attachments);
    state.pendingChatAttachments = state.pendingChatAttachments.slice(-6);
    renderChatAttachments();
    traceRuntime("attachment", "已添加聊天附件", { count: attachments.length });
    setStatus(`已添加 ${attachments.length} 个附件到当前对话。`);
  } catch (error) {
    setStatus(`选择附件失败：${error.message}`);
  }
}

async function handleClearDatabaseMount() {
  try {
    const mountStatus = await databaseStore.clearDatabaseMount();
    state.db = databaseStore.createEmptyState();
    state.kaedeContextDocs = createEmptyKaedeContextDocs();
    seedSettingsForm();
    render();
    renderDatabaseMountStatus(mountStatus);
    state.shellCache.mountPackageRoot = "";
    state.shellCache.autoOpenKaede = false;
    saveKarinShellCache();
    setStatus("已取消 Kaede 挂载，当前回到内存模式。");
  } catch (error) {
    setStatus(`取消外部挂载失败：${error.message}`);
  }
}

async function refreshDatabaseMountStatus() {
  try {
    const mountStatus = await databaseStore.getMountStatus();
    await refreshKaedeContextDocs();
    let summary = null;
    let compatibility = null;
    if (mountStatus?.configured) {
      try {
        summary = await databaseStore.getMountedKaedeSummary();
      } catch (error) {
        traceRuntime("mount", "读取 Kaede 摘要失败", { error: error.message });
      }
      try {
        compatibility = await databaseStore.getMountedKaedeCompatibility();
      } catch (error) {
        traceRuntime("migration", "读取 Kaede 兼容性失败", { error: error.message });
      }
    }
    renderDatabaseMountStatus(mountStatus, summary, compatibility);
    setStatus("Kaede 挂载状态已刷新。");
  } catch (error) {
    setStatus(`读取 Kaede 挂载状态失败：${error.message}`);
  }
}

function renderDatabaseMountStatus(mountStatus, summary = null, compatibility = null) {
  if (!refs.mountStatus) return;
  state.mountStatus = mountStatus || state.mountStatus;
  const packageRoot = mountStatus?.packageRoot || "";
  if (refs.mountPackageRoot) {
    refs.mountPackageRoot.value = packageRoot || state.shellCache.mountPackageRoot || "";
  }
  const summaryText = summary
    ? ` 记录 ${summary.records || 0} 条，草稿 ${summary.drafts || 0} 条，对话 ${summary.chatMessages || 0} 条，标签 ${summary.tags || 0} 个。`
    : "";
  const compatibilityText = compatibility
    ? ` 兼容性：${compatibility.openMode}${compatibility.requiresMigration ? `，待迁移步骤 ${compatibility.steps.join(", ")}` : ""}。`
    : "";
  refs.mountStatus.textContent = mountStatus?.note
    ? `${mountStatus.note}${mountStatus.appDbPath ? ` 当前 Karin 数据入口：${mountStatus.appDbPath}` : ""}${summaryText}${compatibilityText}`
    : state.shellCache.mountPackageRoot
      ? `Karin 已缓存上次的 Kaede 路径：${state.shellCache.mountPackageRoot}${summaryText}${compatibilityText}`
      : "当前未配置 Kaede 挂载。";
  maybeShowMigrationNotice(compatibility, mountStatus);
  syncKarinSession("mount_status");
}

function maybeShowMigrationNotice(compatibility, mountStatus) {
  if (!compatibility || !mountStatus?.configured || !refs.migrationNoticeModal) return;
  if (compatibility.openMode !== "upgradeable" && compatibility.openMode !== "too_new") return;

  const noticeKey = [
    mountStatus.packageRoot || "",
    compatibility.openMode || "",
    compatibility.schemaVersion ?? "",
    compatibility.targetSchemaVersion ?? "",
    Array.isArray(compatibility.steps) ? compatibility.steps.join("|") : "",
  ].join("::");

  if (state.lastMigrationNoticeKey === noticeKey) return;
  state.lastMigrationNoticeKey = noticeKey;

  const isUpgradeable = compatibility.openMode === "upgradeable";
  if (refs.migrationNoticeTitle) {
    refs.migrationNoticeTitle.textContent = isUpgradeable ? "Kaede 需要迁移升级" : "Kaede 版本高于当前 Karin";
  }
  if (refs.migrationNoticeBody) {
    refs.migrationNoticeBody.textContent = isUpgradeable
      ? "当前挂载的 Kaede 数据结构版本落后于这版 Karin。确认后 Karin 才会在本地执行 schema migration，并继续打开这个 notebook。"
      : "当前挂载的 Kaede 由更高版本的 schema 创建。为了避免误写数据，这版 Karin 不应该直接修改它。";
  }
  if (refs.migrationNoticeMeta) {
    refs.migrationNoticeMeta.textContent = `当前 schemaVersion：${compatibility.schemaVersion}，Karin 支持到：${compatibility.targetSchemaVersion}，兼容性状态：${describeMigrationOpenMode(compatibility.openMode)}。`;
  }
  if (refs.migrationNoticeSteps) {
    const steps = Array.isArray(compatibility.steps) ? compatibility.steps : [];
    refs.migrationNoticeSteps.innerHTML = steps.length
      ? steps.map((step) => `<li>${escapeHtml(formatMigrationStepLabel(step))}</li>`).join("")
      : `<li>${isUpgradeable ? "当前没有列出具体步骤，但打开时仍会先执行版本同步。" : "当前版本过新，建议使用更新版本的 Karin 打开。"}</li>`;
  }

  const ackButton = document.querySelector("#ack-migration-notice-btn");
  if (ackButton) {
    ackButton.textContent = isUpgradeable ? "确认升级并打开" : "知道了";
  }

  refs.migrationNoticeModal.showModal();
}

async function maybePauseOpenForCompatibility(compatibility, requestOptions = {}) {
  if (!compatibility) return false;
  if (compatibility.openMode === "compatible") return false;

  if (compatibility.openMode === "too_new") {
    state.pendingKaedeOpenRequest = null;
    maybeShowMigrationNotice(compatibility, state.mountStatus);
    if (!requestOptions.silent) {
      setStatus("当前 Kaede 版本高于这版 Karin，已阻止打开。");
    }
    return true;
  }

  if (compatibility.openMode === "upgradeable") {
    state.pendingKaedeOpenRequest = {
      silent: Boolean(requestOptions.silent),
      source: requestOptions.source || "manual",
    };
    maybeShowMigrationNotice(compatibility, state.mountStatus);
    if (!requestOptions.silent) {
      setStatus("当前 Kaede 需要先确认升级，确认后才会执行迁移并打开。");
    }
    return true;
  }

  return false;
}

function handleMigrationNoticeClose() {
  state.pendingKaedeOpenRequest = null;
  refs.migrationNoticeModal?.close();
}

async function handleMigrationNoticeAcknowledge() {
  const pending = state.pendingKaedeOpenRequest;
  state.pendingKaedeOpenRequest = null;
  refs.migrationNoticeModal?.close();
  if (!pending) return;
  try {
    await handleOpenMountedKaede({
      ...pending,
      skipCompatibilityPrompt: true,
      source: pending.source || "migration_confirmed",
    });
  } catch (error) {
    setStatus(`确认升级后打开 Kaede 失败：${error.message}`);
  }
}

function describeMigrationOpenMode(openMode) {
  if (openMode === "upgradeable") return "可升级";
  if (openMode === "too_new") return "版本过新";
  if (openMode === "compatible") return "兼容";
  return String(openMode || "未知");
}

function formatMigrationStepLabel(step) {
  const known = {
    to_v4_add_importance: "升级到 v4：补齐 importance 字段默认值",
    to_v5_scoped_tags: "升级到 v5：拆分并规范 calendar/task 标签结构",
    to_v6_calendar_datetime_range: "升级到 v6：统一 calendar 起止完整时间结构",
  };
  return known[step] || String(step || "unknown_step");
}

async function pickKaedeFolderPath() {
  if (pickFolderDialog) {
    return pickFolderDialog();
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    pickFolderDialog = () => invoke("pick_kaede_folder");
    return pickFolderDialog();
  } catch (error) {
    console.warn("Kaede folder picker unavailable:", error);
    throw error;
  }
}

async function pickChatAttachments() {
  if (pickChatAttachmentsCommand) {
    return pickChatAttachmentsCommand();
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    pickChatAttachmentsCommand = () => invoke("pick_chat_attachments");
    return pickChatAttachmentsCommand();
  } catch (error) {
    console.warn("Chat attachment picker unavailable:", error);
    throw error;
  }
}

async function handleEventAiAssist() {
  const text = refs.eventAiInput.value.trim();
  if (!text) {
    setStatus("先输入一句自然语言描述，再让 AI 帮你整理。");
    refs.eventAiInput.focus();
    return;
  }

  try {
    // AI 在这里扮演的是“帮你填表”的助手，而不是绕过确认直接写库。
    // 这样既保留了轻量化体验，也保留了人为兜底。
    setStatus("正在为当前日程弹窗解析内容...");
    const drafts = state.db.settings.parseMode === "llm"
      ? await secretaryAssistant.parseNaturalLanguageWithLlm(text)
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
      tags: eventDraft.proposedTags || [],
      tagColor: eventDraft.proposedTagColor || refs.eventTagColor.value || "#115e59",
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
  deleteEventRecordById(eventId, { closeEditor: true, resetEventForm: true, statusMessage: "事项已删除，历史追溯信息仍然保留。" });
}

function deleteEventRecordById(eventId, options = {}) {
  /* calendar 删除统一走这一条：
     - 表单删除
     - 详情弹层删除
     - 月视图快速输入里的空项删除
     - 全局 Delete/Backspace 删除选中卡片
     这样可以把快照、搜索索引、月视图滚动恢复、状态清理都集中在一个地方。 */
  const event = getRecordById(eventId);
  if (!event || event.recordType !== "calendar") return false;
  /* 周视图里删除普通事项也会触发一次完整 render。
     如果不先记录当前横向/纵向位置，后续 syncWeekPaneScrollerToLeftEdge
     可能会按陈旧的左边界日期重新定位，表现成“删完卡片页面突然跳走”。 */
  if (state.activeView === "week") {
    preserveWeekPanePosition();
  }
  if (state.monthQuickEntry.recordId === eventId) {
    preserveMonthScrollerPosition();
    clearMonthQuickEntry();
  }
  if (state.weekQuickEntry.recordId === eventId) {
    preserveWeekPanePosition();
    clearWeekQuickEntry();
  }
  saveSnapshot(event, "before_delete");
  state.db.records = state.db.records.filter((item) => item.id !== eventId);
  removeSearchDocsForRecord(eventId);
  logChange(eventId, "record", JSON.stringify(event), "[deleted]", "manual_ui");
  state.editingEventId = null;
  if (options.resetEventForm) {
    seedEmptyInputForm();
  }
  persistState();
  if (options.closeEditor) {
    refs.eventEditorModal.close();
  }
  if (options.closePopover && state.eventDetailPopover?.recordId === eventId) {
    closeEventDetailPopover({ statusMessage: "" });
  }
  render();
  setStatus(options.statusMessage || "事项已删除。");
  return true;
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
        tags: draft.proposedTags || [],
        tagColor: draft.proposedTagColor || "#115e59",
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
        tags: draft.proposedTags || [],
        tagColor: draft.proposedTagColor || "#115e59",
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
        state.db = databaseStore.normalizeImportedState(JSON.parse(content));
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

function navigateToDateDetail(dateIso, options = {}) {
  if (!dateIso) return;
  state.selectedDate = dateIso;
  state.visibleWeek = startOfWeek(parseDate(dateIso));
  state.visibleMonth = startOfMonth(parseDate(dateIso));
  syncWeekViewportState(isoDate(startOfWeek(parseDate(dateIso))), { resetRangeAnchor: true });
  state.weekPaneScroll.restoreScrollTop = 0;
  state.weekPaneScroll.animateOnNextSync = true;
  state.weekPaneScroll.suppressNextScroll = false;
  state.activeView = options.preferredView || "day";
  render();

  const focusRecordId = options.focusRecordId || "";
  if (focusRecordId) {
    navigateToRecordInWorkspace(focusRecordId, {
      preferredView: state.activeView,
      forceRender: false,
      forceScroll: false,
      behavior: "auto",
    });
  }
}

function openEventDetailPopover(eventId, anchorElement) {
  if (state.eventDetailPopover?.recordId && state.eventDetailPopover.recordId !== eventId) {
    closeEventDetailPopover({ statusMessage: "" });
    anchorElement = findEventDetailAnchorElement(eventId, { view: state.activeView });
  }

  const record = getRecordById(eventId);
  if (!record || record.recordType !== "calendar" || !anchorElement || !refs.eventDetailPopover || !refs.eventDetailPopoverContent) {
    return;
  }

  state.editingEventId = record.id;
  state.editingTodoId = null;
  if (state.activeView === "day") {
    renderSelectedDaySummary();
    renderDailyEvents();
  }
  renderTracePanel();

  state.eventDetailPopover = {
    recordId: record.id,
    anchorRect: getPopoverAnchorRect(anchorElement),
  };

  /* 详情弹窗始终围绕一份“当前草稿”工作：
     - 首次打开时，用持久化 record 初始化草稿
     - 后续手动输入、标签选择、AI patch 都只改草稿
     - 只有点“保存”时才真正写回 record
     这样就不会再出现“AI 改了 DOM，但下一次重绘又被旧 record 覆盖”的问题。 */
  if (state.eventDetailDraft.recordId !== record.id || !state.eventDetailDraft.values) {
    state.eventDetailDraft = {
      recordId: record.id,
      values: buildEventDetailDraft(record),
    };
  }

  refs.eventDetailPopoverContent.innerHTML = buildEventDetailPopoverMarkup(record);
  refs.eventDetailPopover.classList.remove("is-hidden", "is-closing", "is-visible");
  refs.eventDetailPopover.classList.add("is-entering");
  refs.eventDetailPopover.setAttribute("aria-hidden", "false");
  positionEventDetailPopover(state.eventDetailPopover.anchorRect);
  requestAnimationFrame(() => {
    refs.eventDetailPopover?.classList.remove("is-entering");
    refs.eventDetailPopover?.classList.add("is-visible");
  });

  bindEventDetailActions(refs.eventDetailPopoverContent, record.id, { mode: "popover" });
}

function resetEventDetailTransientState() {
  state.eventDetailDraft = {
    recordId: "",
    values: null,
  };
  state.detailAiState = {
    recordId: "",
    running: false,
    changedFields: [],
    message: "",
    inputText: "",
  };
  state.detailTagPicker = {
    recordId: "",
    open: false,
  };
  state.detailTemporalUi = {
    recordId: "",
    expanded: false,
  };
}

/* 详情弹窗关闭时并不是直接从 DOM 取值保存，而是先把当前草稿整理成标准 payload。
   这样“显式保存”和“退出自动保存”都可以复用同一套提交结构，
   避免不同退出路径保存出不同字段。 */
function buildEventDetailPayloadFromDraft(eventId) {
  const record = getRecordById(eventId);
  if (!record) return null;
  const latestRaw = getLatestRawInputForRecord(record.id);
  const draft = getEventDetailDraft(record);
  const startTime = String(draft.startTime || "");
  const endTime = String(draft.endTime || "");
  const hasConcreteTime = Boolean(startTime || endTime);
  return {
    id: record.id,
    title: String(draft.title || "").trim() || "新建日程",
    date: draft.date || record.date || state.selectedDate,
    endDate: (draft.endDate || draft.date || record.date || state.selectedDate) < (draft.date || record.date || state.selectedDate)
      ? (draft.date || record.date || state.selectedDate)
      : (draft.endDate || draft.date || record.date || state.selectedDate),
    allDay: !hasConcreteTime,
    startTime: hasConcreteTime ? startTime : "",
    endTime: hasConcreteTime ? endTime : "",
    location: String(draft.location || "").trim(),
    tags: ensureDefaultTags("calendar", draft.tags || []),
    tagColor: draft.tagColor || getPrimaryRecordColor(record),
    importance: record.importance || "normal",
    notes: String(draft.notes || "").trim(),
    rawInput: latestRaw?.inputText || "",
    sourceType: record.sourceType || "manual_ui",
  };
}

function hasEventDetailPayloadChanges(eventId, payload) {
  const record = getRecordById(eventId);
  if (!record || !payload) return false;
  const currentTags = ensureDefaultTags("calendar", Array.isArray(record.tags) ? record.tags : []);
  return [
    String(record.title || "") !== String(payload.title || ""),
    String(record.date || "") !== String(payload.date || ""),
    String(getEventEndDateIso(record) || "") !== String(payload.endDate || payload.date || ""),
    String(record.startTime || "") !== String(payload.startTime || ""),
    String(record.endTime || "") !== String(payload.endTime || ""),
    Boolean(record.allDay) !== Boolean(payload.allDay),
    String(record.location || "") !== String(payload.location || ""),
    String(record.notes || "") !== String(payload.notes || ""),
    JSON.stringify(currentTags) !== JSON.stringify(payload.tags || []),
    normalizeHexColor(record.tagColor || getDefaultTagColor("calendar")) !== normalizeHexColor(payload.tagColor || getDefaultTagColor("calendar")),
  ].some(Boolean);
}

/* 自动保存的底层提交器。
   它先比较草稿和当前 record 是否真的发生变化；只有有变化时才：
   1. updateExistingEvent
   2. persistState
   3. 根据场景决定 revealCreatedEvent 还是普通 render
   这样点外面关闭、按 Esc、切到另一条事项时都能走同一条稳定链路。 */
function persistEventDetailDraft(eventId, options = {}) {
  const payload = buildEventDetailPayloadFromDraft(eventId);
  if (!payload) return false;
  const changed = hasEventDetailPayloadChanges(eventId, payload);
  resetEventDetailTransientState();
  if (!changed) {
    return false;
  }
  /* 详情卡片关闭/切换时，如果当前在周视图，自动保存也会触发 render。
     这里同样先锁住当前周视图位置，避免“拖拽创建新卡片 -> 旧卡片自动保存 -> 页面横向跳一下”。 */
  if (state.activeView === "week" && !options.reveal) {
    preserveWeekPanePosition();
  }
  updateExistingEvent(payload);
  persistState();
  if (options.reveal) {
    revealCreatedEvent(eventId);
  } else {
    render();
  }
  if (options.statusMessage) {
    setStatus(options.statusMessage);
  }
  return true;
}

function closeEventDetailPopover(options = {}) {
  if (!refs.eventDetailPopover || refs.eventDetailPopover.classList.contains("is-hidden")) return;
  const eventId = state.eventDetailPopover?.recordId || "";
  const shouldAutoSave = options.autoSave !== false;
  if (shouldAutoSave && eventId) {
    const didSave = persistEventDetailDraft(eventId, {
      reveal: false,
      statusMessage: options.statusMessage === undefined ? "事项已自动保存。" : options.statusMessage,
    });
    if (didSave) {
      return;
    }
  }
  const anchor = eventId ? findEventDetailAnchorElement(eventId, { view: state.activeView }) : null;
  if (anchor) {
    // 关闭前重新抓一次当前锚点，让“回收到源事项”能跟随滚动后的位置。
    positionEventDetailPopover(getPopoverAnchorRect(anchor));
  }
  refs.eventDetailPopover.classList.remove("is-visible");
  refs.eventDetailPopover.classList.remove("is-entering");
  refs.eventDetailPopover.classList.add("is-closing");
  refs.eventDetailPopover.setAttribute("aria-hidden", "true");
  window.setTimeout(() => {
    if (!refs.eventDetailPopover || refs.eventDetailPopover.classList.contains("is-visible")) return;
    refs.eventDetailPopover.classList.add("is-hidden");
    refs.eventDetailPopover.classList.remove("is-closing");
    refs.eventDetailPopover.style.removeProperty("--popover-left");
    refs.eventDetailPopover.style.removeProperty("--popover-top");
    refs.eventDetailPopover.style.removeProperty("--popover-arrow-top");
    refs.eventDetailPopover.style.removeProperty("--popover-arrow-left");
    refs.eventDetailPopover.style.removeProperty("--popover-arrow-right");
    refs.eventDetailPopover.style.removeProperty("--popover-origin-x");
    refs.eventDetailPopover.style.removeProperty("--popover-origin-y");
    refs.eventDetailPopover.dataset.side = "";
    state.eventDetailPopover = null;
    resetEventDetailTransientState();
  }, 320);
}

/* 详情弹窗是当前日程的“主编辑面”。
   它不再依赖外层传统表单，而是直接由草稿态驱动：
   - 标题右侧的小圆点承担标签入口
   - AI 修改助手只作用于当前这一条记录
   - 底部保存按钮负责把草稿提交回数据层 */
function buildEventDetailPopoverMarkup(record) {
  const draft = getEventDetailDraft(record);
  const latestRaw = getLatestRawInputForRecord(record.id);
  const detailAiState = state.detailAiState.recordId === record.id ? state.detailAiState : {
    recordId: record.id,
    running: false,
    changedFields: [],
    message: "",
    inputText: "",
  };
  const tagPickerOpen = state.detailTagPicker.recordId === record.id && state.detailTagPicker.open;
  const changedFields = new Set(detailAiState.changedFields || []);
  const temporalUi = state.detailTemporalUi.recordId === record.id ? state.detailTemporalUi : {
    recordId: record.id,
    expanded: false,
  };
  const timeText = formatEventDetailTimeSummary(draft);
  const timeChanged = changedFields.has("date") || changedFields.has("endDate") || changedFields.has("startTime") || changedFields.has("endTime");
  const tagDotColor = resolveScopedPrimaryColor("calendar", draft.tags, draft.tagColor || getDefaultTagColor("calendar"));

  /* 详情卡片这里专门做“减行数”优化：
     - 时间默认压成一行摘要
     - AI 区只保留输入和执行按钮
     - 原始输入继续折叠，避免主编辑区被次要信息撑高 */
  return `
    <div class="event-detail-popover-head">
      <div class="event-detail-popover-title-wrap">
        <p class="event-detail-popover-eyebrow" data-event-detail-eyebrow>${escapeHtml(draft.date || state.selectedDate)}</p>
        <div class="event-detail-title-row">
          <input class="event-detail-inline-title${changedFields.has("title") ? " is-ai-updated" : ""}" data-event-detail-field="title" value="${escapeHtml(draft.title || "未命名事项")}">
          <div class="event-detail-tag-picker">
            <button
              class="event-detail-tag-dot"
              data-event-detail-tag-trigger
              type="button"
              aria-expanded="${tagPickerOpen ? "true" : "false"}"
              style="--event-tag-dot:${escapeHtml(tagDotColor)}"
              aria-label="选择标签"
            ></button>
            ${tagPickerOpen ? buildEventDetailTagPanelMarkup(draft) : ""}
          </div>
        </div>
      </div>
    </div>
    <section class="event-detail-time-shell${temporalUi.expanded ? " is-expanded" : ""}">
      <button
        class="event-detail-time-summary${timeChanged ? " is-ai-updated" : ""}"
        data-event-detail-action="toggle-time"
        type="button"
        aria-expanded="${temporalUi.expanded ? "true" : "false"}"
      >
        <span class="event-detail-time-summary-label">日期时间</span>
        <span class="event-detail-time-summary-value" data-event-detail-time-text>${escapeHtml(timeText)}</span>
      </button>
      <!-- 编辑层常驻 DOM，只做显隐切换。
           这样展开/收起时更顺，也不会因为重建节点丢掉输入状态。 -->
      <div class="event-detail-time-editor-wrap" aria-hidden="${temporalUi.expanded ? "false" : "true"}">
        ${buildEventDetailTemporalEditorMarkup(draft, changedFields)}
      </div>
    </section>
    <label class="event-detail-inline-label ${changedFields.has("location") ? "is-ai-updated" : ""}">
      地点
      <input data-event-detail-field="location" type="text" value="${escapeHtml(draft.location || "")}" placeholder="地点未填">
    </label>
    <label class="event-detail-inline-label ${changedFields.has("notes") ? "is-ai-updated" : ""}">
      备注
      <textarea class="event-detail-inline-notes" data-event-detail-field="notes" rows="1" placeholder="暂无备注">${escapeHtml(draft.notes || "")}</textarea>
    </label>
    <section class="event-detail-ai-box">
      <textarea
        class="event-detail-ai-input"
        data-event-detail-ai-input
        rows="2"
        placeholder="例如：改到晚上7点；地点改成图书馆302；改成全天事项"
        ${detailAiState.running ? "disabled" : ""}
      >${escapeHtml(detailAiState.inputText || "")}</textarea>
      <div class="event-detail-ai-actions">
        <span class="event-detail-ai-title">AI修改助手</span>
        <button class="ghost-btn" data-event-detail-action="ai-apply" type="button"${detailAiState.running ? " disabled" : ""}>${detailAiState.running ? "处理中..." : "AI修改"}</button>
      </div>
    </section>
    <div class="event-detail-inline-actions">
      <button class="secondary-btn" data-event-detail-action="save" type="button">保存</button>
      <button class="ghost-btn" data-event-detail-action="toggle-raw" type="button">原始输入</button>
      <button class="danger-btn" data-event-detail-action="delete" type="button">删除</button>
    </div>
    <div class="event-detail-popover-foot is-collapsed" data-event-detail-raw-panel>
      <span>原始输入</span>
      <p>${escapeHtml(latestRaw?.inputText || "暂无原始输入")}</p>
    </div>
  `;
}

function buildEventDetailDraft(record) {
  return {
    title: record.title || "",
    date: record.date || state.selectedDate,
    endDate: getEventEndDateIso(record),
    startTime: record.startTime || "",
    endTime: record.endTime || "",
    allDay: Boolean(record.allDay || !record.startTime),
    location: record.location || "",
    notes: record.notes || "",
    tags: ensureDefaultTags("calendar", Array.isArray(record.tags) ? record.tags : []),
    tagColor: normalizeHexColor(record.tagColor || getDefaultTagColor("calendar")),
  };
}

function formatEventDetailTimeSummary(draft) {
  const startDate = draft.date || state.selectedDate;
  const endDate = draft.endDate || startDate;
  const startDateText = formatEventDetailCompactDate(startDate);
  const endDateText = formatEventDetailCompactDate(endDate);
  if (draft.allDay || (!draft.startTime && !draft.endTime)) {
    return startDate === endDate ? `${startDateText} 全天` : `${startDateText} - ${endDateText} 全天`;
  }
  const startTime = draft.startTime || "00:00";
  const endTime = draft.endTime || draft.startTime || "00:00";
  if (startDate === endDate) {
    return `${startDateText}${startTime} - ${endTime}`;
  }
  return `${startDateText}${startTime} - ${endDateText}${endTime}`;
}

function formatEventDetailCompactDate(dateIso) {
  const normalized = normalizeDateOnly(dateIso);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-");
  return `${Number(year)}年${Number(month)}月${Number(day)}日`;
}

function buildEventDetailTemporalEditorMarkup(draft, changedFields) {
  const rows = [
    { field: "date", label: "开始日期" },
    { field: "startTime", label: "开始时间" },
    { field: "endDate", label: "结束日期" },
    { field: "endTime", label: "结束时间" },
  ];
  /* 时间编辑组保持最小必要字段集合。
     不再额外放“全天/定时”切换，是否全天由时间是否留空自动推导。 */
  return `
    <div class="event-detail-temporal-editor">
      ${rows.map(({ field, label }) => `
        <div class="event-detail-temporal-row${changedFields.has(field) ? " is-ai-updated" : ""}">
          <span class="event-detail-temporal-label">${label}</span>
          ${buildEventDetailTemporalInlineControlMarkup(draft, field)}
        </div>
      `).join("")}
    </div>
  `;
}

function buildEventDetailTemporalInlineControlMarkup(draft, field) {
  if (field === "date" || field === "endDate") {
    const value = field === "date" ? (draft.date || state.selectedDate) : (draft.endDate || draft.date || state.selectedDate);
    return `
      <input class="event-detail-inline-temporal-input" data-event-detail-inline-input="${field}" type="date" value="${escapeHtml(value)}">
    `;
  }
  if (field === "startTime" || field === "endTime") {
    const value = field === "startTime" ? (draft.startTime || "09:00") : (draft.endTime || draft.startTime || "10:00");
    return `
      <input class="event-detail-inline-temporal-input" data-event-detail-inline-input="${field}" type="time" value="${escapeHtml(value)}">
    `;
  }
  return "";
}

/* 标签面板沿用现有 tag registry，但这里只做当前事项的轻量多选。
   顶层只显示颜色点，真正的标签名放到弹出面板里选。 */
function buildEventDetailTagPanelMarkup(draft) {
  const selectedTags = ensureDefaultTags("calendar", draft.tags || []);
  const tags = getScopedTagRegistry("calendar");
  if (!tags.length) {
    return `<div class="event-detail-tag-panel empty-state">这里还没有日程标签。</div>`;
  }
  return `
    <div class="event-detail-tag-panel">
      ${tags.map((tag) => {
        const active = selectedTags.includes(tag.name);
        return `
          <button
            class="tag-inline-option${active ? " is-active" : ""}"
            type="button"
            data-event-detail-tag-toggle="${escapeHtml(tag.name)}"
          >
            <span class="tag-inline-option-mark" aria-hidden="true">${active ? "✓" : ""}</span>
            <span class="tag-inline-option-dot" style="--tag-dot:${escapeHtml(normalizeHexColor(tag.color))}"></span>
            <span class="tag-inline-option-label">${escapeHtml(tag.name)}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function getEventDetailDraft(record) {
  if (state.eventDetailDraft.recordId === record.id && state.eventDetailDraft.values) {
    return state.eventDetailDraft.values;
  }
  return buildEventDetailDraft(record);
}

/* 所有输入框都先写详情草稿，不直接写 record。
   这是当前“UI 编辑态”和“持久化数据”之间的边界。 */
function updateEventDetailDraftField(eventId, field, value) {
  const record = getRecordById(eventId);
  if (!record) return;
  const baseDraft = state.eventDetailDraft.recordId === eventId && state.eventDetailDraft.values
    ? state.eventDetailDraft.values
    : buildEventDetailDraft(record);
  state.eventDetailDraft = {
    recordId: eventId,
    values: {
      ...baseDraft,
      [field]: value,
    },
  };
}

function applyEventDetailTemporalChange(eventId, field, value) {
  const record = getRecordById(eventId);
  if (!record) return;
  const baseDraft = getEventDetailDraft(record);
  const nextDraft = {
    ...baseDraft,
    [field]: value,
  };
  /* 旧版显式 allDay 开关已经移除。
     现在只要开始/结束时间都为空，就把当前草稿视为全天事项。 */
  nextDraft.allDay = !nextDraft.startTime && !nextDraft.endTime;
  if (field === "date" && nextDraft.endDate < nextDraft.date) {
    nextDraft.endDate = nextDraft.date;
  }
  if (field === "endDate" && nextDraft.endDate < nextDraft.date) {
    nextDraft.endDate = nextDraft.date;
  }
  state.eventDetailDraft = {
    recordId: eventId,
    values: nextDraft,
  };
}

function isEventDetailTemporalExpanded(eventId) {
  return state.detailTemporalUi.recordId === eventId && state.detailTemporalUi.expanded;
}

/* 时间区域改为“摘要层 + 编辑层”共存，
   这样展开和收起都可以只切 class，不需要整块重绘，动画更顺也不会打断焦点。 */
function syncEventDetailTemporalUi(root, eventId) {
  if (!root) return;
  const shell = root.querySelector(".event-detail-time-shell");
  if (!shell) return;
  const expanded = isEventDetailTemporalExpanded(eventId);
  const summary = shell.querySelector(".event-detail-time-summary");
  const editorWrap = shell.querySelector(".event-detail-time-editor-wrap");
  const record = getRecordById(eventId);
  const draft = record ? getEventDetailDraft(record) : null;
  shell.classList.toggle("is-expanded", expanded);
  if (summary) {
    summary.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (draft) {
      const timeText = summary.querySelector("[data-event-detail-time-text]");
      if (timeText) timeText.textContent = formatEventDetailTimeSummary(draft);
    }
  }
  if (editorWrap) {
    editorWrap.setAttribute("aria-hidden", expanded ? "false" : "true");
  }
}

function syncEventDetailTemporalInputs(root, eventId) {
  if (!root) return;
  const record = getRecordById(eventId);
  if (!record) return;
  const draft = getEventDetailDraft(record);
  const inputMap = {
    date: draft.date || state.selectedDate,
    startTime: draft.startTime || "09:00",
    endDate: draft.endDate || draft.date || state.selectedDate,
    endTime: draft.endTime || draft.startTime || "10:00",
  };
  Object.entries(inputMap).forEach(([field, value]) => {
    const input = root.querySelector(`[data-event-detail-inline-input="${field}"]`);
    if (input && input.value !== value) input.value = value;
  });
  syncEventDetailTemporalUi(root, eventId);
}

function setEventDetailTemporalExpanded(root, eventId, expanded) {
  state.detailTemporalUi = {
    recordId: eventId,
    expanded,
  };
  syncEventDetailTemporalUi(root, eventId);
}

/* 标签也是草稿的一部分。这里顺手同步 tagColor，
   保证标题右边的小圆点始终跟当前选中标签的主色保持一致。 */
function updateEventDetailDraftTags(eventId, tags) {
  const record = getRecordById(eventId);
  if (!record) return;
  const baseDraft = state.eventDetailDraft.recordId === eventId && state.eventDetailDraft.values
    ? state.eventDetailDraft.values
    : buildEventDetailDraft(record);
  const nextTags = ensureDefaultTags("calendar", tags);
  state.eventDetailDraft = {
    recordId: eventId,
    values: {
      ...baseDraft,
      tags: nextTags,
      tagColor: resolveScopedPrimaryColor("calendar", nextTags, baseDraft.tagColor || getDefaultTagColor("calendar")),
    },
  };
}

/* 这一个函数统一绑定“详情弹窗 / 日视图详情面板”两种编辑表面。
   这一轮保留同一套行为：
   - 输入框更新草稿
   - 标签圆点展开标签面板
   - AI 按钮只修改当前事项草稿
   - 保存时再统一写回 record */
function bindEventDetailActions(root, eventId, options = {}) {
  if (!root) return;
  const isPanel = options.mode === "panel";
  root.querySelectorAll("[data-event-detail-field]").forEach((element) => {
    element.addEventListener("input", (event) => {
      updateEventDetailDraftField(eventId, event.target.dataset.eventDetailField, event.target.value);
    });
    /* 用户一旦切去改标题 / 地点 / 备注等非时间字段，
       时间二级编辑卡片就自动收起，回到紧凑的一行摘要。 */
    element.addEventListener("focus", () => {
      if (isEventDetailTemporalExpanded(eventId)) {
        setEventDetailTemporalExpanded(root, eventId, false);
      }
    });
  });
  root.querySelector("[data-event-detail-action='save']")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    saveEventDetailEdit(root, eventId, options);
  });
  root.querySelector("[data-event-detail-action='toggle-raw']")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleEventDetailRawPanel(root, isPanel);
  });
  root.querySelector("[data-event-detail-action='toggle-time']")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setEventDetailTemporalExpanded(root, eventId, !isEventDetailTemporalExpanded(eventId));
  });
  root.querySelectorAll("[data-event-detail-inline-input]").forEach((input) => {
    input.addEventListener("input", () => {
      applyEventDetailTemporalChange(eventId, input.dataset.eventDetailInlineInput, input.value);
      syncEventDetailTemporalInputs(root, eventId);
    });
    input.addEventListener("change", () => {
      applyEventDetailTemporalChange(eventId, input.dataset.eventDetailInlineInput, input.value);
      syncEventDetailTemporalInputs(root, eventId);
    });
  });
  root.querySelector("[data-event-detail-tag-trigger]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isEventDetailTemporalExpanded(eventId)) {
      setEventDetailTemporalExpanded(root, eventId, false);
    }
    state.detailTagPicker = {
      recordId: eventId,
      open: !(state.detailTagPicker.recordId === eventId && state.detailTagPicker.open),
    };
    rerenderDetailSurface(root, eventId, options);
  });
  root.querySelectorAll("[data-event-detail-tag-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const tagName = button.dataset.eventDetailTagToggle;
      const draft = getEventDetailDraft(getRecordById(eventId));
      const activeTags = ensureDefaultTags("calendar", draft.tags || []);
      const nextTags = activeTags.includes(tagName)
        ? activeTags.filter((item) => item !== tagName)
        : [...activeTags, tagName];
      updateEventDetailDraftTags(eventId, nextTags);
      state.detailTagPicker = { recordId: eventId, open: true };
      rerenderDetailSurface(root, eventId, options);
    });
  });
  root.querySelector("[data-event-detail-action='ai-apply']")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    submitEventDetailAiEdit(root, eventId, options);
  });
  root.querySelector("[data-event-detail-ai-input]")?.addEventListener("input", (event) => {
    state.detailAiState = {
      ...state.detailAiState,
      recordId: eventId,
      inputText: event.target.value,
    };
  });
  root.querySelector("[data-event-detail-ai-input]")?.addEventListener("focus", () => {
    if (isEventDetailTemporalExpanded(eventId)) {
      setEventDetailTemporalExpanded(root, eventId, false);
    }
  });
  root.querySelector("[data-event-detail-ai-input]")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitEventDetailAiEdit(root, eventId, options);
    }
  });
  root.querySelector("[data-event-detail-action='delete']")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    deleteEventFromDetail(root, eventId, options);
  });
  syncEventDetailTemporalUi(root, eventId);
}

function toggleEventDetailRawPanel(root, isPanel = false) {
  const panel = root?.querySelector("[data-event-detail-raw-panel]");
  if (!panel) return;
  const expanded = panel.classList.toggle("is-collapsed");
  if (!isPanel && refs.eventDetailPopover) {
    refs.eventDetailPopover.classList.toggle("is-raw-expanded", !expanded);
  }
}

function collectEventDetailData(root, eventId) {
  const record = getRecordById(eventId);
  if (!record || !root) return null;
  const latestRaw = getLatestRawInputForRecord(record.id);
  const draft = getEventDetailDraft(record);
  const getValue = (field) => root.querySelector(`[data-event-detail-field="${field}"]`)?.value || "";
  return {
    id: record.id,
    title: getValue("title") || "新建日程",
    date: draft.date || record.date || state.selectedDate,
    endDate: draft.endDate || getEventEndDateIso(record),
    allDay: Boolean(draft.allDay || (!draft.startTime && !draft.endTime)),
    startTime: draft.allDay ? "" : (draft.startTime || ""),
    endTime: draft.allDay ? "" : (draft.endTime || ""),
    location: getValue("location"),
    tags: ensureDefaultTags("calendar", draft.tags || []),
    tagColor: draft.tagColor || getPrimaryRecordColor(record),
    importance: record.importance || "normal",
    notes: getValue("notes"),
    rawInput: latestRaw?.inputText || "",
    sourceType: record.sourceType || "manual_ui",
  };
}

/* 保存阶段才真正越过“草稿边界”写回数据层。
   这里会：
   1. 把当前详情表面采样成 payload
   2. 调用 updateExistingEvent 写回 record / tag / trace
   3. 清空详情草稿与 AI 临时状态
   4. 触发持久化和主界面重绘 */
function saveEventDetailEdit(root, eventId, options = {}) {
  const payload = collectEventDetailData(root, eventId);
  if (!payload) return;
  state.eventDetailDraft = {
    recordId: eventId,
    values: {
      ...getEventDetailDraft(getRecordById(eventId)),
      title: payload.title,
      date: payload.date,
      endDate: payload.endDate,
      startTime: payload.startTime,
      endTime: payload.endTime,
      location: payload.location,
      notes: payload.notes,
      tags: payload.tags,
      tagColor: payload.tagColor,
    },
  };
  persistEventDetailDraft(eventId, {
    reveal: true,
    statusMessage: "事项已更新。",
  });
  if (options.mode === "panel") {
    renderDailyEvents();
  }
}

function deleteEventFromDetail(root, eventId, options = {}) {
  deleteEventRecordById(eventId, {
    closePopover: options.mode === "popover",
    resetEventForm: false,
    statusMessage: "事项已删除。",
  });
}

/* 详情弹窗现在采用“局部重绘内部内容，完全不动外层弹窗容器”的策略：
   - 位置由 openEventDetailPopover 时确定
   - AI 请求中 / 返回后 / 标签切换时，只替换内部 HTML
   这样既避免弹窗漂移，也避免旧 record 把草稿覆盖回去。 */
function rerenderDetailSurface(root, eventId, options = {}) {
  if (options.mode === "panel") {
    renderDailyEvents();
    return;
  }
  const record = getRecordById(eventId);
  if (!record || !refs.eventDetailPopoverContent || !refs.eventDetailPopover) return;
  refs.eventDetailPopoverContent.innerHTML = buildEventDetailPopoverMarkup(record);
  refs.eventDetailPopover.classList.remove("is-hidden", "is-closing");
  refs.eventDetailPopover.classList.add("is-visible");
  refs.eventDetailPopover.setAttribute("aria-hidden", "false");
  bindEventDetailActions(refs.eventDetailPopoverContent, eventId, { mode: "popover" });
}

/* 详情 AI 的最终链路：
   1. 用当前详情草稿 + 一句用户指令向模型请求 patch
   2. 若模型返回 patch，则直接改草稿
   3. 若模型只返回 reason 且没有 patch，才视为“不执行修改”
   4. 再局部重绘详情内容，把新草稿显示出来
   这样可以兼容 DeepSeek 常见的返回格式：patch 和解释性 reason 同时出现。 */
async function submitEventDetailAiEdit(root, eventId, options = {}) {
  if (state.detailAiState.running) return;
  const record = getEventDetailRecordForAi(eventId);
  const input = root?.querySelector("[data-event-detail-ai-input]");
  if (!record || !input) return;
  const instruction = input.value.trim();
  if (!instruction) {
    state.detailAiState = {
      ...state.detailAiState,
      recordId: eventId,
      message: "先输入一句修改要求。",
      inputText: input.value,
    };
    rerenderDetailSurface(root, eventId, options);
    return;
  }

  const settings = state.db.settings || {};
  if (!(settings.parseMode === "llm" && settings.apiKey)) {
    state.detailAiState = {
      ...state.detailAiState,
      recordId: eventId,
      message: "当前详情 AI 仅在大模型模式且已配置 API Key 时可用。",
    };
    rerenderDetailSurface(root, eventId, options);
    return;
  }

  state.detailAiState = {
    ...state.detailAiState,
    recordId: eventId,
    running: true,
    message: "正在修改字段...",
    inputText: input.value,
  };
  rerenderDetailSurface(root, eventId, options);

  try {
    const patchResult = await requestEventDetailAiPatch(record, instruction);
    const hasPatch = Boolean(patchResult.patch && Object.keys(patchResult.patch).length);
    if (!hasPatch && patchResult.reason) {
      state.detailAiState = {
        ...state.detailAiState,
        recordId: eventId,
        running: false,
        changedFields: [],
        message: patchResult.reason,
        inputText: input.value,
      };
      rerenderDetailSurface(root, eventId, options);
      return;
    }

    const changedFields = applyEventDetailAiPatch(eventId, patchResult.patch || {});
    state.detailAiState = {
      ...state.detailAiState,
      recordId: eventId,
      running: false,
      changedFields,
      message: patchResult.summary || (changedFields.length ? "已更新字段，请检查后保存。" : (patchResult.reason || "没有识别到可修改字段。")),
      inputText: input.value,
    };
    rerenderDetailSurface(root, eventId, options);
  } catch (error) {
    state.detailAiState = {
      ...state.detailAiState,
      recordId: eventId,
      running: false,
      changedFields: [],
      message: `AI 修改失败：${error.message}`,
      inputText: input.value,
    };
    rerenderDetailSurface(root, eventId, options);
  }
}

/* patch 应用层只负责“改草稿”，不直接操作 DOM。
   DOM 的显示统一交给 rerenderDetailSurface，
   这样数据流始终是：
   AI patch -> 草稿 -> 视图
   而不是 AI patch -> DOM -> 下次重绘再猜状态。 */
function applyEventDetailAiPatch(eventId, patch) {
  const record = getRecordById(eventId);
  if (!record || !patch || typeof patch !== "object") return [];
  const draft = getEventDetailDraft(record);
  const changedFields = [];
  const allowedFields = ["title", "date", "endDate", "startTime", "endTime", "location", "notes"];
  const nextDraft = { ...draft };
  allowedFields.forEach((field) => {
    if (!(field in patch)) return;
    const nextValue = String(patch[field] ?? "");
    if (String(draft[field] || "") !== nextValue) {
      nextDraft[field] = nextValue;
      changedFields.push(field);
    }
  });
  if (changedFields.length) {
    state.eventDetailDraft = {
      recordId: eventId,
      values: nextDraft,
    };
  }
  return changedFields;
}

function getEventDetailRecordForAi(eventId) {
  const record = getRecordById(eventId);
  if (!record) return null;
  const draft = getEventDetailDraft(record);
  return {
    ...record,
    ...draft,
    allDay: !(draft.startTime || draft.endTime),
  };
}

/* 这里是“小 AI 助手”和外层 Karin assistant 的真正分界线：
   - 只发送当前时间、当前事项草稿、这一句用户修改要求
   - 不带 Kaede README，不带 notebook 全局上下文，不带对话历史
   - 返回结构限定成 patch，专门为低 token、低延迟的字段修改而设计 */
async function requestEventDetailAiPatch(record, instruction) {
  const settings = state.db.settings;
  const endpoint = buildChatCompletionsEndpoint(settings.apiBaseUrl);
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  const localNow = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const payload = {
    model: settings.apiModel,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "你是当前事项的字段修改助手。你只能修改这条日程的字段：title、date、startTime、endTime、location、notes。标题应优先提炼活动本身，不要把地点写进标题；像 lunch talk、组会、复盘会 这类活动短语应优先作为标题。返回 JSON：{\"patch\":{},\"summary\":\"\",\"reason\":\"\"}。如果请求超出范围，返回空 patch 和简短 reason。若 startTime 和 endTime 都为空，系统会视为全天事项。",
      },
      {
        role: "user",
        content: [
          `当前本地时间：${localNow} | timezone=${timezone} | iso=${now.toISOString()}`,
          `当前事项：${JSON.stringify({
            title: record.title || "",
            date: record.date || "",
            startTime: record.startTime || "",
            endTime: record.endTime || "",
            location: record.location || "",
            notes: record.notes || "",
          })}`,
          `用户要求：${instruction}`,
        ].join("\n"),
      },
    ],
  };

  const startedAt = performance.now();
  traceRuntime("detail_ai_patch", "详情 AI · request", { model: settings.apiModel });
  recordLlmExchange({
    stage: "详情AI字段修改",
    direction: "request",
    meta: `model=${settings.apiModel} | endpoint=${endpoint} | messages=${payload.messages.length}`,
    content: payload,
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(buildModelRequestErrorMessage(endpoint, error));
  }

  const durationMs = Math.round(performance.now() - startedAt);
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`详情 AI 请求失败：${response.status}，接口地址 ${endpoint}，返回内容：${responseText}`);
  }

  const json = await response.json();
  traceRuntime("detail_ai_patch", "详情 AI · response", {
    model: settings.apiModel,
    durationMs,
    promptTokens: json?.usage?.prompt_tokens ?? "",
    completionTokens: json?.usage?.completion_tokens ?? "",
    totalTokens: json?.usage?.total_tokens ?? "",
  });
  recordLlmExchange({
    stage: "详情AI字段修改",
    direction: "response",
    meta: `model=${settings.apiModel} | status=${response.status}`,
    durationMs,
    usage: json?.usage || null,
    content: {
      choices: json?.choices?.map((choice) => ({
        index: choice.index,
        finish_reason: choice.finish_reason,
        message: choice.message,
      })) || [],
      usage: json?.usage || null,
    },
  });

  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("模型没有返回可解析内容。");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("模型返回的不是合法 JSON。");
  }
  return normalizeEventDetailAiResult(parsed);
}

/* DeepSeek 这类模型有时会一边返回有效 patch，一边在 reason 里解释“为什么这么改”。
   这里统一做兼容：
   - 只要 patch 非空，就认为这次修改有效
   - 此时 reason 不再作为“拒绝修改”信号
   - 只有 patch 为空时，reason 才保留给 UI 显示 */
function normalizeEventDetailAiResult(result) {
  const allowedFields = ["title", "date", "endDate", "startTime", "endTime", "location", "notes"];
  const patch = {};
  if (result?.patch && typeof result.patch === "object") {
    Object.entries(result.patch).forEach(([key, value]) => {
      if (!allowedFields.includes(key)) return;
      patch[key] = typeof value === "string" ? value : String(value ?? "");
    });
  }
  return {
    patch,
    summary: String(result?.summary || ""),
    reason: Object.keys(patch).length ? "" : String(result?.reason || ""),
  };
}

function positionEventDetailPopover(anchorRect) {
  if (!refs.eventDetailPopover || !anchorRect) return;
  const popoverWidth = 320;
  const spacing = 14;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const popoverHeight = refs.eventDetailPopover.offsetHeight || 220;
  const side = anchorRect.left > viewportWidth * 0.55 ? "left" : "right";
  const left = side === "right"
    ? Math.min(viewportWidth - popoverWidth - 16, anchorRect.right + spacing)
    : Math.max(16, anchorRect.left - popoverWidth - spacing);
  const anchorCenterY = anchorRect.top + anchorRect.height / 2;
  const top = Math.max(12, Math.min(viewportHeight - popoverHeight - 12, anchorCenterY - popoverHeight / 2));
  const centerYInPopover = Math.max(24, Math.min(popoverHeight - 24, anchorCenterY - top));
  const arrowTop = centerYInPopover - 9;

  refs.eventDetailPopover.dataset.side = side;
  refs.eventDetailPopover.style.setProperty("--popover-left", `${left}px`);
  refs.eventDetailPopover.style.setProperty("--popover-top", `${top}px`);
  refs.eventDetailPopover.style.setProperty("--popover-arrow-top", `${arrowTop}px`);
  const originX = side === "right" ? 0 : popoverWidth;
  /* 这里最关键的约束是：
     1. 箭头中心
     2. 缩放原点
     3. 源事项当前可见区域的中线
     三者必须共线。
     否则视觉上就会出现“箭头指中间，但卡片像从底部缩放”的错觉。 */
  const originY = centerYInPopover;
  refs.eventDetailPopover.style.setProperty("--popover-origin-x", `${originX}px`);
  refs.eventDetailPopover.style.setProperty("--popover-origin-y", `${originY}px`);
}

function revealCreatedEvent(eventId, options = {}) {
  if (!eventId) return;
  navigateToRecordInWorkspace(eventId, {
    preferredView: options.preferredView || state.activeView,
    forceRender: true,
    forceScroll: Boolean(options.forceScroll || options.forceNavigate),
    behavior: options.behavior || "smooth",
  });
}

function revealCreatedWeekEventInPlace(eventId) {
  if (!eventId) return;
  const anchor = findEventDetailAnchorElement(eventId, { view: "week" });
  if (!anchor) return;
  /* 周视图时间轴里的双击/拖拽创建是“原地加一张卡片”的语义，
     不应该再触发一次“导航到这条记录”的横向跳转。
     所以这里只复用当前已存在的 DOM 锚点，直接打开详情。 */
  openEventDetailPopover(eventId, anchor);
}

/* 这里只负责“在当前 DOM 里找到那条事项对应的可点击卡片”。
   它被聊天卡片跳转、保存后重新定位、事项间切换三条链路共同复用。 */
function findEventDetailAnchorElement(eventId, options = {}) {
  const root = getEventAnchorRoot(options.view);
  if (!root) return null;
  if (options.view === "day") {
    return root.querySelector(
      `.day-all-day-chip[data-day-event-id="${eventId}"], .day-event-block[data-day-event-id="${eventId}"]`
    );
  }
  if (options.view === "week") {
    return root.querySelector(
      `.week-all-day-item[data-week-event-id="${eventId}"], .week-event-block[data-week-event-id="${eventId}"]`
    );
  }
  if (options.view === "month") {
    const record = getRecordById(eventId);
    return root.querySelector(
      `.month-inline-chip[data-month-event-id="${eventId}"], .month-span-bar[data-month-event-id="${eventId}"], [data-month-quick-entry="${eventId}"]`
    ) || (record?.date ? root.querySelector(`.calendar-day[data-date="${record.date}"]`) : null);
  }
  return root.querySelector(
    `.day-all-day-chip[data-day-event-id="${eventId}"], .day-event-block[data-day-event-id="${eventId}"], .week-all-day-item[data-week-event-id="${eventId}"], .week-event-block[data-week-event-id="${eventId}"], .month-inline-chip[data-month-event-id="${eventId}"], .month-span-bar[data-month-event-id="${eventId}"], [data-month-quick-entry="${eventId}"]`
  );
}

function createDirectAllDayEvent({ dateIso, sourceType }) {
  createEventFromForm({
    id: "",
    title: "新建日程",
    date: dateIso,
    allDay: true,
    startTime: "",
    endTime: "",
    location: "",
    tags: [],
    tagColor: getDefaultTagColor("calendar"),
    importance: "normal",
    notes: "",
    rawInput: "",
    sourceType,
  }, {
    seedForm: false,
  });
  persistState();
  state.selectedDate = dateIso;
  state.visibleMonth = startOfMonth(parseDate(dateIso));
  state.visibleWeek = startOfWeek(parseDate(dateIso));
  render();
  revealCreatedEvent(state.editingEventId);
  setStatus(`已创建全天事项：${dateIso}`);
}

/* 时间轴上的“直接创建定时日程”统一走这里：
   - 日视图双击
   - 周视图双击
   - 日视图拖拽空白区
   - 周视图拖拽空白区
   这层只负责把真实时间区间写入数据层，并根据 sourceType 决定是否保留周视图当前视口。 */
function createDirectTimedEvent({ dateIso, endDateIso = dateIso, startMinutes, endMinutes, sourceType }) {
  const start = Math.min(startMinutes, endMinutes);
  const end = Math.max(startMinutes, endMinutes);
  const safeEnd = end === start ? start + 60 : end;
  const preserveWeekViewport = state.activeView === "week" && sourceType === "week_timeline_direct";
  if (preserveWeekViewport) {
    preserveWeekPanePosition();
  }
  createEventFromForm({
    id: "",
    title: "新建日程",
    date: dateIso,
    endDate: endDateIso || dateIso,
    allDay: false,
    startTime: formatMinutes(start),
    endTime: formatMinutes(safeEnd),
    location: "",
    tags: [],
    tagColor: getDefaultTagColor("calendar"),
    importance: "normal",
    notes: "",
    rawInput: "",
    sourceType,
  }, {
    seedForm: false,
  });
  persistState();
  state.selectedDate = dateIso;
  state.visibleMonth = startOfMonth(parseDate(dateIso));
  if (!preserveWeekViewport) {
    state.visibleWeek = startOfWeek(parseDate(dateIso));
  }
  render();
  if (preserveWeekViewport) {
    revealCreatedWeekEventInPlace(state.editingEventId);
  } else {
    revealCreatedEvent(state.editingEventId);
  }
  const normalizedEndDateIso = endDateIso || dateIso;
  const timeSummary = normalizedEndDateIso === dateIso
    ? `${formatMinutes(start)} - ${formatMinutes(safeEnd)}`
    : `${dateIso} ${formatMinutes(start)} - ${normalizedEndDateIso} ${formatMinutes(safeEnd)}`;
  setStatus(`已创建日程：${timeSummary}`);
}

function handleDayTimelineDoubleClick(event) {
  if (event.button !== 0) return;
  if (event.target.closest("[data-day-event-id], .day-all-day-chip, #event-detail-popover")) return;
  const startMinutes = eventToTimelineMinutes(event);
  createDirectTimedEvent({
    dateIso: state.selectedDate,
    startMinutes,
    endMinutes: startMinutes + 60,
    sourceType: "day_timeline_direct",
  });
}

function handleDayAllDayDoubleClick(event) {
  if (event.button !== 0) return;
  if (event.target.closest("[data-day-event-id], #event-detail-popover")) return;
  createDirectAllDayEvent({
    dateIso: state.selectedDate,
    sourceType: "day_all_day_direct",
  });
}

function handleWeekTimelineDoubleClick(event, weekDays) {
  if (event.button !== 0) return;
  if (event.target.closest("[data-week-event-id], .week-all-day-item, #event-detail-popover")) return;
  const hit = eventToWeekTimelinePosition(event, weekDays);
  if (!hit) return;
  createDirectTimedEvent({
    dateIso: hit.dateIso,
    startMinutes: hit.minutes,
    endMinutes: hit.minutes + 60,
    sourceType: "week_timeline_direct",
  });
}

function handleWeekAllDayDoubleClick(event, dateIso) {
  if (event.button !== 0) return;
  if (event.target.closest("[data-week-event-id], #event-detail-popover")) return;
  finishWeekQuickEntry({ render: false });
  const created = createSingleDayAllDayQuickEntry(dateIso, {
    initialTitle: "新建日程",
    sourceType: "week_quick_entry",
  });
  activateWeekQuickEntry(created, { draftTitle: "", render: true });
}

function shouldSuppressDetailOpen(recordId) {
  return state.suppressDetailOpen.recordId === recordId && Date.now() < state.suppressDetailOpen.until;
}

function markSuppressDetailOpen(recordId, durationMs = 260) {
  state.suppressDetailOpen = {
    recordId: String(recordId || ""),
    until: Date.now() + durationMs,
  };
}

function suppressSurfaceClick(durationMs = 260) {
  state.suppressSurfaceClickUntil = Date.now() + durationMs;
}

function shouldSuppressSurfaceClick() {
  return Date.now() < state.suppressSurfaceClickUntil;
}

function scheduleWeekSingleClick(kind, targetId, action) {
  state.pendingWeekClick.token += 1;
  const token = state.pendingWeekClick.token;
  state.pendingWeekClick.kind = kind;
  state.pendingWeekClick.target = targetId;
  window.setTimeout(() => {
    if (token !== state.pendingWeekClick.token) return;
    state.pendingWeekClick.kind = "";
    state.pendingWeekClick.target = "";
    action();
  }, 220);
}

function cancelPendingWeekSingleClick(kind, targetId) {
  if (state.pendingWeekClick.kind !== kind || state.pendingWeekClick.target !== targetId) return;
  state.pendingWeekClick.token += 1;
  state.pendingWeekClick.kind = "";
  state.pendingWeekClick.target = "";
}

function beginDayDrag(event) {
  if (event.button !== 0) return;
  if (event.target.closest("[data-day-event-id], .day-all-day-chip, #event-detail-popover")) return;
  const startMinutes = eventToTimelineMinutes(event);
  const dragSeed = {
    scope: "day",
    dateIso: state.selectedDate,
    startMinutes,
    endMinutes: startMinutes + DAY_SLOT_MINUTES,
    pointerStartX: event.clientX,
    pointerStartY: event.clientY,
    didMove: false,
  };

  const handleMove = (moveEvent) => {
    if (!state.dayDrag && dragSeed) {
      const deltaX = Math.abs(moveEvent.clientX - dragSeed.pointerStartX);
      const deltaY = Math.abs(moveEvent.clientY - dragSeed.pointerStartY);
      if (deltaX >= 4 || deltaY >= 4) {
        dragSeed.didMove = true;
        state.dayDrag = { ...dragSeed };
        renderDayView();
      }
    }
    if (!state.dayDrag) return;
    if (!state.dayDrag.didMove) {
      state.dayDrag.didMove = true;
    }
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
  if (!state.dayDrag.didMove) {
    state.dayDrag = null;
    renderDayView();
    return;
  }
  const start = Math.min(state.dayDrag.startMinutes, state.dayDrag.endMinutes);
  const end = Math.max(state.dayDrag.startMinutes, state.dayDrag.endMinutes);
  const safeEnd = end === start ? start + DAY_SLOT_MINUTES : end;
  const dateIso = state.dayDrag.dateIso;
  state.dayDrag = null;
  createDirectTimedEvent({
    dateIso,
    startMinutes: start,
    endMinutes: safeEnd,
    sourceType: "day_timeline_direct",
  });
}

/* 周视图空白区拖拽创建：
   这里只记录两个端点，不直接写库。
   - startDateIso/startMinutes：鼠标按下位置
   - endDateIso/endMinutes：鼠标当前经过位置
   后续预览和最终创建都复用这份临时状态，因此跨天天然可表达。 */
function beginWeekDrag(event, weekDays) {
  if (event.button !== 0) return;
  if (event.target.closest("[data-week-event-id], .week-all-day-item, #event-detail-popover")) return;
  const hit = eventToWeekTimelinePosition(event, weekDays);
  if (!hit) return;
  const dragSeed = {
    scope: "week",
    startDateIso: hit.dateIso,
    endDateIso: hit.dateIso,
    startMinutes: hit.minutes,
    endMinutes: hit.minutes + DAY_SLOT_MINUTES,
    pointerStartX: event.clientX,
    pointerStartY: event.clientY,
    didMove: false,
  };

  const handleMove = (moveEvent) => {
    /* 周视图空白拖拽创建的职责刻意保持很单纯：
       - 只做“起点 + 当前鼠标位置”两端记录
       - 每次鼠标移动只刷新 preview 态
       - 真正写库延迟到 mouseup
       这样才能把“拖拽创建”与“已有卡片拖拽修改”彻底分离，减少互相打架。 */
    const nextHit = eventToWeekTimelinePosition(moveEvent, weekDays);
    if (!nextHit) return;
    if (!state.dayDrag && dragSeed) {
      const deltaX = Math.abs(moveEvent.clientX - dragSeed.pointerStartX);
      const deltaY = Math.abs(moveEvent.clientY - dragSeed.pointerStartY);
      if (deltaX >= 4 || deltaY >= 4) {
        dragSeed.didMove = true;
        captureWeekPreviewViewport();
        state.dayDrag = { ...dragSeed };
        renderWeekView();
      }
    }
    if (!state.dayDrag) return;
    if (!state.dayDrag.didMove) {
      state.dayDrag.didMove = true;
    }
    state.dayDrag.endDateIso = nextHit.dateIso;
    state.dayDrag.endMinutes = nextHit.minutes;
    captureWeekPreviewViewport();
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

/* 松手时把拖拽态归一化为真实起止，再一次性落库。
   这样拖拽中的预览只是 UI 临时态，不会反复修改 record。 */
function finalizeWeekDrag() {
  if (!state.dayDrag) return;
  if (!state.dayDrag.didMove) {
    state.dayDrag = null;
    clearWeekPreviewViewportLock();
    renderWeekView();
    return;
  }
  const normalized = normalizeWeekDragRange(state.dayDrag);
  state.dayDrag = null;
  clearWeekPreviewViewportLock();
  if (!normalized) {
    renderWeekView();
    return;
  }
  const safeEnd = normalized.endMinutes === normalized.startMinutes
    ? normalized.startMinutes + DAY_SLOT_MINUTES
    : normalized.endMinutes;
  createDirectTimedEvent({
    dateIso: normalized.startDateIso,
    endDateIso: normalized.endDateIso,
    startMinutes: normalized.startMinutes,
    endMinutes: safeEnd,
    sourceType: "week_timeline_direct",
  });
}

/* 第一阶段只开放“周视图已有定时卡片平移修改时间”。
   这里不做 resize，不做全天转换；只把整张卡片按鼠标落点整体挪动。
   之所以先限制成这一种，是因为它和 Apple Calendar 的第一层直觉最一致，
   也能避免在同一阶段里把“拖拽平移 / 拉伸改时长 / 全天与定时互转”三套语义揉在一起。 */
function beginWeekTimedCardDrag(event, node, weekDays) {
  if (event.button !== 0) return;
  if (event.target.closest("#event-detail-popover")) return;
  const recordId = node.dataset.weekEventId;
  const record = getRecordById(recordId);
  if (!record || record.recordType !== "calendar" || isAllDayLikeRecord(record)) return;
  const hit = eventToWeekTimelinePosition(event, weekDays);
  if (!hit) return;
  const hitTimestamp = timelineHitToTimestamp(hit.dateIso, hit.minutes);
  if (!Number.isFinite(hitTimestamp)) return;
  const dragSeed = {
    scope: "week",
    recordId,
    hitTimestamp,
    pointerStartX: event.clientX,
    pointerStartY: event.clientY,
    didMove: false,
    previewPayload: null,
  };

  const handleMove = (moveEvent) => {
    /* 已有卡片拖拽和空白区拖拽创建共享同一个坐标映射函数，
       这样“鼠标位置 -> 日期 + 分钟”的换算规则永远一致，
       就不会出现用户在空白区拖出来是一个时间、拖已有卡片却落到另一套时间的分裂感。 */
    const nextHit = eventToWeekTimelinePosition(moveEvent, weekDays);
    if (!nextHit) return;
    const deltaX = Math.abs(moveEvent.clientX - dragSeed.pointerStartX);
    const deltaY = Math.abs(moveEvent.clientY - dragSeed.pointerStartY);
    if (!state.timedCardDrag && deltaX < 4 && deltaY < 4) return;

    const nextTimestamp = timelineHitToTimestamp(nextHit.dateIso, nextHit.minutes);
    if (!Number.isFinite(nextTimestamp)) return;
    const deltaMinutes = Math.round((nextTimestamp - dragSeed.hitTimestamp) / 60000);
    const previewPayload = moveTimedEventByMinutes(record, deltaMinutes);
    if (!previewPayload) return;

    if (!state.timedCardDrag) {
      dragSeed.didMove = true;
      captureWeekPreviewViewport();
      state.timedCardDrag = { ...dragSeed, previewPayload };
    } else {
      state.timedCardDrag.didMove = true;
      state.timedCardDrag.previewPayload = previewPayload;
      captureWeekPreviewViewport();
    }
    renderWeekView();
  };

  const handleUp = () => {
    document.removeEventListener("mousemove", handleMove);
    document.removeEventListener("mouseup", handleUp);
    finalizeWeekTimedCardDrag();
  };

  document.addEventListener("mousemove", handleMove);
  document.addEventListener("mouseup", handleUp);
}

function finalizeWeekTimedCardDrag() {
  if (!state.timedCardDrag) return;
  const dragState = state.timedCardDrag;
  state.timedCardDrag = null;
  clearWeekPreviewViewportLock();
  if (!dragState.didMove || !dragState.previewPayload) {
    renderWeekView();
    return;
  }
  const record = getRecordById(dragState.recordId);
  if (!record) {
    renderWeekView();
    return;
  }
  /* 只有在 mouseup 确认落点后，才把 previewPayload 真正写回 record。
     拖拽过程中始终只改临时预览，这样页面就不会在鼠标移动中不断持久化、重算索引或触发别的副作用。 */
  preserveWeekPanePosition();
  updateExistingEvent(dragState.previewPayload);
  persistState();
  markSuppressDetailOpen(record.id);
  renderWeekView();
  setStatus("已通过拖拽调整日程时间。");
}

function collectEventFormData() {
  const startDate = refs.eventDate.value || state.selectedDate;
  const rawEndDate = refs.eventEndDate.value || startDate;
  const endDate = rawEndDate < startDate ? startDate : rawEndDate;
  return {
    id: refs.eventId.value,
    title: refs.eventTitle.value,
    date: startDate,
    endDate,
    allDay: refs.eventAllDay.value === "true",
    startTime: refs.eventStartTime.value,
    endTime: refs.eventEndTime.value,
    location: refs.eventLocation.value,
    tags: parseTagInput(refs.eventTags.value),
    tagColor: refs.eventTagColor.value,
    importance: "normal",
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
    endDate: draft.proposedEndDate || draft.proposedDate || isoDate(new Date()),
    allDay: draft.allDay,
    startTime: draft.proposedStartTime || "",
    endTime: draft.proposedEndTime || "",
    location: draft.proposedLocation || "",
    tags: Array.isArray(draft.proposedTags) ? draft.proposedTags : [],
    tagColor: draft.proposedTagColor || "#115e59",
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
    tags: Array.isArray(draft.proposedTags) ? draft.proposedTags : [],
    tagColor: draft.proposedTagColor || "#115e59",
    rawInput: draft.rawText,
    sourceType: "chat_draft",
  }, {
    rawInputCapturedAt: draft.createdAt,
    parseMetadata: { draftId: draft.id, confidence: draft.confidence, ambiguities: draft.ambiguities },
  });
}

/* ---------- Database write APIs ----------
   这些函数代表 database 的正式写接口。
   不论来源是 UI、导入流程还是秘书生成的草稿，都应尽量复用这些入口。
*/
function createEventFromForm(payload, options = {}) {
  const now = new Date().toISOString();
  const eventId = createId("evt");
  const rawInputId = createId("raw");
  // calendar 写入统一先做时间规范化：
  // - 生成 v6 真源 startAt / endAt
  // - 同步产出 legacy 兼容字段 date / endDate / startTime / endTime
  // 这样下游月/周/日视图、搜索、AI 都能拿到一致的数据形状。
  const temporal = normalizeEventTemporalPayload(payload);
  const normalizedTags = ensureDefaultTags("calendar", parseTagInput(Array.isArray(payload.tags) ? payload.tags.join(",") : String(payload.tags || "")));
  const tagIds = ensureScopedTags("calendar", normalizedTags, payload.tagColor);
  const resolvedTagNames = resolveScopedTagNames("calendar", tagIds, normalizedTags);
  const event = {
    id: eventId,
    recordType: "calendar",
    createdAt: now,
    updatedAt: now,
    version: 1,
    status: "active",
    date: temporal.date,
    endDate: temporal.endDate,
    startTime: temporal.startTime,
    endTime: temporal.endTime,
    startAt: temporal.startAt,
    endAt: temporal.endAt,
    allDay: temporal.allDay,
    timezone: temporal.timezone,
    title: payload.title.trim(),
    notes: payload.notes.trim(),
    location: payload.location.trim(),
    tagIds,
    tags: resolvedTagNames,
    tagColor: resolveScopedPrimaryColor("calendar", resolvedTagNames, payload.tagColor),
    importance: payload.importance || "normal",
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
  if (options.seedForm !== false) {
    seedEmptyInputForm({ ...payload, id: eventId });
  }
  return event;
}

function createTodoFromForm(payload, options = {}) {
  const now = new Date().toISOString();
  const todoId = createId("todo");
  const rawInputId = createId("raw");
  const normalizedTags = ensureDefaultTags("task", parseTagInput(Array.isArray(payload.tags) ? payload.tags.join(",") : String(payload.tags || "")));
  const tagIds = ensureScopedTags("task", normalizedTags, payload.tagColor);
  const resolvedTagNames = resolveScopedTagNames("task", tagIds, normalizedTags);
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
    tagIds,
    tags: resolvedTagNames,
    tagColor: resolveScopedPrimaryColor("task", resolvedTagNames, payload.tagColor),
    importance: payload.importance || "normal",
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
  // 更新路径和新建路径复用同一套时间归一化，
  // 避免“新建时是 v6 结构，编辑保存后又退回旧结构”的问题。
  const temporal = normalizeEventTemporalPayload(payload, event.timezone);
  const normalizedTags = ensureDefaultTags("calendar", parseTagInput(Array.isArray(payload.tags) ? payload.tags.join(",") : String(payload.tags || "")));
  const nextTagIds = ensureScopedTags("calendar", normalizedTags, payload.tagColor);
  const nextTagNames = resolveScopedTagNames("calendar", nextTagIds, normalizedTags);
  const oldFields = { title: event.title, date: event.date, endDate: event.endDate, startTime: event.startTime, endTime: event.endTime, startAt: event.startAt, endAt: event.endAt, allDay: event.allDay, location: event.location, notes: event.notes, tags: JSON.stringify(resolveRecordTagObjects(event).map((tag) => tag.name)), tagColor: event.tagColor };
  event.title = payload.title.trim();
  event.date = temporal.date;
  event.endDate = temporal.endDate;
  event.startTime = temporal.startTime;
  event.endTime = temporal.endTime;
  event.startAt = temporal.startAt;
  event.endAt = temporal.endAt;
  event.allDay = temporal.allDay;
  event.timezone = temporal.timezone;
  event.location = payload.location.trim();
  event.notes = payload.notes.trim();
  event.tags = nextTagNames;
  event.tagIds = nextTagIds;
  event.tagColor = resolveScopedPrimaryColor("calendar", nextTagNames, payload.tagColor || event.tagColor || "#115e59");
  event.importance = payload.importance || event.importance || "normal";
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
  const normalizedTags = ensureDefaultTags("task", parseTagInput(Array.isArray(payload.tags) ? payload.tags.join(",") : String(payload.tags || "")));
  const nextTagIds = ensureScopedTags("task", normalizedTags, payload.tagColor);
  const nextTagNames = resolveScopedTagNames("task", nextTagIds, normalizedTags);
  const oldFields = { title: todo.title, notes: todo.notes, priority: todo.priority, tags: JSON.stringify(resolveRecordTagObjects(todo).map((tag) => tag.name)), tagColor: todo.tagColor };
  todo.title = payload.title.trim();
  todo.notes = payload.notes.trim();
  todo.priority = payload.priority;
  todo.tags = nextTagNames;
  todo.tagIds = nextTagIds;
  todo.tagColor = resolveScopedPrimaryColor("task", nextTagNames, payload.tagColor || todo.tagColor || "#115e59");
  todo.importance = payload.importance || todo.importance || "normal";
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
    endDate: event.endDate,
    allDay: event.allDay,
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location,
    tags: resolveRecordTagObjects(event).map((tag) => tag.name),
    tagColor: getPrimaryRecordColor(event),
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
    tags: resolveRecordTagObjects(todo).map((tag) => tag.name),
    tagColor: getPrimaryRecordColor(todo),
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
      proposedTags: [],
      proposedTagColor: "#115e59",
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
      proposedTags: [],
      proposedTagColor: "#115e59",
      allDay: !parsedTime.startTime,
      confidence: inferConfidence(parsedDate, parsedTime, locationMatch),
      ambiguities,
    };
  });
}

function buildSearchDocEntry(record, payload, type, rawInputId) {
  // searchDoc 需要把时间区间文本也纳入索引；
  // 否则 record 已升级为跨天 / 完整区间后，检索仍只看到旧单天时间碎片。
  const temporal = type === "calendar" ? normalizeEventTemporalPayload(payload, record.timezone) : null;
  const searchText = type === "task"
    ? [payload.title || "", payload.notes || "", payload.rawInput || "", payload.priority || "", ...(payload.tags || [])].filter(Boolean).join(" ")
    : [
      temporal?.startAt || payload.date || "",
      temporal?.endAt || payload.endDate || "",
      temporal?.date || payload.date || "",
      temporal?.endDate || payload.endDate || "",
      temporal?.allDay ? "全天" : `${temporal?.startTime || payload.startTime || "未定"} ${temporal?.endTime || payload.endTime || ""}`,
      payload.title || "",
      payload.location || "",
      payload.notes || "",
      payload.rawInput || "",
      ...(payload.tags || []),
    ].filter(Boolean).join(" ");
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
  rebuildDerivedViewState();
  return state.derivedView.calendarsByDate.get(dateIso) || [];
}

/* calendar 的原始 record 只有一份，但在日/周时间轴里，同一条跨天定时事项需要被切成“按天显示”的 segment。
   例如 4 月 12 日 23:00 - 4 月 13 日 01:00：
   - 在 4/12 这天显示 23:00 - 24:00
   - 在 4/13 这天显示 00:00 - 01:00
   后续日视图、周视图、拖拽目标预览都统一基于这套 segment 逻辑，避免每个视图各算一遍。 */
function getTimedEventSegmentsForDate(dateIso) {
  const dayStart = parseDate(dateIso);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return getActiveRecordsByType("calendar")
    .filter((record) => record.date && !isAllDayLikeRecord(record))
    .map((record) => buildTimedEventSegmentForDate(record, dateIso, dayStart, dayEnd))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.startMinutes !== right.startMinutes) return left.startMinutes - right.startMinutes;
      if (left.endMinutes !== right.endMinutes) return left.endMinutes - right.endMinutes;
      return String(left.record.title || "").localeCompare(String(right.record.title || ""), "zh-CN");
    });
}

function buildTimedEventSegmentForDate(record, dateIso, dayStart = null, dayEnd = null) {
  const bounds = getTimedEventBounds(record);
  if (!bounds) return null;
  const safeDayStart = dayStart || parseDate(dateIso);
  safeDayStart.setHours(0, 0, 0, 0);
  const safeDayEnd = dayEnd || new Date(safeDayStart);
  if (!dayEnd) safeDayEnd.setDate(safeDayEnd.getDate() + 1);

  const overlapStart = new Date(Math.max(bounds.start.getTime(), safeDayStart.getTime()));
  const overlapEnd = new Date(Math.min(bounds.end.getTime(), safeDayEnd.getTime()));
  if (overlapEnd <= overlapStart) return null;

  const startMinutes = Math.round((overlapStart.getTime() - safeDayStart.getTime()) / 60000);
  const endMinutes = Math.round((overlapEnd.getTime() - safeDayStart.getTime()) / 60000);
  return {
    record,
    dateIso,
    startMinutes,
    endMinutes: Math.max(startMinutes + DAY_SLOT_MINUTES, endMinutes),
    isContinuedFromPrev: overlapStart.getTime() > safeDayStart.getTime() ? false : bounds.start.getTime() < safeDayStart.getTime(),
    isContinuedToNext: overlapEnd.getTime() < safeDayEnd.getTime() ? false : bounds.end.getTime() > safeDayEnd.getTime(),
  };
}

function getTimedEventBounds(record) {
  if (!record || record.recordType !== "calendar" || isAllDayLikeRecord(record)) return null;
  const startDate = normalizeDateOnly(record.date) || state.selectedDate;
  const startTime = normalizeTimeOnly(record.startTime) || extractTimePart(record.startAt || "") || "00:00";
  const endDate = getEventEndDateIso(record);
  const endTime = normalizeTimeOnly(record.endTime) || extractTimePart(record.endAt || "") || startTime || "00:00";
  const start = new Date(`${startDate}T${startTime}:00`);
  const end = new Date(`${endDate}T${endTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end > start) {
    return { start, end };
  }
  const fallbackEnd = new Date(start);
  fallbackEnd.setMinutes(fallbackEnd.getMinutes() + DAY_SLOT_MINUTES);
  return { start, end: fallbackEnd };
}

function getEventEndDateIso(record) {
  // v6 下优先从 endAt 反推出“用户看到的结束日期”。
  // 对全天事项，endAt 采用次日 00:00 的半开区间，所以这里要先减一天。
  const fromDateTime = extractDatePart(record?.endAt || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromDateTime)) {
    const canonical = record?.allDay ? addDaysToIsoDate(fromDateTime, -1) : fromDateTime;
    return canonical < (record?.date || state.selectedDate) ? (record?.date || state.selectedDate) : canonical;
  }
  const fallback = record?.date || state.selectedDate;
  const candidate = String(record?.endDate || fallback).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback;
  return candidate < fallback ? fallback : candidate;
}

function isAllDayLikeRecord(record) {
  return Boolean(record?.allDay || (!record?.startTime && !extractTimePart(record?.startAt || "")));
}

function getRecordDisplayDates(record) {
  if (!record?.date) return [];
  const startIso = record.date;
  const endIso = getEventEndDateIso(record);
  if (!isAllDayLikeRecord(record) || endIso <= startIso) {
    return [startIso];
  }
  const dates = [];
  let cursor = parseDate(startIso);
  const end = parseDate(endIso);
  while (cursor <= end) {
    dates.push(isoDate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function getActiveRecordsByType(recordType) {
  rebuildDerivedViewState();
  return state.derivedView.activeByType.get(recordType) || [];
}

function rebuildDerivedViewState() {
  const signature = [
    state.db.records.length,
    state.activeTagFilters.join("|"),
    state.db.records[0]?.updatedAt || "",
    state.db.records[state.db.records.length - 1]?.updatedAt || "",
  ].join("|");

  if (state.derivedView.signature === signature) return;

  const activeByType = new Map([
    ["calendar", []],
    ["task", []],
    ["memory", []],
  ]);
  const calendarsByDate = new Map();

  state.db.records.forEach((record) => {
    if (record.status !== "active" || !recordMatchesActiveTagFilter(record)) return;
    const bucket = activeByType.get(record.recordType);
    if (bucket) bucket.push(record);

    if (record.recordType === "calendar" && record.date) {
      getRecordDisplayDates(record).forEach((dateIso) => {
        const dayRecords = calendarsByDate.get(dateIso) || [];
        dayRecords.push(record);
        calendarsByDate.set(dateIso, dayRecords);
      });
    }
  });

  calendarsByDate.forEach((records, dateIso) => {
    calendarsByDate.set(dateIso, records.sort((a, b) => {
      if (!a.startTime && b.startTime) return -1;
      if (a.startTime && !b.startTime) return 1;
      return (a.startTime || "99:99").localeCompare(b.startTime || "99:99");
    }));
  });

  state.derivedView = {
    signature,
    calendarsByDate,
    activeByType,
  };
}

function persistState() {
  const stop = startRuntimeTimer("persist", "持久化状态");
  databaseStore.persistState(state.db);
  stop({ mode: "scheduled" });
  syncKarinSession("persist");
}

function buildKarinSessionSnapshot(reason = "workspace_sync") {
  const mount = state.mountStatus || {
    configured: false,
    packageRoot: state.shellCache?.mountPackageRoot || "",
    appDbPath: "",
    activeDbUrl: "",
    note: refs.mountStatus?.textContent || "",
  };
  const packageRoot = mount.packageRoot || state.shellCache?.mountPackageRoot || "";
  const displayName = packageRoot ? packageRoot.split("/").filter(Boolean).pop() || "当前 Kaede" : "当前 Kaede";
  return {
    reason,
    shell: {
      runtimeMode: databaseStore.getRuntimeMode?.() || "unknown",
      activeView: state.activeView,
      assistantEnabled: true,
      uiEnabled: true,
    },
    notebook: {
      displayName,
      mount,
      manifest: {
        ...((window.KarinSession && window.KarinSession.notebook && window.KarinSession.notebook.manifest) || {}),
        version: state.db.packageVersion || "0.1.0",
        schemaVersion: state.db.schemaVersion || state.db.version || 1,
      },
      recordCount: Array.isArray(state.db.records) ? state.db.records.length : 0,
      draftCount: Array.isArray(state.db.drafts) ? state.db.drafts.length : 0,
      chatCount: Array.isArray(state.db.chatMessages) ? state.db.chatMessages.length : 0,
      tagCount: (state.db.eventTags?.length || 0) + (state.db.taskTags?.length || 0),
    },
  };
}

function syncKarinSession(reason = "workspace_sync") {
  try {
    window.KarinSessionController?.syncFromLegacy(buildKarinSessionSnapshot(reason));
  } catch (error) {
    console.warn("Failed to sync Karin session:", error);
  }
}

function applyShellCache() {
  const cached = state.shellCache;
  if (!cached) return;
  state.db.settings = {
    ...state.db.settings,
    parseMode: cached.parseMode || state.db.settings.parseMode,
    apiBaseUrl: cached.apiBaseUrl || state.db.settings.apiBaseUrl,
    apiKey: cached.apiKey || state.db.settings.apiKey,
    apiModel: cached.apiModel || state.db.settings.apiModel,
  };
  applyUiTheme(cached.uiTheme || "atelier-warm");
  if (refs.mountPackageRoot && cached.mountPackageRoot) {
    refs.mountPackageRoot.value = cached.mountPackageRoot;
  }
}

function loadKarinShellCache() {
  try {
    const raw = window.localStorage.getItem(KARIN_SHELL_CACHE_KEY);
    if (!raw) {
      return {
        mountPackageRoot: "",
        autoOpenKaede: false,
        parseMode: "",
        apiBaseUrl: "",
        apiKey: "",
        apiModel: "",
        uiTheme: "atelier-warm",
      };
    }
    const parsed = JSON.parse(raw);
    return {
      mountPackageRoot: String(parsed.mountPackageRoot || ""),
      autoOpenKaede: Boolean(parsed.autoOpenKaede),
      parseMode: String(parsed.parseMode || ""),
      apiBaseUrl: String(parsed.apiBaseUrl || ""),
      apiKey: String(parsed.apiKey || ""),
      apiModel: String(parsed.apiModel || ""),
      uiTheme: normalizeUiTheme(parsed.uiTheme),
    };
  } catch (error) {
    console.warn("Failed to load Karin shell cache:", error);
    return {
      mountPackageRoot: "",
      autoOpenKaede: false,
      parseMode: "",
      apiBaseUrl: "",
      apiKey: "",
      apiModel: "",
      uiTheme: "atelier-warm",
    };
  }
}

function saveKarinShellCache() {
  state.shellCache = {
    mountPackageRoot: refs.mountPackageRoot?.value.trim() || "",
    autoOpenKaede: Boolean(state.shellCache?.autoOpenKaede),
    parseMode: state.db.settings.parseMode || "",
    apiBaseUrl: state.db.settings.apiBaseUrl || "",
    apiKey: state.db.settings.apiKey || "",
    apiModel: state.db.settings.apiModel || "",
    uiTheme: normalizeUiTheme(refs.uiTheme?.value || state.shellCache?.uiTheme || "atelier-warm"),
  };
  try {
    window.localStorage.setItem(KARIN_SHELL_CACHE_KEY, JSON.stringify(state.shellCache));
  } catch (error) {
    console.warn("Failed to save Karin shell cache:", error);
  }
}

function normalizeUiTheme(value) {
  const theme = String(value || "").trim();
  return UI_THEME_OPTIONS.includes(theme) ? theme : "atelier-warm";
}

function applyUiTheme(theme) {
  const resolved = normalizeUiTheme(theme);
  document.documentElement.dataset.uiTheme = resolved;
  if (resolved === "soft-sculpt") {
    document.documentElement.dataset.nuiTheme = "light";
    document.documentElement.dataset.nuiLightDirection = "top-left";
  } else {
    delete document.documentElement.dataset.nuiTheme;
    delete document.documentElement.dataset.nuiLightDirection;
  }
  if (refs.uiTheme) refs.uiTheme.value = resolved;
  if (!state.shellCache) state.shellCache = {};
  state.shellCache.uiTheme = resolved;
}

function getRecentChatContext(limit = 6) {
  return state.db.chatMessages
    .slice(-limit)
    .map((message) => ({
      role: message.role,
      agent: message.agent || "",
      content: String(message.content || "").slice(0, 500),
    }));
}

function traceRuntime(scope, message, details = {}) {
  const metaEntries = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`);

  state.runtimeLogs.unshift({
    id: createId("log"),
    at: formatClockTime(new Date()),
    scope,
    message,
    durationMs: typeof details.durationMs === "number" ? details.durationMs : null,
    meta: metaEntries.filter((item) => !item.startsWith("durationMs=")).join(" | "),
  });
  state.runtimeLogs = state.runtimeLogs.slice(0, 80);
  renderRuntimeLogs();
  mirrorRuntimeLog(scope, message, details).catch((error) => {
    console.warn("Failed to mirror runtime log:", error);
  });
}

function startRuntimeTimer(scope, message, details = {}) {
  const startedAt = performance.now();
  traceRuntime(scope, `${message} · start`, details);
  return (endDetails = {}) => {
    const durationMs = Math.round(performance.now() - startedAt);
    traceRuntime(scope, `${message} · done`, { ...details, ...endDetails, durationMs });
  };
}

async function mirrorRuntimeLog(scope, message, details = {}) {
  const meta = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" | ");

  if (emitRuntimeLogCommand) {
    return emitRuntimeLogCommand(scope, message, meta);
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    emitRuntimeLogCommand = (runtimeScope, runtimeMessage, runtimeMeta) => invoke("emit_runtime_log", {
      scope: runtimeScope,
      message: runtimeMessage,
      meta: runtimeMeta,
    });
    return emitRuntimeLogCommand(scope, message, meta);
  } catch (error) {
    emitRuntimeLogCommand = null;
    throw error;
  }
}

async function initializeLlmTraceLogPath() {
  try {
    state.llmTraceLogPath = await getLlmTraceLogPath();
    renderLlmTraceStatus();
  } catch (error) {
    console.warn("Failed to initialize LLM trace log path:", error);
  }
}

async function getLlmTraceLogPath() {
  if (getLlmTraceLogPathCommand) {
    return getLlmTraceLogPathCommand();
  }

  const { invoke } = await import("@tauri-apps/api/core");
  getLlmTraceLogPathCommand = () => invoke("get_llm_trace_log_path");
  return getLlmTraceLogPathCommand();
}

async function getKaedeContextDocs() {
  if (getKaedeContextDocsCommand) {
    return getKaedeContextDocsCommand();
  }

  const { invoke } = await import("@tauri-apps/api/core");
  getKaedeContextDocsCommand = () => invoke("get_kaede_context_docs");
  return getKaedeContextDocsCommand();
}

async function appendLlmTraceLog(entry) {
  if (appendLlmTraceLogCommand) {
    return appendLlmTraceLogCommand(entry);
  }

  const { invoke } = await import("@tauri-apps/api/core");
  appendLlmTraceLogCommand = (line) => invoke("append_llm_trace_log", { entry: line });
  return appendLlmTraceLogCommand(entry);
}

async function clearLlmTraceLogFile() {
  if (clearLlmTraceLogCommand) {
    return clearLlmTraceLogCommand();
  }

  const { invoke } = await import("@tauri-apps/api/core");
  clearLlmTraceLogCommand = () => invoke("clear_llm_trace_log");
  return clearLlmTraceLogCommand();
}

async function refreshKaedeContextDocs() {
  try {
    const docs = await getKaedeContextDocs();
    state.kaedeContextDocs = {
      packageRoot: String(docs?.packageRoot || ""),
      readme: String(docs?.readme || ""),
      operatorReadme: String(docs?.operatorReadme || ""),
      tools: String(docs?.tools || ""),
      operations: String(docs?.operations || ""),
    };
  } catch (error) {
    state.kaedeContextDocs = createEmptyKaedeContextDocs();
    console.warn("Failed to refresh Kaede context docs:", error);
  }
}

function clearRuntimeLogs() {
  state.runtimeLogs = [];
  renderRuntimeLogs();
  traceRuntime("log", "已清空测试日志");
}

function clearLlmTraceLogs() {
  clearLlmTraceLogFile().then((path) => {
    if (path) {
      state.llmTraceLogPath = path;
    }
    renderLlmTraceStatus();
    traceRuntime("llm_trace", "已清空 LLM token trace 文件", { path: state.llmTraceLogPath });
    setStatus(`已清空 LLM token trace 文件：${state.llmTraceLogPath}`);
  }).catch((error) => {
    setStatus(`清空 LLM token trace 文件失败：${error.message}`);
  });
}

function recordLlmExchange(entry) {
  const normalized = {
    at: new Date().toISOString(),
    stage: String(entry?.stage || "unknown"),
    direction: String(entry?.direction || "unknown"),
    meta: String(entry?.meta || ""),
    durationMs: Number.isFinite(entry?.durationMs) ? Math.round(entry.durationMs) : null,
    usage: normalizeUsage(entry?.usage),
    summary: summarizeLlmContent(entry?.content),
  };

  appendLlmTraceLog(JSON.stringify(normalized)).then((path) => {
    if (path && path !== state.llmTraceLogPath) {
      state.llmTraceLogPath = path;
      renderLlmTraceStatus();
    }
  }).catch((error) => {
    console.warn("Failed to append LLM trace log:", error);
  });
}

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return {
    prompt_tokens: toFiniteNumberOrNull(usage.prompt_tokens),
    completion_tokens: toFiniteNumberOrNull(usage.completion_tokens),
    total_tokens: toFiniteNumberOrNull(usage.total_tokens),
    prompt_cache_hit_tokens: toFiniteNumberOrNull(usage.prompt_cache_hit_tokens),
    prompt_cache_miss_tokens: toFiniteNumberOrNull(usage.prompt_cache_miss_tokens),
  };
}

function summarizeLlmContent(content) {
  if (!content || typeof content !== "object") {
    return summarizeMessageContent(content);
  }

  if (Array.isArray(content?.messages)) {
    return summarizeRequestPayload(content);
  }

  if (Array.isArray(content?.choices) || content?.usage) {
    return summarizeResponsePayload(content);
  }

  return summarizeMessageContent(content);
}

function summarizeRequestPayload(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const summarizedMessages = messages.map((message) => summarizeRequestMessage(message));
  const totalChars = summarizedMessages.reduce((sum, message) => sum + (message.charCount || 0), 0);
  return {
    kind: "request",
    model: String(payload?.model || ""),
    temperature: typeof payload?.temperature === "number" ? payload.temperature : null,
    messageCount: summarizedMessages.length,
    totalChars,
    estimatedPromptTokens: estimateTokenCount(totalChars),
    messages: summarizedMessages,
  };
}

function summarizeRequestMessage(message) {
  const contentSummary = summarizeMessageContent(message?.content);
  return {
    role: String(message?.role || "unknown"),
    charCount: contentSummary.charCount || 0,
    estimatedTokens: estimateTokenCount(contentSummary.charCount || 0),
    textPreview: contentSummary.textPreview || "",
    multimodal: Boolean(contentSummary.multimodal),
    imageCount: contentSummary.imageCount || 0,
    textPartCount: contentSummary.textPartCount || 0,
  };
}

function summarizeResponsePayload(payload) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  return {
    kind: "response",
    usage: normalizeUsage(payload?.usage),
    choices: choices.slice(0, 3).map((choice) => {
      const contentSummary = summarizeMessageContent(choice?.message?.content);
      return {
        index: toFiniteNumberOrNull(choice?.index),
        finishReason: String(choice?.finish_reason || ""),
        charCount: contentSummary.charCount || 0,
        estimatedTokens: estimateTokenCount(contentSummary.charCount || 0),
        textPreview: contentSummary.textPreview || "",
        multimodal: Boolean(contentSummary.multimodal),
      };
    }),
  };
}

function summarizeMessageContent(content) {
  if (typeof content === "string") {
    return {
      charCount: content.length,
      estimatedTokens: estimateTokenCount(content.length),
      textPreview: clipDebugString(content, 220),
      multimodal: false,
      imageCount: 0,
      textPartCount: 1,
    };
  }

  if (Array.isArray(content)) {
    let charCount = 0;
    let imageCount = 0;
    let textPartCount = 0;
    const previews = [];

    content.forEach((part) => {
      if (part?.type === "text") {
        const text = String(part.text || "");
        charCount += text.length;
        textPartCount += 1;
        if (previews.length < 3) previews.push(clipDebugString(text, 120));
        return;
      }
      if (part?.type === "image_url") {
        imageCount += 1;
      }
    });

    return {
      charCount,
      estimatedTokens: estimateTokenCount(charCount),
      textPreview: previews.join(" | "),
      multimodal: true,
      imageCount,
      textPartCount,
    };
  }

  const serialized = safeSerializeForDebug(content);
  return {
    charCount: serialized.length,
    estimatedTokens: estimateTokenCount(serialized.length),
    textPreview: clipDebugString(serialized, 220),
    multimodal: false,
    imageCount: 0,
    textPartCount: 0,
  };
}

function estimateTokenCount(charCount) {
  const normalized = typeof charCount === "number" ? charCount : String(charCount || "").length;
  if (!normalized) return 0;
  return Math.max(1, Math.round(normalized / 2));
}

function clipDebugString(value, limit = 220) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...[+${text.length - limit} chars]`;
}

function safeSerializeForDebug(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return `[unserializable:${error.message}]`;
  }
}

function toFiniteNumberOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatClockTime(date) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function buildUserMessageSummary(text, attachments = []) {
  const normalizedText = text || "(仅附件)";
  if (!attachments.length) return normalizedText;
  const attachmentSummary = attachments
    .map((attachment) => `${attachment.name}(${attachment.kind})`)
    .join(", ");
  return `${normalizedText}\n[附件] ${attachmentSummary}`;
}

function getRecordById(recordId) {
  return databaseStore.getRecordById(state.db, recordId);
}

function getRawInputById(rawInputId) {
  return databaseStore.getRawInputById(state.db, rawInputId);
}

function getRawInputsForRecord(recordId) {
  return databaseStore.getRawInputsForRecord(state.db, recordId);
}

function getLatestRawInputForRecord(recordId) {
  return databaseStore.getLatestRawInputForRecord(state.db, recordId);
}

function getTraceLogsForRecord(recordId) {
  return databaseStore.getTraceLogsForRecord(state.db, recordId);
}

function getSearchDocForRecord(recordId) {
  return databaseStore.getSearchDocForRecord(state.db, recordId);
}

function upsertSearchDoc(searchDoc) {
  databaseStore.upsertSearchDoc(state.db, searchDoc);
}

function removeSearchDocsForRecord(recordId) {
  databaseStore.removeSearchDocsForRecord(state.db, recordId);
}

function seedDemoData() {
  if (state.db.records.length > 0) {
    setStatus("当前已有数据，若想体验示例可以先导出后再清空当前数据。");
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
  const selectedTimed = getRecordById(state.editingEventId);
  const selectedTimeText = selectedTimed?.recordType === "calendar" && selectedTimed.date === dateIso && selectedTimed.startTime && !selectedTimed.allDay
    ? `${selectedTimed.startTime} ${selectedTimed.title}`
    : "未选中定时日程";
  refs.selectedDaySummary.className = "selected-day-summary";
  refs.selectedDaySummary.innerHTML = `
    <div class="summary-stat-grid">
      <article class="summary-stat">
        <span class="muted">日期</span>
        <strong>${escapeHtml(dateIso)}</strong>
      </article>
      <article class="summary-stat">
        <span class="muted">定时</span>
        <strong>${timedCount}</strong>
      </article>
      <article class="summary-stat">
        <span class="muted">全天</span>
        <strong>${allDayCount}</strong>
      </article>
    </div>
  `;
}

function openEventEditor(title) {
  closeEventDetailPopover();
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
    .map(normalizeTagName)
    .filter(Boolean)));
}

function normalizeTagRegistry(data) {
  // 全局标签表既要吃新结构里的 tags，也要从旧记录里反推出标签与颜色，
  // 否则升级后会出现“标签名字还在，但颜色丢了”的体验断层。
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

function getScopedTagRegistry(scope) {
  if (scope === "task") {
    if (!Array.isArray(state.db.taskTags)) state.db.taskTags = [];
    return state.db.taskTags;
  }
  if (!Array.isArray(state.db.eventTags)) state.db.eventTags = [];
  return state.db.eventTags;
}

function buildScopedTagId(scope, name) {
  const normalizedName = normalizeTagName(name)
    .toLowerCase()
    .replace(/[\s\-_]+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  return `tag_${scope}_${normalizedName || "tag"}`;
}

function ensureScopedTags(scope, tags = [], preferredColor = "#115e59") {
  const registry = getScopedTagRegistry(scope);
  const normalizedTags = parseTagInput(Array.isArray(tags) ? tags.join(",") : String(tags || ""));
  const normalizedColor = normalizeHexColor(preferredColor || "#115e59");
  const now = new Date().toISOString();
  const tagIds = normalizedTags.map((tagName) => {
    let existing = registry.find((item) => item.name === tagName);
    if (!existing) {
      existing = {
        id: buildScopedTagId(scope, tagName),
        name: tagName,
        color: normalizedColor,
        scope,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      registry.push(existing);
    }
    return existing.id;
  });
  registry.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return Array.from(new Set(tagIds));
}

function getDefaultTagName(scope) {
  return scope === "task" ? DEFAULT_TASK_TAG_NAME : DEFAULT_EVENT_TAG_NAME;
}

function getDefaultTagColor(scope) {
  return scope === "task" ? "#ca8a04" : "#115e59";
}

function ensureDefaultTags(scope, tags = []) {
  const normalizedTags = parseTagInput(Array.isArray(tags) ? tags.join(",") : String(tags || ""));
  return normalizedTags.length ? normalizedTags : [getDefaultTagName(scope)];
}

function resolveScopedTagObject(scope, tagRef) {
  const registry = getScopedTagRegistry(scope);
  return registry.find((item) => item.id === tagRef || item.name === tagRef) || null;
}

function resolveScopedTagNames(scope, tagIds = [], fallbackTags = []) {
  const names = Array.isArray(tagIds)
    ? tagIds
        .map((tagId) => resolveScopedTagObject(scope, tagId)?.name || "")
        .filter(Boolean)
    : [];
  return names.length ? names : parseTagInput(Array.isArray(fallbackTags) ? fallbackTags.join(",") : String(fallbackTags || ""));
}

function pickDisplayTagName(scope, tags = []) {
  const normalizedTags = parseTagInput(Array.isArray(tags) ? tags.join(",") : String(tags || ""));
  if (!normalizedTags.length) return "";
  const defaultTagName = getDefaultTagName(scope);
  return normalizedTags.find((tagName) => tagName !== defaultTagName) || normalizedTags[0];
}

function resolveScopedPrimaryColor(scope, tags = [], fallback = "#115e59") {
  const displayTag = pickDisplayTagName(scope, tags);
  if (!displayTag) return normalizeHexColor(fallback || getDefaultTagColor(scope));
  return normalizeHexColor(resolveScopedTagObject(scope, displayTag)?.color || fallback || getDefaultTagColor(scope));
}

function resolveRecordTagObjects(record) {
  if (!record) return [];
  const scope = record.recordType === "task" ? "task" : "calendar";
  const fallbackColor = normalizeHexColor(record.tagColor || getDefaultTagColor(scope));

  if (Array.isArray(record.tagIds) && record.tagIds.length) {
    return record.tagIds
      .map((tagId) => resolveScopedTagObject(scope, tagId))
      .filter(Boolean)
      .map((tag) => ({ ...tag, color: normalizeHexColor(tag.color || fallbackColor) }));
  }

  return parseTagInput(Array.isArray(record.tags) ? record.tags.join(",") : String(record.tags || "")).map((tagName) => {
    const found = resolveScopedTagObject(scope, tagName);
    return found
      ? { ...found, color: normalizeHexColor(found.color || fallbackColor) }
      : {
          id: buildScopedTagId(scope, tagName),
          name: tagName,
          color: fallbackColor,
          scope,
        };
  });
}

function getPrimaryRecordColor(record) {
  if (!record) return "#115e59";
  const scope = record.recordType === "task" ? "task" : "calendar";
  const tags = resolveRecordTagObjects(record);
  if (!tags.length) return normalizeHexColor(record?.tagColor || getDefaultTagColor(scope));
  const defaultTagName = getDefaultTagName(scope);
  const displayTag = tags.find((tag) => tag?.name && tag.name !== defaultTagName) || tags[0];
  return normalizeHexColor(displayTag?.color || record?.tagColor || getDefaultTagColor(scope));
}

function buildRecordAccentStyle(record) {
  const color = getPrimaryRecordColor(record);
  return `--record-accent:${color};--record-accent-soft:${color}22;--record-accent-border:${color};--record-accent-text:${pickTextColor(color)};`;
}

function buildRecordCardStyle(record) {
  return `${buildRecordAccentStyle(record)}border-left:4px solid ${getPrimaryRecordColor(record)};`;
}

function buildTagStyle(color) {
  const hex = normalizeHexColor(color || "#115e59");
  return `--tag-bg:${hex}22;--tag-text:${pickTextColor(hex)};--tag-border:${hex}55;`;
}

function normalizeHexColor(color) {
  const value = String(color || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#115e59";
}

function normalizeTagName(value) {
  return String(value || "").trim();
}

function ensureAllRecordsHaveTags(options = {}) {
  let changed = false;
  (state.db.records || []).forEach((record) => {
    const scope = record.recordType === "task" ? "task" : "calendar";
    const nextTagNames = ensureDefaultTags(scope, Array.isArray(record.tags) ? record.tags : []);
    const nextTagIds = ensureScopedTags(scope, nextTagNames, record.tagColor || getDefaultTagColor(scope));
    const sameIds = JSON.stringify(nextTagIds) === JSON.stringify(Array.isArray(record.tagIds) ? record.tagIds : []);
    const sameNames = JSON.stringify(nextTagNames) === JSON.stringify(parseTagInput(Array.isArray(record.tags) ? record.tags.join(",") : String(record.tags || "")));
    if (!sameIds || !sameNames) {
      record.tagIds = nextTagIds;
      record.tags = resolveScopedTagNames(scope, nextTagIds, nextTagNames);
      record.tagColor = resolveScopedPrimaryColor(scope, record.tags, record.tagColor || getDefaultTagColor(scope));
      record.updatedAt = record.updatedAt || new Date().toISOString();
      changed = true;
    }
  });
  if (changed && options.persist) {
    persistState();
  }
  return changed;
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

function normalizeDateOnly(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeTimeOnly(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeLocalDateTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})(?::\d{2})?/);
  if (!match) return "";
  const date = normalizeDateOnly(match[1]);
  const time = normalizeTimeOnly(match[2]);
  return date && time ? `${date}T${time}` : "";
}

function extractDatePart(value) {
  return String(value || "").split("T")[0] || "";
}

function extractTimePart(value) {
  return normalizeTimeOnly(String(value || "").split("T")[1] || "") || "";
}

function addDaysToIsoDate(dateIso, days) {
  const date = parseDate(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function normalizeEventTemporalPayload(payload, preferredTimezone = "") {
  // 前端 calendar 时间入口：
  // 1. 接受旧 UI 继续传 date/endDate/startTime/endTime/allDay
  // 2. 统一转成 v6 真源 startAt/endAt
  // 3. 再投影回兼容字段，供仍未完全迁移的 legacy 视图使用
  const timezone = String(preferredTimezone || payload?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const allDay = Boolean(payload?.allDay || !normalizeTimeOnly(payload?.startTime));
  const date = normalizeDateOnly(payload?.date) || state.selectedDate;
  const endDateRaw = normalizeDateOnly(payload?.endDate) || date;
  const endDate = endDateRaw < date ? date : endDateRaw;
  const startTime = allDay ? "" : normalizeTimeOnly(payload?.startTime);
  const endTime = allDay ? "" : (normalizeTimeOnly(payload?.endTime) || startTime || "00:00");
  const startAt = normalizeLocalDateTime(payload?.startAt) || `${date}T${allDay ? "00:00" : (startTime || "00:00")}`;
  let endAt = normalizeLocalDateTime(payload?.endAt)
    || (allDay ? `${addDaysToIsoDate(endDate, 1)}T00:00` : `${endDate}T${endTime || startTime || "00:00"}`);
  if (endAt < startAt) {
    endAt = allDay ? `${addDaysToIsoDate(date, 1)}T00:00` : startAt;
  }
  return {
    timezone,
    allDay,
    date: extractDatePart(startAt) || date,
    endDate: allDay
      ? ((addDaysToIsoDate(extractDatePart(endAt), -1) < (extractDatePart(startAt) || date))
        ? (extractDatePart(startAt) || date)
        : addDaysToIsoDate(extractDatePart(endAt), -1))
      : ((extractDatePart(endAt) < (extractDatePart(startAt) || date)) ? (extractDatePart(startAt) || date) : extractDatePart(endAt)),
    startTime: allDay ? "" : (extractTimePart(startAt) || startTime),
    endTime: allDay ? "" : (extractTimePart(endAt) || endTime || startTime),
    startAt,
    endAt,
  };
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

function monthDiff(baseMonth, targetMonth) {
  return (targetMonth.getFullYear() - baseMonth.getFullYear()) * 12 + (targetMonth.getMonth() - baseMonth.getMonth());
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

function formatCalendarCardDateBadge(dateIso) {
  const safe = normalizeDateOnly(dateIso);
  if (!safe) return "";
  const date = parseDate(safe);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatCalendarCardTimeRange(input = {}) {
  if (input.isAllDay) return "全天";
  const startDate = normalizeDateOnly(input.startDate);
  const endDate = normalizeDateOnly(input.endDate || input.startDate);
  const startTime = normalizeTimeOnly(input.startTime) || "未定";
  const endTime = normalizeTimeOnly(input.endTime) || startTime;
  if (!startDate || !endDate || startDate === endDate) {
    return `${startTime} - ${endTime}`;
  }
  /* 跨天定时事项在多个视图里会被拆段渲染，但卡片时间文案应该始终指向“真实起止”。
     这里在跨天时补上月/日，避免只看时间无法知道结束点属于下一天。 */
  return `${formatCalendarCardDateBadge(startDate)} ${startTime} - ${formatCalendarCardDateBadge(endDate)} ${endTime}`;
}

function minutesToOffset(minutes, hourHeight) {
  const clamped = Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60, minutes));
  return ((clamped - DAY_START_HOUR * 60) / 60) * hourHeight;
}

function getTimelineSnapPixelStep(hourHeight) {
  /* 时间轴“鼠标像素 -> 分钟数”的换算必须和 DAY_SLOT_MINUTES 同步。
     之前这里偷用了 `hourHeight / 2`，那实际上写死了“30 分钟一格”。
     现在统一按“每小时高度 * (槽位分钟 / 60)”推导，之后再改成 5/10/15/30 分钟都不会失配。 */
  return hourHeight * (DAY_SLOT_MINUTES / 60);
}

function eventToTimelineMinutes(event) {
  const rect = refs.dayGridSurface.getBoundingClientRect();
  const relativeY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const snapStep = getTimelineSnapPixelStep(DAY_HOUR_HEIGHT);
  const rawMinutes = DAY_START_HOUR * 60 + Math.round(relativeY / snapStep) * DAY_SLOT_MINUTES;
  return Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60, rawMinutes));
}

function eventToWeekTimelinePosition(event, weekDays) {
  // 周视图拖拽需要同时得到“落在哪一天”和“落在几点”，
  // 这里把二维坐标一次性映射成 dateIso + minutes，供预览和最终创建共用。
  const surface = refs.weekGrid.querySelector("#week-grid-surface");
  if (!surface) return null;
  const rect = surface.getBoundingClientRect();
  const relativeX = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left));
  const relativeY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const dayCount = Math.max(1, weekDays.length);
  const dayIndex = Math.max(0, Math.min(dayCount - 1, Math.floor((relativeX / rect.width) * dayCount)));
  const snapStep = getTimelineSnapPixelStep(WEEK_HOUR_HEIGHT);
  const rawMinutes = DAY_START_HOUR * 60 + Math.round(relativeY / snapStep) * DAY_SLOT_MINUTES;
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
  const startAt = normalizeLocalDateTime(record?.startAt || "");
  if (startAt) {
    const date = parseDate(extractDatePart(startAt));
    const [hour, minute] = (extractTimePart(startAt) || "00:00").split(":").map(Number);
    date.setHours(hour || 0, minute || 0, 0, 0);
    return date.getTime();
  }
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
  let importedCount = 0;
  let firstDate = null;
  events.forEach((item) => {
    const rawText = buildIcsRawText(item, sourceName);
    createEventFromForm({
      title: item.summary || "ICS 导入事项",
      date: isoDate(item.start),
      endDate: item.allDay ? isoDate(addDays(item.end || item.start, -1)) : isoDate(item.start),
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
  if (!refs.tagFilterTrigger || !refs.tagFilterOptions) return;
  const eventTags = getUsedScopedTags("calendar");
  const taskTags = getUsedScopedTags("task");
  syncTagFilterSelection();
  const totalSelected = state.activeTagFilters.length;
  refs.tagFilterTrigger.textContent = totalSelected ? `标签筛选 · ${totalSelected}` : "标签筛选";
  refs.tagFilterOptions.innerHTML = buildTagFilterGroup("calendar", "日程标签", eventTags)
    + buildTagFilterGroup("task", "待办标签", taskTags);
  if (!eventTags.length && !taskTags.length) {
    refs.tagFilterOptions.className = "tag-filter-options empty-state";
    refs.tagFilterOptions.textContent = "还没有可筛选的标签。";
    return;
  }
  refs.tagFilterOptions.className = "tag-filter-options";
}

function recordMatchesActiveTagFilter(record) {
  if (!state.activeTagFilters.length) return false;
  const matched = resolveRecordTagObjects(record).some((tag) => state.activeTagFilters.includes(tag.id));
  return matched;
}

function getUsedScopedTags(scope) {
  const registry = scope === "task" ? (state.db.taskTags || []) : (state.db.eventTags || []);
  return registry.filter((tag) => countRecordsForTag(scope, tag.id) > 0);
}

function getAllVisibleTagIds() {
  return [
    ...getUsedScopedTags("calendar").map((tag) => tag.id),
    ...getUsedScopedTags("task").map((tag) => tag.id),
  ];
}

function syncTagFilterSelection(options = {}) {
  const allVisibleTagIds = getAllVisibleTagIds();
  const validIds = new Set(allVisibleTagIds);
  state.activeTagFilters = state.activeTagFilters.filter((tagId) => validIds.has(tagId));

  if (options.forceAll || !state.tagFilterInitialized) {
    state.activeTagFilters = allVisibleTagIds;
    state.tagFilterInitialized = true;
  }
}

function buildTagFilterGroup(scope, title, tags) {
  if (!tags.length) return "";
  return `
    <section class="tag-filter-group">
      <div class="tag-filter-group-title">${escapeHtml(title)}</div>
      ${tags.map((tag) => `
        <label class="tag-filter-option">
          <span class="tag-filter-option-main">
            <input type="checkbox" data-tag-filter-id="${escapeHtml(tag.id)}" ${state.activeTagFilters.includes(tag.id) ? "checked" : ""}>
            <span class="tag-filter-option-text">
              <span class="tag-color-dot" style="background:${escapeHtml(normalizeHexColor(tag.color || getDefaultTagColor(scope)))};"></span>
              <span>${escapeHtml(tag.name)}</span>
            </span>
          </span>
          <span class="tag-filter-option-count">${countRecordsForTag(scope, tag.id)}</span>
        </label>
      `).join("")}
    </section>
  `;
}

function renderTagManager() {
  if (!refs.tagManagerEventList || !refs.tagManagerTaskList) return;
  refs.tagManagerEventList.className = "tag-manager-list";
  refs.tagManagerTaskList.className = "tag-manager-list";
  refs.tagManagerEventList.innerHTML = buildTagManagerList("calendar", state.db.eventTags || [], "还没有日程标签。");
  refs.tagManagerTaskList.innerHTML = buildTagManagerList("task", state.db.taskTags || [], "还没有待办标签。");
}

function buildTagManagerList(scope, tags, emptyText) {
  if (!tags.length) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }
  return tags.map((tag) => `
    <article class="tag-manager-item">
      <div class="tag-manager-row">
        <div class="tag-manager-meta">
          <span class="tag-color-dot" style="background:${escapeHtml(normalizeHexColor(tag.color || "#115e59"))};"></span>
          <span class="tag-manager-name">${escapeHtml(tag.name)}</span>
          <span class="tag-manager-count">${countRecordsForTag(scope, tag.id)} 条事项</span>
        </div>
        <div class="tag-manager-actions">
          <input
            type="color"
            value="${escapeHtml(normalizeHexColor(tag.color || "#115e59"))}"
            data-tag-color-input="true"
            data-tag-scope="${escapeHtml(scope)}"
            data-tag-id="${escapeHtml(tag.id)}"
            aria-label="调整 ${escapeHtml(tag.name)} 的颜色"
          >
          <button
            class="ghost-btn"
            type="button"
            data-tag-action="delete"
            data-tag-scope="${escapeHtml(scope)}"
            data-tag-id="${escapeHtml(tag.id)}"
          >删除</button>
        </div>
      </div>
    </article>
  `).join("");
}

function countRecordsForTag(scope, tagId) {
  const recordType = scope === "task" ? "task" : "calendar";
  return (state.db.records || []).filter((record) => {
    if (record.recordType !== recordType || record.status !== "active") return false;
    return Array.isArray(record.tagIds) && record.tagIds.includes(tagId);
  }).length;
}

function deleteScopedTag(scope, tagId) {
  const registry = getScopedTagRegistry(scope);
  const index = registry.findIndex((item) => item.id === tagId);
  if (index < 0) return;
  registry.splice(index, 1);
  const recordType = scope === "task" ? "task" : "calendar";
  (state.db.records || []).forEach((record) => {
    if (record.recordType !== recordType) return;
    const nextTagIds = Array.isArray(record.tagIds) ? record.tagIds.filter((item) => item !== tagId) : [];
    const nextTagNames = ensureDefaultTags(scope, resolveScopedTagNames(scope, nextTagIds, []));
    record.tagIds = ensureScopedTags(scope, nextTagNames, record.tagColor || getDefaultTagColor(scope));
    record.tags = resolveScopedTagNames(scope, record.tagIds, nextTagNames);
    record.tagColor = resolveScopedPrimaryColor(scope, record.tags, getDefaultTagColor(scope));
    record.updatedAt = new Date().toISOString();
  });
  state.activeTagFilters = state.activeTagFilters.filter((item) => item !== tagId);
  persistState();
  render();
}
