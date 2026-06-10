---
inclusion: always
---

# Secret & Credential Handling Rules

## NEVER do these things

- Never echo, print, log, or include API keys, tokens, passwords, or secrets in any response, code comment, or file content
- Never hardcode secrets in source files — always read from environment variables or encrypted storage
- Never suggest putting secrets directly in UI input fields as examples
- Never include real credential values in documentation, README files, or example code
- If a user pastes a real API key or secret in chat, immediately warn them to rotate it and do NOT repeat the value back

## Always do these things

- Read secrets from `process.env` (loaded via `.env` file with dotenv) or Electron's `safeStorage`
- Use placeholder values like `your_api_key_here` or `AIza...` in examples
- Keep `.env` in `.gitignore` — never commit it
- When showing config examples, use `GEMINI_API_KEY=your_key_here` format only

## For this project specifically

- AI API key is loaded from `.env` → `GROQ_API_KEY`
- Fallback order: encrypted keychain file → `process.env.GROQ_API_KEY` → null
- The `.env` file is gitignored and must never be committed
- Model: `llama-3.3-70b-versatile` via Groq API
