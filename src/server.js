'use strict';

const app = require('./app');
const config = require('./config');

const prisma = app.locals.prisma;

const server = app.listen(config.port, () => {
  console.log(`[kt04] API запущен: http://localhost:${config.port} (${config.env})`);
});

async function shutdown(signal) {
  console.log(`[kt04] Получен ${signal}, останавливаем сервер...`);

  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

module.exports = server;
