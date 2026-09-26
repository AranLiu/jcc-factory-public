FROM node:26.10.0-bookworm-slim AS client-build
WORKDIR /app
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --prefix client
COPY client ./client
RUN npm --prefix client run build

FROM node:26.10.0-bookworm-slim AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev && npm ci --omit=dev --prefix server

FROM python:3.12-slim-bookworm AS python-deps
COPY server/python_services/requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

FROM node:26.10.0-bookworm-slim AS node-runtime

FROM python:3.12-slim-bookworm AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --create-home --home-dir /home/app app

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=python-deps /opt/venv /opt/venv

WORKDIR /app
COPY --from=server-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=server-deps --chown=app:app /app/server/node_modules ./server/node_modules
COPY --chown=app:app server ./server
COPY --chown=app:app scripts/setup-admin.js ./scripts/setup-admin.js
COPY --from=client-build --chown=app:app /app/client/dist ./client/dist
COPY --chown=app:app docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/uploads /app/temp_uploads \
        /app/server/uploads /app/server/uploads/documents /app/server/knowledge_base_files \
        /app/server/temp /app/server/logs \
    && chown -R app:app /app/uploads /app/temp_uploads \
        /app/server/uploads /app/server/knowledge_base_files \
        /app/server/temp /app/server/logs

ENV PATH="/opt/venv/bin:${PATH}"
ENV PYTHON_COMMAND=/opt/venv/bin/python

USER app
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
