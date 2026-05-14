# Testing

## Coverage Summary
- **Frontend (Vitest + React Testing Library + jsdom)**
  - Utilities: datetime, Modbus codec, analyzer signal decoder.
  - Components/contexts: ConfirmDialog, ToastProvider, ThemeProvider.
  - Help system types.
- **Backend (Rust unit tests)**
  - Modbus helpers, analyzer polling helpers, analyzer tile validation.
  - Workspace name validation, settings defaults.
  - Attachments helpers, logging helpers.

## Commands
### Frontend
```bash
npm run test:run
```

### Backend
```bash
# from src-tauri
cargo test
```

## Tips
- Frontend tests run in **jsdom** with `@testing-library/jest-dom` matchers.
- Add new React tests under `src/**/*.test.ts(x)`.
- Add Rust unit tests inside modules using `#[cfg(test)]` blocks.
- If a test relies on time or randomness, prefer deterministic helpers.
