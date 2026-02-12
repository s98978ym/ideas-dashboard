import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/db';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions['adapter'],
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            'openid email profile https://www.googleapis.com/auth/generative-language',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      // Attach user ID to session
      if (session.user) {
        (session.user as any).id = user.id;
      }

      // Fetch Google access token from Account table
      const account = await prisma.account.findFirst({
        where: { userId: user.id, provider: 'google' },
      });

      if (account) {
        (session as any).accessToken = account.access_token;
        (session as any).accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : undefined;
      }

      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'database',
  },
};
