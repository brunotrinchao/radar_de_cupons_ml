let currentTabId = null;
let countdownTimer = null;

const el = {
  btnAplicar: document.getElementById("btnAplicar"),
  btnPausar: document.getElementById("btnPausar"),
  filtroTexto: document.getElementById("filtroTexto"),
  agendamento: document.getElementById("agendamento"),
  status: document.getElementById("status"),
  logContainer: document.getElementById("log-container"),
  toastContainer: document.getElementById("toast-container")
};

function notify(message, type = "info", duration = 2500) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerText = message;
  el.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

function setMainButton(mode) {
  if (mode === "cancelar") {
    el.btnAplicar.dataset.action = "cancelar";
    el.btnAplicar.innerText = "Cancelar";
    el.btnAplicar.style.background = "#ff4a4a";
    el.btnAplicar.style.boxShadow = "0 4px 0 #cc3232";
    return;
  }

  el.btnAplicar.dataset.action = "iniciar";
  el.btnAplicar.innerText = "Iniciar";
  el.btnAplicar.style.background = "var(--primary)";
  el.btnAplicar.style.boxShadow = "0 4px 0 var(--primary-shadow)";
}

function stopCountdown() {
  if (!countdownTimer) return;
  clearInterval(countdownTimer);
  countdownTimer = null;
}

function startCountdown(targetTs) {
  stopCountdown();
  const tick = () => {
    const diff = Math.floor((targetTs - Date.now()) / 1000);
    if (diff <= 0) {
      el.status.innerText = "Iniciando...";
      stopCountdown();
      return;
    }
    el.status.innerText = `Agendado: ${diff}s restantes...`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function renderLogs(logs) {
  const list = Array.isArray(logs) ? logs : [];
  if (!list.length) {
    el.logContainer.innerHTML = '<div class="empty">Nenhum cupom aplicado ainda.</div>';
    return;
  }

  el.logContainer.innerHTML = "";
  list.slice(0, 100).forEach((name) => {
    const row = document.createElement("div");
    row.className = "log-item";
    row.innerText = `✅ ${name}`;
    el.logContainer.appendChild(row);
  });
}

function renderCaptureState(state) {
  stopCountdown();

  if (!state) {
    setMainButton("iniciar");
    el.status.classList.remove("active");
    el.status.innerText = "Pronto para começar";
    renderLogs([]);
    return;
  }

  el.filtroTexto.value = state.filtro || el.filtroTexto.value;
  if (state.agendamento) el.agendamento.value = state.agendamento;
  renderLogs(state.logs || []);

  if (state.status === "SNIPER") {
    setMainButton("cancelar");
    el.status.classList.remove("active");
    if (state.alvoTimestamp) startCountdown(state.alvoTimestamp);
    else el.status.innerText = state.mensagem || "Aguardando horário...";
    return;
  }

  if (state.status === "RODANDO") {
    setMainButton("cancelar");
    el.status.classList.add("active");
    el.status.innerText = state.mensagem || "Processando...";
    return;
  }

  if (state.status === "PAUSADO") {
    setMainButton("cancelar");
    el.status.classList.remove("active");
    el.status.innerText = state.mensagem || "Pausado";
    return;
  }

  if (state.status === "ERRO") {
    setMainButton("iniciar");
    el.status.classList.remove("active");
    el.status.innerText = state.mensagem || "Erro";
    return;
  }

  setMainButton("iniciar");
  el.status.classList.remove("active");
  el.status.innerText = state.mensagem || "Finalizado";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function fetchSnapshot() {
  const tab = await getActiveTab();
  currentTabId = tab?.id || null;

  const response = await chrome.runtime.sendMessage({
    tipo: "OBTER_SNAPSHOT",
    tabId: currentTabId
  });

  if (!response?.ok) {
    notify(response?.erro || "Falha ao carregar.", "error");
    return;
  }

  renderCaptureState(response.snapshot?.estado || null);
}

async function sendStartCapture() {
  if (!currentTabId) {
    notify("Não foi possível identificar a aba ativa.", "error");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    tipo: "INICIAR_CAPTURA",
    tabId: currentTabId,
    filtro: el.filtroTexto.value.trim().toLowerCase(),
    agendamento: el.agendamento.value
  });

  if (!response?.ok) {
    notify(response?.erro || "Falha ao iniciar captura.", "error");
    return;
  }

  notify("Captura iniciada/agendada.", "success");
  await fetchSnapshot();
}

async function sendCancelCapture() {
  await chrome.runtime.sendMessage({ tipo: "CANCELAR_CAPTURA" });
  notify("Captura cancelada.", "info");
  await fetchSnapshot();
}

async function sendPauseCapture() {
  const response = await chrome.runtime.sendMessage({ tipo: "PAUSAR_CAPTURA", minutes: 2 });
  if (!response?.ok) {
    notify(response?.erro || "Não foi possível pausar.", "error");
    return;
  }
  notify("Captura pausada por 2 minutos.", "info");
  await fetchSnapshot();
}

function bindEvents() {
  el.btnAplicar.addEventListener("click", async () => {
    if (el.btnAplicar.dataset.action === "cancelar") {
      await sendCancelCapture();
      return;
    }
    await sendStartCapture();
  });

  el.btnPausar.addEventListener("click", sendPauseCapture);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.estadoBot) fetchSnapshot().catch(() => {});
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await fetchSnapshot();
});
