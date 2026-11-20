// Sign-in (online mode) — the last onboarding screen (brief §4): logo, tagline, three full-width buttons
//   Continue with Google · Continue with Apple (iOS only — Apple requires it when another social login is
//   offered) · Continue with Email (6-digit email code by default, or email + password with
//   "Forgot password"), and small Terms / Privacy links. Shown instead of the app while signed out.
//
// `SignInView` is the presentational part (also used by the dev-only `SignInPreview` route);
// the default export wires it to Clerk (useSSO for Google/Apple, useSignIn/useSignUp for email).
// Clerk links accounts by verified email, so Google and email sign-ins with the same address land on one user.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, radius, shadow } from '../theme';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale, ScaleIn } from '../components/Motion';
import { useToast, haptic } from '../components/Toast';
import { BrandLogo } from '../components/BrandLogo';
import { TAGLINE, TERMS_URL, PRIVACY_URL } from '../data/onboarding';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SHOW_APPLE = Platform.OS === 'ios';

function GoogleGlyph({ size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <Path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <Path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <Path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </Svg>
  );
}

function AppleGlyph({ size = 18, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path fill={color} d="M16.37 12.63c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.27-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.43-3.66zM14.1 5.88c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.68-1.1 1.76-.96 2.8 1.01.08 2.05-.52 2.68-1.28z" />
    </Svg>
  );
}

