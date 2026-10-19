'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import Image from 'next/image';
import { KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { loadAppData, supabase } from '@/lib/supabase';
import type { AppData } from '@/lib/types';
import { WorkoutApp } from './WorkoutApp';

type AuthStage = 'loading' | 'login' | 'mfa' | 'app';

export function AuthGate() {
  const [stage, setStage] = useState<AuthStage>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const continueWithSession = useCallback(async (nextSession: Session) => {
    if (!supabase) return;
    setError('');
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) throw assurance.error;
    if (assurance.data.currentLevel === 'aal2') {
      const loaded = await loadAppData(nextSession.user.id);
      setSession(nextSession);
      setData(loaded);
      setStage('app');
      return;
    }
    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) throw factors.error;
    const verified = factors.data.totp.find((factor) => factor.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setQrCode('');
    } else {
      const enrollment = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Workout Manager' });
      if (enrollment.error) throw enrollment.error;
      setFactorId(enrollment.data.id);
      setQrCode(enrollment.data.totp.qr_code);
    }
    setSession(nextSession);
    setStage('mfa');
  }, []);

  useEffect(() => {
    let active = true;
    supabase?.auth.getSession().then(async ({ data: { session: current } }) => {
      if (!active) return;
      if (!current) { setStage('login'); return; }
      try { await continueWithSession(current); } catch (caught) { setError(caught instanceof Error ? caught.message : '인증 상태를 확인하지 못했습니다.'); setStage('login'); }
    });
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { setSession(null); setData(null); setStage('login'); }
    });
    return () => { active = false; subscription?.data.subscription.unsubscribe(); };
  }, [continueWithSession]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError('');
    const result = await supabase.auth.signInWithPassword({ email, password });
    try {
      if (result.error) throw result.error;
      if (!result.data.session) throw new Error('로그인 세션을 만들지 못했습니다.');
      await continueWithSession(result.data.session);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '로그인하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function verifyMfa(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !session) return;
    setBusy(true); setError('');
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code: totpCode.replace(/\s/g, '') });
      if (result.error) throw result.error;
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session) throw refreshed.error ?? new Error('세션을 갱신하지 못했습니다.');
      await continueWithSession(refreshed.data.session);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '인증 코드를 확인하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  if (stage === 'app' && session && data) return <WorkoutApp initialData={data} session={session} />;

  return (
    <main className="auth-page">
      <section className="auth-card" aria-busy={stage === 'loading'}>
        <div className="auth-brand"><span>W</span> Workout Manager</div>
        {stage === 'loading' ? (
          <div className="auth-loading"><LoaderCircle className="spin" aria-hidden="true" /><p>안전한 세션을 확인하고 있어요.</p></div>
        ) : stage === 'login' ? (
          <>
            <div className="auth-icon"><LockKeyhole aria-hidden="true" /></div>
            <p className="overline">PRIVATE ACCESS</p>
            <h1>내 기록으로<br />돌아가기</h1>
            <p className="auth-description">등록된 본인 계정만 로그인할 수 있어요. 건강 데이터는 2단계 인증 후에만 열립니다.</p>
            <form onSubmit={signIn} className="auth-form">
              <label>이메일<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
              <label>비밀번호<input required type="password" autoComplete="current-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <KeyRound />} 로그인</button>
            </form>
            <p className="auth-footnote">공개 회원가입은 비활성화되어 있습니다.</p>
          </>
        ) : (
          <>
            <div className="auth-icon"><ShieldCheck aria-hidden="true" /></div>
            <p className="overline">SECOND STEP</p>
            <h1>한 번 더<br />확인할게요</h1>
            <p className="auth-description">Google Authenticator의 6자리 코드를 입력해 주세요.</p>
            {qrCode && <div className="qr-panel"><Image unoptimized width={170} height={170} src={qrCode} alt="Authenticator 등록 QR 코드" /><p>처음 연결한다면 QR 코드를 스캔한 뒤 코드를 입력하세요.</p></div>}
            <form onSubmit={verifyMfa} className="auth-form">
              <label>인증 코드<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button" disabled={busy || totpCode.length !== 6}>{busy ? <LoaderCircle className="spin" /> : <ShieldCheck />} 기록 열기</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
