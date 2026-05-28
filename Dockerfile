FROM node:20-alpine
WORKDIR /app
COPY package.json server.js index.html ./
RUN npm install --production
EXPOSE 3000
CMD ["node", "server.js"]
