
window.groqApiKey = null;

let aiConversation = [];
let aiStreaming = false;

async function initSettings() {

  window.groqApiKey =
    await window.electronAPI.loadApiKey();

  if (window.groqApiKey) {

    document.getElementById('apiKeyInput').value =
      '•'.repeat(20);

    document.getElementById('keyStatus').innerHTML =
      '<span style="color:var(--green)">✓ API key loaded</span>';
  }

  // Load GitHub token status (masked)
  try {
    const masked = await window.electronAPI.loadGithubToken();
    if (masked) {
      document.getElementById('githubTokenInput').value = masked;
      document.getElementById('githubTokenStatus').innerHTML =
        '<span style="color:var(--green)">✓ GitHub token loaded</span>';
    }
  } catch { /* no token saved */ }

  // Load history into settings panel
  await refreshHistoryPanel();
}

function toggleSettings() {

  const p =
    document.getElementById('settingsPanel');

  p.style.display =
    p.style.display === 'none'
      ? 'block'
      : 'none';
}

async function saveApiKey() {

  const input =
    document.getElementById('apiKeyInput');

  const key = input.value.trim();

  if (!key || key.startsWith('•')) {
    return;
  }

  const status =
    document.getElementById('keyStatus');

  status.innerHTML =
    '<span style="color:var(--muted)">Validating…</span>';

  const valid =
    await window.electronAPI.validateApiKey(key);

  if (!valid) {

    status.innerHTML =
      '<span style="color:var(--red)">✗ Invalid API key</span>';

    return;
  }

  await window.electronAPI.saveApiKey(key);

  window.groqApiKey = key;

  input.value = '•'.repeat(20);

  status.innerHTML =
    '<span style="color:var(--green)">✓ Saved and validated</span>';
}

function renderAiTab() {

  document.getElementById('tab-ai').innerHTML = `
    <div style="max-width:860px">

      ${!window.groqApiKey ? `
        <div style="
          background:var(--surface2);
          border:1px solid var(--accent);
          border-radius:12px;
          padding:24px;
          margin-bottom:16px;
        ">
          <div style="font-size:1rem;font-weight:700;margin-bottom:8px">🔑 Set up AI Analysis</div>
          <div style="color:var(--muted);font-size:0.85rem;margin-bottom:16px;line-height:1.6">
            ASTRA uses <strong style="color:var(--text)">Groq</strong> (free tier, no credit card required)
            to generate security reports and answer questions about scan results.
          </div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:16px;font-size:0.82rem;line-height:1.8">
            <div style="font-weight:700;color:var(--text);margin-bottom:6px">3 steps to get started:</div>
            <div>1. Go to <a href="#" onclick="window.electronAPI.openExternal('https://console.groq.com/keys');return false" style="color:var(--accent)">console.groq.com/keys</a></div>
            <div>2. Click <strong style="color:var(--text)">Create API Key</strong> — give it any name</div>
            <div>3. Copy the key, paste it in Settings, click Save</div>
          </div>
          <button
            onclick="toggleSettings()"
            style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:10px 22px;font-size:0.88rem;font-weight:600;cursor:pointer;width:100%"
          >
            Open Settings to add Groq API key →
          </button>
        </div>
      ` : ''}

      <div
        id="aiMessages"
        style="
          display:flex;
          flex-direction:column;
          gap:16px;
          margin-bottom:16px
        ">
      </div>

      <div style="
        display:flex;
        gap:8px;
        background:var(--surface);
        border:1px solid var(--border);
        border-radius:10px;
        padding:6px 6px 6px 14px
      ">

        <input
          id="aiInput"
          type="text"
          placeholder="Ask about the scan..."
          style="
            flex:1;
            background:none;
            border:none;
            outline:none;
            color:var(--text);
            font-size:0.88rem;
            font-family:var(--font)
          "
          onkeydown="
            if(event.key==='Enter'&&!event.shiftKey){
              event.preventDefault();
              sendAiMessage();
            }
          "
          ${!window.groqApiKey ? 'disabled' : ''}
        />

        <button
          id="aiSendBtn"
          onclick="sendAiMessage()"
          ${!window.groqApiKey ? 'disabled' : ''}
          style="
            background:var(--accent);
            color:#fff;
            border:none;
            border-radius:8px;
            padding:8px 16px;
            font-size:0.82rem;
            font-weight:600;
            cursor:pointer
          "
        >
          Send
        </button>

      </div>

      <div style="
        margin-top:8px;
        font-size:0.72rem;
        color:var(--muted)
      ">
        Powered by Groq — llama-3.3-70b-versatile
      </div>

    </div>
  `;
}

function appendAiMessage(
  role,
  text,
  streaming = false
) {

  const container =
    document.getElementById('aiMessages');

  if (!container) {
    return;
  }

  const id = 'ai-msg-' + Date.now();

  const isUser = role === 'user';

  const div = document.createElement('div');

  div.id = id;

  div.style.cssText = `
    display:flex;
    gap:10px;
    align-items:flex-start;
    ${isUser ? 'flex-direction:row-reverse' : ''}
  `;

  div.innerHTML = `
    <div style="
      width:28px;
      height:28px;
      border-radius:50%;
      background:${isUser ? 'var(--accent)' : 'var(--surface2)'};
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:0.75rem;
      flex-shrink:0
    ">
      ${isUser ? '👤' : '🤖'}
    </div>

    <div style="
      flex:1;
      background:${isUser ? 'var(--accent)' : 'var(--surface)'};
      border:1px solid ${isUser ? 'var(--accent)' : 'var(--border)'};
      border-radius:10px;
      padding:12px 14px;
      max-width:90%
    ">

      <div
        class="ai-content"
        style="
          font-size:0.85rem;
          line-height:1.6;
          white-space:pre-wrap
        "
      >
        ${escapeHtml(text)}

        ${
          streaming
            ? '<span class="cursor" style="display:inline-block;width:2px;height:14px;background:var(--accent);margin-left:2px;animation:blink 1s infinite">▋</span>'
            : ''
        }

      </div>

    </div>
  `;

  container.appendChild(div);

  container.scrollTop =
    container.scrollHeight;

  return id;
}

