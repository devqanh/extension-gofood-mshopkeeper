(function () {
  "use strict";

  var WEBHOOK_MESSAGE_TYPE = "GOFOOD_VIETQR_POST_WEBHOOK";

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== WEBHOOK_MESSAGE_TYPE) {
      return false;
    }

    postJson(message.endpoint, message.payload).then(function (result) {
      sendResponse(result);
    }).catch(function (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    });

    return true;
  });

  function postJson(endpoint, payload) {
    if (!endpoint) {
      return Promise.resolve({
        ok: false,
        error: "Missing webhook endpoint"
      });
    }

    return fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload || {})
    }).then(function (response) {
      return response.text().catch(function () {
        return "";
      }).then(function (bodyText) {
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          bodyText: bodyText.slice(0, 2000)
        };
      });
    });
  }
})();
