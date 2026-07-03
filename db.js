(function () {
  "use strict";

  const DB_NAME = "tasko-db";
  const DB_VERSION = 1;
  const STORE_NAME = "tasks";
  const FALLBACK_KEY = "tasko_tasks_v1";
  const SEEDED_KEY = "tasko_seeded_v1";
  let database = null;
  let usingFallback = false;

  function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function localDate(offsetDays = 0) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function fallbackRead() {
    try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]"); }
    catch (error) { console.warn("Tasko could not read fallback storage.", error); return []; }
  }

  function fallbackWrite(tasks) {
    try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(tasks)); }
    catch (error) { console.error("Tasko could not save to fallback storage.", error); }
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function init() {
    if (!window.indexedDB) {
      usingFallback = true;
      return { fallback: true };
    }

    try {
      database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
            store.createIndex("dueDate", "dueDate", { unique: false });
            store.createIndex("completed", "completed", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("IndexedDB is blocked"));
      });
      database.onversionchange = () => database.close();
      return { fallback: false };
    } catch (error) {
      console.warn("IndexedDB is unavailable; Tasko is using localStorage.", error);
      usingFallback = true;
      return { fallback: true };
    }
  }

  async function getAll() {
    if (usingFallback || !database) return fallbackRead();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      return await requestToPromise(transaction.objectStore(STORE_NAME).getAll());
    } catch (error) {
      console.warn("IndexedDB read failed; switching to fallback storage.", error);
      usingFallback = true;
      return fallbackRead();
    }
  }

  async function put(task) {
    const record = { ...task, updatedAt: new Date().toISOString() };
    if (usingFallback || !database) {
      const tasks = fallbackRead();
      const index = tasks.findIndex(item => item.id === record.id);
      if (index >= 0) tasks[index] = record; else tasks.push(record);
      fallbackWrite(tasks);
      return record;
    }
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      await requestToPromise(transaction.objectStore(STORE_NAME).put(record));
      // Keep a small mirror so a later IndexedDB failure can fall back without data loss.
      const mirror = fallbackRead();
      const mirrorIndex = mirror.findIndex(item => item.id === record.id);
      if (mirrorIndex >= 0) mirror[mirrorIndex] = record; else mirror.push(record);
      fallbackWrite(mirror);
      return record;
    } catch (error) {
      console.warn("IndexedDB write failed; saving to fallback storage.", error);
      usingFallback = true;
      return put(record);
    }
  }

  async function remove(id) {
    if (usingFallback || !database) {
      fallbackWrite(fallbackRead().filter(task => task.id !== id));
      return;
    }
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      await requestToPromise(transaction.objectStore(STORE_NAME).delete(id));
      fallbackWrite(fallbackRead().filter(task => task.id !== id));
    } catch (error) {
      console.warn("IndexedDB delete failed; using fallback storage.", error);
      usingFallback = true;
      return remove(id);
    }
  }

  async function seedIfNeeded() {
    const existing = await getAll();
    if (existing.length || localStorage.getItem(SEEDED_KEY)) return existing;

    const now = new Date().toISOString();
    const samples = [
      { id: makeId(), title: "Plan the day with Tasko", notes: "Try completing this task — a tiny win to get started.", dueDate: localDate(0), dueTime: "09:30", priority: "high", category: "Personal", completed: false, createdAt: now, updatedAt: now, completedAt: null, reminderFiredAt: null },
      { id: makeId(), title: "Review project notes", notes: "Collect the three most important next steps.", dueDate: localDate(0), dueTime: "15:00", priority: "medium", category: "Work", completed: false, createdAt: now, updatedAt: now, completedAt: null, reminderFiredAt: null },
      { id: makeId(), title: "Take a mindful walk", notes: "Ten minutes, no phone required.", dueDate: localDate(1), dueTime: "18:30", priority: "low", category: "Health", completed: false, createdAt: now, updatedAt: now, completedAt: null, reminderFiredAt: null },
      { id: makeId(), title: "Explore Tasko's offline mode", notes: "Disconnect from the internet and refresh the app after its first load.", dueDate: localDate(3), dueTime: "11:00", priority: "medium", category: "Learning", completed: false, createdAt: now, updatedAt: now, completedAt: null, reminderFiredAt: null }
    ];

    for (const task of samples) await put(task);
    localStorage.setItem(SEEDED_KEY, "true");
    return samples;
  }

  window.TaskoDB = { init, getAll, put, remove, seedIfNeeded, makeId, isFallback: () => usingFallback };
})();
