(function () {
  "use strict";

  let audioContext = null;

  function permission() {
    return "Notification" in window ? Notification.permission : "unsupported";
  }

  async function requestPermission() {
    if (!("Notification" in window)) return "unsupported";
    try { return await Notification.requestPermission(); }
    catch (error) { console.warn("Notification permission could not be requested.", error); return Notification.permission; }
  }

  async function showBrowserNotification(task) {
    if (permission() !== "granted") return false;
    const options = {
      body: task.notes || `“${task.title}” is due now.`,
      icon: "icons/icon-192.svg",
      badge: "icons/icon-192.svg",
      tag: `tasko-${task.id}`,
      renotify: true,
      requireInteraction: true,
      data: { taskId: task.id, url: "./index.html" },
      actions: [
        { action: "open", title: "Open Tasko" },
        { action: "dismiss", title: "Dismiss" }
      ]
    };

    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification("Tasko reminder", options);
      } else {
        new Notification("Tasko reminder", options);
      }
      return true;
    } catch (error) {
      console.warn("Browser notification could not be shown.", error);
      return false;
    }
  }

  function unlockAudio() {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
    } catch (error) {
      console.warn("Tasko could not prepare reminder audio.", error);
    }
  }

  function playAlert() {
    try {
      unlockAudio();
      const now = audioContext.currentTime;
      [0, 0.18, 0.36].forEach((offset, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime([659, 784, 988][index], now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.18);
      });
    } catch (error) {
      console.warn("Tasko could not play the reminder sound.", error);
    }
  }

  window.TaskoNotifications = { permission, requestPermission, showBrowserNotification, playAlert, unlockAudio };
})();
