import { escapeHtml, safeJson } from "./escape.js";
import { STYLES } from "./styles.js";
import { renderShell } from "./markup.js";
import { CLIENT_SCRIPT } from "./client.js";

export interface DocsUiOptions {
  title?: string;
  openApiUrl: string;
  appUrl?: string;
  historyUrl?: string;
  sameOriginTryIt?: boolean;
}

export function renderDocsUi(options: DocsUiOptions): string {
  const title = escapeHtml(options.title ?? "Specord API Docs");
  const source = escapeHtml(options.openApiUrl);
  const clientConfig = safeJson({
    openApiUrl: options.openApiUrl,
    appUrl: options.appUrl,
    historyUrl: options.historyUrl,
    sameOriginTryIt: options.sameOriginTryIt,
  });

  return `<!doctype html>
<html lang="en" data-specord-docs-shell>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${STYLES}</style>
</head>
<body>
${renderShell({ title, source })}
<script>window.__SPECORD__ = ${clientConfig};</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
