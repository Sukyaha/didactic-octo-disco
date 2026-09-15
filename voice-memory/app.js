const STORAGE_KEY = "voice-memory-v1";
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const els = {
  chips: document.getElementById("chips"),
  addSub: document.getElementById("add-sub"),
  feed: document.getElementById("feed"),
  mic: document.getElementById("mic"),
  hint: document.getElementById("hint"),
  live: document.getElementById("live"),
  status: document.getElementById("status"),
  toast: document.getElementById("toast"),
  exportTxt: document.getElementById("export-txt"),
  exportJson: document.getElementById("export-json"),
  dialog: document.getElementById("sub-dialog"),
  form: document.getElementById("sub-form"),
  subName: document.getElementById("sub-name"),
};

const defaultState = () => ({
  activeId: "inbox",
  subscriptions: [{ id: "inbox", name: "Inbox", createdAt: Date.now() }],
  notes: [],
});

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    if (!data.subscriptions?.length) return defaultState();
    return {
      activeId: data.activeId || data.subscriptions[0].id,
      subscriptions: data.subscriptions,
      notes: Array.isArray(data.notes) ? data.notes : [],
    };
  } catch {
    return defaultState();
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = load();
let recognition = null;
let listening = false;
let finalBuffer = "";
let toastTimer = 0;

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toast(message) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

function currentSub() {
  return state.subscriptions.find((s) => s.id === state.activeId) || state.subscriptions[0];
}

function visibleNotes() {
  if (state.activeId === "all") return [...state.notes].sort((a, b) => b.createdAt - a.createdAt);
  return state.notes
    .filter((n) => n.subscriptionId === state.activeId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function subName(id) {
  return state.subscriptions.find((s) => s.id === id)?.name || "Inbox";
}

function renderChips() {
  const items = [{ id: "all", name: "All" }, ...state.subscriptions];
  els.chips.innerHTML = items
    .map((s) => {
      const active = s.id === state.activeId ? "active" : "";
      const canDelete = s.id !== "all" && s.id !== "inbox";
      return `<button type="button" class="chip ${active}" data-id="${s.id}">
        ${escapeHtml(s.name)}${canDelete ? ` <span data-del="${s.id}" title="Remove">×</span>` : ""}
      </button>`;
    })
    .join("");
}

function renderFeed() {
  const notes = visibleNotes();
  if (!notes.length) {
    els.feed.innerHTML = `<div class="empty">No notes here yet.<br />Tap the mic and speak a memory.</div>`;
    return;
  }
  els.feed.innerHTML = notes
    .map((n) => {
      const when = new Date(n.createdAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      return `<article class="note" data-note="${n.id}">
        <div class="note-meta">
          <span>${escapeHtml(subName(n.subscriptionId))}</span>
          <span>${when}</span>
        </div>
        <p>${escapeHtml(n.text)}</p>
        <div class="note-actions">
          <button type="button" class="icon-btn" data-play="${n.id}">Play</button>
          <button type="button" class="icon-btn danger" data-delete="${n.id}">Delete</button>
        </div>
      </article>`;
    })
    .join("");
}

function render() {
  renderChips();
  renderFeed();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function addNote(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return;
  const subscriptionId = state.activeId === "all" ? "inbox" : currentSub().id;
  state.notes.unshift({
    id: uid(),
    subscriptionId,
    text: cleaned,
    createdAt: Date.now(),
  });
  save();
  render();
  toast("Saved on this device");
}

function deleteNote(id) {
  state.notes = state.notes.filter((n) => n.id !== id);
  save();
  render();
}

function speak(text) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => /en[-_]US/i.test(v.lang) && /google|natural|premium/i.test(v.name)) ||
    voices.find((v) => /en/i.test(v.lang));
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
  els.status.textContent = "Playing";
  utterance.onend = () => {
    if (!listening) els.status.textContent = "Ready";
  };
}

function setListening(on) {
  listening = on;
  els.mic.classList.toggle("listening", on);
  els.mic.setAttribute("aria-pressed", String(on));
  els.mic.setAttribute("aria-label", on ? "Stop listening" : "Start listening");
  els.live.hidden = !on;
  els.status.textContent = on ? "Listening…" : "Ready";
  els.hint.textContent = on
    ? "Tap the mic again to save."
    : "Tap the mic, then speak. Chrome or Edge works best.";
}

function ensureRecognition() {
  if (recognition) return recognition;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) finalBuffer += `${result[0].transcript} `;
      else interim += result[0].transcript;
    }
    els.live.hidden = false;
    els.live.textContent = `${finalBuffer}${interim}`.trim();
  };

  recognition.onerror = (event) => {
    if (event.error === "no-speech" || event.error === "aborted") return;
    if (event.error === "not-allowed") {
      toast("Microphone permission blocked");
      els.hint.textContent = "Allow the mic in the browser address bar, then try again.";
    } else {
      toast(`Mic error: ${event.error}`);
    }
    stopListening(false);
  };

  recognition.onend = () => {
    if (listening) {
      try {
        recognition.start();
      } catch {
        /* Chrome may throw if a restart races */
      }
    }
  };

  return recognition;
}

