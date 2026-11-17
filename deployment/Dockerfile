FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
# Public Firebase web configuration only. Never pass an OAuth secret as a build argument.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_MORRIS_ENTRA_TENANT_ID
ENV VITE_ENABLE_SECURE_API=true VITE_SECURE_API_ORIGIN=same-origin VITE_SECURE_TENANT_ID=synthetic-zagime VITE_FIREBASE_PROJECT_ID=morris-client-dash-zagime
RUN npm run build && npm run build:server
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node","dist-server/start.mjs"]
