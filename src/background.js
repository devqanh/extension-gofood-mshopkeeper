(function () {
  "use strict";

  var API_REQUEST_MESSAGE_TYPE = "GOFOOD_VIETQR_API_REQUEST";
  var LEGACY_WEBHOOK_MESSAGE_TYPE = "GOFOOD_VIETQR_POST_WEBHOOK";
  var API_ORIGIN = "https://gofood.dewa.vn";
  var ALLOWED_API_PATHS = [
    "/api/branches",
    "/api/transactions/sync"
  ];

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || (message.type !== API_REQUEST_MESSAGE_TYPE && message.type !== LEGACY_WEBHOOK_MESSAGE_TYPE)) {
      return false;
    }

    requestApi(message).then(function (result) {
      sendResponse(result);
    }).catch(function (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    });

    return true;
  });

  function requestApi(message) {
    var endpoint = message.endpoint || message.url || "";
    var method = String(message.method || "POST").toUpperCase();
    var payload = message.payload;

    if (!endpoint) {
      return Promise.resolve({
        ok: false,
        error: "Missing API endpoint"
      });
    }

    if (!isAllowedApiEndpoint(endpoint)) {
      return Promise.resolve({
        ok: false,
        error: "API endpoint is not allowed"
      });
    }

    var options = {
      method: method,
      cache: "no-store",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json"
      }
    };

    if (method !== "GET" && method !== "HEAD") {
      options.body = JSON.stringify(payload || {});
    }

    return fetch(endpoint, options).then(function (response) {
      return response.text().catch(function () {
        return "";
      }).then(function (bodyText) {
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          bodyText: bodyText.slice(0, 2000),
          json: parseJson(bodyText)
        };
      });
    });
  }

  function isAllowedApiEndpoint(endpoint) {
    try {
      var url = new URL(endpoint);
      return url.origin === API_ORIGIN && ALLOWED_API_PATHS.indexOf(url.pathname) !== -1;
    } catch (error) {
      return false;
    }
  }

  function parseJson(text) {
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }
})();