function startListening() {
  if (!SpeechRecognition) return;
  finalBuffer = "";
  els.live.textContent = "";
  setListening(true);
  try {
    navigator.vibrate?.(20);
    ensureRecognition().start();
  } catch {
    toast("Could not start the microphone");
    setListening(false);
  }
}

function stopListening(saveNote = true) {
  const text = (els.live.textContent || finalBuffer).trim();
  setListening(false);
  try {
    recognition?.stop();
  } catch {
    /* already stopped */
  }
  if (saveNote) addNote(text);
}

function download(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJson() {
  download(
    `voice-memory-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(state, null, 2),
    "application/json"
  );
}

function exportTxt() {
  const lines = [
    "Voice Memory export",
    `Exported ${new Date().toLocaleString()}`,
    "",
  ];
  for (const sub of state.subscriptions) {
    const notes = state.notes.filter((n) => n.subscriptionId === sub.id);
    lines.push(`# ${sub.name}`);
    if (!notes.length) lines.push("(empty)", "");
    for (const note of notes.sort((a, b) => b.createdAt - a.createdAt)) {
      lines.push(`- ${new Date(note.createdAt).toLocaleString()}`);
      lines.push(note.text, "");
    }
  }
  download(
    `voice-memory-${new Date().toISOString().slice(0, 10)}.txt`,
    lines.join("\n"),
    "text/plain"
  );
}

els.chips.addEventListener("click", (event) => {
  const del = event.target.closest("[data-del]");
  if (del) {
    const id = del.dataset.del;
    state.subscriptions = state.subscriptions.filter((s) => s.id !== id);
    state.notes = state.notes.map((n) =>
      n.subscriptionId === id ? { ...n, subscriptionId: "inbox" } : n
    );
    if (state.activeId === id) state.activeId = "inbox";
    save();
    render();
    return;
  }
  const chip = event.target.closest("[data-id]");
  if (!chip) return;
  state.activeId = chip.dataset.id;
  save();
  render();
});

els.addSub.addEventListener("click", () => {
  els.subName.value = "";
  els.dialog.showModal();
  els.subName.focus();
});

document.getElementById("sub-cancel").addEventListener("click", () => els.dialog.close());

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = els.subName.value.trim();
  if (!name) return;
  const sub = { id: uid(), name, createdAt: Date.now() };
  state.subscriptions.push(sub);
  state.activeId = sub.id;
  save();
  render();
  els.dialog.close();
});

els.feed.addEventListener("click", (event) => {
  const play = event.target.closest("[data-play]");
  const del = event.target.closest("[data-delete]");
  if (play) {
    const note = state.notes.find((n) => n.id === play.dataset.play);
    if (note) speak(note.text);
  }
  if (del) deleteNote(del.dataset.delete);
});

els.mic.addEventListener("click", () => {
  if (!SpeechRecognition) {
    toast("Use Chrome or Edge for the microphone");
    return;
  }
  if (listening) stopListening(true);
  else startListening();
});

els.exportTxt.addEventListener("click", exportTxt);
els.exportJson.addEventListener("click", exportJson);

if (!SpeechRecognition) {
  els.mic.classList.add("unsupported");
  els.hint.textContent = "Speech recognition needs Chrome or Edge on HTTPS.";
  els.status.textContent = "Mic unavailable";
  els.feed.insertAdjacentHTML(
    "beforebegin",
    `<p class="banner">This browser cannot transcribe speech. Open this page in Chrome or Edge, and keep HTTPS on so the mic can run.</p>`
  );
} else if (location.protocol !== "https:" && location.hostname !== "localhost") {
  els.hint.textContent = "Microphone needs HTTPS. Open the GitHub Pages link.";
}

window.speechSynthesis?.getVoices?.();
render();
