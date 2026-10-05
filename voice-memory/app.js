const STORAGE_KEY = "voice-memory-v1";
const HELPER_KEY = "voice-memory-helper";
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const HELPERS = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "grok", name: "Grok", url: "https://grok.com/" },
  { id: "claude", name: "Claude", url: "https://claude.ai/new" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app" },
];

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
  sendNotes: document.getElementById("send-notes"),
  service: document.getElementById("handoff-service"),
  search: document.getElementById("search"),
  dialog: document.getElementById("sub-dialog"),
  form: document.getElementById("sub-form"),
  subName: document.getElementById("sub-name"),
  copyDialog: document.getElementById("copy-dialog"),
  copyTitle: document.getElementById("copy-title"),
  copyHelp: document.getElementById("copy-help"),
  copyText: document.getElementById("copy-text"),
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

function loadHelperId() {
  try {
    const id = localStorage.getItem(HELPER_KEY);
    if (HELPERS.some((helper) => helper.id === id)) return id;
  } catch {
    /* private mode or blocked storage */
  }
  return "chatgpt";
}

function currentHelper() {
  return HELPERS.find((helper) => helper.id === helperId) || HELPERS[0];
}

function sendLabel() {
  return `Send to ${currentHelper().name}`;
}

function applyHelperLabels() {
  const helper = currentHelper();
  const label = sendLabel();
  els.service.value = helper.id;
  els.sendNotes.textContent = label;
  els.sendNotes.title = `Copy visible notes and open ${helper.name}. Paste them in and press send.`;
  document.querySelectorAll("[data-send]").forEach((button) => {
    button.textContent = label;
  });
}

function setHelper(id) {
  if (!HELPERS.some((helper) => helper.id === id)) return;
  helperId = id;
  try {
    localStorage.setItem(HELPER_KEY, id);
  } catch {
    /* the choice still applies for this visit */
  }
  applyHelperLabels();
}

let state = load();
let helperId = loadHelperId();
let recognition = null;
let listening = false;
let finalBuffer = "";
let toastTimer = 0;
let query = "";

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toast(message) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4000);
}

function currentSub() {
  return state.subscriptions.find((s) => s.id === state.activeId) || state.subscriptions[0];
}

