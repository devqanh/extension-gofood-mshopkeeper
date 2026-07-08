(function () {
  "use strict";

  var PANEL_CLASS = "gofood-vietqr-panel";
  var BUTTON_ID = "gofood-vietqr-button";
  var DEFAULT_TEMPLATE = "compact2";
  var PAGE_HOOK_SCRIPT = "src/page-hook.js";
  var PAGE_HOOK_SOURCE = "gofood-vietqr-page-hook";
  var SAVE_SYNC_MESSAGE_TYPE = "GOFOOD_VIETQR_SAVE_SYNC_RESPONSE";
  var API_REQUEST_MESSAGE_TYPE = "GOFOOD_VIETQR_API_REQUEST";

  var state = {
    config: null,
    settings: {
      selectedBankId: "",
      selectedBranchId: ""
    },
    activeScope: null,
    lastInteractedScope: null,
    autoNoteTimer: 0,
    autoNoteObserver: null,
    generatedNoteCodes: {},
    lastNoteEpochSecond: 0,
    lastSaveSyncResponse: null,
    lastInvoiceRefSaveKey: "",
    elements: {}
  };

  var staleButton = document.getElementById(BUTTON_ID);
  if (staleButton) {
    staleButton.remove();
  }

  init();

  function init() {
    injectPageNetworkHook();
    bindSaveSyncResponseCapture();
    bindOrderChangeCleanup();
    bindAutoNoteGeneration();
    loadState().then(function () {
      scheduleAutoNoteForActiveScope();
    });

    if (chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName === "local") {
          if (changes.cachedConfig) {
            state.config = normalizeConfig(changes.cachedConfig.newValue);
            if (state.elements.panel) {
              renderConfig();
            }
          }
          return;
        }

        if (areaName !== "sync") {
          return;
        }

        var branchSelectionChanged = Boolean(changes.selectedBranchId || changes.selectedBankId);

        loadState().then(function () {
          if (state.elements.panel) {
            renderConfig();
          }

          if (branchSelectionChanged) {
            refreshQrForSelectedBranch();
          }
        });
      });
    }
  }

  function refreshQrForSelectedBranch() {
    var scope = getUsableScope(state.activeScope) || findPaymentScope({ ignoreLast: true });

    if (!scope) {
      return;
    }

    state.activeScope = scope;
    state.lastInteractedScope = scope;
    activateEmbeddedPanel(scope);
    renderConfig();
    primeAmountField({ force: true });
    handleGenerate({
      refreshAmount: true,
      newNote: true,
      noScroll: true
    });
  }

  function injectPageNetworkHook() {
    if (!chrome || !chrome.runtime || !chrome.runtime.getURL) {
      return;
    }

    var root = document.documentElement;
    if (!root || root.dataset.gvqNetworkHookInjected) {
      return;
    }

    root.dataset.gvqNetworkHookInjected = "true";

    var script = document.createElement("script");
    script.src = chrome.runtime.getURL(PAGE_HOOK_SCRIPT);
    script.async = false;
    script.onload = function () {
      script.remove();
    };

    (document.head || root).appendChild(script);
  }

  function bindSaveSyncResponseCapture() {
    window.addEventListener("message", function (event) {
      var data = event.data || {};

      if (event.source !== window || data.source !== PAGE_HOOK_SOURCE || data.type !== SAVE_SYNC_MESSAGE_TYPE) {
        return;
      }

      handleSaveSyncResponse(data.payload || {});
    });
  }

  function handleSaveSyncResponse(payload) {
    var response = normalizeSaveSyncResponse(payload);
    if (!response) {
      return;
    }

    state.lastSaveSyncResponse = response;
    attachSaveSyncResponseToPanel(response);
    sendTransactionSyncToApi(response);
    storageSet("local", {
      lastSaveSyncResponse: response
    });

    if (window.console && typeof window.console.info === "function") {
      window.console.info("[GoFood VietQR] Bắt response save-sync:", response);
    }
  }

  function normalizeSaveSyncResponse(payload) {
    var json = payload.bodyJson && typeof payload.bodyJson === "object" ? payload.bodyJson : null;
    var refNo = extractSaveSyncRefNo(json);

    return {
      capturedAt: payload.capturedAt || new Date().toISOString(),
      source: payload.source || "",
      method: payload.method || "",
      url: payload.url || "",
      status: Number(payload.status || 0),
      ok: payload.ok !== false,
      success: json ? json.Success === true || json.success === true : Boolean(payload.ok),
      refNo: refNo,
      code: json ? json.Code || json.code || null : null,
      data: json ? json.Data || json.data || null : null,
      bodyJson: json,
      bodyText: String(payload.bodyText || "").slice(0, 4000)
    };
  }

  function extractSaveSyncRefNo(json) {
    if (!json || typeof json !== "object") {
      return "";
    }

    var data = json.Data || json.data || {};
    return String(data.RefNo || data.refNo || data.ref_no || "").trim();
  }

  function attachSaveSyncResponseToPanel(response) {
    var panel = state.elements.panel;

    if (!panel || !panel.isConnected) {
      var scope = getUsableScope(state.activeScope) || findPaymentScope({ ignoreLast: true });
      panel = scope ? scope.querySelector(":scope > ." + PANEL_CLASS) : null;
    }

    if (!panel) {
      return;
    }

    panel.dataset.gvqSaveStatus = String(response.status || "");
    panel.dataset.gvqSaveSuccess = response.success ? "true" : "false";
    panel.dataset.gvqSaveCapturedAt = response.capturedAt;

    if (response.refNo) {
      panel.dataset.gvqSaveRefNo = response.refNo;
    }

    if (state.elements.status) {
      setStatus(
        response.refNo
          ? "Đã bắt response lưu tạm: " + response.refNo
          : "Đã bắt response lưu tạm.",
        response.success ? "ok" : "error"
      );
    }
  }

  function sendTransactionSyncToApi(response) {
    var endpoint = getApiUrl("/api/transactions/sync");
    var transferNote = detectCurrentTransferNote();

    if (!response.refNo || !transferNote || !endpoint) {
      if (state.elements.status && response.refNo && !transferNote) {
        setStatus("Đã bắt RefNo nhưng chưa tìm thấy mã GOFOOD trong ghi chú.", "error");
      }
      return;
    }

    var paymentSnapshot = buildPaymentSnapshot();
    var selectedBank = getSelectedBank();
    var saveKey = response.refNo + "|" + transferNote;

    if (saveKey === state.lastInvoiceRefSaveKey) {
      return;
    }

    state.lastInvoiceRefSaveKey = saveKey;

    var payload = {
      event: "mshopkeeper.save_sync",
      id: response.refNo,
      refNo: response.refNo,
      transferNote: transferNote,
      receivableAmount: paymentSnapshot.receivableAmount,
      receivableAmountText: paymentSnapshot.receivableAmountText,
      bankTransferAmount: paymentSnapshot.bankTransferAmount,
      bankTransferAmountText: paymentSnapshot.bankTransferAmountText,
      cashAmount: paymentSnapshot.cashAmount,
      cashAmountText: paymentSnapshot.cashAmountText,
      paymentTotal: paymentSnapshot.paymentTotal,
      paymentTotalText: paymentSnapshot.paymentTotalText,
      paymentMethods: paymentSnapshot.paymentMethods,
      paymentsByType: paymentSnapshot.paymentsByType,
      branchId: selectedBank ? selectedBank.branchId || selectedBank.id : "",
      branchName: selectedBank ? selectedBank.branchName || selectedBank.label : "",
      transferPrefix: selectedBank ? selectedBank.transferPrefix || getTransferNotePrefix() : getTransferNotePrefix(),
      bankId: selectedBank ? selectedBank.bankId : "",
      bankName: selectedBank ? selectedBank.bankName || "" : "",
      bankAccountNo: selectedBank ? selectedBank.accountNo : "",
      bankAccountName: selectedBank ? selectedBank.accountName : "",
      sourceUrl: window.location.href,
      sourceHost: window.location.host,
      sourcePath: window.location.pathname,
      postedAt: buildPostDateInfo(new Date()),
      saveSyncStatus: response.status,
      saveSyncSuccess: response.success,
      saveSyncResponse: {
        Code: response.code,
        Data: response.data,
        Success: response.success
      },
      capturedAt: response.capturedAt
    };

    postApiPayload(endpoint, payload).then(function (result) {
      if (!result || result.ok === false) {
        throw new Error(result && result.error ? result.error : "API không nhận dữ liệu.");
      }

      if (result.status && result.status >= 400) {
        throw new Error("API trả về HTTP " + result.status + ".");
      }

      return result;
    }).then(function () {
      storageSet("local", {
        lastInvoiceRefMapping: payload
      });

      if (state.elements.status) {
        setStatus("Đã gửi API RefNo " + response.refNo + " cho " + transferNote + ".", "ok");
      }
    }).catch(function (error) {
      state.lastInvoiceRefSaveKey = "";
      if (state.elements.status) {
        setStatus(error.message, "error");
      }
      if (window.console && typeof window.console.warn === "function") {
        window.console.warn("[GoFood VietQR] Không gửi được API RefNo:", error);
      }
    });
  }

  function postApiPayload(endpoint, payload) {
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      return new Promise(function (resolve) {
        chrome.runtime.sendMessage({
          type: API_REQUEST_MESSAGE_TYPE,
          method: "POST",
          endpoint: endpoint,
          payload: payload
        }, function (response) {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message || "Không gửi được message tới background."
            });
            return;
          }

          resolve(response || {
            ok: false,
            error: "Background không trả phản hồi."
          });
        });
      });
    }

    return fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return {
        ok: response.ok,
        status: response.status
      };
    });
  }

  function getApiJson(endpoint) {
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      return new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage({
          type: API_REQUEST_MESSAGE_TYPE,
          method: "GET",
          endpoint: endpoint
        }, function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || "Không gửi được message tới background."));
            return;
          }

          if (!response || response.ok === false) {
            reject(new Error(response && response.error ? response.error : "API không trả phản hồi."));
            return;
          }

          if (response.status && response.status >= 400) {
            reject(new Error("API trả về HTTP " + response.status + "."));
            return;
          }

          resolve(response.json || {});
        });
      });
    }

    return fetch(endpoint, {
      cache: "no-store",
      credentials: "omit"
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("API trả về HTTP " + response.status + ".");
      }
      return response.json();
    });
  }

  function getApiBaseUrl() {
    var config = window.GOFOOD_API_CONFIG || {};
    return String(config.baseUrl || "http://localhost:8222").replace(/\/+$/, "");
  }

  function getApiUrl(path) {
    return getApiBaseUrl() + "/" + String(path || "").replace(/^\/+/, "");
  }

  function detectCurrentTransferNote() {
    var panel = state.elements.panel && state.elements.panel.isConnected ? state.elements.panel : null;
    if (panel && panel.dataset.gvqNote) {
      return getCanonicalTransferNote(panel.dataset.gvqNote) || "";
    }

    var scopes = [
      state.activeScope,
      state.lastInteractedScope,
      getActiveScope(),
      findPaymentScope({ ignoreLast: true })
    ];

    for (var i = 0; i < scopes.length; i += 1) {
      var scope = scopes[i];
      var note = scope ? getExistingTransferNote(scope) : "";
      if (note) {
        return note;
      }
    }

    var panels = Array.prototype.slice.call(document.querySelectorAll("." + PANEL_CLASS))
      .filter(isVisible)
      .sort(function (a, b) {
        return visibleScore(b) - visibleScore(a);
      });

    for (var panelIndex = 0; panelIndex < panels.length; panelIndex += 1) {
      var panelNote = getCanonicalTransferNote(panels[panelIndex].dataset.gvqNote || "");
      if (panelNote) {
        return panelNote;
      }
    }

    return "";
  }

  function detectCurrentAmount() {
    var panel = state.elements.panel && state.elements.panel.isConnected ? state.elements.panel : null;
    if (panel && panel.dataset.gvqAmount) {
      return normalizeAmount(panel.dataset.gvqAmount);
    }

    return detectAmountFromPage();
  }

  function buildPaymentSnapshot() {
    var scope = getUsableScope(state.activeScope) || findPaymentScope({ ignoreLast: true }) || document;
    var receivableAmount = detectReceivableAmountFromPage(scope) || detectCurrentAmount();
    var paymentMethods = detectPaymentMethods(scope);
    var summary = summarizePaymentMethods(paymentMethods);

    return {
      receivableAmount: receivableAmount,
      receivableAmountText: receivableAmount ? formatAmount(receivableAmount) : "",
      bankTransferAmount: summary.bankTransferAmount,
      bankTransferAmountText: summary.bankTransferAmount ? formatAmount(summary.bankTransferAmount) : "",
      cashAmount: summary.cashAmount,
      cashAmountText: summary.cashAmount ? formatAmount(summary.cashAmount) : "",
      paymentTotal: summary.paymentTotal,
      paymentTotalText: summary.paymentTotal ? formatAmount(summary.paymentTotal) : "",
      paymentMethods: paymentMethods,
      paymentsByType: summary.paymentsByType
    };
  }

  function detectPaymentMethods(scope) {
    var root = scope || document;
    var wrappers = Array.prototype.slice.call(root.querySelectorAll(".type-payment-wrap"))
      .filter(isVisible);

    if (!wrappers.length && root !== document) {
      wrappers = Array.prototype.slice.call(document.querySelectorAll(".type-payment-wrap"))
        .filter(isVisible);
    }

    if (!wrappers.length) {
      return [];
    }

    wrappers.sort(function (a, b) {
      return visibleScore(b) - visibleScore(a);
    });

    var items = Array.prototype.slice.call(wrappers[0].querySelectorAll(".type-payment-item"))
      .filter(isVisible);

    return items.map(function (item, index) {
      var method = extractPaymentMethodName(item);
      var rawAmount = extractPaymentMethodAmount(item);
      var amount = normalizeAmount(rawAmount);
      var type = classifyPaymentMethod(method);

      return {
        index: index + 1,
        method: method,
        type: type,
        amount: amount,
        amountText: amount ? formatAmount(amount) : "",
        rawAmount: rawAmount
      };
    }).filter(function (item) {
      return item.method || item.amount || item.rawAmount;
    });
  }

  function extractPaymentMethodName(item) {
    var selectors = [
      '.filter-select .q-field__native[placeholder*="Phương thức"] span',
      '.q-select .q-field__native[placeholder*="Phương thức"] span',
      '.q-field__native[placeholder*="Phương thức"] span',
      ".filter-select .q-field__native span",
      ".q-select .q-field__native span"
    ];

    for (var i = 0; i < selectors.length; i += 1) {
      var element = item.querySelector(selectors[i]);
      var text = element ? String(element.textContent || "").trim() : "";
      if (text) {
        return text;
      }
    }

    return "";
  }

  function extractPaymentMethodAmount(item) {
    var selectors = [
      ".misa-input-money input",
      ".input-text-right input",
      "input.text-right",
      'input[maxlength="14"]'
    ];

    for (var i = 0; i < selectors.length; i += 1) {
      var input = item.querySelector(selectors[i]);
      if (!input) {
        continue;
      }

      var value = String(input.value || input.getAttribute("value") || "").trim();
      if (value) {
        return value;
      }
    }

    return "";
  }

  function classifyPaymentMethod(method) {
    var normalized = normalizeText(method);

    if (normalized.indexOf("chuyen khoan") >= 0 || normalized.indexOf("ck") === 0 || normalized.indexOf("bank") >= 0) {
      return "bank_transfer";
    }

    if (normalized.indexOf("tien mat") >= 0 || normalized.indexOf("cash") >= 0) {
      return "cash";
    }

    if (normalized.indexOf("the") >= 0 || normalized.indexOf("card") >= 0) {
      return "card";
    }

    return "other";
  }

  function summarizePaymentMethods(paymentMethods) {
    var paymentsByType = {};

    paymentMethods.forEach(function (item) {
      var type = item.type || "other";
      var amountNumber = Number(item.amount || 0);

      if (!paymentsByType[type]) {
        paymentsByType[type] = {
          amount: "0",
          amountText: "",
          methods: []
        };
      }

      paymentsByType[type].methods.push(item);
      if (amountNumber > 0) {
        paymentsByType[type].amount = String(Number(paymentsByType[type].amount || 0) + amountNumber);
        paymentsByType[type].amountText = formatAmount(paymentsByType[type].amount);
      }
    });

    var bankTransferAmount = paymentsByType.bank_transfer ? paymentsByType.bank_transfer.amount : "";
    var cashAmount = paymentsByType.cash ? paymentsByType.cash.amount : "";
    var paymentTotalNumber = paymentMethods.reduce(function (total, item) {
      return total + Number(item.amount || 0);
    }, 0);

    return {
      bankTransferAmount: bankTransferAmount && Number(bankTransferAmount) > 0 ? bankTransferAmount : "",
      cashAmount: cashAmount && Number(cashAmount) > 0 ? cashAmount : "",
      paymentTotal: paymentTotalNumber > 0 ? String(paymentTotalNumber) : "",
      paymentsByType: paymentsByType
    };
  }

  function buildPostDateInfo(date) {
    var timezone = "";

    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (error) {
      timezone = "";
    }

    return {
      iso: date.toISOString(),
      localDateTime: [
        pad(date.getDate()),
        pad(date.getMonth() + 1),
        date.getFullYear()
      ].join("/") + " " + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
      ].join(":"),
      localDate: [pad(date.getDate()), pad(date.getMonth() + 1), date.getFullYear()].join("/"),
      localTime: [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(":"),
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      timezone: timezone
    };
  }

  function bindOrderChangeCleanup() {
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (isInvoiceTabClick(target)) {
        state.lastInteractedScope = null;
        scheduleAutoNoteForActiveScope();
        scheduleRestoreQrForActiveTab();
        return;
      }

      var clickedScope = findPaymentScopeFromElement(target);
      if (clickedScope) {
        state.lastInteractedScope = clickedScope;
      }

      if (!isAddOrderClick(target)) {
        return;
      }

      clearEmbeddedPanels();
      window.setTimeout(clearEmbeddedPanels, 80);
      window.setTimeout(clearEmbeddedPanels, 350);
      window.setTimeout(scheduleAutoNoteForActiveScope, 120);
      window.setTimeout(scheduleAutoNoteForActiveScope, 500);
    }, true);
  }

  function bindAutoNoteGeneration() {
    scheduleAutoNoteForActiveScope();
    window.setTimeout(scheduleAutoNoteForActiveScope, 600);
    window.setTimeout(scheduleAutoNoteForActiveScope, 1500);

    document.addEventListener("focusin", function (event) {
      var target = event.target;
      if (target instanceof Element && findPaymentScopeFromElement(target)) {
        scheduleAutoNoteForActiveScope();
      }
    }, true);

    var observerRoot = document.body || document.documentElement;
    if (!observerRoot) {
      return;
    }

    state.autoNoteObserver = new MutationObserver(function (mutations) {
      var hasRelevantChange = mutations.some(isRelevantPaymentMutation);

      if (hasRelevantChange) {
        scheduleAutoNoteForActiveScope();
      }
    });

    state.autoNoteObserver.observe(observerRoot, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function isRelevantPaymentMutation(mutation) {
    if (!(mutation.target instanceof Element)) {
      return false;
    }

    if (mutation.target.closest("." + PANEL_CLASS)) {
      return false;
    }

    if (isPaymentRelatedElement(mutation.target)) {
      return true;
    }

    return Array.prototype.slice.call(mutation.addedNodes || []).some(function (node) {
      return node instanceof Element && isPaymentRelatedElement(node);
    });
  }

  function isPaymentRelatedElement(element) {
    var closestScope = element.closest(".misa-div.overflow-auto.flex-1, .overflow-auto.flex-1");
    if (closestScope && findReceivableLabel(closestScope)) {
      return true;
    }

    if (element.matches(".misa-div.overflow-auto.flex-1, .overflow-auto.flex-1") && findReceivableLabel(element)) {
      return true;
    }

    var nestedScope = element.querySelector(".misa-div.overflow-auto.flex-1, .overflow-auto.flex-1");
    if (nestedScope && findReceivableLabel(nestedScope)) {
      return true;
    }

    var noteWrap = element.closest(".misa-side-bar-bottom-wrap");
    if (noteWrap && findNoteTextarea(noteWrap)) {
      return true;
    }

    return Boolean(findReceivableLabel(element));
  }

  function scheduleAutoNoteForActiveScope() {
    window.clearTimeout(state.autoNoteTimer);
    state.autoNoteTimer = window.setTimeout(autoFillNoteForActiveScope, 160);
  }

  function autoFillNoteForActiveScope() {
    Promise.resolve().then(function () {
      var scope = findPaymentScope();
      if (!scope) {
        return;
      }

      var textarea = findNoteTextarea(scope);
      if (!textarea) {
        return;
      }

      state.activeScope = scope;
      state.lastInteractedScope = scope;

      if (!(textarea.value || "").trim()) {
        var note = buildTransferNote();
        setNativeValue(textarea, note);
        dispatchInputEvents(textarea, note);
      }

      renderQrForScope(scope);
    });
  }

  function renderQrForScope(scope) {
    if (!getExistingTransferNote(scope)) {
      return;
    }

    state.activeScope = scope;
    state.lastInteractedScope = scope;
    activateEmbeddedPanel(scope);
    renderConfig();
    primeAmountField({ force: true });
    handleGenerate({
      refreshAmount: true,
      newNote: false,
      restoreExistingNote: true,
      noScroll: true
    });
  }

  function isInvoiceTabClick(target) {
    var tab = target.closest('[role="tab"].q-tab, [role="tab"]');
    if (!tab) {
      return false;
    }

    var label = tab.querySelector(".q-tab__label");
    return Boolean(label && normalizeText(label.textContent).indexOf("hoa don") === 0);
  }

  function scheduleRestoreQrForActiveTab() {
    window.setTimeout(restoreQrForActiveTab, 90);
    window.setTimeout(restoreQrForActiveTab, 280);
    window.setTimeout(restoreQrForActiveTab, 650);
  }

  function restoreQrForActiveTab() {
    cleanupMismatchedEmbeddedPanels();

    var scope = findPaymentScope({ ignoreLast: true });
    if (!scope) {
      return;
    }

    state.activeScope = scope;
    loadState().then(function () {
      var existingNote = getExistingTransferNote(scope);
      if (!existingNote) {
        cleanupMismatchedEmbeddedPanels();
        return;
      }

      renderQrForScope(scope);
    }).catch(function () {
      cleanupMismatchedEmbeddedPanels();
    });
  }

  function isAddOrderClick(target) {
    if (target.closest(".misa-add-order")) {
      return true;
    }

    var button = target.closest("button, .q-btn, [role='button']");
    return Boolean(button && button.querySelector(".misa-add-order"));
  }

  function clearEmbeddedPanels() {
    Array.prototype.slice.call(document.querySelectorAll("." + PANEL_CLASS)).forEach(function (panel) {
      if (panel._gvqObserver) {
        panel._gvqObserver.disconnect();
      }
      panel.remove();
    });

    state.activeScope = null;
    state.lastInteractedScope = null;
    state.elements = {};
  }

  function cleanupMismatchedEmbeddedPanels() {
    Array.prototype.slice.call(document.querySelectorAll("." + PANEL_CLASS)).forEach(function (panel) {
      var scope = panel.parentElement;
      var expectedNote = panel.dataset.gvqNote || "";
      if (!scope || !expectedNote) {
        return;
      }

      var textarea = findNoteTextarea(scope);
      var currentNote = getCanonicalTransferNote(textarea ? textarea.value || "" : "");
      if (currentNote === expectedNote) {
        return;
      }

      if (panel._gvqObserver) {
        panel._gvqObserver.disconnect();
      }
      panel.remove();
    });
  }

  function activateEmbeddedPanel(scope) {
    var panel = ensureEmbeddedPanel(scope);
    watchScopeForOrderReuse(scope, panel);
    state.elements = {
      panel: panel,
      bank: panel.querySelector(".gvq-bank"),
      bankInfo: panel.querySelector(".gvq-bank-info"),
      amount: panel.querySelector(".gvq-amount"),
      amountText: panel.querySelector(".gvq-amount-text"),
      note: panel.querySelector(".gvq-note"),
      noteText: panel.querySelector(".gvq-note-text"),
      noteWarning: panel.querySelector(".gvq-note-warning"),
      noteWarningCode: panel.querySelector(".gvq-note-warning-code"),
      status: panel.querySelector(".gvq-status"),
      qrWrap: panel.querySelector(".gvq-qr-wrap"),
      qrLink: panel.querySelector(".gvq-qr-link"),
      qrImg: panel.querySelector(".gvq-qr-img"),
      changeNote: panel.querySelector(".gvq-change-note")
    };

    if (!panel.dataset.gvqBound) {
      panel.dataset.gvqBound = "true";
      state.elements.changeNote.addEventListener("click", function (event) {
        var button = event.currentTarget;
        var now = Date.now();
        var lockedUntil = Number(panel.dataset.gvqChangeNoteLockedUntil || 0);

        if (button.disabled || lockedUntil > now) {
          return;
        }

        panel.dataset.gvqChangeNoteLockedUntil = String(now + 2000);
        button.disabled = true;
        button.classList.add("gvq-refreshing");
        state.activeScope = scope;
        activateEmbeddedPanel(scope);
        handleGenerate({ refreshAmount: true, newNote: true });

        if (state.elements.changeNote) {
          state.elements.changeNote.disabled = true;
          state.elements.changeNote.classList.add("gvq-refreshing");
        }

        window.setTimeout(function () {
          delete panel.dataset.gvqChangeNoteLockedUntil;

          var currentButton = panel.querySelector(".gvq-change-note");
          if (!currentButton || !currentButton.isConnected) {
            return;
          }

          currentButton.disabled = !getBanks().length;
          currentButton.classList.remove("gvq-refreshing");
        }, 2000);
      });
    }
  }

  function ensureEmbeddedPanel(scope) {
    var panel = scope.querySelector(":scope > ." + PANEL_CLASS);
    if (panel) {
      return panel;
    }

    var panel = document.createElement("section");
    panel.className = PANEL_CLASS;
    panel.setAttribute("aria-label", "GoFood VietQR");
    panel.innerHTML = [
      '<div class="gvq-modal">',
      '  <div class="gvq-note-warning">',
      '    Lưu ý: không xoá mã <strong class="gvq-note-warning-code">--</strong> trong mục ghi chú để kế toán tra soát dữ liệu.',
      '  </div>',
      '  <div class="gvq-qr-wrap">',
      '    <button class="gvq-icon-button gvq-change-note" type="button" title="Đổi nội dung chuyển khoản" aria-label="Đổi nội dung chuyển khoản">',
      '      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
      '        <path d="M21 12a9 9 0 1 1-2.64-6.36" />',
      '        <path d="M21 3v6h-6" />',
      '      </svg>',
      '    </button>',
      '    <a class="gvq-qr-link" href="#" target="_blank" rel="noopener noreferrer">',
      '      <img class="gvq-qr-img" alt="Mã QR VietQR" />',
      '    </a>',
      '  </div>',
      '  <div class="gvq-bank-info gvq-hidden-control"></div>',
      '  <strong class="gvq-amount-text gvq-hidden-control">--</strong>',
      '  <strong class="gvq-note-text gvq-hidden-control">--</strong>',
      '  <div class="gvq-status gvq-hidden-control" role="status"></div>',
      '  <select class="gvq-bank gvq-hidden-control" aria-hidden="true" tabindex="-1"></select>',
      '  <input class="gvq-amount gvq-hidden-control" aria-hidden="true" tabindex="-1" />',
      '  <input class="gvq-note gvq-hidden-control" aria-hidden="true" tabindex="-1" />',
      '</div>'
    ].join("");

    scope.appendChild(panel);
    return panel;
  }

  function watchScopeForOrderReuse(scope, panel) {
    if (panel.dataset.gvqWatchBound) {
      return;
    }

    panel.dataset.gvqWatchBound = "true";
    var timer = 0;
    var observer = new MutationObserver(function (mutations) {
      var onlyQrChanged = mutations.every(function (mutation) {
        return mutation.target instanceof Element && Boolean(mutation.target.closest("." + PANEL_CLASS));
      });

      if (onlyQrChanged) {
        return;
      }

      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        removePanelIfOrderChanged(scope, panel);
      }, 120);
    });

    observer.observe(scope, {
      childList: true,
      subtree: true,
      characterData: true
    });

    panel._gvqObserver = observer;
  }

  function removePanelIfOrderChanged(scope, panel) {
    if (!panel.isConnected) {
      if (panel._gvqObserver) {
        panel._gvqObserver.disconnect();
      }
      return;
    }

    var expectedNote = panel.dataset.gvqNote || "";
    if (!expectedNote) {
      return;
    }

    var textarea = findNoteTextarea(scope);
    if (!textarea) {
      return;
    }

    if (getCanonicalTransferNote(textarea.value || "") !== expectedNote) {
      panel.remove();
      if (panel._gvqObserver) {
        panel._gvqObserver.disconnect();
      }
    }
  }

  function findPaymentScope(options) {
    var ignoreLast = options && options.ignoreLast;
    if (!ignoreLast) {
      var lastScope = getUsableScope(state.lastInteractedScope);
      if (lastScope) {
        return lastScope;
      }

      var focusedScope = document.activeElement instanceof Element
        ? getUsableScope(findPaymentScopeFromElement(document.activeElement))
        : null;
      if (focusedScope) {
        return focusedScope;
      }
    }

    var candidates = Array.prototype.slice.call(document.querySelectorAll(".misa-div.overflow-auto.flex-1, .overflow-auto.flex-1"))
      .filter(isVisible)
      .filter(function (scope) {
        return Boolean(findReceivableLabel(scope));
      });

    if (candidates.length) {
      candidates.sort(function (a, b) {
        var scoreDiff = visibleScore(b) - visibleScore(a);
        if (Math.abs(scoreDiff) > 1) {
          return scoreDiff;
        }

        return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? 1 : -1;
      });
      return candidates[0];
    }

    var label = findReceivableLabel(document);
    if (!label) {
      return null;
    }

    return label.closest(".overflow-auto.flex-1") || label.closest(".misa-div") || label.parentElement;
  }

  function findPaymentScopeFromElement(element) {
    if (!element) {
      return null;
    }

    var scope = element.closest(".misa-div.overflow-auto.flex-1, .overflow-auto.flex-1");
    return getUsableScope(scope);
  }

  function getUsableScope(scope) {
    return scope
      && document.documentElement.contains(scope)
      && isVisible(scope)
      && findReceivableLabel(scope)
      ? scope
      : null;
  }

  function getActiveScope() {
    return state.activeScope && document.documentElement.contains(state.activeScope)
      ? state.activeScope
      : document;
  }

  function visibleScore(element) {
    var rect = element.getBoundingClientRect();
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    var width = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    var height = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function findReceivableLabel(scope) {
    var root = scope || document;
    var possibleLabels = Array.prototype.slice.call(root.querySelectorAll("div, span, p, label"));

    return possibleLabels.find(function (element) {
      return isVisible(element) && normalizeText(element.textContent) === "con phai thu";
    }) || null;
  }

  function loadState(options) {
    var forceApi = options && options.forceApi;

    return Promise.all([
      storageGet("sync", {
        selectedBankId: "",
        selectedBranchId: ""
      }),
      storageGet("local", {
        cachedConfig: null
      })
    ]).then(function (results) {
      state.settings = results[0] || state.settings;
      state.settings.selectedBranchId = state.settings.selectedBranchId || state.settings.selectedBankId || "";
      state.settings.selectedBankId = state.settings.selectedBankId || state.settings.selectedBranchId || "";
      state.config = normalizeConfig(results[1] && results[1].cachedConfig);

      return fetchConfig().then(function (config) {
        state.config = config;
        return storageSet("local", {
          cachedConfig: config
        }).then(function () {
          return state.config;
        });
      }).catch(function (error) {
        if (state.config && !forceApi) {
          return state.config;
        }

        throw error;
      });
    });
  }

  function refreshConfigInBackground() {
    fetchConfig().then(function (config) {
      state.config = config;
      return storageSet("local", {
        cachedConfig: config
      });
    }).then(function () {
      renderConfig();
    }).catch(function () {
      // Cache vẫn được dùng khi API tạm thời không truy cập được.
    });
  }

  function fetchConfig() {
    return getApiJson(getApiUrl("/api/branches")).then(function (json) {
      return json;
    }).then(function (json) {
      var config = normalizeConfig(json);
      if (!config || !config.banks.length) {
        throw new Error("API chưa có chi nhánh/ngân hàng active.");
      }
      return config;
    });
  }

  function renderConfig() {
    if (!state.elements.panel) {
      return;
    }

    var select = state.elements.bank;
    var banks = getBanks();
    select.textContent = "";

    if (!banks.length) {
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Chưa có cấu hình ngân hàng";
      select.appendChild(emptyOption);
      select.disabled = true;
      state.elements.changeNote.disabled = true;
      state.elements.bankInfo.textContent = "Không đọc được danh sách chi nhánh từ " + getApiBaseUrl() + ".";
      state.elements.amountText.textContent = "--";
      state.elements.noteText.textContent = "--";
      state.elements.noteWarningCode.textContent = "--";
      state.elements.noteWarning.classList.remove("gvq-show");
      state.elements.qrWrap.classList.remove("gvq-show");
      setStatus("", "");
      return;
    }

    banks.forEach(function (bank) {
      var option = document.createElement("option");
      option.value = bank.id;
      option.textContent = bank.label;
      select.appendChild(option);
    });

    var selectedBankId = state.settings.selectedBranchId || state.settings.selectedBankId;
    var hasSelectedBank = banks.some(function (bank) {
      return bank.id === selectedBankId;
    });

    select.value = hasSelectedBank ? selectedBankId : banks[0].id;
    state.settings.selectedBranchId = select.value;
    state.settings.selectedBankId = select.value;
    select.disabled = false;
    state.elements.changeNote.disabled = false;
    renderBankInfo();

    if (!state.elements.note.value) {
      var existingNote = getExistingTransferNote(getActiveScope());
      if (existingNote) {
        state.elements.note.value = existingNote;
        state.elements.noteText.textContent = existingNote;
      }
    }
  }

  function renderBankInfo() {
    var bank = getSelectedBank();
    if (!bank) {
      state.elements.bankInfo.textContent = "Chưa chọn ngân hàng.";
      return;
    }

    state.elements.bankInfo.textContent = [
      bank.branchName || bank.label || "Chi nhánh",
      " - ",
      bank.accountName || "Tên chủ TK chưa cấu hình",
      " - ",
      bank.accountNo
    ].join("");
  }

  function handleGenerate(options) {
    var refreshAmount = options && options.refreshAmount;
    var newNote = options && options.newNote;
    var restoreExistingNote = options && options.restoreExistingNote;
    var noScroll = options && options.noScroll;
    var banks = getBanks();
    if (!banks.length) {
      setStatus("Chưa có cấu hình ngân hàng. Hãy cấu hình API trong popup extension.", "error");
      return;
    }

    var bank = getSelectedBank();
    if (!bank) {
      setStatus("Hãy chọn ngân hàng nhận tiền.", "error");
      return;
    }

    var noteSource = "";
    if (newNote) {
      noteSource = buildTransferNote();
    } else if (restoreExistingNote) {
      noteSource = getExistingTransferNote(getActiveScope()) || "";
    } else {
      noteSource = state.elements.note.value || getExistingTransferNote(getActiveScope()) || buildTransferNote();
    }

    var note = getCanonicalTransferNote(noteSource) || sanitizeTransferNote(noteSource);
    if (!note && restoreExistingNote) {
      return;
    }
    if (!note) {
      note = buildTransferNote();
    }
    state.elements.note.value = note;

    var amount = refreshAmount ? detectAmountFromPage() : "";
    if (amount) {
      state.elements.amount.value = formatAmount(amount);
    }
    if (!amount) {
      amount = normalizeAmount(state.elements.amount.value);
    }
    if (!amount) {
      amount = detectAmountFromPage();
      if (amount) {
        state.elements.amount.value = formatAmount(amount);
      }
    }
    if (!amount) {
      setStatus("Chưa tìm thấy số tiền Còn phải thu trên trang.", "error");
      state.elements.amountText.textContent = "--";
      state.elements.noteText.textContent = note || "--";
      state.elements.noteWarningCode.textContent = note || "--";
      state.elements.noteWarning.classList.toggle("gvq-show", Boolean(note));
      state.elements.qrWrap.classList.remove("gvq-show");
      return;
    }

    var qrUrl = buildVietQrUrl(bank, amount, note);
    state.elements.panel.dataset.gvqNote = note;
    state.elements.panel.dataset.gvqAmount = amount;
    var filled = restoreExistingNote ? Boolean(findNoteTextarea(getActiveScope())) : fillSiteNote(note);

    state.elements.amountText.textContent = formatAmount(amount);
    state.elements.noteText.textContent = note;
    state.elements.noteWarningCode.textContent = note;
    state.elements.noteWarning.classList.add("gvq-show");
    state.elements.qrImg.src = qrUrl;
    state.elements.qrLink.href = qrUrl;
    state.elements.qrWrap.classList.add("gvq-show");
    if (!noScroll) {
      state.elements.panel.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    }

    setStatus(
      filled
        ? "Đã tạo QR và điền ghi chú vào ô Ghi chú."
        : "Đã tạo QR. Không tìm thấy ô Ghi chú để tự điền.",
      filled ? "ok" : "error"
    );
  }

  function buildVietQrUrl(bank, amount, note) {
    var bankId = encodeURIComponent(bank.bankId);
    var accountNo = encodeURIComponent(bank.accountNo);
    var template = encodeURIComponent(bank.template || getDefaultTemplate());
    var url = new URL("https://img.vietqr.io/image/" + bankId + "-" + accountNo + "-" + template + ".png");

    if (amount) {
      url.searchParams.set("amount", amount);
    }
    if (note) {
      url.searchParams.set("addInfo", note);
    }
    if (bank.accountName) {
      url.searchParams.set("accountName", bank.accountName);
    }

    return url.toString();
  }

  function fillSiteNote(note) {
    var textarea = findNoteTextarea(getActiveScope());
    if (!textarea) {
      return false;
    }

    setNativeValue(textarea, note);
    dispatchInputEvents(textarea, note);
    return true;
  }

  function findNoteTextarea(scope) {
    var root = scope || document;
    var selectors = [
      'textarea[placeholder="Ghi chu ..."]',
      'textarea[placeholder="Ghi chú ..."]',
      'textarea[placeholder*="Ghi"]',
      'textarea.q-field__native[placeholder*="Ghi"]',
      'textarea[id^="f_"][maxlength="255"]'
    ];

    for (var i = 0; i < selectors.length; i += 1) {
      var found = Array.prototype.slice.call(root.querySelectorAll(selectors[i]))
        .filter(isVisible)
        .find(isNoteTextarea);

      if (found) {
        return found;
      }
    }

    return Array.prototype.slice.call(root.querySelectorAll("textarea"))
      .filter(isVisible)
      .find(isNoteTextarea) || null;
  }

  function getExistingTransferNote(scope) {
    var textarea = findNoteTextarea(scope);
    if (!textarea) {
      return "";
    }

    return getCanonicalTransferNote(textarea.value || "");
  }

  function isGeneratedTransferNote(note) {
    return Boolean(getCanonicalTransferNote(note));
  }

  function getTransferNotePrefix() {
    var selectedBank = getSelectedBank();
    if (selectedBank && selectedBank.transferPrefix) {
      return selectedBank.transferPrefix;
    }

    var noteConfig = state.config && state.config.note ? state.config.note : {};
    return noteConfig.prefix || "GOFOOD";
  }

  function getTransferNotePrefixes() {
    var prefixes = [getTransferNotePrefix()];
    var noteConfig = state.config && state.config.note ? state.config.note : {};

    if (noteConfig.prefix) {
      prefixes.push(noteConfig.prefix);
    }

    getBanks().forEach(function (bank) {
      if (bank.transferPrefix) {
        prefixes.push(bank.transferPrefix);
      }
    });

    prefixes.push("GOFOOD");

    var seen = {};
    return prefixes.map(function (prefix) {
      return sanitizeTransferNote(prefix).replace(/\s+/g, "");
    }).filter(function (prefix) {
      if (!prefix || seen[prefix]) {
        return false;
      }
      seen[prefix] = true;
      return true;
    });
  }

  function getCanonicalTransferNote(value) {
    var normalized = removeVietnameseMarks(String(value || ""))
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
    var compact = normalized.replace(/\s+/g, "");

    var prefixes = getTransferNotePrefixes();
    for (var i = 0; i < prefixes.length; i += 1) {
      var prefix = prefixes[i];
      var match = compact.match(new RegExp("^" + escapeRegExp(prefix) + "(\\d{12})"));
      if (match) {
        return prefix + match[1];
      }
    }

    return "";
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isNoteTextarea(element) {
    var placeholder = removeVietnameseMarks(element.getAttribute("placeholder") || "").toLowerCase();
    var maxLength = element.getAttribute("maxlength");
    return placeholder.indexOf("ghi chu") >= 0 || maxLength === "255";
  }

  function isVisible(element) {
    var style = window.getComputedStyle(element);
    var rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && rect.width > 0
      && rect.height > 0;
  }

  function setNativeValue(element, value) {
    var prototype = Object.getPrototypeOf(element);
    var descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function dispatchInputEvents(element, value) {
    try {
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: value,
        inputType: "insertText"
      }));
    } catch (error) {
      element.dispatchEvent(new Event("input", {
        bubbles: true
      }));
    }

    element.dispatchEvent(new Event("change", {
      bubbles: true
    }));
  }

  function primeAmountField(options) {
    var force = options && options.force;
    var receivableAmount = detectReceivableAmountFromPage(getActiveScope());
    if (receivableAmount) {
      state.elements.amount.value = formatAmount(receivableAmount);
      state.elements.amountText.textContent = formatAmount(receivableAmount);
      return;
    }

    if (state.elements.amount.value && !force) {
      return;
    }

    var defaults = state.config && state.config.defaults ? state.config.defaults : {};
    var defaultAmount = normalizeAmount(defaults.amount || "");
    if (defaultAmount) {
      state.elements.amount.value = formatAmount(defaultAmount);
      state.elements.amountText.textContent = formatAmount(defaultAmount);
      return;
    }

    var detectedAmount = detectAmountFromPage();
    if (detectedAmount) {
      state.elements.amount.value = formatAmount(detectedAmount);
      state.elements.amountText.textContent = formatAmount(detectedAmount);
    }
  }

  function detectAmountFromPage() {
    var scope = getActiveScope();
    var receivableAmount = detectReceivableAmountFromPage(scope);
    if (receivableAmount) {
      return receivableAmount;
    }

    var text = scope && scope.innerText ? scope.innerText || "" : (document.body ? document.body.innerText || "" : "");
    var candidates = [];
    var regexes = [
      /(?:con\s*phai\s*thu|tong\s*(?:cong|tien)|thanh\s*toan|phai\s*tra)[^\d]{0,50}((?:\d{1,3}[.,])+\d{3}|\d{4,})\s*(?:d|vnd|₫)?/gi,
      /((?:\d{1,3}[.,])+\d{3}|\d{4,})\s*(?:d|vnd|₫)/gi
    ];
    var normalized = removeVietnameseMarks(text).toLowerCase();

    regexes.forEach(function (regex) {
      var match = regex.exec(normalized);
      while (match) {
        var amount = normalizeAmount(match[1]);
        if (amount && Number(amount) >= 1000 && Number(amount) <= 9999999999999) {
          candidates.push(Number(amount));
        }
        match = regex.exec(normalized);
      }
    });

    if (!candidates.length) {
      return "";
    }

    return String(Math.max.apply(Math, candidates));
  }

  function detectReceivableAmountFromPage(scope) {
    var root = scope || document;
    var possibleLabels = Array.prototype.slice.call(root.querySelectorAll("div, span, p, label"));

    for (var i = 0; i < possibleLabels.length; i += 1) {
      var element = possibleLabels[i];
      if (!isVisible(element)) {
        continue;
      }

      var labelText = normalizeText(element.textContent);
      if (labelText !== "con phai thu") {
        continue;
      }

      var amount = extractLikelyAmountFromText(getNearbyAmountText(element));
      if (amount) {
        return amount;
      }
    }

    var rows = Array.prototype.slice.call(root.querySelectorAll(".row, .misa-div, div"));
    for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      var row = rows[rowIndex];
      if (!isVisible(row)) {
        continue;
      }

      var rowText = normalizeText(row.textContent);
      if (rowText.indexOf("con phai thu") < 0 || rowText.length > 120) {
        continue;
      }

      var rowAmount = extractLikelyAmountFromText(row.textContent);
      if (rowAmount) {
        return rowAmount;
      }
    }

    return "";
  }

  function getNearbyAmountText(labelElement) {
    var chunks = [];
    var next = labelElement.nextElementSibling;
    var previous = labelElement.previousElementSibling;

    if (next) {
      chunks.push(next.textContent || "");
    }
    if (previous) {
      chunks.push(previous.textContent || "");
    }

    if (labelElement.parentElement) {
      chunks.push(labelElement.parentElement.textContent || "");
      Array.prototype.slice.call(labelElement.parentElement.children).forEach(function (child) {
        if (child !== labelElement) {
          chunks.push(child.textContent || "");
        }
      });
    }

    var row = labelElement.closest(".row");
    if (row) {
      chunks.push(row.textContent || "");
    }

    return chunks.join(" ");
  }

  function extractLikelyAmountFromText(text) {
    var matches = String(text || "").match(/(?:\d{1,3}(?:[.,]\d{3})+|\d{4,})/g) || [];
    var candidates = matches.map(function (match) {
      return normalizeAmount(match);
    }).filter(function (amount) {
      return amount && Number(amount) >= 1000 && Number(amount) <= 9999999999999;
    });

    if (!candidates.length) {
      return "";
    }

    return String(Math.max.apply(Math, candidates.map(Number)));
  }

  function normalizeText(value) {
    return removeVietnameseMarks(value)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function detectOrderCode() {
    var scope = getActiveScope();
    var text = removeVietnameseMarks(scope && scope.innerText ? scope.innerText || "" : (document.body ? document.body.innerText || "" : ""));
    var match = text.match(/(?:ma\s*(?:don|hoa\s*don|phieu)|so\s*(?:don|hoa\s*don|phieu)|order)\D{0,24}([a-z0-9][a-z0-9._-]{2,30})/i);
    return match ? match[1] : "";
  }

  function buildTransferNote() {
    var prefix = sanitizeTransferNote(getTransferNotePrefix()).replace(/\s+/g, "");
    return prefix + createUniqueTimestampCode(prefix);
  }

  function createUniqueTimestampCode(prefix) {
    var epochSecond = Math.floor(Date.now() / 1000);
    if (state.lastNoteEpochSecond && epochSecond <= state.lastNoteEpochSecond) {
      epochSecond = state.lastNoteEpochSecond + 1;
    }

    var code = formatTimestampCode(new Date(epochSecond * 1000));
    while (isTransferCodeUsed(prefix, code)) {
      epochSecond += 1;
      code = formatTimestampCode(new Date(epochSecond * 1000));
    }

    state.lastNoteEpochSecond = epochSecond;
    state.generatedNoteCodes[prefix + code] = true;
    return code;
  }

  function isTransferCodeUsed(prefix, code) {
    var note = prefix + code;
    if (state.generatedNoteCodes[note]) {
      return true;
    }

    return Array.prototype.slice.call(document.querySelectorAll("textarea")).some(function (textarea) {
      return getCanonicalTransferNote(textarea.value || "") === note;
    });
  }

  function formatTimestampCode(date) {
    return [
      String(date.getFullYear()).slice(2),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join("");
  }

  function sanitizeTransferNote(value) {
    var noteConfig = state.config && state.config.note ? state.config.note : {};
    var maxLength = Number(noteConfig.maxLength || noteConfig.max_length || 50);
    var normalized = removeVietnameseMarks(String(value || ""))
      .replace(/[^a-zA-Z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (noteConfig.uppercase !== false) {
      normalized = normalized.toUpperCase();
    }

    return normalized.slice(0, Math.max(1, Math.min(maxLength, 50))).trim();
  }

  function normalizeConfig(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    var banks = Array.isArray(raw.banks)
      ? raw.banks
      : (Array.isArray(raw.data) ? raw.data : []);
    var normalizedBanks = banks.map(function (bank, index) {
      var bankId = String(bank.bankId || bank.bank_id || bank.bank_bin || bank.bin || bank.code || "").trim();
      var accountNo = String(bank.accountNo || bank.account_no || bank.account_number || bank.account || "").replace(/\s+/g, "").trim();
      var accountName = String(bank.accountName || bank.account_name || "").trim();
      var bankName = String(bank.bankName || bank.bank_name || bank.shortName || "").trim();
      var branchName = String(bank.branchName || bank.branch_name || bank.name || "").trim();
      var transferPrefix = String(bank.transferPrefix || bank.transfer_prefix || "").trim();
      var id = String(bank.id || bank.branch_id || bankId + "-" + accountNo || "bank-" + index).trim();
      var label = String(bank.label || [branchName, bankName || bank.code || bankId, accountNo].filter(Boolean).join(" - ")).trim();
      var template = String(bank.template || "").trim();

      return {
        id: id,
        branchId: id,
        branchName: branchName,
        label: label || "Tài khoản " + (index + 1),
        bankName: bankName,
        bankId: bankId,
        accountNo: accountNo,
        accountName: accountName,
        transferPrefix: transferPrefix,
        template: template || null
      };
    }).filter(function (bank) {
      return bank.bankId && bank.accountNo;
    });

    return {
      ok: raw.ok !== false && raw.success !== false,
      defaults: raw.defaults || {},
      note: raw.note || {
        prefix: "GOFOOD",
        maxLength: 50,
        uppercase: true
      },
      endpoints: raw.endpoints || {},
      banks: normalizedBanks
    };
  }

  function getBanks() {
    return state.config && Array.isArray(state.config.banks) ? state.config.banks : [];
  }

  function getSelectedBank() {
    var selectedId = state.elements.bank && state.elements.bank.value
      ? state.elements.bank.value
      : (state.settings.selectedBranchId || state.settings.selectedBankId);
    return getBanks().find(function (bank) {
      return bank.id === selectedId;
    }) || null;
  }

  function getDefaultTemplate() {
    return (state.config && state.config.defaults && state.config.defaults.template) || DEFAULT_TEMPLATE;
  }

  function normalizeAmount(value) {
    var digits = String(value || "").replace(/[^\d]/g, "");
    if (!digits || Number(digits) <= 0) {
      return "";
    }
    return digits.slice(0, 13);
  }

  function formatAmount(value) {
    var digits = normalizeAmount(value);
    if (!digits) {
      return "";
    }
    return new Intl.NumberFormat("vi-VN").format(Number(digits));
  }

  function removeVietnameseMarks(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function setStatus(message, tone) {
    state.elements.status.textContent = message || "";
    state.elements.status.classList.toggle("gvq-error", tone === "error");
    state.elements.status.classList.toggle("gvq-ok", tone === "ok");
  }

  function storageGet(areaName, defaults) {
    return new Promise(function (resolve) {
      chrome.storage[areaName].get(defaults, function (items) {
        resolve(items || defaults);
      });
    });
  }

  function storageSet(areaName, items) {
    return new Promise(function (resolve) {
      chrome.storage[areaName].set(items, resolve);
    });
  }
})();
