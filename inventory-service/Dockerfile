FROM node:18

WORKDIR /app

COPY package.json package-lock.json /app/
RUN npm ci

COPY . /app

EXPOSE 4000

CMD ["node", "app.js"]
