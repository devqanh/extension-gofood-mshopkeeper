(function () {
  "use strict";

  var HOOK_FLAG = "__gofoodVietqrSaveSyncHookInstalled";
  var MESSAGE_SOURCE = "gofood-vietqr-page-hook";
  var MESSAGE_TYPE = "GOFOOD_VIETQR_SAVE_SYNC_RESPONSE";

  if (window[HOOK_FLAG]) {
    return;
  }

  try {
    Object.defineProperty(window, HOOK_FLAG, {
      configurable: false,
      enumerable: false,
      value: true
    });
  } catch (error) {
    window[HOOK_FLAG] = true;
  }

  installFetchHook();
  installXhrHook();

  function installFetchHook() {
    if (typeof window.fetch !== "function") {
      return;
    }

    var nativeFetch = window.fetch;

    window.fetch = function () {
      var args = Array.prototype.slice.call(arguments);
      var request = getFetchRequest(args[0], args[1]);
      var shouldCapture = isSaveSyncUrl(request.url);

      return nativeFetch.apply(this, args).then(function (response) {
        if (shouldCapture) {
          captureFetchResponse(response, request);
        }

        return response;
      });
    };
  }

  function installXhrHook() {
    if (typeof window.XMLHttpRequest !== "function") {
      return;
    }

    var proto = window.XMLHttpRequest.prototype;
    var nativeOpen = proto.open;
    var nativeSend = proto.send;

    proto.open = function (method, url) {
      this.__gofoodVietqrRequest = {
        method: String(method || "GET").toUpperCase(),
        url: normalizeUrl(url)
      };

      return nativeOpen.apply(this, arguments);
    };

    proto.send = function () {
      var xhr = this;
      var request = xhr.__gofoodVietqrRequest;

      if (request && isSaveSyncUrl(request.url)) {
        xhr.addEventListener("loadend", function () {
          captureXhrResponse(xhr, request);
        });
      }

      return nativeSend.apply(xhr, arguments);
    };
  }

  function captureFetchResponse(response, request) {
    var cloned;

    try {
      cloned = response.clone();
    } catch (error) {
      emitResponse({
        source: "fetch",
        method: request.method,
        url: request.url,
        status: response.status || 0,
        ok: Boolean(response.ok),
        bodyText: "",
        parseError: "Cannot clone response"
      });
      return;
    }

    cloned.text().then(function (bodyText) {
      emitResponse({
        source: "fetch",
        method: request.method,
        url: response.url || request.url,
        status: response.status || 0,
        ok: Boolean(response.ok),
        bodyText: bodyText,
        headers: headersToObject(response.headers)
      });
    }).catch(function (error) {
      emitResponse({
        source: "fetch",
        method: request.method,
        url: response.url || request.url,
        status: response.status || 0,
        ok: Boolean(response.ok),
        bodyText: "",
        parseError: error && error.message ? error.message : "Cannot read response"
      });
    });
  }

  function captureXhrResponse(xhr, request) {
    var bodyText = "";

    try {
      if (!xhr.responseType || xhr.responseType === "text" || xhr.responseType === "json") {
        bodyText = xhr.responseType === "json" && xhr.response
          ? JSON.stringify(xhr.response)
          : String(xhr.responseText || "");
      }
    } catch (error) {
      bodyText = "";
    }

    emitResponse({
      source: "xhr",
      method: request.method,
      url: xhr.responseURL || request.url,
      status: xhr.status || 0,
      ok: xhr.status >= 200 && xhr.status < 300,
      bodyText: bodyText
    });
  }

  function emitResponse(payload) {
    payload.bodyJson = parseJson(payload.bodyText);
    payload.capturedAt = new Date().toISOString();

    window.postMessage({
      source: MESSAGE_SOURCE,
      type: MESSAGE_TYPE,
      payload: payload
    }, window.location.origin);
  }

  function getFetchRequest(input, init) {
    var method = init && init.method ? init.method : "";
    var url = "";

    if (input instanceof Request) {
      url = input.url;
      method = method || input.method;
    } else {
      url = normalizeUrl(input);
    }

    return {
      method: String(method || "GET").toUpperCase(),
      url: normalizeUrl(url)
    };
  }

  function normalizeUrl(value) {
    try {
      return new URL(String(value || ""), window.location.href).toString();
    } catch (error) {
      return String(value || "");
    }
  }

  function isSaveSyncUrl(url) {
    var normalized = normalizeUrl(url).toLowerCase();

    try {
      var parsed = new URL(normalized);
      return parsed.pathname.indexOf("/sainvoice/save-sync") >= 0;
    } catch (error) {
      return normalized.indexOf("/sainvoice/save-sync") >= 0;
    }
  }

  function parseJson(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return null;
    }
  }

  function headersToObject(headers) {
    var result = {};

    if (!headers || typeof headers.forEach !== "function") {
      return result;
    }

    headers.forEach(function (value, key) {
      result[key] = value;
    });

    return result;
  }
})();
