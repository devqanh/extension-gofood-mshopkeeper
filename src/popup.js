(function () {
  "use strict";

  var API_REQUEST_MESSAGE_TYPE = "GOFOOD_VIETQR_API_REQUEST";
  var BRANCH_SELECTION_RESET_VERSION = "2026-07-08-clear-default-branch";

  var state = {
    settings: {
      selectedBankId: "",
      selectedBranchId: ""
    },
    config: null
  };

  var elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    elements.loadApi = document.getElementById("load-api");
    elements.save = document.getElementById("save");
    elements.bankSelect = document.getElementById("bank-select");
    elements.bankInfo = document.getElementById("bank-info");
    elements.status = document.getElementById("status");

    elements.loadApi.addEventListener("click", loadBranches);
    elements.save.addEventListener("click", saveSettings);
    elements.bankSelect.addEventListener("change", function () {
      state.settings.selectedBranchId = elements.bankSelect.value || "";
      state.settings.selectedBankId = state.settings.selectedBranchId;
      renderBankInfo();
      saveSettings({
        auto: true
      });
    });

    Promise.all([
      storageGet("sync", {
        selectedBankId: "",
        selectedBranchId: ""
      }),
      storageGet("local", {
        cachedConfig: null,
        branchSelectionResetVersion: ""
      })
    ]).then(function (results) {
      var localState = results[1] || {};
      state.settings = results[0] || state.settings;
      if (localState.branchSelectionResetVersion !== BRANCH_SELECTION_RESET_VERSION) {
        state.settings.selectedBranchId = "";
        state.settings.selectedBankId = "";
        return Promise.all([
          storageSet("sync", state.settings),
          storageSet("local", {
            branchSelectionResetVersion: BRANCH_SELECTION_RESET_VERSION
          })
        ]).then(function () {
          state.config = normalizeConfig(localState.cachedConfig);
          renderConfig();
          return loadBranches();
        });
      }

      state.settings.selectedBranchId = state.settings.selectedBranchId || state.settings.selectedBankId || "";
      state.settings.selectedBankId = state.settings.selectedBankId || state.settings.selectedBranchId || "";
      state.config = normalizeConfig(localState.cachedConfig);
      renderConfig();
      return loadBranches();
    }).catch(function (error) {
      setStatus(error.message, "error");
    });
  }

  function loadBranches() {
    setBusy(true);
    setStatus("Đang tải danh sách chi nhánh...", "");

    return getApiJson(getApiUrl("/api/branches")).then(function (json) {
      var config = normalizeConfig(json);
      if (!config || !config.banks.length) {
        throw new Error("API chưa trả về chi nhánh có thông tin ngân hàng.");
      }

      state.config = config;
      return Promise.all([
        storageSet("local", {
          cachedConfig: config
        })
      ]);
    }).then(function () {
      renderConfig();
      setStatus("Đã tải chi nhánh từ API.", "ok");
    }).catch(function (error) {
      setStatus(error.message, "error");
    }).finally(function () {
      setBusy(false);
    });
  }

  function saveSettings(options) {
    var isAuto = options && options.auto;
    state.settings.selectedBranchId = elements.bankSelect.value || "";
    state.settings.selectedBankId = state.settings.selectedBranchId;

    Promise.all([
      storageSet("sync", state.settings),
      storageSet("local", {
        cachedConfig: state.config
      })
    ]).then(function () {
      setStatus(isAuto ? "Đã chọn chi nhánh cho QR." : "Đã lưu chi nhánh mặc định.", "ok");
    });
  }

  function renderConfig() {
    var banks = state.config && state.config.banks ? state.config.banks : [];
    elements.bankSelect.textContent = "";

    if (!banks.length) {
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Chưa có chi nhánh";
      elements.bankSelect.appendChild(emptyOption);
      elements.bankSelect.disabled = true;
      elements.bankInfo.textContent = "Bấm Tải chi nhánh để lấy danh sách chi nhánh nhận tiền.";
      return;
    }

    var placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "Chọn chi nhánh nhận tiền";
    elements.bankSelect.appendChild(placeholderOption);

    banks.forEach(function (bank) {
      var option = document.createElement("option");
      option.value = bank.id;
      option.textContent = bank.label;
      elements.bankSelect.appendChild(option);
    });

    var selectedId = state.settings.selectedBranchId || state.settings.selectedBankId;
    var selectedExists = banks.some(function (bank) {
      return bank.id === selectedId;
    });
    elements.bankSelect.value = selectedExists ? selectedId : "";
    state.settings.selectedBranchId = selectedExists ? elements.bankSelect.value : "";
    state.settings.selectedBankId = state.settings.selectedBranchId;
    elements.bankSelect.disabled = false;
    renderBankInfo();
  }

  function renderBankInfo() {
    var bank = getSelectedBank();
    if (!bank) {
      elements.bankInfo.textContent = "Chưa chọn chi nhánh.";
      return;
    }

    elements.bankInfo.textContent = [
      "Chi nhánh: ",
      bank.branchName || bank.label || "Chưa cấu hình",
      "\nNgân hàng: ",
      bank.bankName || bank.bankId || "Chưa cấu hình",
      "\nChủ TK: ",
      bank.accountName || "Chưa cấu hình",
      "\nSTK: ",
      bank.accountNo,
      "\nPrefix: ",
      bank.transferPrefix || "GOFOOD"
    ].join("");
  }

  function normalizeConfig(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    var branches = Array.isArray(raw.banks)
      ? raw.banks
      : (Array.isArray(raw.data) ? raw.data : []);
    var normalizedBanks = branches.map(function (branch, index) {
      var bankId = String(branch.bankId || branch.bank_id || branch.bank_bin || branch.bin || branch.code || "").trim();
      var accountNo = String(branch.accountNo || branch.account_no || branch.account_number || branch.account || "").replace(/\s+/g, "").trim();
      var accountName = String(branch.accountName || branch.account_name || "").trim();
      var bankName = String(branch.bankName || branch.bank_name || branch.shortName || "").trim();
      var branchName = String(branch.branchName || branch.branch_name || branch.name || "").trim();
      var transferPrefix = String(branch.transferPrefix || branch.transfer_prefix || "").trim();
      var id = String(branch.id || branch.branch_id || bankId + "-" + accountNo || "branch-" + index).trim();
      var label = String(branch.label || [branchName, bankName || bankId, accountNo].filter(Boolean).join(" - ")).trim();

      return {
        id: id,
        branchId: id,
        branchName: branchName,
        label: label || "Chi nhánh " + (index + 1),
        bankName: bankName,
        bankId: bankId,
        accountNo: accountNo,
        accountName: accountName,
        transferPrefix: transferPrefix,
        template: String(branch.template || "").trim() || null
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

  function getApiJson(endpoint) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({
        type: API_REQUEST_MESSAGE_TYPE,
        method: "GET",
        endpoint: endpoint
      }, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || "Không gửi được request tới background."));
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

  function getApiBaseUrl() {
    var config = window.GOFOOD_API_CONFIG || {};
    return String(config.baseUrl || "https://gofood.dewa.vn").replace(/\/+$/, "");
  }

  function getApiUrl(path) {
    return getApiBaseUrl() + "/" + String(path || "").replace(/^\/+/, "");
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
