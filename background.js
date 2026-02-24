const KEYS = {
  estado: "estadoBot"
};

const ALARMS = {
  captureSchedule: "captureSchedule",
  captureResume: "captureResume"
};

const CAPTURE_ENTRY_URL = "https://www.mercadolivre.com.br/cupons/filter?all=true&source_page=int_view_all";

function safeLower(v) {
  return String(v || "").toLowerCase();
}

function nextTimestampFromClock(hms) {
  const parts = String(hms || "").split(":").map(Number);
  const h = Number.isFinite(parts[0]) ? parts[0] : 0;
  const m = Number.isFinite(parts[1]) ? parts[1] : 0;
  const s = Number.isFinite(parts[2]) ? parts[2] : 0;
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, s, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function isCouponsUrl(url) {
  try {
    const parsed = new URL(url || "");
    return parsed.hostname.endsWith("mercadolivre.com.br") && parsed.pathname.startsWith("/cupons");
  } catch {
    return false;
  }
}

async function getLocal(key) {
  const res = await chrome.storage.local.get(key);
  return res[key];
}

async function setLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function captureState() {
  return (await getLocal(KEYS.estado)) || null;
}

async function saveCaptureState(state) {
  await setLocal(KEYS.estado, state);
}

async function clearCaptureState() {
  await chrome.storage.local.remove(KEYS.estado);
}

async function startCapture({
  tabId,
  filtro = "",
  forceEntryPage = false,
  keepLogs = false,
  runId: existingRunId = null,
  startedAt: existingStartedAt = null,
  processedTotal: existingProcessedTotal = 0,
  visitedPages: existingVisitedPages = []
}) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, erro: "Aba inválida." };
  }

  const existing = await captureState();
  const logs = keepLogs && Array.isArray(existing?.logs) ? existing.logs : [];
  const runId = existingRunId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = existingStartedAt || Date.now();
  const visitedPages = Array.isArray(existingVisitedPages) ? [...existingVisitedPages] : [];

  if (tab.url && !visitedPages.includes(tab.url)) visitedPages.push(tab.url);

  await chrome.alarms.clear(ALARMS.captureSchedule);

  if (forceEntryPage && tab.url !== CAPTURE_ENTRY_URL) {
    await saveCaptureState({
      status: "RODANDO",
      runId,
      tabId,
      filtro: safeLower(filtro),
      startedAt,
      processedTotal: Number(existingProcessedTotal || 0),
      visitedPages: visitedPages.slice(-40),
      mensagem: "Abrindo página inicial de cupons...",
      logs
    });

    try {
      await chrome.tabs.update(tabId, { url: CAPTURE_ENTRY_URL });
      return { ok: true };
    } catch {
      return { ok: false, erro: "Não foi possível abrir a página inicial de cupons." };
    }
  }

  if (!isCouponsUrl(tab.url)) {
    return { ok: false, erro: "Abra a página de cupons para iniciar a captura." };
  }

  await saveCaptureState({
    status: "RODANDO",
    runId,
    tabId,
    filtro: safeLower(filtro),
    startedAt,
    processedTotal: Number(existingProcessedTotal || 0),
    visitedPages: visitedPages.slice(-40),
    mensagem: "Processando cupons...",
    logs
  });

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: scriptCaptureCoupons,
      args: [{
        filtro: safeLower(filtro),
        runId
      }]
    });
    return { ok: true };
  } catch (err) {
    await saveCaptureState({
      status: "ERRO",
      runId,
      tabId,
      filtro: safeLower(filtro),
      startedAt,
      processedTotal: Number(existingProcessedTotal || 0),
      visitedPages: visitedPages.slice(-40),
      mensagem: `Falha ao iniciar captura: ${err?.message || "erro"}`,
      logs
    });
    return { ok: false, erro: "Falha ao injetar captura." };
  }
}

