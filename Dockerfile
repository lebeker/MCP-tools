FROM node:18-slim

WORKDIR /app

COPY package.json ./
RUN npm install
RUN npm cache clean --force

# Create config directory and ensure it exists
RUN mkdir -p /app/config

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages uv

COPY . .

# Gateway port
EXPOSE 3000

ENV USERS_CONFIG_PATH=/app/config/users.json

CMD ["node", "proxy.js"]
