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
    confettiPlayed: false
  };

  const viewCopy = {
    today: ["Today", "A clear view of what matters now."],
    upcoming: ["Upcoming", "See what is waiting around the corner."],
    overdue: ["Overdue", "A gentle nudge to bring these back on track."],
    completed: ["Completed", "Small wins add up. Here are yours."]
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const pad = number => String(number).padStart(2, "0");

  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
    if (state.view === "completed") return task.completed;
    if (state.view === "overdue") return isOverdue(task);
    if (state.view === "upcoming") return isUpcoming(task);
    return isTodayTask(task);
  }

  function dueValue(task) {
    const deadline = parseDeadline(task);
    return deadline ? deadline.getTime() : Number.MAX_SAFE_INTEGER;
  }

  function visibleTasks() {
    const priorityWeight = { urgent: 4, high: 3, medium: 2, low: 1 };
    const query = state.query.trim().toLowerCase();
    const tasks = state.tasks.filter(task => {
      if (!taskMatchesView(task)) return false;
      if (state.priority !== "all" && task.priority !== state.priority) return false;
      if (!query) return true;
      return [task.title, task.notes, task.category, task.priority].some(value => (value || "").toLowerCase().includes(query));
    });

    return tasks.sort((a, b) => {
      if (state.sort === "due-desc") return dueValue(b) - dueValue(a);
      if (state.sort === "priority") return priorityWeight[b.priority] - priorityWeight[a.priority] || dueValue(a) - dueValue(b);
      if (state.sort === "created") return new Date(b.createdAt) - new Date(a.createdAt);
      return dueValue(a) - dueValue(b);
    });
  }

  function formatDate(task) {
    if (!task.dueDate) return "No due date";
    const [year, month, day] = task.dueDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (task.dueDate === dateKey()) return "Today";
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (task.dueDate === dateKey(tomorrow)) return "Tomorrow";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(year !== new Date().getFullYear() && { year: "numeric" }) });
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

  function buildTaskCard(task, index) {
    const card = $("#taskCardTemplate").content.firstElementChild.cloneNode(true);
    card.dataset.id = task.id;
    card.style.animationDelay = `${Math.min(index * 35, 210)}ms`;
    if (task.completed) card.classList.add("completed");

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
    if (task.completedAt) meta.append(createMetaChip(`✓ ${new Date(task.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`));

    const countdown = card.querySelector(".countdown");
    countdown.dataset.taskId = task.id;
    const countdownState = countdownInfo(task);
    countdown.textContent = countdownState.text;
    if (countdownState.className) countdown.classList.add(countdownState.className);
    if (!countdownState.text) countdown.hidden = true;
    return card;
  }

  function render() {
    const tasks = visibleTasks();
    const list = $("#taskList");
    list.replaceChildren(...tasks.map(buildTaskCard));
    $("#resultCount").textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
    $("#emptyState").hidden = tasks.length > 0;
    list.hidden = tasks.length === 0;

    const emptyMessages = {
      today: "Your day is open. Add a task when inspiration strikes.",
      upcoming: "No future deadlines are waiting for you.",
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
    const active = state.tasks.filter(task => !task.completed);
    const overdue = active.filter(task => isOverdue(task));
    const upcoming = active.filter(task => isUpcoming(task));
    const todayTasks = state.tasks.filter(task => !task.dueDate || task.dueDate === today);
    const todayDone = todayTasks.filter(task => task.completed).length;
    const completedToday = state.tasks.filter(task => task.completedAt && dateKey(new Date(task.completedAt)) === today).length;
    const progress = todayTasks.length ? Math.round((todayDone / todayTasks.length) * 100) : 0;

    $("#statTotal").textContent = state.tasks.length;
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
      today: active.filter(isTodayTask).length,
      upcoming: upcoming.length,
      overdue: overdue.length,
      completed: state.tasks.filter(task => task.completed).length
    };
    Object.entries(counts).forEach(([key, value]) => {
      const counter = $(`[data-count="${key}"]`);
      if (counter) counter.textContent = value;
    });
  }

  function setView(view) {
    if (!viewCopy[view]) return;
    state.view = view;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openTaskModal(task = null) {
    const form = $("#taskForm");
    form.reset();
    $("#taskId").value = task?.id || "";
    $("#taskModalTitle").textContent = task ? "Edit task" : "Add a task";
    $("#saveTaskButton").textContent = task ? "Save changes" : "Create task";
    if (task) {
      $("#taskTitle").value = task.title;
      $("#taskNotes").value = task.notes || "";
      $("#taskDate").value = task.dueDate || "";
      $("#taskTime").value = task.dueTime || "";
      $("#taskPriority").value = task.priority || "medium";
      $("#taskCategory").value = task.category || "";
    } else {
      $("#taskDate").value = state.view === "today" ? dateKey() : "";
      $("#taskPriority").value = "medium";
    }
    $("#taskModal").hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => $("#taskTitle").focus());
  }

  function closeTaskModal() {
    $("#taskModal").hidden = true;
    document.body.style.overflow = "";
  }

  async function saveTask(event) {
    event.preventDefault();
    const id = $("#taskId").value;
    const existing = state.tasks.find(task => task.id === id);
    const dueDate = $("#taskDate").value;
    const dueTime = $("#taskTime").value;
    const deadlineChanged = existing && (existing.dueDate !== dueDate || existing.dueTime !== dueTime);
    const now = new Date().toISOString();
    const task = {
      id: id || TaskoDB.makeId(),
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
      reminderFiredAt: deadlineChanged ? null : (existing?.reminderFiredAt || null)
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
    if (becomingComplete) card?.classList.add("is-completing");
    task.completed = becomingComplete;
    task.completedAt = becomingComplete ? new Date().toISOString() : null;
    await TaskoDB.put(task);

    const finish = () => {
      render();
      showToast(becomingComplete ? "Nice — task completed" : "Task restored");
      if (becomingComplete) maybeCelebrate();
    };
    becomingComplete ? setTimeout(finish, 480) : finish();
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
    const todayTasks = state.tasks.filter(task => !task.dueDate || task.dueDate === dateKey());
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
    $$(".countdown[data-task-id]").forEach(element => {
      const task = state.tasks.find(item => item.id === element.dataset.taskId);
      if (!task) return;
      const info = countdownInfo(task);
      element.textContent = info.text;
      element.hidden = !info.text;
      element.classList.remove("near", "due", "overdue");
      if (info.className) element.classList.add(info.className);
    });
  }

  async function checkReminders() {
    const now = new Date();
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
    render();
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
      await TaskoDB.put(task);
      showToast("Snoozed for 5 minutes");
      render();
    } else if (action === "done") {
      await toggleTask(task, null);
    }
    dismissReminder(task.id);
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

  function addRipple(event) {
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

  function bindEvents() {
    document.addEventListener("pointerdown", TaskoNotifications.unlockAudio, { once: true });
    document.addEventListener("click", event => {
      addRipple(event);
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) setView(viewButton.dataset.view);
      if (event.target.closest("[data-open-task-modal]")) openTaskModal();
      if (event.target.closest("[data-close-modal]")) closeTaskModal();
    });

    $("#taskList").addEventListener("click", event => {
      const button = event.target.closest("[data-action]");
      const card = event.target.closest(".task-card");
      if (!button || !card) return;
      const task = state.tasks.find(item => item.id === card.dataset.id);
      if (!task) return;
      if (button.dataset.action === "toggle") toggleTask(task, card);
      if (button.dataset.action === "edit") openTaskModal(task);
      if (button.dataset.action === "delete") deleteTask(task, card);
    });

    $("#taskForm").addEventListener("submit", saveTask);
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
    $("#reminderStack").addEventListener("click", event => {
      const button = event.target.closest("[data-reminder]");
      if (button) handleReminderAction(button);
    });
    $("#toastClose").addEventListener("click", hideToast);

    $$(".modal-backdrop").forEach(backdrop => backdrop.addEventListener("click", event => {
      if (event.target !== backdrop) return;
      if (backdrop.id === "taskModal") closeTaskModal();
      if (backdrop.id === "permissionModal") closePermissionModal();
    }));

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") { closeTaskModal(); closePermissionModal(); }
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        event.preventDefault();
        $(".search-box").classList.add("expanded");
        $("#searchInput").focus();
      }
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
    bindEvents();
    await TaskoDB.init();
    state.tasks = await TaskoDB.seedIfNeeded();

    const params = new URLSearchParams(location.search);
    if (viewCopy[params.get("view")]) state.view = params.get("view");
    render();
    updatePermissionUI();
    registerServiceWorker();

    if (params.get("action") === "new") setTimeout(() => openTaskModal(), 250);
    if (!localStorage.getItem("tasko_notification_prompted") && TaskoNotifications.permission() === "default") {
      setTimeout(openPermissionModal, 900);
    }

    await checkReminders();
    setInterval(updateCountdowns, 1000);
    setInterval(checkReminders, 30000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
