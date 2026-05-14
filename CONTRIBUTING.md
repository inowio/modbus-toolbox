# Contributing to Inowio Modbus Toolbox

Thanks for helping us improve the toolbox! This guide keeps contribution steps short and consistent.

## Quick Start

```bash
git clone https://github.com/inowio/modbus-toolbox.git
cd inowio-modbus-toolbox
npm install
npm run tauri dev
```

Prerequisites: Node.js 18+, Rust stable toolchain, Git, and a code editor (VS Code + Tauri, rust-analyzer, ESLint, Prettier recommended).

## Workflow

1. Fork the repo and branch off `main` using `feature/<topic>` or `fix/<topic>`.
2. Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`…).
3. Keep pull requests focused, include tests/docs, and add screenshots for UI work.
4. Open the PR against `main`, reference related issues, and await review.

## Coding Standards

- React + TypeScript only; prefer `export default function Component()` style.
- Rust code must pass `cargo fmt` and `cargo clippy` with warnings treated as errors.
- Avoid duplicated logic, keep functions small, and return explicit errors.
- Update docs or help content whenever behavior changes.

## Testing & Checks

```bash
npm run lint     # Frontend lint
npm run test     # Frontend tests (if available)
cargo fmt        # Rust formatting
cargo clippy -- -D warnings
```

Please add or update tests alongside new features or bug fixes.

## Reporting Issues & Requests

- **Bug reports**: include OS, app version, Node/Rust versions, reproduction steps, expected vs actual results, and logs/screenshots if possible.
- **Feature ideas**: describe the use case, desired outcome, and any alternatives considered.

## Community Expectations

Be respectful, inclusive, and helpful. Use GitHub Issues for bugs/features and Discussions for questions or ideas.

---

Thank you for contributing! 🚀
