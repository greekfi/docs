# Greek documentation

The public documentation site for the Greek options protocol, built with [Docusaurus](https://docusaurus.io/).

## Install

```bash
npm install
```

## Run locally

```bash
npm start
```

This starts the local development server and opens the site in a browser. Most changes appear without a restart.

## Generate the API reference

```bash
npm run gen-reference
```

The generator replaces the API reference in `docs/index.md` with content from the contracts' NatSpec documentation. Do not edit the generated section by hand.

## Build

```bash
npm run build
```

This generates the static site in `build`.

## Deployment

With SSH:

```bash
USE_SSH=true npm run deploy
```

Without SSH:

```bash
GIT_USER=<your-github-username> npm run deploy
```

The deploy command builds the site and pushes it to the `gh-pages` branch.
