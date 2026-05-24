export const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

:root {
  color-scheme: dark;
  --bg: #09090b;
  --sidebar-bg: #0c0c0e;
  --surface: #18181b;
  --surface-hover: #202024;
  --surface-card: #18181b;
  --border: #27272a;
  --border-light: rgba(255, 255, 255, 0.03);
  --border-focus: #a1a1aa;
  --text: #f4f4f5;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  
  --accent: #f4f4f5;
  --accent-glow: rgba(255, 255, 255, 0.05);
  
  --get-bg: rgba(56, 189, 248, 0.07);
  --get-border: rgba(56, 189, 248, 0.2);
  --get-color: #38bdf8;
  
  --post-bg: rgba(52, 211, 153, 0.07);
  --post-border: rgba(52, 211, 153, 0.2);
  --post-color: #34d399;
  
  --put-bg: rgba(251, 191, 36, 0.07);
  --put-border: rgba(251, 191, 36, 0.2);
  --put-color: #fbbf24;
  
  --delete-bg: rgba(248, 113, 113, 0.07);
  --delete-border: rgba(248, 113, 113, 0.2);
  --delete-color: #f87171;
  
  --shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.5);
  
  --sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  background-color: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}

/* Custom Scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* Page Layout */
.app-container {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 420px;
  height: 100vh;
  overflow: hidden;
}

@media (max-width: 1200px) {
  .app-container {
    grid-template-columns: 250px minmax(0, 1fr) 360px;
  }
}

@media (max-width: 992px) {
  .app-container {
    grid-template-columns: 240px minmax(0, 1fr);
    grid-template-rows: 1fr;
  }
  .right-column {
    display: none;
  }
  .right-column.is-visible {
    display: flex;
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    z-index: 1000;
    width: 420px;
    box-shadow: -10px 0 30px rgba(0, 0, 0, 0.8);
    background: var(--surface);
  }
}

@media (max-width: 768px) {
  .app-container {
    grid-template-columns: 1fr;
  }
  .left-column {
    display: none;
  }
  .left-column.is-mobile-open {
    display: flex;
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    width: 280px;
    z-index: 1001;
    box-shadow: 10px 0 30px rgba(0, 0, 0, 0.8);
  }
}

/* --- Left Sidebar Column --- */
.left-column {
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.brand-section {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  background: var(--surface-hover);
  border: 1px solid var(--border);
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  font-weight: 700;
}

.brand-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}

.search-section {
  padding: 12px 16px;
}

.search-box {
  position: relative;
}

.search-input {
  width: 100%;
  height: 34px;
  padding: 0 12px 0 34px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 13px;
  transition: all 0.2s ease;
}

