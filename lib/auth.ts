import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { prisma } from './prisma';

// Validate NEXTAUTH_SECRET on startup
function validateNextAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;

  if (!secret) {
    throw new Error(
      'NEXTAUTH_SECRET is not defined. Please set it in your environment variables.'
    );
  }

  if (secret.length < 32) {
    throw new Error(
      `NEXTAUTH_SECRET must be at least 32 characters long. Current length: ${secret.length}`
    );
  }

  // Only check for weak secrets in actual production runtime, not during builds
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build' && secret.toLowerCase().includes('development')) {
    throw new Error(
      'NEXTAUTH_SECRET contains "development" in production environment. Please use a secure secret.'
    );
  }

  return secret;
}

// Validate secret on module load
const validatedSecret = validateNextAuthSecret();

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) {
          return null;
        }

        const isPasswordValid = await compare(credentials.password, user.password);

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.username,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  secret: validatedSecret,
};
