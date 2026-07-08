(function () {
  "use strict";

  var state = {
    settings: {
      apiUrl: "",
      selectedBankId: ""
    },
    config: null,
    refs: {
      page: 1,
      perPage: 10,
      total: 0,
      totalPages: 1,
      items: []
    }
  };

  var elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    elements.apiUrl = document.getElementById("api-url");
    elements.loadApi = document.getElementById("load-api");
    elements.save = document.getElementById("save");
    elements.bankSelect = document.getElementById("bank-select");
    elements.bankInfo = document.getElementById("bank-info");
    elements.status = document.getElementById("status");
    elements.refreshRefs = document.getElementById("refresh-refs");
    elements.refsList = document.getElementById("refs-list");
    elements.refsPrev = document.getElementById("refs-prev");
    elements.refsNext = document.getElementById("refs-next");
    elements.refsPage = document.getElementById("refs-page");
    elements.refsStatus = document.getElementById("refs-status");

    elements.loadApi.addEventListener("click", loadApiConfig);
    elements.save.addEventListener("click", saveSettings);
    elements.bankSelect.addEventListener("change", renderBankInfo);
    elements.refreshRefs.addEventListener("click", function () {
      loadInvoiceRefs(state.refs.page);
    });
    elements.refsPrev.addEventListener("click", function () {
      loadInvoiceRefs(Math.max(1, state.refs.page - 1));
    });
    elements.refsNext.addEventListener("click", function () {
      loadInvoiceRefs(Math.min(state.refs.totalPages, state.refs.page + 1));
    });

    Promise.all([
      storageGet("sync", {
        apiUrl: "",
        selectedBankId: ""
      }),
      storageGet("local", {
        cachedConfig: null
      })
    ]).then(function (results) {
      state.settings = results[0];
      state.config = normalizeConfig(results[1].cachedConfig);
      elements.apiUrl.value = state.settings.apiUrl || "";
      renderConfig();
      loadInvoiceRefs(1);
    });
  }

  function loadApiConfig() {
    var apiUrl = elements.apiUrl.value.trim();
    if (!apiUrl) {
      setStatus("Nhập API URL PHP trước.", "error");
      return;
    }

    setBusy(true);
    fetch(apiUrl, {
      cache: "no-store",
      credentials: "omit"
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("API trả về HTTP " + response.status + ".");
      }
      return response.json();
    }).then(function (json) {
      var config = normalizeConfig(json);
      if (!config || !config.banks.length) {
        throw new Error("API chưa có tài khoản ngân hàng active.");
      }

      state.config = config;
      state.settings.apiUrl = apiUrl;
      if (!state.settings.selectedBankId) {
        state.settings.selectedBankId = config.banks[0].id;
      }

      return Promise.all([
        storageSet("sync", state.settings),
        storageSet("local", {
          cachedConfig: config
        })
      ]);
    }).then(function () {
      renderConfig();
      setStatus("Đã tải và lưu cấu hình API.", "ok");
      loadInvoiceRefs(1);
    }).catch(function (error) {
      setStatus(error.message, "error");
    }).finally(function () {
      setBusy(false);
    });
  }

  function saveSettings() {
    state.settings.apiUrl = elements.apiUrl.value.trim();
    state.settings.selectedBankId = elements.bankSelect.value || "";

    Promise.all([
      storageSet("sync", state.settings),
      storageSet("local", {
        cachedConfig: state.config
      })
    ]).then(function () {
      setStatus("Đã lưu cấu hình.", "ok");
      loadInvoiceRefs(1);
    });
  }

  function renderConfig() {
    var banks = state.config && state.config.banks ? state.config.banks : [];
    elements.bankSelect.textContent = "";

    if (!banks.length) {
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Chưa có dữ liệu";
      elements.bankSelect.appendChild(emptyOption);
      elements.bankSelect.disabled = true;
      elements.bankInfo.textContent = "Nhập API URL PHP, bấm Tải API, sau đó chọn ngân hàng mặc định.";
      return;
    }

    banks.forEach(function (bank) {
      var option = document.createElement("option");
      option.value = bank.id;
      option.textContent = bank.label;
      elements.bankSelect.appendChild(option);
    });

    var selectedExists = banks.some(function (bank) {
      return bank.id === state.settings.selectedBankId;
    });
    elements.bankSelect.value = selectedExists ? state.settings.selectedBankId : banks[0].id;
    elements.bankSelect.disabled = false;
    renderBankInfo();
  }

  function renderBankInfo() {
    var bank = getSelectedBank();
    if (!bank) {
      elements.bankInfo.textContent = "Chưa chọn ngân hàng.";
      return;
    }

    elements.bankInfo.textContent = [
      "Chủ TK: ",
      bank.accountName || "Chưa cấu hình",
      "\nSTK: ",
      bank.accountNo,
      "\nBank ID: ",
      bank.bankId,
      " | Mẫu QR: ",
      bank.template || getDefaultTemplate()
    ].join("");
  }

  function loadInvoiceRefs(page) {
    var endpoint = getInvoiceRefsEndpoint();

    if (!endpoint) {
      renderRefs([]);
      setRefsStatus("Nhập API URL PHP để xem danh sách RefNo.", "");
      return;
    }

    state.refs.page = page || 1;
    setRefsBusy(true);

    var url;
    try {
      url = new URL(endpoint);
      url.searchParams.set("page", String(state.refs.page));
      url.searchParams.set("perPage", String(state.refs.perPage));
    } catch (error) {
      setRefsStatus("Endpoint danh sách RefNo không hợp lệ.", "error");
      setRefsBusy(false);
      return;
    }

    fetch(url.toString(), {
      cache: "no-store",
      credentials: "omit"
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("API danh sách trả về HTTP " + response.status + ".");
      }
      return response.json();
    }).then(function (json) {
      if (!json || json.ok === false) {
        throw new Error(json && json.error ? json.error : "Không tải được danh sách RefNo.");
      }

      state.refs.page = Number(json.page || 1);
      state.refs.perPage = Number(json.perPage || state.refs.perPage);
      state.refs.total = Number(json.total || 0);
      state.refs.totalPages = Math.max(1, Number(json.totalPages || 1));
      state.refs.items = Array.isArray(json.items) ? json.items : [];
      renderRefs(state.refs.items);
      setRefsStatus(state.refs.total ? "Tổng " + state.refs.total + " bản ghi." : "Chưa có RefNo nào.", state.refs.total ? "ok" : "");
    }).catch(function (error) {
      renderRefs([]);
      setRefsStatus(error.message, "error");
    }).finally(function () {
      setRefsBusy(false);
    });
  }

  function renderRefs(items) {
    elements.refsList.textContent = "";

    if (!items.length) {
      elements.refsList.textContent = "Chưa có dữ liệu.";
    } else {
      items.forEach(function (item) {
        var row = document.createElement("div");
        var title = document.createElement("strong");
        var meta = document.createElement("span");
        var time = document.createElement("span");

        row.className = "ref-item";
        title.textContent = (item.transferNote || "--") + " → RefNo " + (item.refNo || "--");
        meta.textContent = [
          item.amountText || formatAmount(item.amount || ""),
          item.bankAccountNo ? "STK " + item.bankAccountNo : ""
        ].filter(Boolean).join(" | ");
        time.textContent = formatTime(item.updatedAt || item.capturedAt || item.createdAt || "");

        row.appendChild(title);
        if (meta.textContent) {
          row.appendChild(meta);
        }
        if (time.textContent) {
          row.appendChild(time);
        }
        elements.refsList.appendChild(row);
      });
    }

    elements.refsPage.textContent = "Trang " + state.refs.page + "/" + state.refs.totalPages;
    elements.refsPrev.disabled = state.refs.page <= 1;
    elements.refsNext.disabled = state.refs.page >= state.refs.totalPages;
  }

  function getInvoiceRefsEndpoint() {
    var endpoints = state.config && state.config.endpoints ? state.config.endpoints : {};
    var configured = endpoints.invoiceRefs || endpoints.invoice_refs || endpoints.saveRef || endpoints.save_ref;
    var apiUrl = elements.apiUrl.value.trim() || state.settings.apiUrl || "";

    if (configured) {
      try {
        return new URL(String(configured), apiUrl || window.location.href).toString();
      } catch (error) {
        return String(configured);
      }
    }

    if (!apiUrl) {
      return "";
    }

    try {
      return new URL("invoice-refs.php", apiUrl).toString();
    } catch (error) {
      return "";
    }
  }

  function normalizeConfig(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    var banks = Array.isArray(raw.banks) ? raw.banks : [];
    var normalizedBanks = banks.map(function (bank, index) {
      var bankId = String(bank.bankId || bank.bank_id || bank.bin || bank.code || "").trim();
      var accountNo = String(bank.accountNo || bank.account_no || bank.account || "").replace(/\s+/g, "").trim();
      var accountName = String(bank.accountName || bank.account_name || "").trim();
      var id = String(bank.id || bankId + "-" + accountNo || "bank-" + index).trim();
      var label = String(bank.label || [bank.shortName || bank.code || bankId, accountNo].filter(Boolean).join(" - ")).trim();
      var template = String(bank.template || "").trim();

      return {
        id: id,
        label: label || "Tài khoản " + (index + 1),
        bankId: bankId,
        accountNo: accountNo,
        accountName: accountName,
        template: template || null
      };
    }).filter(function (bank) {
      return bank.bankId && bank.accountNo;
    });

    return {
      ok: raw.ok !== false,
      defaults: raw.defaults || {},
      note: raw.note || {},
      endpoints: raw.endpoints || {},
      banks: normalizedBanks
    };
  }

  function getSelectedBank() {
    var banks = state.config && state.config.banks ? state.config.banks : [];
    var selectedId = elements.bankSelect.value;
    return banks.find(function (bank) {
      return bank.id === selectedId;
    }) || null;
  }

  function getDefaultTemplate() {
    return state.config && state.config.defaults && state.config.defaults.template
      ? state.config.defaults.template
      : "compact2";
  }

  function setBusy(isBusy) {
    elements.loadApi.disabled = isBusy;
    elements.save.disabled = isBusy;
  }

  function setRefsBusy(isBusy) {
    elements.refreshRefs.disabled = isBusy;
    elements.refsPrev.disabled = isBusy || state.refs.page <= 1;
    elements.refsNext.disabled = isBusy || state.refs.page >= state.refs.totalPages;
  }

  function setStatus(message, tone) {
    elements.status.textContent = message || "";
    elements.status.classList.toggle("error", tone === "error");
    elements.status.classList.toggle("ok", tone === "ok");
  }

  function setRefsStatus(message, tone) {
    elements.refsStatus.textContent = message || "";
    elements.refsStatus.classList.toggle("error", tone === "error");
    elements.refsStatus.classList.toggle("ok", tone === "ok");
  }

  function formatAmount(value) {
    var digits = String(value || "").replace(/[^\d]/g, "");
    if (!digits) {
      return "";
    }
    return new Intl.NumberFormat("vi-VN").format(Number(digits));
  }

  function formatTime(value) {
    if (!value) {
      return "";
    }

    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString("vi-VN");
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