async function pauseCapture(minutes) {
  const state = await captureState();
  if (!state || state.status !== "RODANDO") return { ok: false, erro: "Não há captura em execução." };

  const until = Date.now() + Math.max(1, Number(minutes) || 1) * 60 * 1000;
  await saveCaptureState({ ...state, status: "PAUSADO", pauseUntil: until, mensagem: `Pausado por ${minutes} min` });
  await chrome.alarms.create(ALARMS.captureResume, { when: until });
  return { ok: true };
}

async function finalizeCaptureFromMessage(msg) {
  const state = await captureState();
  if (!state || state.runId !== msg.runId) return;

  if (msg.tipo === "CAPTURE_PROGRESS") {
    await saveCaptureState({
      ...state,
      status: "RODANDO",
      mensagem: `Processando: ${msg.current}/${msg.total}`
    });
    return;
  }

  if (msg.tipo === "CAPTURE_COUPON_OK") {
    const logs = Array.isArray(state.logs) ? [...state.logs] : [];
    if (!logs.includes(msg.name)) logs.unshift(msg.name);
    await saveCaptureState({ ...state, logs: logs.slice(0, 100) });
    return;
  }

  if (msg.tipo === "CAPTURE_ERROR") {
    await saveCaptureState({ ...state, status: "ERRO", mensagem: msg.message || "Erro na captura." });
    return;
  }

  if (msg.tipo === "CAPTURE_DONE") {
    const processedTotal = Number(state.processedTotal || 0) + Number(msg.total || 0);

    if (msg.nextUrl && !state.visitedPages?.includes(msg.nextUrl)) {
      const nextVisited = [...(state.visitedPages || []), msg.nextUrl].slice(-40);
      await saveCaptureState({
        ...state,
        status: "RODANDO",
        processedTotal,
        visitedPages: nextVisited,
        mensagem: `Indo para próxima página (${processedTotal} aplicados)...`
      });

      try {
        await chrome.tabs.update(state.tabId, { url: msg.nextUrl });
      } catch {
        // ignore
      }
      return;
    }

    await saveCaptureState({
      ...state,
      status: "CONCLUIDO",
      processedTotal,
      mensagem: `Finalizado (${processedTotal})`
    });
  }
}

async function buildSnapshot() {
  return {
    estado: await captureState()
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    const type = request && request.tipo;

    if (type === "OBTER_SNAPSHOT") {
      sendResponse({ ok: true, snapshot: await buildSnapshot() });
      return;
    }

    if (type === "INICIAR_CAPTURA") {
      if (request.agendamento) {
        const when = nextTimestampFromClock(request.agendamento);
        await saveCaptureState({
          status: "SNIPER",
          tabId: request.tabId,
          filtro: safeLower(request.filtro || ""),
          agendamento: request.agendamento,
          alvoTimestamp: when,
          mensagem: "Aguardando horário...",
          logs: []
        });
        await chrome.alarms.create(ALARMS.captureSchedule, { when });
        sendResponse({ ok: true });
        return;
      }

      sendResponse(await startCapture({
        tabId: request.tabId,
        filtro: request.filtro || "",
        forceEntryPage: true,
        keepLogs: false
      }));
      return;
    }

    if (type === "PAUSAR_CAPTURA") {
      sendResponse(await pauseCapture(request.minutes || 2));
      return;
    }

    if (type === "CANCELAR_CAPTURA") {
      await chrome.alarms.clear(ALARMS.captureSchedule);
      await chrome.alarms.clear(ALARMS.captureResume);
      await clearCaptureState();
      sendResponse({ ok: true });
      return;
    }

    if (type && type.startsWith("CAPTURE_")) {
      await finalizeCaptureFromMessage(request);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, erro: "Mensagem não suportada." });
  })().catch((error) => {
    sendResponse({ ok: false, erro: error?.message || "Erro inesperado." });
  });

  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARMS.captureResume) {
    const state = await captureState();
    if (!state || state.status !== "PAUSADO") return;
    await startCapture({
      tabId: state.tabId,
      filtro: state.filtro || "",
      keepLogs: true,
      runId: state.runId || null,
      startedAt: state.startedAt || null,
      processedTotal: state.processedTotal || 0,
      visitedPages: state.visitedPages || []
    });
    return;
  }

  if (alarm.name === ALARMS.captureSchedule) {
    const state = await captureState();
    if (!state || state.status !== "SNIPER") return;
    await startCapture({
      tabId: state.tabId,
      filtro: state.filtro || "",
      forceEntryPage: true,
      keepLogs: true,
      runId: state.runId || null,
      startedAt: state.startedAt || null,
      processedTotal: state.processedTotal || 0,
      visitedPages: state.visitedPages || []
    });
  }
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!isCouponsUrl(details.url)) return;

  const state = await captureState();
  if (!state || state.status !== "RODANDO" || state.tabId !== details.tabId) return;

  await startCapture({
    tabId: details.tabId,
    filtro: state.filtro || "",
    keepLogs: true,
    runId: state.runId || null,
    startedAt: state.startedAt || null,
    processedTotal: state.processedTotal || 0,
    visitedPages: state.visitedPages || []
  });
});

