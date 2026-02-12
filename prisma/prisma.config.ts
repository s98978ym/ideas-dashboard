/**
 * Prisma 7 Configuration
 *
 * This file configures the database connection for Prisma Migrate.
 */

import { defineConfig } from '@prisma/client';

export default defineConfig({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || '',
    },
  },
});