function updateAiMessage(
  id,
  text,
  done = false
) {

  const el = document.getElementById(id);

  if (!el) {
    return;
  }

  const content =
    el.querySelector('.ai-content');

  if (!content) {
    return;
  }

  let html =
    escapeHtml(text)

    .replace(
      /^## (.+)$/gm,
      '<h3 style="font-size:0.9rem;font-weight:700;margin:12px 0 6px;color:var(--accent)">$1</h3>'
    )

    .replace(
      /^### (.+)$/gm,
      '<h4 style="font-size:0.85rem;font-weight:700;margin:10px 0 4px">$1</h4>'
    )

    .replace(
      /\*\*(.+?)\*\*/g,
      '<strong>$1</strong>'
    )

    .replace(
      /`([^`]+)`/g,
      '<code style="background:var(--surface2);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:0.8rem">$1</code>'
    )

    .replace(
      /^- (.+)$/gm,
      '<li style="margin:3px 0;padding-left:4px">$1</li>'
    )

    .replace(
      /^(\d+)\. (.+)$/gm,
      '<li style="margin:3px 0;padding-left:4px"><strong>$1.</strong> $2</li>'
    )

    .replace(
      /\n\n/g,
      '</p><p style="margin:8px 0">'
    );

  content.innerHTML =
    html +
    (
      done
        ? ''
        : '<span class="cursor" style="display:inline-block;width:2px;height:14px;background:var(--accent);margin-left:2px;animation:blink 1s infinite">▋</span>'
    );
}

function escapeHtml(s) {

  return s
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

async function runAiAnalysis() {

  if (
    !window.groqApiKey ||
    !window.lastData
  ) {
    return;
  }

  renderAiTab();

  aiConversation = [];

  aiStreaming = true;

  const msgId =
    appendAiMessage(
      'model',
      '',
      true
    );

  let fullText = '';

  window.electronAPI.removeGroqListeners();

  window.electronAPI.onGroqChunk(chunk => {

    if (chunk.done) {

      aiStreaming = false;

      updateAiMessage(
        msgId,
        fullText,
        true
      );

      aiConversation = [
        {
          role: 'user',
          parts: [
            {
              text: '__scan_analysis__'
            }
          ]
        },

        {
          role: 'model',
          parts: [
            {
              text: fullText
            }
          ]
        }
      ];

      return;
    }

    fullText += chunk.text;

    updateAiMessage(
      msgId,
      fullText,
      false
    );

    const container =
      document.getElementById('aiMessages');

    if (container) {
      container.scrollTop =
        container.scrollHeight;
    }
  });

  window.electronAPI.onGroqError(msg => {

    aiStreaming = false;

    updateAiMessage(
      msgId,
      `Error: ${msg}`,
      true
    );
  });

  await window.electronAPI.groqAnalyze(
    window.lastData,
    window.groqApiKey
  );
}

async function sendAiMessage() {

  if (
    !window.groqApiKey ||
    aiStreaming
  ) {
    return;
  }

  const input =
    document.getElementById('aiInput');

  const text = input.value.trim();

  if (!text) {
    return;
  }

  input.value = '';

  appendAiMessage('user', text);

  const userMsg = {
    role: 'user',
    parts: [
      {
        text
      }
    ]
  };

  if (aiConversation.length === 0) {

    const ctx = `
Here is the scan data:

${JSON.stringify({
  url: window.lastData?.url,
  tls: window.lastData?.tls,
  csp: window.lastData?.csp,
  cors: window.lastData?.cors,
  fingerprint: window.lastData?.fingerprint,
  vuln: window.lastData?.vuln,
  aggregate: window.lastData?.aggregate
}, null, 2)}

User question:
${text}
`;

    aiConversation.push({
      role: 'user',
      parts: [
        {
          text: ctx
        }
      ]
    });

  } else {

    aiConversation.push(userMsg);
  }

  aiStreaming = true;

  const msgId =
    appendAiMessage(
      'model',
      '',
      true
    );

  let fullText = '';

  window.electronAPI.removeGroqListeners();

  window.electronAPI.onGroqChunk(chunk => {

    if (chunk.done) {

      aiStreaming = false;

      updateAiMessage(
        msgId,
        fullText,
        true
      );

      aiConversation.push({
        role: 'model',
        parts: [
          {
            text: fullText
          }
        ]
      });

      return;
    }

    fullText += chunk.text;

    updateAiMessage(
      msgId,
      fullText,
      false
    );

    const container =
      document.getElementById('aiMessages');

    if (container) {
      container.scrollTop =
        container.scrollHeight;
    }
  });

  window.electronAPI.onGroqError(msg => {

    aiStreaming = false;

    updateAiMessage(
      msgId,
      `Error: ${msg}`,
      true
    );
  });

  await window.electronAPI.groqChat(
    aiConversation,
    window.groqApiKey
  );
}

const style =
  document.createElement('style');

style.textContent =
  '@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }';

document.head.appendChild(style);

initSettings();

