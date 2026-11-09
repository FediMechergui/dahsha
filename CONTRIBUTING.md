# Contributing to Dahsha

Thanks for helping make Arabic and English documentaries easier to find! 🎬

## Ways to help

- ⭐ Star the repository so more people discover it.
- 🐞 [Report a bug](https://github.com/FediMechergui/dahsha/issues/new/choose) — include the documentary link and whether you used the website or the Android app.
- 🎬 Suggest a documentary channel or playlist with the channel suggestion template.
- 💬 Share ideas or ask questions in [Discussions](https://github.com/FediMechergui/dahsha/discussions).
- 🛠️ Send a pull request.

## Development setup

Requires Node.js 22 or newer.

```sh
npm run setup
npm run snapshot:restore
npm run export -- --cached
npm run dev
```

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused on one thing.
3. Run `npm test` and make sure it passes.
4. Describe what changed and why; add a screenshot for UI changes.

Do not commit generated data (`client/public/data/`, `client/dist/`), keystores or `.env` files.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