function MailGlyph({ size = 18, color = colors.faint }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" stroke={color} strokeWidth={1.9} strokeLinejoin="round" />
      <Path d="M3.5 7l8.5 6.5L20.5 7" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function WideButton({ label, glyph, kind = 'light', busy, disabled, onPress }) {
  const dark = kind === 'dark';
  const primary = kind === 'primary';
  const fg = dark || primary ? '#FFFFFF' : colors.fg;
  return (
    <PressScale onPress={onPress} disabled={disabled || busy} scaleTo={0.97} style={[styles.wide, dark && styles.wideDark, primary && styles.widePrimary, disabled && !busy && { opacity: 0.45 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.wideGlyph}>{busy ? <ActivityIndicator size="small" color={fg} /> : glyph}</View>
      <Text style={[styles.wideText, { color: fg }]}>{label}</Text>
      <View style={styles.wideGlyph} />
    </PressScale>
  );
}

function Field({ icon, ...props }) {
  return (
    <View style={styles.field}>
      {icon}
      <TextInput placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} style={styles.fieldInput} {...props} />
    </View>
  );
}

function Link({ label, onPress, disabled, style }) {
  return (
    <PressScale onPress={onPress} disabled={disabled} hitSlop={8} accessibilityRole="button" style={style}>
      <Text style={styles.link}>{label}</Text>
    </PressScale>
  );
}

// Six visual boxes over one hidden TextInput (keeps paste + SMS/email autofill working)
function CodeBoxes({ value, onChange, onSubmit }) {
  const input = useRef(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => { const t = setTimeout(() => input.current && input.current.focus(), 350); return () => clearTimeout(t); }, []);
  return (
    <PressScale scaleTo={1} onPress={() => input.current && input.current.focus()} style={styles.codeRow} accessibilityLabel="Verification code">
      {Array.from({ length: 6 }, (_, i) => {
        const ch = value[i] || '';
        const active = focused && (i === value.length || (i === 5 && value.length === 6));
        return (
          <View key={i} style={[styles.codeBox, ch && styles.codeBoxFilled, active && styles.codeBoxActive]}>
            {ch ? <ScaleIn from={0.6} key={ch + i}><Text style={styles.codeChar}>{ch}</Text></ScaleIn> : null}
          </View>
        );
      })}
      <TextInput
        ref={input}
        value={value}
        onChangeText={(t) => {
          const v = t.replace(/\D/g, '').slice(0, 6);
          onChange(v);
          if (v.length === 6) onSubmit && onSubmit(v);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        style={styles.codeHidden}
        caretHidden
      />
    </PressScale>
  );
}

// LEGAL: Terms / Privacy open in the in-app browser (expo-web-browser), falling back to the system browser.
const open = (url) => {
  try {
    // eslint-disable-next-line global-require
    require('expo-web-browser').openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => {}));
  } catch (e) { Linking.openURL(url).catch(() => {}); }
};

/**
 * Presentational sign-in. Handlers return promises and throw an Error with a friendly `message` on failure
 * (shown in a toast):
 *   onGoogle() · onApple() · onSendCode(email) · onVerifyCode(code) · onPassword(email, password)
 *   onForgot(email) — emails a reset code · onReset(code, newPassword)
 */
export function SignInView({ onGoogle, onApple, onSendCode, onVerifyCode, onPassword, onForgot, onReset, showApple = SHOW_APPLE }) {
  const toast = useToast();
  const [step, setStep] = useState('start'); // start | email | password | code | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const emailOk = EMAIL_RE.test(email.trim());
  const em = email.trim().toLowerCase();

  const run = async (key, fn, after) => {
    if (busy) return;
    setBusy(key);
    try {
      const r = await fn();
      if (after) after(r);
    } catch (e) {
      toast.show((e && e.message) || 'Something went wrong — please try again', { tone: 'error', icon: 'x' });
    } finally {
      setBusy(null);
    }
  };
  const sendCode = (resend) => run(resend ? 'resend' : 'email', () => onSendCode(em), () => {
    setStep('code'); setCode(''); haptic('success');
    toast.show(resend ? 'A new code is on its way' : `Code sent to ${email.trim()}`, { icon: 'message' });
  });
  const verify = (c = code) => run('code', () => onVerifyCode(c), (r) => {
    haptic('success');
    if (r && r.next === 'code') { setStep('code'); setCode(''); }
  });
  const signInPassword = () => run('password', () => onPassword(em, password), (r) => {
    if (r && r.next === 'code') { setStep('code'); setCode(''); toast.show(`We sent a code to ${email.trim()} to confirm it’s you`, { icon: 'message' }); }
  });
  const forgot = () => {
    if (!emailOk) { toast.show('Type your email first', { icon: 'message' }); return; }
    run('forgot', () => onForgot(em), () => { setStep('reset'); setCode(''); setPassword(''); toast.show(`Reset code sent to ${email.trim()}`, { icon: 'message' }); });
  };
  const reset = () => run('reset', () => onReset(code, password), () => haptic('success'));
  const back = () => { setStep(step === 'password' || step === 'reset' || step === 'code' ? 'email' : 'start'); setCode(''); };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step !== 'start' ? (
          <PressScale onPress={back} hitSlop={10} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="chevron-left" size={20} color={colors.fg} strokeWidth={2.2} />
          </PressScale>
        ) : <View style={{ height: 40 }} />}

        <FadeInUp distance={10} style={[styles.hero, step !== 'start' && { marginTop: 4 }]}>
          <BrandLogo size={step === 'start' ? 92 : 64} />
          {step === 'start' ? <Text style={styles.brand}>BibleNestra</Text> : null}
          {step === 'start' ? <Text style={styles.tagline}>{TAGLINE}</Text> : null}
        </FadeInUp>

        <View style={{ flex: step === 'start' ? 1 : 0, minHeight: 24 }} />

        {step === 'start' ? (
          <FadeInUp key="start" delay={80} distance={10} style={styles.actions}>
            <WideButton label="Continue with Google" glyph={<GoogleGlyph />} busy={busy === 'google'} disabled={!!busy} onPress={() => run('google', onGoogle)} />
            {showApple ? <WideButton kind="dark" label="Continue with Apple" glyph={<AppleGlyph />} busy={busy === 'apple'} disabled={!!busy} onPress={() => run('apple', onApple)} /> : null}
            <WideButton kind="primary" label="Continue with Email" glyph={<MailGlyph color="#FFFFFF" />} disabled={!!busy} onPress={() => setStep('email')} />
          </FadeInUp>
        ) : null}

        {step === 'email' ? (
          <FadeInUp key="email" distance={10} style={styles.actions}>
            <Text style={styles.title}>Continue with email</Text>
            <Text style={styles.sub}>We’ll email you a 6-digit code — no password needed. New here? This creates your account.</Text>
            <Field icon={<MailGlyph />} value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="send" onSubmitEditing={() => emailOk && sendCode(false)} accessibilityLabel="Email address" autoFocus />
            <WideButton kind="primary" label="Email me a code" glyph={null} busy={busy === 'email'} disabled={!emailOk || !!busy} onPress={() => sendCode(false)} />
            <Link label="Use a password instead" onPress={() => setStep('password')} disabled={!!busy} style={{ alignSelf: 'center', marginTop: 6 }} />
          </FadeInUp>
        ) : null}

        {step === 'password' ? (
          <FadeInUp key="password" distance={10} style={styles.actions}>
            <Text style={styles.title}>Sign in with password</Text>
            <Text style={styles.sub}>New here? We’ll create your account and email you a code to confirm the address.</Text>
            <Field icon={<MailGlyph />} value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" accessibilityLabel="Email address" />
            <Field icon={<Icon name="lock" size={18} color={colors.faint} />} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry autoComplete="password" textContentType="password" returnKeyType="go" onSubmitEditing={() => emailOk && password && signInPassword()} accessibilityLabel="Password" />
            <WideButton kind="primary" label="Continue" glyph={null} busy={busy === 'password'} disabled={!emailOk || !password || !!busy} onPress={signInPassword} />
            <View style={styles.linkRow}>
              <Link label={busy === 'forgot' ? 'Sending…' : 'Forgot password?'} onPress={forgot} disabled={!!busy} />
              <Link label="Email me a code instead" onPress={() => setStep('email')} disabled={!!busy} />
            </View>
          </FadeInUp>
        ) : null}

        {step === 'code' ? (
          <FadeInUp key="code" distance={10} style={styles.actions}>
            <Text style={styles.title}>Check your inbox</Text>
            <Text style={styles.sub}>Enter the 6-digit code we sent to <Text style={styles.subStrong}>{email.trim()}</Text></Text>
            <CodeBoxes value={code} onChange={setCode} onSubmit={(c) => verify(c)} />
            <WideButton kind="primary" label="Verify & continue" glyph={null} busy={busy === 'code'} disabled={code.length !== 6 || !!busy} onPress={() => verify()} />
            <View style={styles.linkRow}>
              <Link label="Use a different email" onPress={() => { setStep('email'); setCode(''); }} disabled={!!busy} />
              <Link label={busy === 'resend' ? 'Sending…' : 'Resend code'} onPress={() => sendCode(true)} disabled={!!busy} />
            </View>
          </FadeInUp>
        ) : null}

        {step === 'reset' ? (
          <FadeInUp key="reset" distance={10} style={styles.actions}>
            <Text style={styles.title}>Choose a new password</Text>
            <Text style={styles.sub}>Enter the code we sent to <Text style={styles.subStrong}>{email.trim()}</Text> and your new password.</Text>
            <CodeBoxes value={code} onChange={setCode} />
            <Field icon={<Icon name="lock" size={18} color={colors.faint} />} value={password} onChangeText={setPassword} placeholder="New password" secureTextEntry autoComplete="password-new" textContentType="newPassword" accessibilityLabel="New password" />
            <WideButton kind="primary" label="Save & sign in" glyph={null} busy={busy === 'reset'} disabled={code.length !== 6 || !password || !!busy} onPress={reset} />
          </FadeInUp>
        ) : null}

        <Text style={styles.legal}>
          By continuing you agree to our{' '}
          <Text style={styles.legalLink} onPress={() => open(TERMS_URL)} accessibilityRole="link">Terms</Text>
          {' '}and{' '}
          <Text style={styles.legalLink} onPress={() => open(PRIVACY_URL)} accessibilityRole="link">Privacy Policy</Text>.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Clerk wiring ----
function clerkMessage(e, fallback) {
  const first = e && e.errors && e.errors[0];
  return (first && (first.longMessage || first.message)) || (e && e.message) || fallback;
}
const clerkCode = (e) => (e && e.errors && e.errors[0] && e.errors[0].code) || null;

export default function SignInScreen() {
  /* eslint-disable global-require */
  const Clerk = require('@clerk/clerk-expo');
  const WebBrowser = require('expo-web-browser');
  const AuthSession = require('expo-auth-session');
  /* eslint-enable global-require */
  const { startSSOFlow } = Clerk.useSSO();
  const { signIn, setActive, isLoaded } = Clerk.useSignIn();
  const { signUp, isLoaded: signUpLoaded } = Clerk.useSignUp();
  const flow = useRef(null); // 'signIn' | 'signUp' — which flow the email code belongs to

  useEffect(() => {
    // Completes the OAuth redirect on web; speeds up the browser on Android
    try { WebBrowser.maybeCompleteAuthSession(); } catch (e) { /* ignore */ }
    if (Platform.OS === 'android') {
      WebBrowser.warmUpAsync().catch(() => {});
      return () => { WebBrowser.coolDownAsync().catch(() => {}); };
    }
    return undefined;
  }, []);
  const ready = () => { if (!isLoaded || !signUpLoaded) throw new Error('Still loading — try again in a moment'); };

  // Google / Apple through Clerk's SSO flow (needs the provider enabled in the Clerk dashboard and, for
  // production, your own Google / Apple credentials + the app's redirect URL allow-listed).
  const oauth = async (strategy) => {
    let res;
    try {
      res = await startSSOFlow({ strategy, redirectUrl: AuthSession.makeRedirectUri({ path: 'sso-callback' }) });
    } catch (e) {
      throw new Error(clerkMessage(e, 'Sign-in was interrupted — please try again'));
    }
    if (res && res.createdSessionId) {
      await (res.setActive || setActive)({ session: res.createdSessionId });
      return;
    }
    if (res && res.authSessionResult && res.authSessionResult.type !== 'success') throw new Error('Sign-in cancelled');
    throw new Error('We couldn’t finish signing you in — try Continue with Email instead');
  };

  const sendCode = async (email) => {
    ready();
    try {
      const si = await signIn.create({ identifier: email });
      const factor = (si.supportedFirstFactors || []).find((f) => f.strategy === 'email_code');
      if (!factor) throw new Error('Email codes aren’t enabled for this account');
      await signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId });
      flow.current = 'signIn';
    } catch (e) {
      if (clerkCode(e) === 'form_identifier_not_found') {
        try {
          await signUp.create({ emailAddress: email });
          await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
          flow.current = 'signUp';
          return;
        } catch (err) {
          throw new Error(clerkMessage(err, 'We couldn’t create your account'));
        }
      }
      throw new Error(clerkMessage(e, 'We couldn’t send a code to that email'));
    }
  };

  const verifyCode = async (code) => {
    try {
      if (flow.current === 'signUp') {
        const res = await signUp.attemptEmailAddressVerification({ code });
        if (res.status === 'complete') return setActive({ session: res.createdSessionId });
        throw new Error('A few more details are needed to finish sign-up');
      }
      const res = await signIn.attemptFirstFactor({ strategy: 'email_code', code });
      if (res.status === 'complete') return setActive({ session: res.createdSessionId });
      throw new Error('Additional verification is required for this account');
    } catch (e) {
      const c = clerkCode(e);
      if (c === 'form_code_incorrect') throw new Error('That code isn’t right — check it and try again');
      if (c === 'verification_expired') throw new Error('That code has expired — tap “Resend code”');
      throw new Error(clerkMessage(e, 'We couldn’t verify that code'));
    }
  };

  // Email + password: signs in, or (no account yet) creates one and confirms the email with a code.
  const password = async (email, pw) => {
    ready();
    try {
      const res = await signIn.create({ identifier: email, password: pw });
      if (res.status === 'complete') { await setActive({ session: res.createdSessionId }); return null; }
      throw new Error('Additional verification is required for this account');
    } catch (e) {
      const c = clerkCode(e);
      if (c === 'form_identifier_not_found') {
        try {
          await signUp.create({ emailAddress: email, password: pw });
          await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
          flow.current = 'signUp';
          return { next: 'code' };
        } catch (err) {
          throw new Error(clerkMessage(err, 'We couldn’t create your account'));
        }
      }
      if (c === 'form_password_incorrect') throw new Error('That password isn’t right — try again or tap “Forgot password?”');
      if (c === 'strategy_for_user_invalid') throw new Error('This account doesn’t use a password — use Google or an email code');
      throw new Error(clerkMessage(e, 'We couldn’t sign you in'));
    }
  };

  const forgot = async (email) => {
    ready();
    try {
      await signIn.create({ strategy: 'reset_password_email_code', identifier: email });
    } catch (e) {
      throw new Error(clerkMessage(e, 'We couldn’t send a reset code to that email'));
    }
  };

  const reset = async (code, pw) => {
    try {
      const res = await signIn.attemptFirstFactor({ strategy: 'reset_password_email_code', code, password: pw });
      if (res.status === 'complete') return setActive({ session: res.createdSessionId });
      throw new Error('Additional verification is required for this account');
    } catch (e) {
      const c = clerkCode(e);
      if (c === 'form_code_incorrect') throw new Error('That code isn’t right — check it and try again');
      throw new Error(clerkMessage(e, 'We couldn’t reset your password'));
    }
  };

  return (
    <SignInView
      onGoogle={() => oauth('oauth_google')}
      onApple={() => oauth('oauth_apple')}
      onSendCode={sendCode}
      onVerifyCode={verifyCode}
      onPassword={password}
      onForgot={forgot}
      onReset={reset}
    />
  );
}

