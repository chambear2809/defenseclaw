FROM node:20-alpine

WORKDIR /app

ENV API_PORT=8787 \
    HOST=0.0.0.0 \
    MFE_PORT=3001 \
    NODE_ENV=production

COPY bundles/c3_agent_tokenomics/mfe_prebuilt/ ./

USER node

EXPOSE 3001 8787

CMD ["node", "scripts/serve-prebuilt-tokenomics-demo.js"]
