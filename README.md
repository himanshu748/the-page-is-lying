<img src="assets/icon.svg" width="64" height="64" alt="">

# The Page Is Lying

A Forge app for Confluence that flags claims in runbooks that the code contradicts, and cites the repo file and line. Design and plan: [PLAN.md](PLAN.md).

## Develop

```sh
npm install
npm run typecheck && npm run lint && npm test
npm run build:ui && npm run test:e2e
```

## Forge (development environment)

Forge CLI 15 needs Node 24, so put it first on `PATH` for Forge commands only:

```sh
export PATH=$HOME/.nvm/versions/node/v24.22.1/bin:$PATH
forge lint
npm run build:ui && forge deploy -e development --non-interactive
forge install -e development -p Confluence --demo-site --confirm-scopes --non-interactive   # first install only
forge install --upgrade -e development ...   # after scope or egress changes
```

Production deploys and pushes need explicit approval.