function visibleNotes() {
  const q = query.trim().toLowerCase();
  let notes =
    state.activeId === "all"
      ? [...state.notes]
      : state.notes.filter((n) => n.subscriptionId === state.activeId);
  if (q) notes = notes.filter((n) => n.text.toLowerCase().includes(q) || subName(n.subscriptionId).toLowerCase().includes(q));
  return notes.sort((a, b) => b.createdAt - a.createdAt);
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
    els.feed.innerHTML = `<div class="empty">No notes here yet.<br />Speak, paste, or drop a file. We only hand notes to your AI helper.</div>`;
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
          <button type="button" class="icon-btn" data-copy="${n.id}">Copy</button>
          <button type="button" class="icon-btn" data-send="${n.id}">${escapeHtml(sendLabel())}</button>
          <button type="button" class="icon-btn danger" data-delete="${n.id}">Delete</button>
        </div>
      </article>`;
    })
    .join("");
}

function render() {
  renderChips();
  renderFeed();
  applyHelperLabels();
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

function notesAsPrompt(notes = visibleNotes()) {
  if (!notes.length) return "";
  const lines = [
    "These are notes from Voice Memory on my desktop.",
    "Please help with them — organize, answer, or turn them into next steps.",
    "",
  ];
  for (const note of notes) {
    lines.push(`[${subName(note.subscriptionId)} · ${new Date(note.createdAt).toLocaleString()}]`);
    lines.push(note.text, "");
  }
  return lines.join("\n");
}

async function writeClipboard(text) {
  if (!text || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function copyText(text) {
  if (await writeClipboard(text)) return true;
  try {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function showCopyFallback(text, title, help) {
  els.copyTitle.textContent = title;
  els.copyHelp.textContent = help;
  els.copyText.value = text;
  if (!els.copyDialog.open) els.copyDialog.showModal();
  els.copyText.focus();
  els.copyText.select();
}

function helperPageUrl(helper) {
  const url = new URL(helper.url);
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function handoffNotes(text) {
  if (!text) {
    toast("Nothing to send yet");
    return;
  }
  const helper = currentHelper();
  const copied = await writeClipboard(text);
  if (!copied) {
    showCopyFallback(
      text,
      `Copy for ${helper.name}`,
      `Select the text and copy it, then paste into ${helper.name} and press send.`
    );
  }
  window.open(helperPageUrl(helper), "_blank", "noopener");
  if (copied) toast(`Copied. Paste into ${helper.name} and press send.`);
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

function readyHint() {
  return window.matchMedia("(min-width: 980px)").matches
    ? "Click the mic or press Space. Paste or drop files. Send hands notes to your AI helper."
    : "Tap the mic, then speak. Chrome or Edge works best.";
}

function setListening(on) {
  listening = on;
  els.mic.classList.toggle("listening", on);
  els.mic.setAttribute("aria-pressed", String(on));
  els.mic.setAttribute("aria-label", on ? "Stop listening" : "Start listening");
  els.live.hidden = !on;
  els.status.textContent = on ? "Listening…" : "Ready";
  els.hint.textContent = on ? "Click the mic or press Space to save." : readyHint();
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

function toggleMic() {
  if (!SpeechRecognition) {
    toast("Use Chrome or Edge for the microphone");
    return;
  }
  if (listening) stopListening(true);
  else startListening();
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
  const lines = ["Voice Memory export", `Exported ${new Date().toLocaleString()}`, ""];
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

function importPayload(text, filename = "") {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (filename.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      if (data.subscriptions && Array.isArray(data.notes)) {
        state = {
          activeId: data.activeId || data.subscriptions[0]?.id || "inbox",
          subscriptions: data.subscriptions,
          notes: data.notes,
        };
        save();
        render();
        toast("Imported Voice Memory JSON");
        return;
      }
    } catch {
      /* fall through to plain text */
    }
  }
  addNote(trimmed);
}

function typingInField() {
  const el = document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
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
  const copy = event.target.closest("[data-copy]");
  const send = event.target.closest("[data-send]");
  const del = event.target.closest("[data-delete]");
  if (play) {
    const note = state.notes.find((n) => n.id === play.dataset.play);
    if (note) speak(note.text);
  }
  if (copy) {
    const note = state.notes.find((n) => n.id === copy.dataset.copy);
    if (note) {
      copyText(note.text).then((ok) => {
        if (ok) toast("Copied note");
        else showCopyFallback(note.text, "Copy this note", "Select the text and copy it.");
      });
    }
  }
  if (send) {
    const note = state.notes.find((n) => n.id === send.dataset.send);
    if (note) handoffNotes(notesAsPrompt([note]));
  }
  if (del) deleteNote(del.dataset.delete);
});

els.mic.addEventListener("click", toggleMic);
els.exportTxt.addEventListener("click", exportTxt);
els.exportJson.addEventListener("click", exportJson);
els.sendNotes.addEventListener("click", () => handoffNotes(notesAsPrompt()));
els.service.addEventListener("change", () => setHelper(els.service.value));
els.search.addEventListener("input", () => {
  query = els.search.value;
  renderFeed();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (listening) stopListening(true);
    if (els.dialog.open) els.dialog.close();
    if (els.copyDialog.open) els.copyDialog.close();
    return;
  }
  if (typingInField() || els.dialog.open || els.copyDialog.open) return;
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    toggleMic();
  } else if (event.key === "/" && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    els.search.focus();
  } else if (event.key.toLowerCase() === "g" && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    handoffNotes(notesAsPrompt());
  }
});

document.addEventListener("paste", (event) => {
  if (typingInField()) return;
  const text = event.clipboardData?.getData("text/plain");
  if (text) {
    event.preventDefault();
    importPayload(text);
  }
});

["dragenter", "dragover"].forEach((type) => {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    document.body.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((type) => {
  document.addEventListener(type, (event) => {
    if (type === "drop") event.preventDefault();
    if (type === "dragleave" && event.target !== document.body) return;
    document.body.classList.remove("dragover");
  });
});
document.addEventListener("drop", async (event) => {
  event.preventDefault();
  document.body.classList.remove("dragover");
  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    const text = event.dataTransfer?.getData("text/plain");
    if (text) importPayload(text);
    return;
  }
  importPayload(await file.text(), file.name || "");
});

if (!SpeechRecognition) {
  els.mic.classList.add("unsupported");
  els.hint.textContent = "Speech recognition needs Chrome or Edge on HTTPS.";
  els.status.textContent = "Mic unavailable";
  document.querySelector(".layout")?.insertAdjacentHTML(
    "beforebegin",
    `<p class="banner">This browser cannot transcribe speech. Open this page in Chrome or Edge on HTTPS. You can still paste notes and hand them to your AI helper.</p>`
  );
} else if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  els.hint.textContent = "Microphone needs HTTPS.";
} else {
  els.hint.textContent = readyHint();
}

window.speechSynthesis?.getVoices?.();
render();
