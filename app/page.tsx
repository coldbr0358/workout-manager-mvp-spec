import { AuthGate } from '@/components/AuthGate';
import { PwaRegister } from '@/components/PwaRegister';
import { WorkoutApp } from '@/components/WorkoutApp';
import { demoData } from '@/lib/demo-data';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function Home() {
  return (
    <>
      {isSupabaseConfigured ? <AuthGate /> : <WorkoutApp initialData={demoData} isDemo />}
      <PwaRegister />
    </>
  );
}
