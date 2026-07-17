(function () {
  "use strict";

  const state = {
    tasks: [],
    view: "today",
    query: "",
    priority: "all",
    sort: "due-asc",
    deletedTask: null,
    toastTimer: null,
    confettiPlayed: false,
    stars: 0,
    logs: [],
    cleanupCount: 0,
    lifetimeStars: 0,
    cycleTaskCount: 0,
    cycleStartedAt: null,
    cyclesCompleted: 0,
    starAnimationFrame: null,
    starAnimationTimer: null,
    modalMode: "task",
    activePenaltySnoozeTaskId: null,
    notePreviewOpen: false,
    progressDrag: null,
    suppressProgressClick: false,
    progressAnimationFrom: new Map()
  };

  const viewCopy = {
    today: ["Tasks", "Today and upcoming tasks, arranged in one clean flow."],
    progress: ["Progress", "Move long-running work forward one smooth step at a time."],
    overdue: ["Overdue", "A gentle nudge to bring these back on track."],
    completed: ["Completed", "Small wins add up. Here are yours."],
    logs: ["Logs", "A private local record of deductions and cleanup."]
  };

  const STAR_STORAGE_KEY = "tasko_stars_v1";
  const LIFETIME_STAR_STORAGE_KEY = "tasko_lifetime_stars_v1";
  const CYCLE_TASK_STORAGE_KEY = "tasko_cycle_task_count_v1";
  const CYCLE_STARTED_STORAGE_KEY = "tasko_cycle_started_at_v1";
  const CYCLE_COUNT_STORAGE_KEY = "tasko_100k_cycle_count_v1";
  const LOG_STORAGE_KEY = "tasko_activity_logs_v1";
  const CLEANUP_STORAGE_KEY = "tasko_completed_cleanup_count_v1";
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const COMPLETED_RETENTION_MS = 30 * DAY_MS;
  const PROGRESS_DONE_DELAY_MS = 30 * 60 * 1000;
  const STAR_CYCLE_TARGET = 100000;
  const REWARD_POINTS = { low: 5, medium: 10, high: 20, urgent: 35 };
  const PENALTY_POINTS = { low: 1, medium: 2, high: 4, urgent: 7 };
  const MILESTONES = [
    { value: 10, label: "Spark", messages: ["Signal acquired. The first ten are yours.", "A clean start — momentum is online."] },
    { value: 50, label: "Building", messages: ["Fifty stars. Your system is taking shape.", "Consistency detected. Keep the signal strong."] },
    { value: 100, label: "Good", messages: ["Good work. One hundred stars secured.", "Triple digits — your rhythm is real now."] },
    { value: 500, label: "Great", messages: ["Five hundred stars. Serious momentum confirmed.", "Great work — follow-through has become a habit."] },
    { value: 1000, label: "Insane", messages: ["One thousand stars. Delightfully insane.", "Four digits. Your future self approves."] },
    { value: 5000, label: "Unstoppable", messages: ["Five thousand stars. Unstoppable mode active.", "Tasko is running out of adjectives."] },
    { value: 10000, label: "Legendary", messages: ["Ten thousand. Legendary signal strength.", "A five-digit record built one task at a time."] },
    { value: 50000, label: "Mythic", messages: ["Fifty thousand stars. Mythic territory reached.", "This level of consistency bends the graph."] },
    { value: 100000, label: "Cosmic", messages: ["One hundred thousand. Cosmic status unlocked.", "Maximum signal. Absolutely extraordinary."] }
  ];

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const pad = number => String(number).padStart(2, "0");

  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function isProgressTask(task) {
    return task.type === "progress";
  }

  function isDeadlineTask(task) {
    return !isProgressTask(task);
  }

  function taskCategory(task) {
    return (task.category || "General").trim() || "General";
  }

  function normalizeProgress(task) {
    return Math.max(0, Math.min(100, Number(task.progress || 0)));
  }

  function progressReadyForDone(task, now = new Date()) {
    return isProgressTask(task) && task.completed && task.completedAt && now - new Date(task.completedAt) >= PROGRESS_DONE_DELAY_MS;
  }

  function notesNeedPreview(task) {
    return Boolean(task.notes) && (task.notes.length > 120 || task.notes.split("\n").length > 3);
  }

  function safeNumber(key) {
    const value = Number.parseInt(localStorage.getItem(key) || "0", 10);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function loadLogs() {
    try {
      const logs = JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || "[]");
      return Array.isArray(logs) ? logs.slice(0, 250) : [];
    } catch (error) {
      console.warn("Tasko could not read the local activity log.", error);
      return [];
    }
  }

  function addLogs(entries) {
    if (!entries.length) return;
    const stamped = entries.map(entry => ({ id: TaskoDB.makeId(), timestamp: new Date().toISOString(), ...entry }));
    state.logs = [...stamped, ...state.logs].slice(0, 250);
    try { localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(state.logs)); }
    catch (error) { console.warn("Tasko could not save the activity log.", error); }
  }

  function milestoneMessage(milestone) {
    if (!milestone) return "Complete a task to ignite your first milestone.";
    const key = `tasko_milestone_message_${milestone.value}`;
    let index = Number.parseInt(localStorage.getItem(key) || "", 10);
    if (!Number.isInteger(index) || !milestone.messages[index]) {
      index = Math.floor(Math.random() * milestone.messages.length);
      localStorage.setItem(key, String(index));
    }
    return milestone.messages[index];
  }

  function formatMilestoneValue(value) {
    return value >= 1000 ? `${value / 1000}k` : String(value);
  }

  function ensureMilestoneNodes() {
    const container = $("#milestoneNodes");
    if (container.children.length) return;
    const fragment = document.createDocumentFragment();
    MILESTONES.forEach(milestone => {
      const node = document.createElement("div");
      node.className = "milestone-node";
      node.dataset.value = milestone.value;
      const dot = document.createElement("span");
      dot.className = "milestone-node-dot";
      const label = document.createElement("small");
      label.textContent = formatMilestoneValue(milestone.value);
      node.append(dot, label);
      fragment.append(node);
    });
    container.append(fragment);
  }

  function milestoneRailProgress(stars) {
    if (stars <= 0) return 0;
    const segmentCount = MILESTONES.length;
    if (stars >= MILESTONES.at(-1).value) return 100;
    const nextIndex = MILESTONES.findIndex(item => stars < item.value);
    const previousValue = nextIndex === 0 ? 0 : MILESTONES[nextIndex - 1].value;
    const nextValue = MILESTONES[nextIndex].value;
    return ((nextIndex + ((stars - previousValue) / (nextValue - previousValue))) / segmentCount) * 100;
  }

  function updateMilestone(stars) {
    ensureMilestoneNodes();
    const reached = [...MILESTONES].reverse().find(item => stars >= item.value) || null;
    const next = MILESTONES.find(item => stars < item.value) || null;
    $("#milestoneStars").textContent = stars.toLocaleString();
    $("#milestoneLevel").textContent = reached?.label || "Starting signal";
    $("#milestoneNext").textContent = next ? `Next: ${formatMilestoneValue(next.value)}` : "Maximum tier";
    $("#milestoneMessage").textContent = milestoneMessage(reached);
    $("#milestoneRemaining").textContent = next ? `${(next.value - stars).toLocaleString()} stars to ${next.label}` : "All milestone checkpoints online";
    $("#milestoneLineFill").style.width = `${milestoneRailProgress(stars)}%`;
    $$(".milestone-node").forEach(node => {
      const value = Number(node.dataset.value);
      node.classList.toggle("active", stars >= value);
      node.classList.toggle("current", Boolean(reached) && value === reached.value);
    });
  }

  function updateStarUI(previous = state.stars, delta = 0) {
    const counter = $("#starCounter");
    const value = $("#starCounterValue");
    const deltaBadge = $("#starDelta");
    cancelAnimationFrame(state.starAnimationFrame);
    clearTimeout(state.starAnimationTimer);
    if (!delta) value.textContent = state.stars.toLocaleString();
    else {
      const startedAt = performance.now();
      const animate = now => {
        const progress = Math.min(1, (now - startedAt) / 580);
        const eased = 1 - Math.pow(1 - progress, 3);
        value.textContent = Math.round(previous + (state.stars - previous) * eased).toLocaleString();
        if (progress < 1) state.starAnimationFrame = requestAnimationFrame(animate);
      };
      state.starAnimationFrame = requestAnimationFrame(animate);
      counter.classList.remove("is-gaining", "is-losing");
      void counter.offsetWidth;
      counter.classList.add(delta > 0 ? "is-gaining" : "is-losing");
      deltaBadge.hidden = false;
      deltaBadge.textContent = `${delta > 0 ? "+" : ""}${delta}`;
      deltaBadge.className = `star-delta ${delta > 0 ? "positive" : "negative"}`;
      state.starAnimationTimer = setTimeout(() => { deltaBadge.hidden = true; counter.classList.remove("is-gaining", "is-losing"); }, 950);
    }
    counter.setAttribute("aria-label", `${state.stars} stars`);
    updateMilestone(state.stars);
  }

  function changeStars(amount) {
    const previous = state.stars;
    state.stars = Math.max(0, state.stars + amount);
    const actualChange = state.stars - previous;
    localStorage.setItem(STAR_STORAGE_KEY, String(state.stars));
    updateStarUI(previous, actualChange);
    return actualChange;
  }

  function animateCycleCompletion(previous, reward) {
    const counter = $("#starCounter");
    const value = $("#starCounterValue");
    const deltaBadge = $("#starDelta");
    cancelAnimationFrame(state.starAnimationFrame);
    clearTimeout(state.starAnimationTimer);
    counter.classList.remove("is-gaining", "is-losing");
    counter.classList.add("cycle-complete");
    deltaBadge.hidden = false;
    deltaBadge.textContent = reward ? `+${reward}` : "100K";
    deltaBadge.className = "star-delta positive";
    updateMilestone(STAR_CYCLE_TARGET);
    const startedAt = performance.now();
    const animate = now => {
      const progress = Math.min(1, (now - startedAt) / 720);
      const eased = 1 - Math.pow(1 - progress, 3);
      value.textContent = Math.round(previous + (STAR_CYCLE_TARGET - previous) * eased).toLocaleString();
      if (progress < 1) state.starAnimationFrame = requestAnimationFrame(animate);
    };
    state.starAnimationFrame = requestAnimationFrame(animate);
    state.starAnimationTimer = setTimeout(() => {
      value.textContent = "0";
      counter.setAttribute("aria-label", "0 stars");
      counter.classList.remove("cycle-complete");
      deltaBadge.hidden = true;
      updateMilestone(0);
    }, 1100);
  }

  function completeStarCycle(previous, reward, triggerTask = null) {
    const now = new Date();
    const started = state.cycleStartedAt ? new Date(state.cycleStartedAt) : now;
    const days = Math.max(1, Math.ceil((now - started) / DAY_MS));
    const tasksCompleted = state.cycleTaskCount;
    state.cyclesCompleted += 1;
    state.stars = 0;
    state.cycleTaskCount = 0;
    state.cycleStartedAt = null;
    localStorage.setItem(STAR_STORAGE_KEY, "0");
    localStorage.setItem(CYCLE_COUNT_STORAGE_KEY, String(state.cyclesCompleted));
    localStorage.setItem(CYCLE_TASK_STORAGE_KEY, "0");
    localStorage.removeItem(CYCLE_STARTED_STORAGE_KEY);
    addLogs([{
      type: "milestone",
      taskTitle: `100,000 stars reached — cycle ${state.cyclesCompleted}`,
      triggerTask: triggerTask?.title || "Imported progress",
      points: STAR_CYCLE_TARGET,
      days,
      tasksCompleted,
      cycleNumber: state.cyclesCompleted,
      lifetimeStars: state.lifetimeStars
    }]);
    animateCycleCompletion(Math.min(previous, STAR_CYCLE_TARGET), reward);
    launchConfetti();
  }

  function awardCompletionStars(reward, task) {
    if (!state.cycleStartedAt) {
      state.cycleStartedAt = new Date().toISOString();
      localStorage.setItem(CYCLE_STARTED_STORAGE_KEY, state.cycleStartedAt);
    }
    state.lifetimeStars += reward;
    state.cycleTaskCount += 1;
    localStorage.setItem(LIFETIME_STAR_STORAGE_KEY, String(state.lifetimeStars));
    localStorage.setItem(CYCLE_TASK_STORAGE_KEY, String(state.cycleTaskCount));
    const previous = state.stars;
    if (previous + reward >= STAR_CYCLE_TARGET) {
      completeStarCycle(previous, reward, task);
      return true;
    }
    changeStars(reward);
    return false;
  }

  function parseDeadline(task) {
    if (!task.dueDate) return null;
    const time = task.dueTime || "23:59";
    const [year, month, day] = task.dueDate.split("-").map(Number);
    const [hours, minutes] = time.split(":").map(Number);
    return new Date(year, month - 1, day, hours || 0, minutes || 0, task.dueTime ? 0 : 59, task.dueTime ? 0 : 999);
  }

  function isOverdue(task, now = new Date()) {
    return !task.completed && Boolean(task.dueDate) && parseDeadline(task) < now;
  }

  function isTodayTask(task) {
    return !task.completed && (!task.dueDate || (task.dueDate === dateKey() && !isOverdue(task)));
  }

  function isUpcoming(task) {
    return !task.completed && Boolean(task.dueDate) && task.dueDate > dateKey();
  }

  function taskMatchesView(task) {
    if (state.view === "progress") return isProgressTask(task);
    if (state.view === "completed") return isDeadlineTask(task) ? task.completed : progressReadyForDone(task);
    if (!isDeadlineTask(task)) return false;
    if (state.view === "overdue") return isOverdue(task);
    return !task.completed && (isTodayTask(task) || isUpcoming(task));
  }

  function dueValue(task) {
    const deadline = parseDeadline(task);
    return deadline ? deadline.getTime() : Number.MAX_SAFE_INTEGER;
  }

  function sortDeadlineTasks(tasks) {
    const priorityWeight = { urgent: 4, high: 3, medium: 2, low: 1 };
    return [...tasks].sort((a, b) => {
      if (state.sort === "due-desc") return dueValue(b) - dueValue(a);
      if (state.sort === "priority") return priorityWeight[b.priority] - priorityWeight[a.priority] || dueValue(a) - dueValue(b);
      if (state.sort === "created") return new Date(b.createdAt) - new Date(a.createdAt);
      return dueValue(a) - dueValue(b);
    });
  }

  function visibleTasks() {
    const query = state.query.trim().toLowerCase();
    const tasks = state.tasks.filter(task => {
      if (!taskMatchesView(task)) return false;
      if (state.priority !== "all" && task.priority !== state.priority) return false;
      if (!query) return true;
      return [task.title, task.notes, task.category, task.priority].some(value => (value || "").toLowerCase().includes(query));
    });

    return sortDeadlineTasks(tasks);
  }

  function formatDate(task) {
    if (!task.dueDate) return "No due date";
    const [year, month, day] = task.dueDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const compactDate = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (task.dueDate === dateKey()) return `Today · ${compactDate}`;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (task.dueDate === dateKey(tomorrow)) return `Tomorrow · ${compactDate}`;
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(year !== new Date().getFullYear() && { year: "numeric" }) });
  }

  function formatTime(time) {
    if (!time) return "";
    const [hours, minutes] = time.split(":").map(Number);
    return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function countdownInfo(task, now = new Date()) {
    if (!task.dueDate || !task.dueTime || task.completed) return { text: "", className: "" };
    const difference = parseDeadline(task) - now;
    const absolute = Math.abs(difference);
    if (absolute <= 30000) return { text: "Due now", className: "due" };

    const totalMinutes = Math.max(1, Math.floor(absolute / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    let amount = "";
    if (days) amount = `${days}d${hours ? ` ${hours}h` : ""}`;
    else if (hours) amount = `${hours}h${minutes ? ` ${minutes}m` : ""}`;
    else amount = `${minutes}m`;

    if (difference < 0) return { text: `Overdue by ${amount}`, className: "overdue" };
    return { text: `${amount} left`, className: difference < 30 * 60 * 1000 ? "near" : "" };
  }

  function createMetaChip(text, className = "") {
    const span = document.createElement("span");
    span.className = `meta-chip ${className}`.trim();
    span.textContent = text;
    return span;
  }

  function isPenaltySnoozed(task, now = new Date()) {
    return Boolean(task.penaltySnoozedUntil) && new Date(task.penaltySnoozedUntil) > now;
  }

  function formatSnoozeUntil(task) {
    return new Date(task.penaltySnoozedUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function categoryDescription(name) {
    const lower = name.toLowerCase();
    if (lower.includes("learn") || lower.includes("study")) return "Academic subjects and study tasks";
    if (lower.includes("work") || lower.includes("office")) return "Practical and professional tasks";
    if (lower.includes("health") || lower.includes("fitness")) return "Care, energy, and routines";
    if (lower.includes("shop")) return "Errands and things to collect";
    if (lower.includes("personal")) return "Personal focus and life admin";
    return "Tasks grouped from this list";
  }

  function groupByCategory(tasks) {
    const groups = new Map();
    tasks.forEach(task => {
      const category = taskCategory(task);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(task);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  function buildCategoryGroup(title, tasks, options = {}) {
    const group = document.createElement("article");
    group.className = `task-category-group glass-panel ${options.className || ""}`.trim();
    const header = document.createElement("header");
    header.className = "task-category-header";
    const icon = document.createElement("span");
    icon.className = "task-category-icon";
    icon.textContent = options.icon || title.charAt(0).toUpperCase();
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = title;
    const detail = document.createElement("p");
    detail.textContent = options.description || categoryDescription(title);
    copy.append(heading, detail);
    const count = document.createElement("span");
    count.className = "task-category-count";
    count.textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
    header.append(icon, copy, count);
    const list = document.createElement("div");
    list.className = options.listClass || "category-task-list";
    group.append(header, list);
    return { group, list };
  }

  function buildTaskCard(task, index) {
    const card = $("#taskCardTemplate").content.firstElementChild.cloneNode(true);
    card.dataset.id = task.id;
    card.style.animationDelay = window.innerWidth <= 720 ? "0ms" : `${Math.min(index * 35, 210)}ms`;
    if (task.completed) card.classList.add("completed");
    if (notesNeedPreview(task)) {
      card.classList.add("has-note-preview");
      card.classList.add("has-long-notes");
    }

    const check = card.querySelector(".check-button");
    check.dataset.action = "toggle";
    check.setAttribute("aria-label", task.completed ? "Restore task" : "Mark task complete");
    card.querySelector("h3").textContent = task.title;
    card.querySelector(".task-notes").textContent = task.notes || "";

    const badge = card.querySelector(".priority-badge");
    badge.textContent = task.priority;
    badge.classList.add(`priority-${task.priority}`);

    const meta = card.querySelector(".task-meta");
    if (task.dueDate) {
      const overdueClass = isOverdue(task) ? "overdue" : "";
      meta.append(createMetaChip(`◷ ${formatDate(task)}${task.dueTime ? ` · ${formatTime(task.dueTime)}` : ""}`, overdueClass));
    }
    if (task.category) meta.append(createMetaChip(task.category, "category"));
    if (isPenaltySnoozed(task)) meta.append(createMetaChip(`Snoozed until ${formatSnoozeUntil(task)}`, "snoozed"));
    if (task.completedAt) meta.append(createMetaChip(`✓ ${new Date(task.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`));

    const countdown = card.querySelector(".countdown");
    countdown.dataset.taskId = task.id;
    const countdownState = countdownInfo(task);
    countdown.textContent = countdownState.text;
    if (countdownState.className) countdown.classList.add(countdownState.className);
    if (!countdownState.text) countdown.hidden = true;

    const actions = card.querySelector(".task-actions");
    if (isOverdue(task)) {
      const snoozeButton = document.createElement("button");
      snoozeButton.type = "button";
      snoozeButton.dataset.action = "penalty-snooze";
      snoozeButton.setAttribute("aria-label", "Snooze point deductions");
      snoozeButton.title = "Snooze point deductions";
      snoozeButton.textContent = "Pause";
      actions.prepend(snoozeButton);
    }
    return card;
  }

  function renderTaskGroups(tasks) {
    const fragment = document.createDocumentFragment();
    const appendGroup = (title, groupedTasks, options) => {
      if (!groupedTasks.length) return;
      const { group, list } = buildCategoryGroup(title, groupedTasks, options);
      groupedTasks.forEach((task, index) => list.append(buildTaskCard(task, index)));
      fragment.append(group);
    };

    if (state.view === "today") {
      appendGroup("Today", tasks.filter(isTodayTask), { icon: "T", description: "Due today and undated tasks" });
      appendGroup("Upcoming", tasks.filter(isUpcoming), { icon: "U", description: "Future deadlines queued below today" });
      return fragment;
    }

    groupByCategory(tasks).forEach(([category, categoryTasks]) => {
      appendGroup(category, categoryTasks, { icon: category.charAt(0).toUpperCase() });
    });
    return fragment;
  }

  function formatCreatedAt(task) {
    const date = new Date(task.createdAt || task.updatedAt || Date.now());
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function visibleProgressTasks() {
    const query = state.query.trim().toLowerCase();
    return state.tasks
      .filter(isProgressTask)
      .filter(task => !progressReadyForDone(task))
      .filter(task => state.priority === "all" || task.priority === state.priority)
      .filter(task => {
        if (!query) return true;
        return [task.title, task.notes, task.category, task.priority].some(value => (value || "").toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const categorySort = taskCategory(a).localeCompare(taskCategory(b));
        if (categorySort) return categorySort;
        return (a.progressOrder || 0) - (b.progressOrder || 0) || new Date(a.createdAt) - new Date(b.createdAt);
      });
  }

  function buildProgressCard(task) {
    const progress = normalizeProgress(task);
    const animatedFrom = state.progressAnimationFrom.has(task.id) ? state.progressAnimationFrom.get(task.id) : progress;
    const card = document.createElement("article");
    card.className = "progress-task-card glass-panel";
    card.dataset.id = task.id;
    card.dataset.progressTarget = progress;
    card.style.setProperty("--progress", animatedFrom);
    if (task.completed) card.classList.add("completed");
    if (notesNeedPreview(task)) card.classList.add("has-note-preview");

    const handle = document.createElement("button");
    handle.className = "drag-handle";
    handle.type = "button";
    handle.setAttribute("aria-label", "Reorder progress card");
    handle.textContent = "≡";

    const body = document.createElement("div");
    body.className = "progress-task-body";
    const titleRow = document.createElement("div");
    titleRow.className = "task-title-row";
    const title = document.createElement("h3");
    title.textContent = task.title;
    const badge = document.createElement("span");
    badge.className = `priority-badge priority-${task.priority}`;
    badge.textContent = task.priority;
    titleRow.append(title, badge);
    const notes = document.createElement("p");
    notes.className = "task-notes";
    notes.textContent = task.notes || "";
    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.append(createMetaChip(`Created ${formatCreatedAt(task)}`));
    if (task.category) meta.append(createMetaChip(task.category, "category"));
    if (task.completedAt) meta.append(createMetaChip(`✓ ${new Date(task.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`));
    body.append(titleRow, notes, meta);

    const meter = document.createElement("div");
    meter.className = "progress-circle";
    const meterInner = document.createElement("div");
    meterInner.innerHTML = `<strong>${progress}%</strong><span>${task.completed ? "done" : "progress"}</span>`;
    meter.append(meterInner);

    const controls = document.createElement("div");
    controls.className = "progress-controls";
    [
      ["-10", -10],
      ["+5", 5],
      ["+10", 10],
      ["+50", 50]
    ].forEach(([label, amount]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.progressDelta = amount;
      button.textContent = label;
      controls.append(button);
    });
    const done = document.createElement("button");
    done.type = "button";
    done.dataset.progressDone = "true";
    done.textContent = task.completed ? "Done" : "Complete";
    controls.append(done);
    [["progressEdit", "Edit"], ["progressDelete", "Delete"]].forEach(([key, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset[key] = "true";
      button.textContent = label;
      controls.append(button);
    });

    card.append(handle, body, meter, controls);
    return card;
  }

  function renderProgress() {
    const cards = visibleProgressTasks();
    const list = $("#progressList");
    const fragment = document.createDocumentFragment();
    groupByCategory(cards).forEach(([category, categoryTasks]) => {
      const ordered = [...categoryTasks].sort((a, b) => (a.progressOrder || 0) - (b.progressOrder || 0));
      const { group, list: groupList } = buildCategoryGroup(category, ordered, {
        icon: category.charAt(0).toUpperCase(),
        listClass: "progress-card-stack"
      });
      ordered.forEach(task => groupList.append(buildProgressCard(task)));
      fragment.append(group);
    });
    list.replaceChildren(fragment);
    requestAnimationFrame(() => {
      $$(".progress-task-card[data-progress-target]").forEach(card => {
        card.style.setProperty("--progress", card.dataset.progressTarget);
      });
      state.progressAnimationFrom.clear();
    });
    $("#progressResultCount").textContent = `${cards.length} ${cards.length === 1 ? "card" : "cards"}`;
    $("#progressEmptyState").hidden = cards.length > 0;
    list.hidden = cards.length === 0;
  }

  function renderLogs() {
    const list = $("#logList");
    const fragment = document.createDocumentFragment();
    state.logs.forEach(log => {
      const entry = document.createElement("article");
      entry.className = `log-entry ${log.type}`;
      const time = document.createElement("time");
      time.className = "log-time";
      time.dateTime = log.timestamp;
      time.textContent = new Date(log.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const marker = document.createElement("span");
      marker.className = "log-marker";
      marker.setAttribute("aria-hidden", "true");
      const copy = document.createElement("div");
      copy.className = "log-copy";
      const title = document.createElement("strong");
      title.textContent = log.taskTitle || "Untitled task";
      const detail = document.createElement("span");
      if (log.type === "penalty") {
        const grace = log.graceDays ? ` · ${log.graceDays}d grace elapsed` : "";
        const snooze = log.snoozedUntil ? ` · snoozed until ${new Date(log.snoozedUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "";
        detail.textContent = `${(log.priority || "task").toUpperCase()} · ${log.overdueHours || 0}h overdue${grace}${snooze} · interval ${log.interval || 1}`;
      } else if (log.type === "cleanup") {
        const completedDate = log.completedAt ? new Date(log.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "unknown";
        detail.textContent = `Completed ${completedDate} · removed after 30 days`;
      } else {
        detail.textContent = `Congratulations · ${log.days || 1} days · ${log.tasksCompleted || 0} rewarded tasks · triggered by ${log.triggerTask || "a completed task"}`;
      }
      copy.append(title, detail);
      const amount = document.createElement("span");
      amount.className = "log-points";
      amount.textContent = log.type === "penalty" ? `-${log.points}` : (log.type === "cleanup" ? "CLEARED" : "100K");
      entry.append(time, marker, copy, amount);
      fragment.append(entry);
    });
    list.replaceChildren(fragment);
    $("#logEmpty").hidden = state.logs.length > 0;
    list.hidden = state.logs.length === 0;
    $("#logPointsDeducted").textContent = state.logs.filter(log => log.type === "penalty").reduce((sum, log) => sum + (log.points || 0), 0).toLocaleString();
    $("#logTasksCleared").textContent = state.cleanupCount.toLocaleString();
    $("#logLifetimeStars").textContent = state.lifetimeStars.toLocaleString();
    $("#logCyclesCompleted").textContent = state.cyclesCompleted.toLocaleString();
  }

  function render() {
    const logsMode = state.view === "logs";
    const progressMode = state.view === "progress";
    document.body.classList.toggle("logs-mode", logsMode);
    document.body.classList.toggle("progress-mode", progressMode);
    $("#dashboardSection").hidden = logsMode || progressMode;
    $("#milestoneSection").hidden = logsMode || progressMode;
    $("#taskSection").hidden = logsMode || progressMode;
    $("#progressSection").hidden = !progressMode;
    $("#logsSection").hidden = !logsMode;
    if (logsMode) {
      renderLogs();
      updateHeader();
      updateStats();
      return;
    }
    if (progressMode) {
      renderProgress();
      updateHeader();
      updateStats();
      return;
    }
    const tasks = visibleTasks();
    const list = $("#taskList");
    if (state.view === "completed") list.replaceChildren(...tasks.map(buildTaskCard));
    else list.replaceChildren(renderTaskGroups(tasks));
    $("#resultCount").textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
    $("#emptyState").hidden = tasks.length > 0;
    list.hidden = tasks.length === 0;

    const emptyMessages = {
      today: "Your task lane is open. Add today or future work when inspiration strikes.",
      overdue: "Lovely — nothing has slipped past its deadline.",
      completed: "Complete a task and it will settle in here."
    };
    $("#emptyMessage").textContent = state.query ? "No tasks match your search and filters." : emptyMessages[state.view];
    updateHeader();
    updateStats();
  }

  function updateHeader() {
    const [title, subtitle] = viewCopy[state.view];
    $("#viewTitle").textContent = title;
    $("#viewSubtitle").textContent = subtitle;
    $("#dateLabel").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    $$('[data-view]').forEach(button => button.classList.toggle("active", button.dataset.view === state.view));
  }

  function updateStats() {
    const today = dateKey();
    const deadlineTasks = state.tasks.filter(isDeadlineTask);
    const active = deadlineTasks.filter(task => !task.completed);
    const overdue = active.filter(task => isOverdue(task));
    const upcoming = active.filter(task => isUpcoming(task));
    const todayTasks = deadlineTasks.filter(task => !task.dueDate || task.dueDate === today);
    const todayDone = todayTasks.filter(task => task.completed).length;
    const completedToday = deadlineTasks.filter(task => task.completedAt && dateKey(new Date(task.completedAt)) === today).length;
    const progress = todayTasks.length ? Math.round((todayDone / todayTasks.length) * 100) : 0;

    $("#statTotal").textContent = deadlineTasks.length;
    $("#statCompleted").textContent = completedToday;
    $("#statOverdue").textContent = overdue.length;
    $("#statUpcoming").textContent = upcoming.length;
    $("#progressRing").style.setProperty("--progress", progress);
    $("#progressPercent").textContent = `${progress}%`;

    if (!todayTasks.length) {
      $("#progressMessage").textContent = "Fresh start";
      $("#progressDetail").textContent = "Add a task and build momentum.";
    } else if (progress === 100) {
      $("#progressMessage").textContent = "Beautifully done";
      $("#progressDetail").textContent = "Every task for today is complete.";
    } else {
      $("#progressMessage").textContent = progress >= 50 ? "Great momentum" : "You've got this";
      $("#progressDetail").textContent = `${todayDone} of ${todayTasks.length} tasks complete today.`;
    }

    const counts = {
      today: active.filter(task => isTodayTask(task) || isUpcoming(task)).length,
      progress: state.tasks.filter(task => isProgressTask(task) && !progressReadyForDone(task)).length,
      upcoming: upcoming.length,
      overdue: overdue.length,
      completed: deadlineTasks.filter(task => task.completed).length + state.tasks.filter(progressReadyForDone).length,
      logs: state.logs.length
    };
    Object.entries(counts).forEach(([key, value]) => {
      const counter = $(`[data-count="${key}"]`);
      if (counter) counter.textContent = value;
    });
  }

  function setView(view) {
    if (view === "upcoming") view = "today";
    if (!viewCopy[view]) return;
    state.view = view;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openTaskModal(task = null, mode = null) {
    const progressMode = isProgressTask(task || {}) || mode === "progress";
    state.modalMode = progressMode ? "progress" : "task";
    const form = $("#taskForm");
    form.reset();
    $("#taskModal").classList.toggle("progress-entry", progressMode);
    $("#taskId").value = task?.id || "";
    $("#taskModalTitle").textContent = task ? (progressMode ? "Edit progress card" : "Edit task") : (progressMode ? "Add progress card" : "Add a task");
    $("#saveTaskButton").textContent = task ? "Save changes" : "Create task";
    if (task) {
      $("#taskTitle").value = task.title;
      $("#taskNotes").value = task.notes || "";
      $("#taskDate").value = progressMode ? "" : (task.dueDate || "");
      $("#taskTime").value = progressMode ? "" : (task.dueTime || "");
      $("#taskPriority").value = task.priority || "medium";
      $("#taskCategory").value = task.category || "";
    } else {
      $("#taskDate").value = !progressMode && state.view === "today" ? dateKey() : "";
      $("#taskPriority").value = "medium";
    }
    $(".form-hint").textContent = progressMode
      ? "Progress cards award stars once when completed: Low +5, Medium +10, High +20, Urgent +35."
      : "Completion rewards: Low +5, Medium +10, High +20, Urgent +35 stars.";
    $("#taskModal").hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => $("#taskTitle").focus());
  }

  function closeTaskModal() {
    $("#taskModal").hidden = true;
    $("#taskModal").classList.remove("progress-entry");
    state.modalMode = "task";
    document.body.style.overflow = "";
  }

  async function saveTask(event) {
    event.preventDefault();
    const id = $("#taskId").value;
    const existing = state.tasks.find(task => task.id === id);
    const progressMode = state.modalMode === "progress";
    const dueDate = progressMode ? "" : $("#taskDate").value;
    const dueTime = progressMode ? "" : $("#taskTime").value;
    const deadlineChanged = existing && !progressMode && (existing.dueDate !== dueDate || existing.dueTime !== dueTime);
    const now = new Date().toISOString();
    const task = {
      id: id || TaskoDB.makeId(),
      type: progressMode ? "progress" : "task",
      title: $("#taskTitle").value.trim(),
      notes: $("#taskNotes").value.trim(),
      dueDate,
      dueTime,
      priority: $("#taskPriority").value,
      category: $("#taskCategory").value.trim(),
      completed: existing?.completed || false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      completedAt: existing?.completedAt || null,
      reminderFiredAt: deadlineChanged ? null : (existing?.reminderFiredAt || null),
      rewardGranted: existing?.rewardGranted || false,
      pointsEarned: existing?.pointsEarned || 0,
      progress: progressMode ? normalizeProgress(existing || {}) : undefined,
      progressOrder: progressMode ? (existing?.progressOrder || Date.now()) : undefined,
      penaltyTotal: existing?.penaltyTotal || 0,
      penaltyIntervalsApplied: deadlineChanged ? 0 : (existing?.penaltyIntervalsApplied || 0),
      penaltyCyclePoints: deadlineChanged ? 0 : (existing?.penaltyCyclePoints || 0),
      penaltyCycleKey: deadlineChanged ? null : (existing?.penaltyCycleKey || null),
      penaltySnoozedUntil: deadlineChanged ? null : (existing?.penaltySnoozedUntil || null)
    };
    if (!task.title) return;

    const saved = await TaskoDB.put(task);
    const index = state.tasks.findIndex(item => item.id === saved.id);
    if (index >= 0) state.tasks[index] = saved; else state.tasks.push(saved);
    closeTaskModal();
    render();
    showToast(existing ? "Task updated" : "Task created");
  }

  async function toggleTask(task, card) {
    const becomingComplete = !task.completed;
    let reward = 0;
    let cycleCompleted = false;
    if (becomingComplete) card?.classList.add("is-completing");
    task.completed = becomingComplete;
    task.completedAt = becomingComplete ? new Date().toISOString() : null;
    if (becomingComplete && !task.rewardGranted) {
      reward = REWARD_POINTS[task.priority] || REWARD_POINTS.medium;
      task.rewardGranted = true;
      task.pointsEarned = reward;
    }
    await TaskoDB.put(task);
    if (reward) cycleCompleted = awardCompletionStars(reward, task);

    const finish = () => {
      render();
      showToast(cycleCompleted
        ? `100K cycle ${state.cyclesCompleted} complete — stars reset`
        : (becomingComplete ? `${reward ? `+${reward} stars · ` : ""}Task completed` : "Task restored"));
      if (becomingComplete && !cycleCompleted) maybeCelebrate();
    };
    becomingComplete ? setTimeout(finish, 480) : finish();
  }

  async function finishProgressTask(task) {
    let reward = 0;
    let cycleCompleted = false;
    const previousProgress = normalizeProgress(task);
    state.progressAnimationFrom.set(task.id, previousProgress);
    task.progress = 100;
    if (!task.completed) {
      task.completed = true;
      task.completedAt = new Date().toISOString();
    }
    if (!task.rewardGranted) {
      reward = REWARD_POINTS[task.priority] || REWARD_POINTS.medium;
      task.rewardGranted = true;
      task.pointsEarned = reward;
      cycleCompleted = awardCompletionStars(reward, task);
    }
    await TaskoDB.put(task);
    render();
    showToast(cycleCompleted
      ? `100K cycle ${state.cyclesCompleted} complete — stars reset`
      : (reward ? `+${reward} stars · Progress completed` : "Progress completed"));
  }

  async function updateProgressTask(task, delta) {
    const previousProgress = normalizeProgress(task);
    const nextProgress = Math.max(0, Math.min(100, previousProgress + delta));
    if (nextProgress !== previousProgress) state.progressAnimationFrom.set(task.id, previousProgress);
    task.progress = nextProgress;
    if (nextProgress < 100) {
      task.completed = false;
      task.completedAt = null;
    }
    if (nextProgress >= 100) {
      await finishProgressTask(task);
      return;
    }
    await TaskoDB.put(task);
    render();
  }

  async function deleteTask(task, card) {
    card?.classList.add("is-deleting");
    await new Promise(resolve => setTimeout(resolve, card ? 360 : 0));
    state.deletedTask = { ...task };
    state.tasks = state.tasks.filter(item => item.id !== task.id);
    await TaskoDB.remove(task.id);
    render();
    showToast("Task deleted", "Undo", async () => {
      const restored = await TaskoDB.put(state.deletedTask);
      state.tasks.push(restored);
      state.deletedTask = null;
      render();
      showToast("Task restored");
    });
  }

  function maybeCelebrate() {
    const todayTasks = state.tasks.filter(task => isDeadlineTask(task) && (!task.dueDate || task.dueDate === dateKey()));
    if (!todayTasks.length || !todayTasks.every(task => task.completed) || state.confettiPlayed) return;
    state.confettiPlayed = true;
    launchConfetti();
  }

  function launchConfetti() {
    const layer = $("#confettiLayer");
    const colors = ["#6c5ce7", "#21b879", "#f06a6a", "#f5bd45", "#4793eb", "#e68bd4"];
    for (let index = 0; index < 70; index += 1) {
      const piece = document.createElement("i");
      piece.className = "confetti";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[index % colors.length];
      piece.style.setProperty("--duration", `${2.2 + Math.random() * 2}s`);
      piece.style.setProperty("--drift", `${-120 + Math.random() * 240}px`);
      piece.style.setProperty("--spin", `${360 + Math.random() * 720}deg`);
      piece.style.animationDelay = `${Math.random() * .45}s`;
      layer.append(piece);
    }
    setTimeout(() => layer.replaceChildren(), 5000);
  }

  function showToast(message, actionLabel = "", action = null) {
    const toast = $("#toast");
    clearTimeout(state.toastTimer);
    toast.classList.remove("hiding");
    toast.hidden = false;
    $("#toastMessage").textContent = message;
    const actionButton = $("#toastAction");
    actionButton.hidden = !actionLabel;
    actionButton.textContent = actionLabel;
    actionButton.onclick = action ? async () => { hideToast(); await action(); } : null;
    state.toastTimer = setTimeout(hideToast, action ? 6500 : 3000);
  }

  function hideToast() {
    const toast = $("#toast");
    if (toast.hidden) return;
    toast.classList.add("hiding");
    setTimeout(() => { toast.hidden = true; toast.classList.remove("hiding"); }, 230);
  }

  function updateCountdowns() {
    const tasksById = new Map(state.tasks.map(task => [task.id, task]));
    $$(".countdown[data-task-id]").forEach(element => {
      const task = tasksById.get(element.dataset.taskId);
      if (!task) return;
      const info = countdownInfo(task);
      if (element.textContent !== info.text) element.textContent = info.text;
      if (element.hidden === Boolean(info.text)) element.hidden = !info.text;
      if (element.dataset.countdownClass !== info.className) {
        element.classList.remove("near", "due", "overdue");
        if (info.className) element.classList.add(info.className);
        element.dataset.countdownClass = info.className;
      }
    });
  }

  function penaltyForIntervals(intervals, base) {
    const firstSix = Math.min(intervals, 6) * base;
    const hoursSixToTwentyFour = Math.max(0, Math.min(intervals, 24) - 6) * base * 2;
    const afterOneDay = Math.max(0, intervals - 24) * base * 3;
    return firstSix + hoursSixToTwentyFour + afterOneDay;
  }

  function penaltyGraceDays(task) {
    return task.priority === "high" || task.priority === "urgent" ? 0 : 30;
  }

  async function applyOverduePenalties(now = new Date()) {
    let availableStars = state.stars;
    let totalDeducted = 0;
    let updatedTasks = 0;
    const penaltyLogs = [];
    for (const task of state.tasks) {
      if (!isOverdue(task, now)) continue;
      const deadline = parseDeadline(task);
      const graceDays = penaltyGraceDays(task);
      const graceStart = new Date(deadline.getTime() + graceDays * DAY_MS);
      const snoozedUntil = task.penaltySnoozedUntil ? new Date(task.penaltySnoozedUntil) : null;
      const penaltyStart = snoozedUntil && snoozedUntil > graceStart ? snoozedUntil : graceStart;
      if (now < penaltyStart) continue;
      const cycleKey = `${deadline.toISOString()}|${graceDays}|${penaltyStart.toISOString()}`;
      if (!task.penaltyCycleKey && graceDays === 0 && task.penaltyCycleDeadline === deadline.toISOString()) task.penaltyCycleKey = cycleKey;
      if (task.penaltyCycleKey !== cycleKey) {
        task.penaltyCycleKey = cycleKey;
        task.penaltyIntervalsApplied = 0;
        task.penaltyCyclePoints = 0;
      }
      const intervals = Math.floor((now - penaltyStart) / HOUR_MS) + 1;
      if (intervals <= (task.penaltyIntervalsApplied || 0)) continue;
      const base = PENALTY_POINTS[task.priority] || PENALTY_POINTS.medium;
      const targetPenalty = penaltyForIntervals(intervals, base);
      const requestedDeduction = Math.max(0, targetPenalty - (task.penaltyCyclePoints || 0));
      if (!requestedDeduction) continue;
      const actualDeduction = Math.min(requestedDeduction, availableStars);
      availableStars -= actualDeduction;
      totalDeducted += actualDeduction;
      task.penaltyIntervalsApplied = intervals;
      task.penaltyCyclePoints = targetPenalty;
      task.penaltyTotal = (task.penaltyTotal || 0) + actualDeduction;
      updatedTasks += 1;
      await TaskoDB.put(task);
      if (actualDeduction > 0) penaltyLogs.push({ type: "penalty", taskTitle: task.title, taskId: task.id, points: actualDeduction, priority: task.priority, graceDays, snoozedUntil: task.penaltySnoozedUntil || null, interval: intervals, overdueHours: Math.max(1, Math.floor((now - deadline) / HOUR_MS)) });
    }
    if (totalDeducted) {
      changeStars(-totalDeducted);
      addLogs(penaltyLogs);
      showToast(`${totalDeducted} stars deducted for overdue tasks`);
    }
    return { updatedTasks, totalDeducted };
  }

  async function cleanupExpiredCompletedTasks(now = new Date()) {
    const expired = state.tasks.filter(task => task.completed && task.completedAt && now - new Date(task.completedAt) >= COMPLETED_RETENTION_MS);
    if (!expired.length) return 0;
    for (const task of expired) await TaskoDB.remove(task.id);
    const expiredIds = new Set(expired.map(task => task.id));
    state.tasks = state.tasks.filter(task => !expiredIds.has(task.id));
    state.cleanupCount += expired.length;
    localStorage.setItem(CLEANUP_STORAGE_KEY, String(state.cleanupCount));
    addLogs(expired.map(task => ({ type: "cleanup", taskTitle: task.title, taskId: task.id, completedAt: task.completedAt })));
    return expired.length;
  }

  async function checkReminders() {
    const now = new Date();
    const penaltyResult = await applyOverduePenalties(now);
    const dueTasks = state.tasks.filter(task => {
      const deadline = parseDeadline(task);
      return !task.completed && task.dueDate && task.dueTime && deadline <= now && !task.reminderFiredAt;
    });

    for (const task of dueTasks) {
      task.reminderFiredAt = now.toISOString();
      await TaskoDB.put(task);
      showReminderPopup(task);
      TaskoNotifications.showBrowserNotification(task);
      TaskoNotifications.playAlert();
    }
    if (dueTasks.length || penaltyResult.updatedTasks) render();
  }

  function showReminderPopup(task) {
    if ($(`.reminder-popup[data-id="${task.id}"]`)) return;
    const popup = document.createElement("article");
    popup.className = "reminder-popup glass-panel";
    popup.dataset.id = task.id;

    const head = document.createElement("div");
    head.className = "reminder-head";
    const symbol = document.createElement("span");
    symbol.className = "reminder-symbol";
    symbol.textContent = "◷";
    const copy = document.createElement("div");
    const kicker = document.createElement("p");
    kicker.textContent = "Due now";
    const title = document.createElement("h3");
    title.textContent = task.title;
    copy.append(kicker, title);
    head.append(symbol, copy);

    const detail = document.createElement("p");
    detail.textContent = task.notes || `${task.category || "Task"} · scheduled for ${formatTime(task.dueTime)}`;
    const actions = document.createElement("div");
    actions.className = "reminder-actions";
    [["dismiss", "Dismiss"], ["snooze", "Snooze 5 min"], ["done", "Mark done"]].forEach(([action, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.reminder = action;
      button.textContent = label;
      actions.append(button);
    });
    popup.append(head, detail, actions);
    $("#reminderStack").append(popup);
  }

  function dismissReminder(id) {
    const popup = $(`.reminder-popup[data-id="${id}"]`);
    if (!popup) return;
    popup.classList.add("leaving");
    setTimeout(() => popup.remove(), 330);
  }

  async function handleReminderAction(button) {
    const popup = button.closest(".reminder-popup");
    const task = state.tasks.find(item => item.id === popup?.dataset.id);
    if (!task) return;
    const action = button.dataset.reminder;
    if (action === "snooze") {
      const snoozed = new Date(Date.now() + 5 * 60 * 1000);
      task.dueDate = dateKey(snoozed);
      task.dueTime = `${pad(snoozed.getHours())}:${pad(snoozed.getMinutes())}`;
      task.reminderFiredAt = null;
      task.penaltyIntervalsApplied = 0;
      task.penaltyCyclePoints = 0;
      task.penaltyCycleKey = null;
      await TaskoDB.put(task);
      showToast("Snoozed for 5 minutes");
      render();
    } else if (action === "done") {
      await toggleTask(task, null);
    }
    dismissReminder(task.id);
  }

  function openNotePreview(task) {
    if (!task?.notes) return;
    $("#notePreviewTitle").textContent = task.title;
    $("#notePreviewCategory").textContent = taskCategory(task);
    $("#notePreviewBody").textContent = task.notes;
    const meta = $("#notePreviewMeta");
    meta.replaceChildren();
    if (isProgressTask(task)) meta.append(createMetaChip(`Progress ${normalizeProgress(task)}%`));
    else if (task.dueDate) meta.append(createMetaChip(`${formatDate(task)}${task.dueTime ? ` · ${formatTime(task.dueTime)}` : ""}`, isOverdue(task) ? "overdue" : ""));
    meta.append(createMetaChip(task.priority, `priority-${task.priority}`));
    $("#notePreviewModal").hidden = false;
    state.notePreviewOpen = true;
    document.body.classList.add("modal-open");
    document.body.style.overflow = "hidden";
    if (!history.state?.taskoModal) history.pushState({ taskoModal: "note-preview" }, "");
  }

  function closeNotePreview(fromPop = false) {
    if ($("#notePreviewModal").hidden) return;
    $("#notePreviewModal").hidden = true;
    state.notePreviewOpen = false;
    document.body.classList.remove("modal-open");
    document.body.style.overflow = "";
    if (!fromPop && history.state?.taskoModal === "note-preview") history.back();
  }

  function openPenaltySnoozeModal(task) {
    state.activePenaltySnoozeTaskId = task.id;
    $("#penaltySnoozeTitle").textContent = `Snooze points for ${task.title}`;
    const options = $("#penaltySnoozeOptions");
    const fragment = document.createDocumentFragment();
    for (let days = 2; days <= 10; days += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.snoozeDays = days;
      button.textContent = `${days} days`;
      fragment.append(button);
    }
    options.replaceChildren(fragment);
    $("#penaltySnoozeModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closePenaltySnoozeModal() {
    $("#penaltySnoozeModal").hidden = true;
    state.activePenaltySnoozeTaskId = null;
    document.body.style.overflow = "";
  }

  async function snoozePenalty(days) {
    const task = state.tasks.find(item => item.id === state.activePenaltySnoozeTaskId);
    if (!task) return;
    const until = new Date(Date.now() + days * DAY_MS);
    task.penaltySnoozedUntil = until.toISOString();
    task.penaltyIntervalsApplied = 0;
    task.penaltyCyclePoints = 0;
    task.penaltyCycleKey = null;
    await TaskoDB.put(task);
    closePenaltySnoozeModal();
    render();
    showToast(`Point deductions snoozed for ${days} days`);
  }

  function cardTaskFromEvent(event) {
    const card = event.target.closest("[data-id]");
    if (!card) return null;
    return state.tasks.find(item => item.id === card.dataset.id) || null;
  }

  function updatePermissionUI() {
    const enabled = TaskoNotifications.permission() === "granted";
    $(".permission-dot").classList.toggle("enabled", enabled);
    $("#notificationButton").title = enabled ? "Notifications enabled" : "Notification settings";
  }

  function openPermissionModal() {
    $("#permissionModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closePermissionModal() {
    $("#permissionModal").hidden = true;
    document.body.style.overflow = "";
  }

  async function enableNotifications() {
    const result = await TaskoNotifications.requestPermission();
    localStorage.setItem("tasko_notification_prompted", "true");
    closePermissionModal();
    updatePermissionUI();
    if (result === "granted") showToast("Notifications are ready");
    else if (result === "denied") showToast("In-app reminders will still appear");
    else showToast("Notifications are not supported here");
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === "dark";
    $(".theme-icon").textContent = dark ? "☀" : "☾";
    $(".theme-label").textContent = dark ? "Light mode" : "Dark mode";
    $("#themeToggle").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    $("#headerThemeToggle").textContent = dark ? "☀" : "☾";
    $("#headerThemeToggle").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = dark ? "#171923" : "#6c5ce7";
  }

  function toggleTheme() {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("tasko_theme", theme);
    applyTheme(theme);
  }

  function formatNotesAsList(type) {
    const textarea = $("#taskNotes");
    const value = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const nextBreak = value.indexOf("\n", selectionEnd);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    const nonEmptyLines = lines.filter(line => line.trim());
    const markerPattern = type === "bullet" ? /^\s*-\s+/ : /^\s*\d+\.\s+/;
    const shouldRemove = nonEmptyLines.length > 0 && nonEmptyLines.every(line => markerPattern.test(line));
    let number = 1;
    const formatted = lines.map(line => {
      const indent = line.match(/^\s*/)?.[0] || "";
      const content = line.slice(indent.length).replace(/^(?:-|\d+\.)\s*/, "");
      if (shouldRemove) return `${indent}${content}`;
      const marker = type === "bullet" ? "-" : `${number++}.`;
      return `${indent}${marker} ${content}`;
    }).join("\n");
    if (value.length - (lineEnd - lineStart) + formatted.length > textarea.maxLength) {
      showToast("The formatted note would exceed 600 characters");
      return;
    }
    textarea.setRangeText(formatted, lineStart, lineEnd, "select");
    textarea.focus();
  }

  function continueNoteList(event) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey) return;
    const textarea = event.currentTarget;
    const caret = textarea.selectionStart;
    if (caret !== textarea.selectionEnd) return;
    const lineStart = textarea.value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
    const currentLine = textarea.value.slice(lineStart, caret);
    const match = currentLine.match(/^(\s*)(-|\d+\.)\s?(.*)$/);
    if (!match) return;
    event.preventDefault();
    if (!match[3].trim()) {
      textarea.setRangeText("", lineStart, caret, "end");
      return;
    }
    const marker = match[2] === "-" ? "-" : `${Number.parseInt(match[2], 10) + 1}.`;
    textarea.setRangeText(`\n${match[1]}${marker} `, caret, caret, "end");
  }

  function addRipple(event) {
    if (window.innerWidth <= 720) return;
    const button = event.target.closest(".ripple-button");
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    button.append(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  function progressDragAfterElement(container, y) {
    return [...container.querySelectorAll(".progress-task-card:not(.dragging)")]
      .reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        return closest;
      }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  function beginProgressDrag(event) {
    const handle = event.target.closest(".drag-handle");
    if (!handle) return;
    const card = handle.closest(".progress-task-card");
    const stack = card?.closest(".progress-card-stack");
    if (!card || !stack) return;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    state.progressDrag = { card, stack, pointerId: event.pointerId, startY: event.clientY, moved: false };
    card.classList.add("dragging");
    document.body.classList.add("is-dragging-progress");
  }

  function moveProgressDrag(event) {
    const drag = state.progressDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (Math.abs(event.clientY - drag.startY) > 4) drag.moved = true;
    const after = progressDragAfterElement(drag.stack, event.clientY);
    if (after) drag.stack.insertBefore(drag.card, after);
    else drag.stack.append(drag.card);
  }

  async function endProgressDrag(event) {
    const drag = state.progressDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.card.classList.remove("dragging");
    document.body.classList.remove("is-dragging-progress");
    state.suppressProgressClick = drag.moved;
    const updates = [];
    $$(".progress-card-stack").forEach(stack => {
      [...stack.querySelectorAll(".progress-task-card")].forEach((card, index) => {
        const task = state.tasks.find(item => item.id === card.dataset.id);
        if (task && task.progressOrder !== index + 1) {
          task.progressOrder = index + 1;
          updates.push(TaskoDB.put(task));
        }
      });
    });
    state.progressDrag = null;
    await Promise.all(updates);
    if (state.suppressProgressClick) setTimeout(() => { state.suppressProgressClick = false; }, 0);
  }

  function bindEvents() {
    document.addEventListener("pointerdown", TaskoNotifications.unlockAudio, { once: true });
    document.addEventListener("click", event => {
      addRipple(event);
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) setView(viewButton.dataset.view);
      if (event.target.closest("[data-open-task-modal]")) openTaskModal();
      if (event.target.closest("[data-open-progress-modal]")) openTaskModal(null, "progress");
      if (event.target.closest("[data-close-modal]")) closeTaskModal();
      if (event.target.closest("[data-close-note-preview]")) closeNotePreview();
      if (event.target.closest("[data-close-penalty-snooze]")) closePenaltySnoozeModal();
    });

    $("#taskList").addEventListener("click", event => {
      const button = event.target.closest("[data-action]");
      const card = event.target.closest(".task-card");
      if (!card) return;
      const task = state.tasks.find(item => item.id === card.dataset.id);
      if (!task) return;
      if (button) {
        if (button.dataset.action === "toggle") toggleTask(task, card);
        if (button.dataset.action === "edit") openTaskModal(task);
        if (button.dataset.action === "delete") deleteTask(task, card);
        if (button.dataset.action === "penalty-snooze") openPenaltySnoozeModal(task);
        return;
      }
      if (notesNeedPreview(task)) openNotePreview(task);
    });

    $("#progressList").addEventListener("click", event => {
      if (state.suppressProgressClick) return;
      if (event.target.closest(".drag-handle")) return;
      const task = cardTaskFromEvent(event);
      if (!task) return;
      const card = event.target.closest(".progress-task-card");
      const deltaButton = event.target.closest("[data-progress-delta]");
      const doneButton = event.target.closest("[data-progress-done]");
      if (deltaButton) { updateProgressTask(task, Number(deltaButton.dataset.progressDelta)); return; }
      if (doneButton) { finishProgressTask(task); return; }
      if (event.target.closest("[data-progress-edit]")) { openTaskModal(task, "progress"); return; }
      if (event.target.closest("[data-progress-delete]")) { deleteTask(task, card); return; }
      if (notesNeedPreview(task)) openNotePreview(task);
    });
    $("#progressList").addEventListener("pointerdown", beginProgressDrag);
    $("#progressList").addEventListener("pointermove", moveProgressDrag);
    $("#progressList").addEventListener("pointerup", endProgressDrag);
    $("#progressList").addEventListener("pointercancel", endProgressDrag);

    $("#taskForm").addEventListener("submit", saveTask);
    $(".notes-tools").addEventListener("click", event => {
      const button = event.target.closest("[data-notes-format]");
      if (button) formatNotesAsList(button.dataset.notesFormat);
    });
    $("#taskNotes").addEventListener("keydown", continueNoteList);
    $("#searchInput").addEventListener("input", event => { state.query = event.target.value; render(); });
    $("#priorityFilter").addEventListener("change", event => { state.priority = event.target.value; render(); });
    $("#sortSelect").addEventListener("change", event => { state.sort = event.target.value; render(); });
    $("#themeToggle").addEventListener("click", toggleTheme);
    $("#headerThemeToggle").addEventListener("click", toggleTheme);

    $("#notificationButton").addEventListener("click", openPermissionModal);
    $("#permissionLater").addEventListener("click", () => {
      localStorage.setItem("tasko_notification_prompted", "true");
      closePermissionModal();
    });
    $("#enableNotifications").addEventListener("click", enableNotifications);
    $("#penaltySnoozeOptions").addEventListener("click", event => {
      const button = event.target.closest("[data-snooze-days]");
      if (button) snoozePenalty(Number(button.dataset.snoozeDays));
    });
    $("#reminderStack").addEventListener("click", event => {
      const button = event.target.closest("[data-reminder]");
      if (button) handleReminderAction(button);
    });
    $("#toastClose").addEventListener("click", hideToast);

    $$(".modal-backdrop").forEach(backdrop => backdrop.addEventListener("click", event => {
      if (event.target !== backdrop) return;
      if (backdrop.id === "taskModal") closeTaskModal();
      if (backdrop.id === "permissionModal") closePermissionModal();
      if (backdrop.id === "notePreviewModal") closeNotePreview();
      if (backdrop.id === "penaltySnoozeModal") closePenaltySnoozeModal();
    }));

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") { closeTaskModal(); closePermissionModal(); closeNotePreview(); closePenaltySnoozeModal(); }
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        event.preventDefault();
        $(".search-box").classList.add("expanded");
        $("#searchInput").focus();
      }
    });

    window.addEventListener("popstate", () => {
      if (state.notePreviewOpen) closeNotePreview(true);
    });

    $(".search-box > span:first-child").addEventListener("click", () => {
      if (window.innerWidth <= 720) {
        $(".search-box").classList.toggle("expanded");
        $("#searchInput").focus();
      }
    });
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    try { await navigator.serviceWorker.register("./service-worker.js"); }
    catch (error) { console.warn("Tasko's offline worker could not be registered.", error); }
  }

  async function init() {
    const storedTheme = localStorage.getItem("tasko_theme");
    applyTheme(storedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    state.stars = safeNumber(STAR_STORAGE_KEY);
    state.lifetimeStars = Math.max(safeNumber(LIFETIME_STAR_STORAGE_KEY), state.stars);
    state.cycleTaskCount = safeNumber(CYCLE_TASK_STORAGE_KEY);
    state.cycleStartedAt = localStorage.getItem(CYCLE_STARTED_STORAGE_KEY);
    state.cyclesCompleted = safeNumber(CYCLE_COUNT_STORAGE_KEY);
    localStorage.setItem(LIFETIME_STAR_STORAGE_KEY, String(state.lifetimeStars));
    if (state.stars > 0 && !state.cycleStartedAt) {
      state.cycleStartedAt = new Date().toISOString();
      localStorage.setItem(CYCLE_STARTED_STORAGE_KEY, state.cycleStartedAt);
    }
    state.logs = loadLogs();
    state.cleanupCount = safeNumber(CLEANUP_STORAGE_KEY);
    bindEvents();
    await TaskoDB.init();
    state.tasks = await TaskoDB.seedIfNeeded();
    await cleanupExpiredCompletedTasks();

    const params = new URLSearchParams(location.search);
    if (params.get("view") === "upcoming") state.view = "today";
    else if (viewCopy[params.get("view")]) state.view = params.get("view");
    render();
    updateStarUI();
    if (state.stars >= STAR_CYCLE_TARGET) {
      if (!state.cycleTaskCount) state.cycleTaskCount = state.tasks.filter(task => task.rewardGranted).length;
      completeStarCycle(state.stars, 0);
    }
    updatePermissionUI();
    registerServiceWorker();

    if (params.get("action") === "new") setTimeout(() => openTaskModal(), 250);
    if (!localStorage.getItem("tasko_notification_prompted") && TaskoNotifications.permission() === "default") {
      setTimeout(openPermissionModal, 900);
    }

    await checkReminders();
    setInterval(updateCountdowns, 1000);
    setInterval(checkReminders, 30000);
    setInterval(() => {
      if ((state.view === "progress" || state.view === "completed") && state.tasks.some(isProgressTask)) render();
    }, 60000);
    setInterval(async () => {
      if (await cleanupExpiredCompletedTasks()) render();
    }, HOUR_MS);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
