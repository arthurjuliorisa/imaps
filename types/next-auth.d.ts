import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string;
      username?: string;
      role: string;
      companyCode?: string;
    };
  }

  interface User {
    id: string;
    email: string;
    username: string;
    role: string;
    companyCode?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
    companyCode?: string;
  }
}