// Dev-only preview of the design (no Clerk): /?route=SignInPreview
export function SignInPreviewScreen() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return (
    <SignInView
      showApple
      onGoogle={async () => { await wait(600); throw new Error('Preview only — Google sign-in needs a Clerk key'); }}
      onApple={async () => { await wait(600); throw new Error('Preview only — Apple sign-in needs a Clerk key'); }}
      onSendCode={async () => { await wait(500); }}
      onVerifyCode={async () => { await wait(500); throw new Error('That code isn’t right — check it and try again'); }}
      onPassword={async () => { await wait(500); throw new Error('Preview only — needs a Clerk key'); }}
      onForgot={async () => { await wait(500); }}
      onReset={async () => { await wait(500); throw new Error('Preview only — needs a Clerk key'); }}
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 22, width: '100%', maxWidth: 520, alignSelf: 'center' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised, marginTop: 6, marginLeft: -4 },
  hero: { alignItems: 'center', marginTop: 40 },
  brand: { marginTop: 18, fontFamily: fonts.serifBold, fontSize: 30, letterSpacing: -0.6, color: colors.fg },
  tagline: { marginTop: 8, fontFamily: fonts.serifItalic, fontSize: 18, lineHeight: 25, color: colors.muted, textAlign: 'center' },

  actions: { gap: 12 },
  title: { fontFamily: fonts.serifBold, fontSize: 25, letterSpacing: -0.4, color: colors.fg },
  sub: { marginTop: -4, marginBottom: 4, fontSize: 14, lineHeight: 20, color: colors.muted },
  subStrong: { color: colors.fg, fontWeight: '700' },

  wide: { height: 54, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  wideDark: { backgroundColor: '#000000', borderColor: '#000000' },
  widePrimary: { backgroundColor: colors.primary, borderColor: colors.primary, ...shadow.sm },
  wideGlyph: { width: 24, alignItems: 'center', justifyContent: 'center' },
  wideText: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700' },

  field: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, paddingHorizontal: 14 },
  fieldInput: { flex: 1, height: 52, fontSize: 16, color: colors.fg },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  link: { fontSize: 14, fontWeight: '700', color: colors.primary },

  codeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginVertical: 6, position: 'relative' },
  codeBox: { flex: 1, height: 56, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  codeBoxFilled: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  codeBoxActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.surface },
  codeChar: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.fg },
  codeHidden: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.01, color: 'transparent', fontSize: 1 },

  legal: { marginTop: 22, paddingHorizontal: 8, fontSize: 12, lineHeight: 18, color: colors.faint, textAlign: 'center' },
  legalLink: { color: colors.muted, fontWeight: '700', textDecorationLine: 'underline' },
});
