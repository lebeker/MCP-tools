FROM node:18-slim

WORKDIR /app

COPY package.json ./
RUN npm install

# Create config directory and ensure it exists
RUN mkdir -p /app/config

COPY . .

# Gateway port
EXPOSE 3000

ENV USERS_CONFIG_PATH=/app/config/users.json

CMD ["node", "proxy.js"]
