'use strict';

/**
 * PM2 ecosystem config pour A11 backend local.
 * Usage :
 *   pm2 start ecosystem.config.cjs
 *   pm2 stop a11-backend
 *   pm2 restart a11-backend
 *   pm2 logs a11-backend
 *   pm2 save   (persiste la liste après reboot)
 */
module.exports = {
  apps: [
    {
      name: 'a11-backend',
      script: 'server.cjs',
      cwd: __dirname,

      // Pas de cluster — le backend est stateful (mémoire, WebSocket)
      instances: 1,
      exec_mode: 'fork',

      // Redémarrage automatique si crash
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,       // 2s entre chaque restart
      min_uptime: '10s',         // considéré stable après 10s

      // Ne pas redémarrer si arrêt volontaire (pm2 stop)
      stop_exit_codes: [0],

      // Variables d'environnement — le .env.local est chargé par server.cjs lui-même
      env: {
        NODE_ENV: 'development',
      },

      // Logs
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_size: '20M',
      retain: 5,

      // Watch désactivé — les fichiers .cjs sont nombreux, ça ralentirait
      watch: false,

      // Arrêt propre
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
