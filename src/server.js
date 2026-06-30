require('dotenv').config();

const { createApp } = require('./app');
const { initConnection } = require('./db');

const PORT = process.env.PORT || 3001;

async function bootstrap() {
  await initConnection();

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`IF-back API rodando na porta ${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Falha ao iniciar servidor:', error.message);
  process.exit(1);
});
