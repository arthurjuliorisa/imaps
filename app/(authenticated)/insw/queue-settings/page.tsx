import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { intervalSettingsAccess } from '@/lib/insw-queue/interval-settings-http';
import QueueSettings from './QueueSettings';

export default async function QueueSettingsPage() {
  const access = intervalSettingsAccess(await getServerSession(authOptions));
  if (access === 401) redirect('/login');
  if (access !== 200) redirect('/access-denied');
  return <QueueSettings />;
}