.search-input:focus {
  border-color: var(--border-focus);
  outline: none;
  background: var(--bg);
  box-shadow: 0 0 0 2px var(--border-light);
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.nav-section {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px 20px;
}

.nav-group {
  margin-bottom: 16px;
}

.nav-group-title {
  padding: 6px 12px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 4px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-item:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.nav-item.is-active {
  background: var(--surface-hover);
  color: var(--text);
  border-left: 2px solid var(--border-focus);
  border-radius: 0 4px 4px 0;
}

.sidebar-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.meta-stats {
  display: flex;
  gap: 12px;
}

.stat-tag {
  background: var(--surface);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
}

/* --- Center Content Column --- */
.center-column {
  background: var(--bg);
  overflow-y: auto;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.center-header {
  position: sticky;
  top: 0;
  background: rgba(9, 9, 11, 0.8);
  backdrop-filter: blur(8px);
  z-index: 10;
  padding: 16px 40px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.api-meta-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.api-meta-badge {
  background: var(--surface-hover);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.btn-premium {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 14px;
  font-size: 12.5px;
  color: var(--text);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-premium:hover {
  background: var(--surface-hover);
  border-color: var(--border-focus);
}

.btn-premium.is-primary {
  background: var(--text);
  color: var(--bg);
  border: 1px solid var(--text);
  font-weight: 500;
}

.btn-premium.is-primary:hover {
  background: var(--text-secondary);
  border-color: var(--text-secondary);
  transform: none;
}

.btn-premium:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.btn-premium.is-primary:disabled,
.btn-premium.is-primary:disabled:hover {
  background: var(--surface-hover);
  border-color: var(--border);
  color: var(--text-muted);
}

.docs-workspace {
  padding: 40px;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
}

.overview-card {
  margin-bottom: 40px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 28px;
  box-shadow: var(--shadow);
}

.overview-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 12px;
  letter-spacing: -0.02em;
}

.overview-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* Endpoint Operation Card */
.operation-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-bottom: 30px;
  overflow: hidden;
  box-shadow: var(--shadow);
  transition: border-color 0.2s ease;
}

.operation-card:hover {
  border-color: var(--border-focus);
}

.operation-header {
  padding: 16px 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.operation-route {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.operation-path {
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-summary {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.operation-details {
  padding: 24px 20px;
}

.operation-desc {
  color: var(--text-secondary);
  font-size: 13.5px;
  margin-bottom: 20px;
}

/* Method Badge */
.method-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 4px;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 1px solid transparent;
}

.method-badge.get {
  background: var(--get-bg);
  border-color: var(--get-border);
  color: var(--get-color);
}

.method-badge.post {
  background: var(--post-bg);
  border-color: var(--post-border);
  color: var(--post-color);
}

.method-badge.put, .method-badge.patch {
  background: var(--put-bg);
  border-color: var(--put-border);
  color: var(--put-color);
}

.method-badge.delete {
  background: var(--delete-bg);
  border-color: var(--delete-border);
  color: var(--delete-color);
}

/* Schema / Parameters Table */
.params-section {
  margin-top: 24px;
}

.section-subtitle {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.params-table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  background: var(--surface);
}

.params-table th {
  background: var(--sidebar-bg);
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}

.params-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  vertical-align: top;
}

.params-table tr:last-child td {
  border-bottom: none;
}

.param-name {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--text);
}

.param-type {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.param-req {
  color: #ef4444;
  font-size: 11px;
  margin-left: 4px;
}

.param-desc {
  color: var(--text-secondary);
}

/* Tree / JSON structures */
.schema-box {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 12px 16px;
  font-family: var(--mono);
  font-size: 12px;
  overflow-x: auto;
  max-height: 280px;
}

/* Responses Block */
.response-pill-group {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.response-pill {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.response-pill:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.response-pill.is-active {
  background: var(--surface-hover);
  color: var(--text);
  border-color: var(--border-focus);
}

/* --- Right Toolkit Column --- */
.right-column {
  background: var(--sidebar-bg);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.toolkit-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toolkit-title {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.toolkit-tabs {
  display: flex;
  padding: 4px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.toolkit-tab {
  flex: 1;
  text-align: center;
  padding: 6px 4px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-weight: 500;
}

.toolkit-tab:hover {
  color: var(--text);
}

.toolkit-tab.is-active {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  box-shadow: none;
}

.toolkit-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

/* Snippets panel */
.snippet-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.snippet-select-group {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
  background: var(--surface);
  padding: 3px;
  border-radius: 4px;
}

.snippet-lang-tab {
  flex: 1;
  text-align: center;
  font-size: 11.5px;
  padding: 4px 0;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.snippet-lang-tab:hover {
  color: var(--text);
}

.snippet-lang-tab.is-active {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
}

.snippet-pre {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 16px;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  position: relative;
  line-height: 1.5;
}

/* Try It panel */
.try-field-group {
  margin-bottom: 16px;
}

.try-field-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
  font-family: var(--mono);
}

.try-input {
  width: 100%;
  height: 34px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 12px;
  color: var(--text);
  font-size: 12px;
  font-family: var(--mono);
  transition: all 0.2s ease;
}

.try-input:focus {
  border-color: var(--border-focus);
  outline: none;
  background: var(--bg);
}

.try-textarea {
  width: 100%;
  height: 120px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 12px;
  font-family: var(--mono);
  resize: vertical;
  transition: all 0.2s ease;
}

.try-textarea:focus {
  border-color: var(--border-focus);
  outline: none;
  background: var(--bg);
}

.try-target {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 11px;
}

.try-target code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: var(--mono);
}

.try-response {
  margin-top: 24px;
  border-top: 1px solid var(--border);
  padding-top: 20px;
}

.try-response-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.try-status-code {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
}

.try-status-code.success {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.try-status-code.error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.try-latency {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--mono);
}

.try-response-url {
  margin-bottom: 10px;
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}

/* Toast Notification */
.toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.toast {
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  padding: 12px 18px;
  border-radius: 4px;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 10px;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: auto;
}

.toast.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.toast.success {
  border-left: 4px solid var(--post-color);
}

.toast.error {
  border-left: 4px solid var(--delete-color);
}

/* Utility UI Classes */
.loading-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  gap: 12px;
  color: var(--text-secondary);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-muted);
}

.hidden {
  display: none !important;
}

/* Schema highlighting */
.json-key { color: #f43f5e; }
.json-value-string { color: #34d399; }
.json-value-number { color: #f59e0b; }
.json-value-boolean { color: #60a5fa; }
.json-value-null { color: #9ca3af; }

/* Authentication styles */
.auth-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 14px;
  margin-bottom: 16px;
}

.auth-header {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.auth-inputs {
  display: grid;
  gap: 8px;
}

.auth-field {
  display: grid;
  gap: 4px;
}

.auth-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}

.auth-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  transition: all 0.2s ease;
}

.auth-input:focus {
  border-color: var(--border-focus);
  outline: none;
  box-shadow: 0 0 0 2px var(--border-light);
}

/* API History Visual Timeline */
.history-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.history-global-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.history-global-toggle input {
  cursor: pointer;
  accent-color: var(--accent);
}

.history-timeline {
  position: relative;
  padding-left: 24px;
  margin-top: 10px;
}

.history-timeline::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 6px;
  bottom: 6px;
  width: 1px;
  background: var(--border);
  z-index: 1;
}

.timeline-item {
  position: relative;
  margin-bottom: 24px;
}

.timeline-item:last-child {
  margin-bottom: 0;
}

.timeline-dot {
  position: absolute;
  left: -24px;
  top: 4px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--border);
  border: 2px solid var(--sidebar-bg);
  z-index: 2;
  box-shadow: none;
  transition: all 0.25s ease;
}

.timeline-item.added .timeline-dot {
  background: #10b981;
  box-shadow: none;
}

.timeline-item.removed .timeline-dot {
  background: #ef4444;
  box-shadow: none;
}

.timeline-item.changed .timeline-dot {
  background: #f59e0b;
  box-shadow: none;
}

.timeline-item.deprecated .timeline-dot {
  background: #f97316;
  box-shadow: none;
}

.timeline-item.security .timeline-dot {
  background: #8b5cf6;
  box-shadow: none;
}

.timeline-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 12px;
  transition: all 0.2s ease;
}

.timeline-card:hover {
  border-color: var(--border-focus);
  background: var(--surface-hover);
}

.timeline-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.commit-pill {
  font-family: var(--mono);
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 10px;
}

.timeline-summary {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
}

.timeline-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.badge-tag {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
}

.badge-tag.added {
  background: rgba(16, 185, 129, 0.1);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.badge-tag.removed {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.badge-tag.changed {
  background: rgba(245, 158, 11, 0.1);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.badge-tag.deprecated {
  background: rgba(249, 115, 22, 0.1);
  color: #fb923c;
  border: 1px solid rgba(249, 115, 22, 0.2);
}

.badge-tag.security {
  background: rgba(139, 92, 246, 0.1);
  color: #c084fc;
  border: 1px solid rgba(139, 92, 246, 0.2);
}

.badge-tag.breaking {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.4);
  box-shadow: none;
  font-weight: 700;
}
`;
