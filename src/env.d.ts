declare namespace NodeJS {
    interface ProcessEnv {
      // Required
      BOT_TOKEN: string;
      
      // Admin Configuration
      ADMIN_IDS: string;
      
      // MongoDB Configuration
      MONGODB_URI: string;
      DB_NAME: string;
      
      // Server Configuration
      PORT: string;
      WEBHOOK_PATH: string;
      WEBHOOK_URL: string;
      RENDER_EXTERNAL_HOSTNAME: string;
      
      // Group Configuration
      GROUP_ID: string;
      GROUP_CHAT_ID: string;
      VERIFICATION_BOT_USERNAME: string;
      VERIFICATION_ENABLED: string;
      AUTO_KICK_UNVERIFIED_MINUTES?: string;
      BOT_USERNAME?: string;
      
      // Web API Key (for securing admin endpoints)
      WEB_API_KEY?: string;

      // Telegram Stars Premium plan prices (amount in Stars / XTR)
      STARS_PREMIUM_WEEKLY?: string;
      STARS_PREMIUM_MONTHLY?: string;
      STARS_PREMIUM_YEARLY?: string;
    }
  }