async function scriptCaptureCoupons(options) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalizeTextLocal = (text) => String(text || "").toLowerCase().replace(/\s+/g, " ").trim();

  const isRunning = async () => {
    const res = await chrome.storage.local.get("estadoBot");
    return res?.estadoBot?.status === "RODANDO" && res?.estadoBot?.runId === options.runId;
  };

  const visible = (el) => {
    if (!el) return false;
    const st = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== "none" && st.visibility !== "hidden" && r.width > 0 && r.height > 0;
  };

  const triggerClick = (el) => {
    if (!el || !visible(el)) return false;
    const target = el.closest("button,a,[role='button']") || el;
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };

    try {
      target.dispatchEvent(new PointerEvent("pointerdown", opts));
      target.dispatchEvent(new MouseEvent("mousedown", opts));
      target.dispatchEvent(new PointerEvent("pointerup", opts));
      target.dispatchEvent(new MouseEvent("mouseup", opts));
      target.dispatchEvent(new MouseEvent("click", opts));
      return true;
    } catch {
      try {
        target.click();
        return true;
      } catch {
        return false;
      }
    }
  };

  const textMatchesFilter = (text) => {
    const raw = normalizeTextLocal(text);
    if (options.filtro && !raw.includes(options.filtro)) return false;
    return true;
  };

  const extractCouponTitle = (card, targetEl) => {
    if (card) {
      const titleNode = card.querySelector(".title");
      const attrTitle = titleNode?.getAttribute("title")?.trim();
      if (attrTitle) return attrTitle.slice(0, 80);

      const visualTitle = titleNode?.querySelector(".interpolated-label__container")?.textContent?.trim();
      if (visualTitle) return visualTitle.slice(0, 80);

      const titleText = titleNode?.textContent?.replace(/\s+/g, " ").trim();
      if (titleText) return titleText.slice(0, 80);
    }

    const rawText = String(card?.innerText || targetEl?.innerText || "").replace(/\r/g, "\n");
    const lines = rawText
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const ignored = /^(aplicar|ganhar|resgatar|usar|ativar|pegar|ver mais|saiba mais|termos|regras|cupom)$/i;
    const meaningful = lines.filter((line) => !ignored.test(line));

    const scoreLine = (line) => {
      let score = 0;
      if (/\d+\s*%/.test(line)) score += 5;
      if (/\boff\b/i.test(line)) score += 4;
      if (/(desconto|frete|cashback|sem juros|em )/i.test(line)) score += 2;
      if (line.length >= 6) score += 1;
      return score;
    };

    const ranked = meaningful
      .map((line) => ({ line, score: scoreLine(line) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked.find((item) => item.score > 0)?.line;
    if (best) return best.slice(0, 80);
    if (meaningful.length) return meaningful[0].slice(0, 80);
    return "Cupom";
  };

  const detectNextPageUrl = () => {
    const current = new URL(window.location.href);
    const currentPage = Number(current.searchParams.get("page") || "1");

    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href"))
      .filter(Boolean)
      .map((href) => new URL(href, window.location.origin).toString());

    const candidates = links.filter((href) => href.includes("/cupons") && href.includes("page="));
    if (!candidates.length) return null;

    const explicitNext = candidates.find((href) => {
      try {
        const u = new URL(href);
        const p = Number(u.searchParams.get("page") || "0");
        return p === currentPage + 1;
      } catch {
        return false;
      }
    });

    if (explicitNext) return explicitNext;

    const higher = candidates
      .map((href) => {
        try {
          const u = new URL(href);
          return { href, page: Number(u.searchParams.get("page") || "0") };
        } catch {
          return { href, page: 0 };
        }
      })
      .filter((x) => x.page > currentPage)
      .sort((a, b) => a.page - b.page)[0];

    return higher ? higher.href : null;
  };

  const closeModals = new MutationObserver(() => {
    const dismiss = Array.from(document.querySelectorAll("button,span,a")).find((el) => {
      const tx = (el.innerText || "").trim().toLowerCase();
      return tx === "entendi" || tx === "ok" || el.classList.contains("andes-modal__close");
    });
    if (dismiss) triggerClick(dismiss);
  });

  closeModals.observe(document.body, { childList: true, subtree: true });

  const couponActionRegex = /\b(aplicar|ganhar|resgatar|usar|ativar|pegar)\b/i;
  const findClickableTarget = (el) => el.closest("button,a,[role='button']") || el;

  const collectCandidates = () => {
    const seen = new Set();
    const nodes = Array.from(document.querySelectorAll("button,a,span,[role='button']"));
    const output = [];

    for (const node of nodes) {
      if (!visible(node)) continue;

      const tx = normalizeTextLocal(node.innerText || node.textContent || "");
      if (!couponActionRegex.test(tx)) continue;

      const target = findClickableTarget(node);
      if (!target || !visible(target)) continue;
      if (target instanceof HTMLButtonElement && target.disabled) continue;

      const card = target.closest(".andes-card,li,article,section,[data-testid*='coupon'],[class*='coupon']") || target.parentElement;
      const context = card?.innerText || target.innerText || "";
      if (!textMatchesFilter(context)) continue;

      if (seen.has(target)) continue;
      seen.add(target);
      output.push(target);
    }

    return output;
  };

  let candidates = collectCandidates();
  let stableRounds = 0;
  for (let i = 0; i < 5 && stableRounds < 2; i += 1) {
    const before = candidates.length;
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    await wait(1100);
    candidates = collectCandidates();
    if (candidates.length <= before) stableRounds += 1;
    else stableRounds = 0;
  }

  const nextUrl = detectNextPageUrl();

  if (!candidates.length) {
    chrome.runtime.sendMessage({
      tipo: "CAPTURE_DONE",
      runId: options.runId,
      total: 0,
      nextUrl
    });
    closeModals.disconnect();
    return;
  }

  for (let i = 0; i < candidates.length; i += 1) {
    if (!(await isRunning())) {
      closeModals.disconnect();
      return;
    }

    const el = findClickableTarget(candidates[i]);
    if (!document.body.contains(el)) continue;
    if (el instanceof HTMLButtonElement && el.disabled) continue;

    chrome.runtime.sendMessage({ tipo: "CAPTURE_PROGRESS", runId: options.runId, current: i + 1, total: candidates.length });

    const card = el.closest(".andes-card") || el.parentElement;
    const name = extractCouponTitle(card, el);

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    await wait(500);
    triggerClick(el);

    chrome.runtime.sendMessage({
      tipo: "CAPTURE_COUPON_OK",
      runId: options.runId,
      name
    });

    await wait(1100);
  }

  closeModals.disconnect();
  chrome.runtime.sendMessage({
    tipo: "CAPTURE_DONE",
    runId: options.runId,
    total: candidates.length,
    nextUrl
  });
}
