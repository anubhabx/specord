export const CLIENT_SCRIPT = String.raw`
(function () {
  "use strict";

  // State Management
  var config = window.__SPECORD__ || { openApiUrl: "/api/openapi.json" };
  var state = {
    openapi: null,
    operations: [],
    selectedOpKey: "",
    searchQuery: "",
    activeResponseCode: "",
    activeToolkitTab: "try",
    activeSnippetLang: "curl",
    tryItResponse: null,
    tryItLatency: 0,
    historyRecords: [],
    showGlobalHistory: false,
    tryItParams: {},
    tryItBody: {}
  };

  // DOM Selectors Helper
  var q = function (sel) { return document.querySelector(sel); };
  var qAll = function (sel) { return document.querySelectorAll(sel); };

  // Bootstrap Application
  document.addEventListener("DOMContentLoaded", function () {
    initApp();
  });

  // Hot bootstrap fallback if DOM already loaded
  if (document.readyState === "interactive" || document.readyState === "complete") {
    setTimeout(initApp, 1);
  }

  function initApp() {
    var searchInput = q("[data-specord-search-input]");
    if (searchInput) {
      searchInput.addEventListener("input", function (e) {
        state.searchQuery = e.target.value;
        renderSidebar();
      });
    }

    var copyBtn = q("[data-specord-copy-json]");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        copyRawJson();
      });
    }

    // Toolkit Tabs Click Wiring
    qAll("[data-toolkit-tab]").forEach(function (tabEl) {
      tabEl.addEventListener("click", function () {
        var tab = tabEl.getAttribute("data-toolkit-tab");
        switchToolkitTab(tab);
      });
    });

    fetchOpenApiDocument();
  }

  function fetchOpenApiDocument() {
    fetch(config.openApiUrl)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP Status " + res.status + " " + res.statusText);
        return res.json();
      })
      .then(function (data) {
        state.openapi = data;
        state.operations = flattenOperations(data);
        if (state.operations.length > 0) {
          state.selectedOpKey = state.operations[0].key;
          var responseKeys = Object.keys(state.operations[0].responses || {});
          state.activeResponseCode = responseKeys.indexOf("200") !== -1 ? "200" : (responseKeys[0] || "200");
        }
        fetchApiHistory();
      })
      .catch(function (err) {
        renderError(err.message || String(err));
      });
  }

  function fetchApiHistory() {
    var historyUrl = config.historyUrl || (config.openApiUrl.substring(0, config.openApiUrl.lastIndexOf('/')) + '/history');
    fetch(historyUrl)
      .then(function (res) {
        if (!res.ok) return { records: [] };
        return res.json();
      })
      .then(function (data) {
        state.historyRecords = data.records || [];
        renderApp();
      })
      .catch(function () {
        renderApp();
      });
  }

  // Flatten nested OpenAPI paths/methods into list operations
  function flattenOperations(doc) {
    var items = [];
    var paths = doc.paths || {};
    var idx = 0;
    
    for (var pathName in paths) {
      var pathObj = paths[pathName] || {};
      for (var method in pathObj) {
        if (method === "parameters" || method === "summary" || method === "description") continue;
        
        var op = pathObj[method] || {};
        var key = method.toUpperCase() + "::" + pathName;
        
        // Merge route level parameters if any
        var resolvedParams = (pathObj.parameters || []).concat(op.parameters || []);
        
        // Pick primary controller/tag
        var tag = (op.tags && op.tags[0]) || "Default";
        
        items.push({
          id: idx++,
          key: key,
          path: pathName,
          method: method.toLowerCase(),
          summary: op.summary || (method.toUpperCase() + " " + pathName),
          description: op.description || "",
          parameters: resolvedParams,
          requestBody: op.requestBody,
          responses: op.responses || {},
          security: op.security || doc.security || [],
          tag: tag,
          original: op
        });
      }
    }
    return items;
  }

  // --- View Render Orchestrators ---
  function renderApp() {
    // Render navigation numbers
    var opsCountEl = q("[data-specord-ops-count]");
    if (opsCountEl) {
      opsCountEl.textContent = state.operations.length + " ops";
    }

    renderSidebar();
    renderContent();
  }

  function renderError(message) {
    var ws = q("[data-specord-workspace]");
    if (ws) {
      ws.innerHTML = '<div class="empty-state" style="color: #ef4444;"><div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">Failed to load spec</div>' + escapeHtml(message) + '</div>';
    }
    var nav = q("[data-specord-navigation]");
    if (nav) {
      nav.innerHTML = '<div class="empty-state" style="font-size: 12px;">Failed to load navigation.</div>';
    }
  }

  // Render navigation group accordions
  function renderSidebar() {
    var navEl = q("[data-specord-navigation]");
    if (!navEl) return;

    var groups = {};
    var count = 0;
    var query = state.searchQuery.toLowerCase();

    state.operations.forEach(function (op) {
      // Fuzzy filter search query
      var match = op.path.toLowerCase().indexOf(query) !== -1 ||
                  op.summary.toLowerCase().indexOf(query) !== -1 ||
                  op.tag.toLowerCase().indexOf(query) !== -1 ||
                  op.method.toLowerCase().indexOf(query) !== -1;
      
      if (!match) return;

      if (!groups[op.tag]) {
        groups[op.tag] = [];
      }
      groups[op.tag].push(op);
      count++;
    });

    if (count === 0) {
      navEl.innerHTML = '<div class="empty-state" style="font-size: 12px; padding: 20px 10px;">No operations found.</div>';
      return;
    }

    var html = "";
    for (var tag in groups) {
      html += '<div class="nav-group">';
      html += '  <div class="nav-group-title">' + escapeHtml(tag) + '</div>';
      
      groups[tag].forEach(function (op) {
        var activeClass = op.key === state.selectedOpKey ? " is-active" : "";
        html += '<div class="nav-item' + activeClass + '" data-op-key="' + op.key + '" role="button" tabindex="0">';
        html += '  <span class="method-badge ' + op.method + '" style="font-size: 8px; height: 16px; padding: 0 4px;">' + op.method + '</span>';
        html += '  <span style="font-family: var(--mono); font-size: 12px;" title="' + escapeHtml(op.path) + '">' + escapeHtml(op.path) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    navEl.innerHTML = html;

    // Attach click listeners
    navEl.querySelectorAll("[data-op-key]").forEach(function (itemEl) {
      itemEl.addEventListener("click", function () {
        var key = itemEl.getAttribute("data-op-key");
        selectOperation(key);
      });
    });
  }

  function selectOperation(key) {
    if (state.selectedOpKey === key) return;
    state.selectedOpKey = key;
    
    var op = state.operations.find(function (o) { return o.key === key; });
    if (op) {
      var responseKeys = Object.keys(op.responses || {});
      state.activeResponseCode = responseKeys.indexOf("200") !== -1 ? "200" : (responseKeys[0] || "200");
    }
    
    state.tryItResponse = null;
    state.tryItLatency = 0;
    
    renderSidebar();
    renderContent();
  }

  // Render the core active endpoint details
  function renderContent() {
    var ws = q("[data-specord-workspace]");
    if (!ws) return;

    var op = state.operations.find(function (o) { return o.key === state.selectedOpKey; });
    if (!op) {
      ws.innerHTML = '<div class="empty-state">Select an operation from the sidebar to view references.</div>';
      return;
    }

    var html = "";
    
    // Overview Meta
    html += '<div class="overview-card">';
    html += '  <div class="api-meta-info" style="margin-bottom: 8px;">';
    html += '    <span class="method-badge ' + op.method + '" style="font-size: 11px; height: 26px; padding: 0 12px; border-radius: 6px;">' + op.method + '</span>';
    html += '    <h1 style="font-size: 20px; font-weight: 700; color: var(--text); font-family: var(--mono); word-break: break-all;">' + escapeHtml(op.path) + '</h1>';
    html += '  </div>';
    html += '  <h2 style="font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 12px;">' + escapeHtml(op.summary) + '</h2>';
    if (op.description) {
      html += '  <p class="overview-desc">' + escapeHtml(op.description) + '</p>';
    }
    html += '</div>';

    // Parameters Section
    var pathParams = (op.parameters || []).filter(function (p) { return p.in === "path"; });
    var queryParams = (op.parameters || []).filter(function (p) { return p.in === "query"; });
    var headerParams = (op.parameters || []).filter(function (p) { return p.in === "header"; });

    if (pathParams.length > 0) {
      html += renderParamsBlock("Path Parameters", pathParams);
    }
    if (queryParams.length > 0) {
      html += renderParamsBlock("Query Parameters", queryParams);
    }
    if (headerParams.length > 0) {
      html += renderParamsBlock("Header Parameters", headerParams);
    }

    // Request Body Section
    if (op.requestBody) {
      var bodyObj = op.requestBody || {};
      var contentObj = bodyObj.content || {};
      var jsonBody = contentObj["application/json"] || contentObj["*/*"] || {};
      
      html += '<div class="params-section">';
      html += '  <div class="section-subtitle">Request Body (' + (bodyObj.required ? 'Required' : 'Optional') + ')</div>';
      if (bodyObj.description) {
        html += '  <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px;">' + escapeHtml(bodyObj.description) + '</p>';
      }
      if (jsonBody.schema) {
        html += '  <pre class="schema-box">' + formatSchemaToTypeScript(jsonBody.schema, 0) + '</pre>';
      } else {
        html += '  <div class="schema-box" style="color: var(--text-muted);">Payload schema unspecified.</div>';
      }
      html += '</div>';
    }

    // Responses Section
    html += '<div class="params-section">';
    html += '  <div class="section-subtitle">Responses</div>';
    
    var responseCodes = Object.keys(op.responses);
    if (responseCodes.length > 0) {
      html += '<div class="response-pill-group">';
      responseCodes.forEach(function (code) {
        var activeClass = code === state.activeResponseCode ? " is-active" : "";
        var resDesc = op.responses[code].description || "Response";
        html += '<span class="response-pill' + activeClass + '" data-res-code="' + code + '">' + code + ' <span style="font-size: 11px; opacity: 0.7;">' + escapeHtml(resDesc) + '</span></span>';
      });
      html += '</div>';

      // Schema for active response
      var activeRes = op.responses[state.activeResponseCode] || {};
      var activeContent = activeRes.content || {};
      var activeJson = activeContent["application/json"] || activeContent["*/*"] || {};

      if (activeJson.schema) {
        html += '  <pre class="schema-box">' + formatSchemaToTypeScript(activeJson.schema, 0) + '</pre>';
      } else {
        html += '  <div class="schema-box" style="color: var(--text-muted);">Empty response payload or non-JSON contract.</div>';
      }
    } else {
      html += '  <div class="schema-box" style="color: var(--text-muted);">No responses declared.</div>';
    }
    html += '</div>';

    ws.innerHTML = html;

    // Response Tab Clicks
    ws.querySelectorAll("[data-res-code]").forEach(function (pillEl) {
      pillEl.addEventListener("click", function () {
        var code = pillEl.getAttribute("data-res-code");
        state.activeResponseCode = code;
        renderContent();
      });
    });

    renderToolkit();
  }

  function renderParamsBlock(title, params) {
    var html = '<div class="params-section">';
    html += '  <div class="section-subtitle">' + title + '</div>';
    html += '  <table class="params-table">';
    html += '    <thead>';
    html += '      <tr>';
    html += '        <th style="width: 200px;">Parameter</th>';
    html += '        <th>Description</th>';
    html += '      </tr>';
    html += '    </thead>';
    html += '    <tbody>';
    
    params.forEach(function (p) {
      var requiredText = p.required ? '<span class="param-req" title="Required parameter">*</span>' : '';
      var typeLabel = (p.schema && p.schema.type) || "any";
      
      html += '      <tr>';
      html += '        <td>';
      html += '          <div class="param-name">' + escapeHtml(p.name) + requiredText + '</div>';
      html += '          <div class="param-type">' + escapeHtml(typeLabel) + '</div>';
      html += '        </td>';
      html += '        <td>';
      html += '          <div class="param-desc">' + escapeHtml(p.description || "No description provided.") + '</div>';
      if (p.schema && p.schema.default !== undefined) {
        html += '          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; font-family: var(--mono);">Default: ' + escapeHtml(String(p.schema.default)) + '</div>';
      }
      html += '        </td>';
      html += '      </tr>';
    });
    
    html += '    </tbody>';
    html += '  </table>';
    html += '</div>';
    return html;
  }

  // --- Right Toolkit View Orchestrator ---
  function renderToolkit() {
    var contentEl = q("[data-specord-toolkit-content]");
    if (!contentEl) return;

    var op = state.operations.find(function (o) { return o.key === state.selectedOpKey; });
    if (!op) {
      contentEl.innerHTML = '<div class="empty-state">Select an operation to unlock developer tools.</div>';
      return;
    }

    // Highlight Active tab header button
    qAll("[data-toolkit-tab]").forEach(function (tabEl) {
      var tab = tabEl.getAttribute("data-toolkit-tab");
      if (tab === state.activeToolkitTab) {
        tabEl.classList.add("is-active");
        tabEl.setAttribute("aria-selected", "true");
      } else {
        tabEl.classList.remove("is-active");
        tabEl.setAttribute("aria-selected", "false");
      }
    });

    if (state.activeToolkitTab === "try") {
      renderTryIt(contentEl, op);
    } else if (state.activeToolkitTab === "snippets") {
      renderSnippets(contentEl, op);
    } else if (state.activeToolkitTab === "spec") {
      renderRawSpec(contentEl, op);
    } else if (state.activeToolkitTab === "history") {
      renderHistoryTab(contentEl, op);
    }
  }

  function renderHistoryTab(container, op) {
    var html = '<div class="history-panel">';
    
    // Header with "Show all" toggle
    html += '  <div class="history-header">';
    html += '    <div class="section-subtitle" style="margin-bottom: 0;">API Changesets</div>';
    html += '    <label class="history-global-toggle">';
    html += '      <input type="checkbox" id="specord-global-history-chk"' + (state.showGlobalHistory ? ' checked' : '') + ' />';
    html += '      <span>Show all</span>';
    html += '    </label>';
    html += '  </div>';

    // Filter records
    var filtered = state.historyRecords.filter(function (r) {
      if (state.showGlobalHistory) return true;
      return r.operationId === op.original.operationId || (r.method === op.method && r.path === op.path);
    });

    if (filtered.length === 0) {
      html += '  <div class="empty-state" style="padding: 20px 0;">No changesets found for this operation.</div>';
    } else {
      html += '  <div class="history-timeline">';
      filtered.forEach(function (r) {
        var badgeClass = r.changeType || "changed";
        var breakingBadge = r.breaking ? '<span class="badge-tag breaking">Breaking</span>' : '';
        var formattedDate = r.date ? new Date(r.date).toLocaleDateString() : "recent";
        var shortSha = r.commit ? r.commit.substring(0, 7) : "local";
        var authorText = r.author ? ' by ' + r.author : '';

        html += '    <div class="timeline-item ' + badgeClass + '">';
        html += '      <div class="timeline-dot"></div>';
        html += '      <div class="timeline-card">';
        html += '        <div class="timeline-meta">';
        html += '          <span class="commit-pill" title="' + escapeHtml(r.commit || "") + '">' + escapeHtml(shortSha) + '</span>';
        html += '          <span>' + escapeHtml(formattedDate) + escapeHtml(authorText) + '</span>';
        html += '        </div>';
        html += '        <div class="timeline-summary">' + escapeHtml(r.summary) + '</div>';
        html += '        <div class="timeline-badges">';
        html += '          <span class="badge-tag ' + badgeClass + '">' + badgeClass + '</span>';
        html += '          ' + breakingBadge;
        if (r.path && state.showGlobalHistory) {
          html += '          <span style="font-family: var(--mono); font-size: 10px; color: var(--text-muted); margin-left: auto;">' + escapeHtml(r.method.toUpperCase() + ' ' + r.path) + '</span>';
        }
        html += '        </div>';
        html += '      </div>';
        html += '    </div>';
      });
      html += '  </div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Wiring checkbox toggle
    var chk = container.querySelector("#specord-global-history-chk");
    if (chk) {
      chk.addEventListener("change", function (e) {
        state.showGlobalHistory = e.target.checked;
        renderHistoryTab(container, op);
      });
    }
  }

  function switchToolkitTab(tab) {
    state.activeToolkitTab = tab;
    renderToolkit();
  }

  // --- Try It execution panel ---
  function renderTryIt(container, op) {
    var html = "";
    var targetBaseUrl = resolveTryItBaseUrl();
    html += '<div style="display: grid; gap: 16px;">';
    
    // Auth section
    var sessionToken = sessionStorage.getItem("specord:tryit:auth:headers") || "";
    html += '  <div class="auth-section">';
    html += '    <div class="auth-header">';
    html += '      <span>Authentication</span>';
    html += '      <span style="font-size: 9px; color: var(--post-from); font-weight: bold;">Session Only</span>';
    html += '    </div>';
    html += '    <div class="auth-inputs">';
    html += '      <div class="auth-field">';
    html += '        <label class="auth-label">Bearer Token / Authorization Header</label>';
    html += '        <input type="text" class="auth-input" id="specord-auth-token-input" value="' + escapeHtml(sessionToken) + '" placeholder="Bearer your-token-here..." />';
    html += '      </div>';
    html += '    </div>';
    html += '  </div>';

    html += '  <div class="try-target" data-specord-try-target>';
    html += '    <span>Target</span>';
    if (targetBaseUrl) {
      html += '    <code>' + escapeHtml(targetBaseUrl) + '</code>';
    } else {
      html += '    <code>Set --app-url or document.servers[0].url</code>';
    }
    html += '  </div>';

    // Inputs for all parameters (Path, Query, Headers)
    var params = op.parameters || [];
    var savedParams = state.tryItParams[op.key] || {};
    if (params.length > 0) {
      html += '  <div>';
      html += '    <div class="section-subtitle" style="margin-bottom: 8px;">Parameters</div>';
      params.forEach(function (p) {
        var placeholder = (p.schema && p.schema.default !== undefined) ? String(p.schema.default) : "";
        var example = p.example || (p.schema && p.schema.example) || "";
        var currentVal = savedParams[p.name] !== undefined ? savedParams[p.name] : (example || placeholder);
        
        html += '    <div class="try-field-group">';
        html += '      <label class="try-field-label">' + escapeHtml(p.name) + ' <span style="opacity: 0.5; font-weight: normal;">(' + p.in + ')</span></label>';
        html += '      <input type="text" class="try-input" data-try-param="' + escapeHtml(p.name) + '" data-param-in="' + p.in + '" value="' + escapeHtml(String(currentVal)) + '" placeholder="' + escapeHtml(String(placeholder)) + '" />';
        html += '    </div>';
      });
      html += '  </div>';
    }

    // Body parameter editor
    if (op.requestBody) {
      var bodyObj = op.requestBody || {};
      var contentObj = bodyObj.content || {};
      var jsonBody = contentObj["application/json"] || contentObj["*/*"] || {};
      var bodyExample = "";
      if (jsonBody.schema) {
        bodyExample = JSON.stringify(generateSchemaExample(jsonBody.schema), null, 2);
      }
      var currentBody = state.tryItBody[op.key] !== undefined ? state.tryItBody[op.key] : bodyExample;
      
      html += '  <div>';
      html += '    <div class="section-subtitle" style="margin-bottom: 8px;">Request Body</div>';
      html += '    <div class="try-field-group">';
      html += '      <label class="try-field-label">JSON Payload</label>';
      html += '      <textarea class="try-textarea" data-try-body placeholder="Enter raw JSON...">' + escapeHtml(currentBody) + '</textarea>';
      html += '    </div>';
      html += '  </div>';
    }

    // Submit execution button
    html += '  <button class="btn-premium is-primary" style="width: 100%; justify-content: center; height: 38px;" data-specord-try-submit' + (!targetBaseUrl ? ' disabled' : '') + '>';
    html += '    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true" style="margin-right: 6px;"><path d="M3 13.5V2.5l11 5.5-11 5.5z"/></svg>';
    html += '    Send Browser-local request';
    html += '  </button>';

    // Response section
    if (state.tryItResponse) {
      var isSuccess = state.tryItResponse.status >= 200 && state.tryItResponse.status < 300;
      var statusClass = isSuccess ? "success" : "error";
      
      html += '  <div class="try-response" data-specord-try-result>';
      html += '    <div class="try-response-meta">';
      html += '      <span class="try-status-code ' + statusClass + '">' + state.tryItResponse.status + ' ' + escapeHtml(state.tryItResponse.statusText) + '</span>';
      html += '      <span class="try-latency">' + state.tryItLatency + ' ms</span>';
      html += '    </div>';
      if (state.tryItResponse.targetUrl) {
        html += '    <div class="try-response-url">' + escapeHtml(state.tryItResponse.targetUrl) + '</div>';
      }
      html += '    <pre class="snippet-pre" style="max-height: 320px; overflow-y: auto;">' + formatHighlightedJson(state.tryItResponse.data) + '</pre>';
      html += '  </div>';
    }
    
    html += '</div>';
    container.innerHTML = html;

    // Attach Try Send listeners
    var submitBtn = container.querySelector("[data-specord-try-submit]");
    if (submitBtn) {
      submitBtn.addEventListener("click", function () {
        executeTryRequest(op);
      });
    }

    // Wiring sessionStorage Authentication updates
    var tokenInput = container.querySelector("#specord-auth-token-input");
    if (tokenInput) {
      tokenInput.addEventListener("input", function (e) {
        sessionStorage.setItem("specord:tryit:auth:headers", e.target.value);
      });
    }

    // Track parameters change to sync snippets live!
    container.querySelectorAll("[data-try-param]").forEach(function (inputEl) {
      inputEl.addEventListener("input", function (e) {
        if (!state.tryItParams[op.key]) state.tryItParams[op.key] = {};
        state.tryItParams[op.key][inputEl.getAttribute("data-try-param")] = e.target.value;
      });
    });
    var bodyArea = container.querySelector("[data-try-body]");
    if (bodyArea) {
      bodyArea.addEventListener("input", function (e) {
        state.tryItBody[op.key] = e.target.value;
      });
    }
  }

  function executeTryRequest(op) {
    var pathParams = {};
    var queryParams = {};
    var body = null;
    var targetBaseUrl = resolveTryItBaseUrl();

    if (!targetBaseUrl) {
      state.tryItResponse = {
        status: 0,
        statusText: "Target Missing",
        data: {
          error: "No Try It target is configured.",
          hint: "For standalone specord serve, start with --app-url or add document.servers[0].url."
        }
      };
      state.tryItLatency = 0;
      renderToolkit();
      showToast("Try It target missing.", "error");
      return;
    }

    // Load auth token
    var sessionToken = sessionStorage.getItem("specord:tryit:auth:headers") || "";
    var headersMap = { "Content-Type": "application/json" };
    if (sessionToken) {
      if (sessionToken.indexOf(":") !== -1) {
        var colonIdx = sessionToken.indexOf(":");
        var hName = sessionToken.substring(0, colonIdx).trim();
        var hVal = sessionToken.substring(colonIdx + 1).trim();
        headersMap[hName] = hVal;
      } else {
        var authVal = sessionToken.trim();
        if (authVal.toLowerCase().indexOf("bearer ") !== 0 && authVal.toLowerCase().indexOf("basic ") !== 0 && authVal.toLowerCase().indexOf("token ") !== 0) {
          authVal = "Bearer " + authVal;
        }
        headersMap["Authorization"] = authVal;
      }
    }

    // Grab parameters from state cache or fallback to DOM or schemas
    var savedParams = state.tryItParams[op.key] || {};
    var params = op.parameters || [];
    params.forEach(function (p) {
      var val = savedParams[p.name] !== undefined ? savedParams[p.name] : "";
      if (!val) {
        var inputEl = q('[data-try-param="' + p.name + '"]');
        val = inputEl ? inputEl.value : ((p.schema && p.schema.default !== undefined) ? String(p.schema.default) : (p.example || ""));
      }
      
      if (p.in === "path") pathParams[p.name] = val;
      if (p.in === "query" && val) queryParams[p.name] = val;
      if (p.in === "header" && val) headersMap[p.name] = val;
    });

    // Grab body
    var savedBody = state.tryItBody[op.key];
    if (savedBody !== undefined) {
      body = savedBody;
    } else {
      var bodyTextArea = q("[data-try-body]");
      body = bodyTextArea ? bodyTextArea.value : "";
    }

    // Substitute parameters into path template
    var finalPath = op.path;
    for (var name in pathParams) {
      finalPath = finalPath.replace("{" + name + "}", encodeURIComponent(pathParams[name]));
    }

    // Build final Query String
    var queryKeys = Object.keys(queryParams);
    var queryString = "";
    if (queryKeys.length > 0) {
      queryString = "?" + queryKeys.map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(queryParams[k]); }).join("&");
    }

    var finalUrl = joinUrlAndPath(targetBaseUrl, finalPath) + queryString;

    // Setup visual loading state
    var submitBtn = q("[data-specord-try-submit]");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; margin-right: 6px;"></span> Sending...';
    }

    var start = performance.now();
    fetch(finalUrl, {
      method: op.method.toUpperCase(),
      headers: headersMap,
      body: (op.method !== "get" && op.method !== "head" && body) ? body : undefined
    })
      .then(function (res) {
        var duration = Math.round(performance.now() - start);
        return res.text().then(function (text) {
          return {
            status: res.status,
            statusText: res.statusText,
            latency: duration,
            data: parseTryResponseText(text),
            targetUrl: finalUrl
          };
        });
      })
      .then(function (result) {
        state.tryItResponse = result;
        state.tryItLatency = result.latency;
        renderToolkit();
        if (result.status >= 200 && result.status < 300) {
          showToast("Request executed successfully.", "success");
        } else {
          showToast("Request completed with HTTP " + result.status + ".", "error");
        }
      })
      .catch(function (err) {
        var duration = Math.round(performance.now() - start);
        state.tryItResponse = {
          status: 0,
          statusText: "Fetch Failure",
          data: { error: err.message || String(err), hint: "Check CORS settings on your server." }
        };
        state.tryItLatency = duration;
        renderToolkit();
        showToast("Fetch execution failed.", "error");
      });
  }

  function resolveTryItBaseUrl() {
    var appUrl = normalizeTryItBaseUrl(config.appUrl);
    if (appUrl) return appUrl;

    var serverUrl = resolveOpenApiServerUrl();
    if (serverUrl) return serverUrl;

    if (config.sameOriginTryIt === false) return "";
    return window.location.origin;
  }

  function resolveOpenApiServerUrl() {
    var servers = state.openapi && Array.isArray(state.openapi.servers)
      ? state.openapi.servers
      : [];

    for (var i = 0; i < servers.length; i++) {
      var server = servers[i];
      var rawUrl = typeof server === "string" ? server : (server && server.url);
      if (typeof rawUrl !== "string" || !rawUrl.trim()) continue;
      if (rawUrl.indexOf("{") !== -1) continue;

      try {
        var absolute = new URL(rawUrl, window.location.origin).href;
        var normalized = normalizeTryItBaseUrl(absolute);
        if (normalized) return normalized;
      } catch (_err) {
        continue;
      }
    }

    return "";
  }

  function normalizeTryItBaseUrl(value) {
    if (typeof value !== "string") return "";
    var trimmed = value.trim();
    if (!trimmed) return "";
    return trimmed.replace(/\/+$/g, "");
  }

  function joinUrlAndPath(baseUrl, path) {
    var normalizedBase = normalizeTryItBaseUrl(baseUrl);
    var normalizedPath = String(path || "").replace(/^\/+/g, "");
    if (!normalizedBase) return "/" + normalizedPath;
    if (!normalizedPath) return normalizedBase;
    return normalizedBase + "/" + normalizedPath;
  }

  function parseTryResponseText(text) {
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (_err) {
      return {
        error: "Non-JSON response.",
        body: text
      };
    }
  }

  // --- Snippet panel rendering ---
  function renderSnippets(container, op) {
    var snippets = generateCodeSnippets(op);
    var currentLang = state.activeSnippetLang;

    var html = '<div class="snippet-panel">';
    html += '  <div class="snippet-select-group">';
    
    var languages = [
      { key: "curl", label: "cURL" },
      { key: "js", label: "Fetch JS" },
      { key: "python", label: "Python" },
      { key: "go", label: "Go" },
      { key: "rust", label: "Rust" }
    ];

    languages.forEach(function (lang) {
      var activeClass = lang.key === currentLang ? " is-active" : "";
      html += '    <div class="snippet-lang-tab' + activeClass + '" data-snippet-lang="' + lang.key + '">' + lang.label + '</div>';
    });

    html += '  </div>';
    
    var activeCode = snippets[currentLang] || "";
    html += '  <div style="position: relative;">';
    html += '    <button class="btn-premium" style="position: absolute; top: 10px; right: 10px; z-index: 2; height: 24px; padding: 0 8px; font-size: 11px; background: var(--surface);" data-copy-snippet-btn>Copy</button>';
    html += '    <pre class="snippet-pre" style="white-space: pre; overflow-x: auto; max-height: 400px;" data-specord-code-snippets>' + escapeHtml(activeCode) + '</pre>';
    html += '  </div>';
    html += '</div>';

    container.innerHTML = html;

    // Attach Snippet Language Tabs
    container.querySelectorAll("[data-snippet-lang]").forEach(function (tabEl) {
      tabEl.addEventListener("click", function () {
        var lang = tabEl.getAttribute("data-snippet-lang");
        state.activeSnippetLang = lang;
        renderToolkit();
      });
    });

    // Copy Snippet Logic
    var copySnippetBtn = container.querySelector("[data-copy-snippet-btn]");
    if (copySnippetBtn) {
      copySnippetBtn.addEventListener("click", function () {
        navigator.clipboard.writeText(activeCode)
          .then(function () {
            copySnippetBtn.textContent = "Copied!";
            showToast("Snippet copied to clipboard.", "success");
            setTimeout(function () {
              if (copySnippetBtn) copySnippetBtn.textContent = "Copy";
            }, 1500);
          })
          .catch(function () {
            showToast("Failed to copy snippet.", "error");
          });
      });
    }
  }

  // Generates high fidelity code requests templates dynamically reading active inputs
  function generateCodeSnippets(op) {
    var pathParams = {};
    var queryParams = {};
    var headers = {};
    var bodyContent = "";
    var targetBaseUrl = resolveTryItBaseUrl();

    // Load auth token from sessionStorage
    var sessionToken = sessionStorage.getItem("specord:tryit:auth:headers") || "";
    if (sessionToken) {
      if (sessionToken.indexOf(":") !== -1) {
        var colonIdx = sessionToken.indexOf(":");
        var hName = sessionToken.substring(0, colonIdx).trim();
        var hVal = sessionToken.substring(colonIdx + 1).trim();
        headers[hName] = hVal;
      } else {
        var authVal = sessionToken.trim();
        if (authVal.toLowerCase().indexOf("bearer ") !== 0 && authVal.toLowerCase().indexOf("basic ") !== 0 && authVal.toLowerCase().indexOf("token ") !== 0) {
          authVal = "Bearer " + authVal;
        }
        headers["Authorization"] = authVal;
      }
    }

    var savedParams = state.tryItParams[op.key] || {};
    var params = op.parameters || [];
    params.forEach(function (p) {
      var val = savedParams[p.name] !== undefined ? savedParams[p.name] : ((p.schema && p.schema.default !== undefined) ? String(p.schema.default) : (p.example || ""));
      if (p.in === "path") pathParams[p.name] = val || "{" + p.name + "}";
      if (p.in === "query" && val) queryParams[p.name] = val;
      if (p.in === "header" && val) headers[p.name] = val;
    });

    var savedBody = state.tryItBody[op.key];
    if (savedBody !== undefined) {
      bodyContent = savedBody;
    } else if (op.requestBody) {
      var bodyObj = op.requestBody || {};
      var contentObj = bodyObj.content || {};
      var jsonBody = contentObj["application/json"] || contentObj["*/*"] || {};
      if (jsonBody.schema) {
        bodyContent = JSON.stringify(generateSchemaExample(jsonBody.schema), null, 2);
      }
    }

    var finalPath = op.path;
    for (var name in pathParams) {
      finalPath = finalPath.replace("{" + name + "}", encodeURIComponent(pathParams[name]));
    }
    
    var queryKeys = Object.keys(queryParams);
    var queryStr = "";
    if (queryKeys.length > 0) {
      queryStr = "?" + queryKeys.map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(queryParams[k]); }).join("&");
    }

    var finalUrl = targetBaseUrl
      ? joinUrlAndPath(targetBaseUrl, finalPath) + queryStr
      : finalPath + queryStr;

    // Curl
    var curlHeaders = Object.keys(headers).map(function (h) { return '  -H "' + h + ': ' + headers[h] + '"'; }).join(" \\\n");
    var curlBody = bodyContent ? "  -d '" + bodyContent.replace(/'/g, "'\\''") + "'" : "";
    var curlSnippet = "curl -X " + op.method.toUpperCase() + " \"" + finalUrl + "\"";
    if (curlHeaders) curlSnippet += " \\\n" + curlHeaders;
    if (curlBody) curlSnippet += " \\\n" + curlBody;

    // JavaScript fetch
    var fetchHeaders = { "Content-Type": "application/json" };
    Object.assign(fetchHeaders, headers);
    var jsSnippet = 'fetch("' + finalUrl + '", {\n' +
      '  method: "' + op.method.toUpperCase() + '",\n' +
      '  headers: ' + JSON.stringify(fetchHeaders, null, 2).replace(/\n/g, "\n  ") +
      (bodyContent ? ',\n  body: JSON.stringify(' + bodyContent.replace(/\n/g, "\n  ") + ')' : "") +
      '\n})\n.then(function(res) { return res.json(); })\n.then(function(data) { console.log(data); });';

    // Python requests
    var pySnippet = 'import requests\n\n' +
      'url = "' + finalUrl + '"\n' +
      (Object.keys(headers).length > 0 ? 'headers = ' + JSON.stringify(headers, null, 4) + '\n' : "") +
      (bodyContent ? 'payload = ' + bodyContent + '\n' : "") +
      'response = requests.' + op.method.toLowerCase() + '(url' + 
      (Object.keys(headers).length > 0 ? ', headers=headers' : "") +
      (bodyContent ? ', json=payload' : "") + ')\n' +
      'print(response.json())';

    // Go net/http
    var goSnippet = 'package main\n\nimport (\n\t"fmt"\n\t"net/http"\n\t"io"\n)\n\nfunc main() {\n' +
      '\tclient := &http.Client{}\n' +
      '\treq, _ := http.NewRequest("' + op.method.toUpperCase() + '", "' + finalUrl + '", nil)\n' +
      (Object.keys(headers).map(function(h) { return '\treq.Header.Add("' + h + '", "' + headers[h] + '")\n'; }).join("")) +
      '\tresp, _ := client.Do(req)\n' +
      '\tdefer resp.Body.Close()\n' +
      '\tbody, _ := io.ReadAll(resp.Body)\n' +
      '\tfmt.Println(string(body))\n}';

    // Rust reqwest
    var rustSnippet = 'use reqwest::header::HeaderMap;\n\n#[tokio::main]\nasync fn main() -> Result<(), reqwest::Error> {\n' +
      '    let client = reqwest::Client::new();\n' +
      '    let res = client.' + op.method.toLowerCase() + '("' + finalUrl + '")\n' +
      (Object.keys(headers).map(function(h) { return '        .header("' + h + '", "' + headers[h] + '")\n'; }).join("")) +
      (bodyContent ? '        .json(&' + bodyContent.replace(/\n/g, '\n        ') + ')\n' : "") +
      '        .send()\n' +
      '        .await?;\n' +
      '    println!("{:#?}", res.text().await?);\n' +
      '    Ok(())\n}';

    return {
      curl: curlSnippet,
      js: jsSnippet,
      python: pySnippet,
      go: goSnippet,
      rust: rustSnippet
    };
  }

  // --- Raw Spec panel ---
  function renderRawSpec(container, op) {
    var rawText = JSON.stringify(op.original, null, 2);
    var html = '<div style="position: relative;">';
    html += '  <pre class="snippet-pre" style="max-height: 480px; overflow-y: auto;">' + formatHighlightedJson(op.original) + '</pre>';
    html += '</div>';
    container.innerHTML = html;
  }

  // --- OpenAPI Schema Resolution ---
  function resolveRef(schema) {
    if (!schema) return null;
    if (schema.$ref) {
      var parts = schema.$ref.split("/");
      var name = parts[parts.length - 1];
      var resolved = state.openapi.components && state.openapi.components.schemas && state.openapi.components.schemas[name];
      if (resolved) {
        return Object.assign({ _name: name }, resolved);
      }
    }
    return schema;
  }

  // Render pretty TypeScript interface structures
  function formatSchemaToTypeScript(schema, depth) {
    if (!schema) return "any";
    schema = resolveRef(schema);
    
    if (schema.type === "object") {
      var props = schema.properties || {};
      var lines = [];
      var indent = "  ".repeat(depth);
      var childIndent = "  ".repeat(depth + 1);
      
      for (var key in props) {
        var prop = resolveRef(props[key]);
        var isRequired = schema.required && schema.required.indexOf(key) !== -1;
        var typeStr = formatSchemaToTypeScript(prop, depth + 1);
        var comment = prop.description ? ' <span class="text-muted">// ' + escapeHtml(prop.description) + '</span>' : '';
        lines.push(childIndent + '<span class="json-key">' + escapeHtml(key) + '</span>' + (isRequired ? "" : "?") + ": " + typeStr + ";" + comment);
      }
      
      if (lines.length === 0) return "{}";
      return "{\n" + lines.join("\n") + "\n" + indent + "}";
    }
    
    if (schema.type === "array") {
      var items = resolveRef(schema.items);
      return formatSchemaToTypeScript(items, depth) + "[]";
    }
    
    var baseType = schema.type || "any";
    if (schema.enum) {
      return schema.enum.map(function (v) {
        return typeof v === "string" ? '"' + escapeHtml(v) + '"' : escapeHtml(String(v));
      }).join(" | ");
    }
    
    return '<span class="json-value-boolean">' + escapeHtml(baseType) + '</span>';
  }

  // Generate example values recursively for schema structures
  function generateSchemaExample(schema) {
    schema = resolveRef(schema);
    if (!schema) return null;

    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;

    if (schema.type === "object") {
      var obj = {};
      var props = schema.properties || {};
      for (var key in props) {
        obj[key] = generateSchemaExample(props[key]);
      }
      return obj;
    }
    
    if (schema.type === "array") {
      var itemEx = generateSchemaExample(schema.items);
      return itemEx !== null ? [itemEx] : [];
    }

    if (schema.enum && schema.enum.length > 0) {
      return schema.enum[0];
    }

    var baseType = schema.type || "string";
    if (baseType === "string") {
      if (schema.format === "date-time") return new Date().toISOString();
      if (schema.format === "email") return "user@example.com";
      return "string";
    }
    if (baseType === "number" || baseType === "integer") return 0;
    if (baseType === "boolean") return true;

    return null;
  }

  // Raw pretty print JSON syntax highlighter
  function formatHighlightedJson(val) {
    var raw = JSON.stringify(val, null, 2);
    if (!raw) return "";
    
    return raw.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
      var cls = "json-value-number";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "json-key";
          return '<span class="' + cls + '">' + escapeHtml(match.replace(/:$/, "")) + '</span>:';
        } else {
          cls = "json-value-string";
        }
      } else if (/true|false/.test(match)) {
        cls = "json-value-boolean";
      } else if (/null/.test(match)) {
        cls = "json-value-null";
      }
      return '<span class="' + cls + '">' + escapeHtml(match) + '</span>';
    });
  }

  // Core escapes
  function escapeHtml(value) {
    if (typeof value !== "string") value = String(value);
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Clipboard copy of full document
  function copyRawJson() {
    if (!state.openapi) {
      showToast("OpenAPI document not ready.", "error");
      return;
    }
    
    var rawText = JSON.stringify(state.openapi, null, 2);
    navigator.clipboard.writeText(rawText)
      .then(function () {
        showToast("OpenAPI JSON copied to clipboard.", "success");
      })
      .catch(function () {
        showToast("Failed to copy document.", "error");
      });
  }

  // Display rich toast notifications
  function showToast(message, type) {
    var container = q("[data-specord-toast-container]");
    if (!container) return;

    var toastEl = document.createElement("div");
    toastEl.className = "toast " + (type || "success");
    toastEl.textContent = message;

    container.appendChild(toastEl);

    // Fade in
    requestAnimationFrame(function () {
      toastEl.classList.add("is-visible");
    });

    // Fade out and prune DOM
    setTimeout(function () {
      toastEl.classList.remove("is-visible");
      setTimeout(function () {
        if (toastEl.parentNode === container) {
          container.removeChild(toastEl);
        }
      }, 300);
    }, 3000);
  }
})();
`;
