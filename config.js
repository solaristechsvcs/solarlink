// SolarLink configuration — fill in on your Wisp server.
// IMPORTANT: Never commit real credentials. This tracked file contains placeholders only.
export default {
  server: {
    port: 3000,
    baseUrl: 'https://your-domain.example',
    trustProxy: true
  },
  discord: {
    clientId: 'CHANGE_ME_DISCORD_CLIENT_ID',
    clientSecret: 'CHANGE_ME_DISCORD_CLIENT_SECRET',
    redirectUri: 'https://your-domain.example/auth/discord/callback'
  },
  session: {
    secret: 'CHANGE_ME_REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS'
  },
  mysql: {
    host: 'CHANGE_ME_MYSQL_HOST',
    port: 3306,
    user: 'CHANGE_ME_MYSQL_USER',
    password: 'CHANGE_ME_MYSQL_PASSWORD',
    database: 'solarlink'
  }
};
