(function () {
  "use strict";

  var state = {
    settings: {
      apiUrl: "",
      selectedBankId: ""
    },
    config: null
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

    elements.loadApi.addEventListener("click", loadApiConfig);
    elements.save.addEventListener("click", saveSettings);
    elements.bankSelect.addEventListener("change", renderBankInfo);

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

  function setStatus(message, tone) {
    elements.status.textContent = message || "";
    elements.status.classList.toggle("error", tone === "error");
    elements.status.classList.toggle("ok", tone === "ok");
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
