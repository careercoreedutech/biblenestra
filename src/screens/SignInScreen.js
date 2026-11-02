// Sign-in (online mode). Shown instead of the app while signed out.
// Continue with Google · Continue with Apple (iOS — required by Apple when Google sign-in is offered) ·
// email → 6-digit code (signs in an existing account or creates a new one).
//
// `SignInView` is the presentational part (also used by the dev-only `SignInPreview` route);
// the default export wires it to Clerk.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, radius, shadow } from '../theme';
import { NightGlow, alpha } from '../components/ui';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale, ScaleIn } from '../components/Motion';
import { useToast, haptic } from '../components/Toast';

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

function SocialButton({ label, glyph, dark, busy, disabled, onPress }) {
  return (
    <PressScale onPress={onPress} disabled={disabled} scaleTo={0.97} style={[styles.social, dark && styles.socialDark, disabled && !busy && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={label}>
      {busy ? <ActivityIndicator size="small" color={dark ? '#FFFFFF' : colors.primary} /> : glyph}
      <Text style={[styles.socialText, dark && { color: '#FFFFFF' }]}>{label}</Text>
    </PressScale>
  );
}

function PrimaryButton({ label, onPress, disabled, busy }) {
  return (
    <PressScale onPress={onPress} disabled={disabled || busy} scaleTo={0.97} style={[styles.primary, (disabled || busy) && { opacity: busy ? 0.75 : 0.45 }]} accessibilityRole="button" accessibilityLabel={label}>
      {busy ? <ActivityIndicator size="small" color={colors.primaryFg} /> : null}
      <Text style={styles.primaryText}>{label}</Text>
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

/**
 * Presentational sign-in. Handlers return promises; they should throw an Error with a friendly
 * `message` on failure (shown in a toast).
 */
export function SignInView({ onGoogle, onApple, onSendCode, onVerifyCode, showApple = SHOW_APPLE }) {
  const toast = useToast();
  const [step, setStep] = useState('start'); // 'start' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null); // 'google' | 'apple' | 'email' | 'code' | 'resend'
  const emailOk = EMAIL_RE.test(email.trim());

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

  const sendCode = (resend) => run(resend ? 'resend' : 'email', () => onSendCode(email.trim().toLowerCase()), () => {
    setStep('code');
    setCode('');
    haptic('success');
    toast.show(resend ? 'A new code is on its way' : `Code sent to ${email.trim()}`, { icon: 'message' });
  });
  const verify = (c = code) => run('code', () => onVerifyCode(c), () => haptic('success'));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <FadeInUp distance={12} style={styles.hero}>
          <NightGlow intensity={1.1} />
          <ScaleIn delay={120} from={0.5} style={styles.mark}>
            <Icon name="cross" size={26} color={colors.goldLight} strokeWidth={2.2} />
          </ScaleIn>
          <Text style={styles.heroEyebrow}>BibleNestra</Text>
          <Text style={styles.heroTitle}>Your home for the Word and the people who love it</Text>
          <Text style={styles.heroVerse}>“Thy word is a lamp unto my feet, and a light unto my path.”</Text>
          <Text style={styles.heroRef}>Psalm 119:105</Text>
        </FadeInUp>

        {step === 'start' ? (
          <FadeInUp key="start" delay={120} distance={10} style={styles.card}>
            <Text style={styles.title}>Welcome</Text>
            <Text style={styles.sub}>Sign in to share posts, pray together and keep your coins on every device.</Text>

            <View style={{ gap: 10, marginTop: 18 }}>
              <SocialButton label="Continue with Google" glyph={<GoogleGlyph />} busy={busy === 'google'} disabled={!!busy} onPress={() => run('google', onGoogle)} />
              {showApple ? (
                <SocialButton dark label="Continue with Apple" glyph={<AppleGlyph />} busy={busy === 'apple'} disabled={!!busy} onPress={() => run('apple', onApple)} />
              ) : null}
            </View>

            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>or use your email</Text>
              <View style={styles.orLine} />
            </View>

            <View style={styles.emailWrap}>
              <MailGlyph size={18} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.faint}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={() => emailOk && sendCode(false)}
                style={styles.emailInput}
                accessibilityLabel="Email address"
              />
            </View>
            <PrimaryButton label="Email me a 6-digit code" disabled={!emailOk} busy={busy === 'email'} onPress={() => sendCode(false)} />
          </FadeInUp>
        ) : (
          <FadeInUp key="code" distance={10} style={styles.card}>
            <View style={styles.codeIcon}><MailGlyph size={21} color={colors.primary} /></View>
            <Text style={styles.title}>Check your inbox</Text>
            <Text style={styles.sub}>
              Enter the 6-digit code we sent to <Text style={styles.subStrong}>{email.trim()}</Text>
            </Text>
            <CodeBoxes value={code} onChange={setCode} onSubmit={(c) => verify(c)} />
            <PrimaryButton label="Verify & continue" disabled={code.length !== 6} busy={busy === 'code'} onPress={() => verify()} />
            <View style={styles.codeLinks}>
              <PressScale onPress={() => { setStep('start'); setCode(''); }} disabled={!!busy} hitSlop={8}>
                <Text style={styles.link}>Use a different email</Text>
              </PressScale>
              <PressScale onPress={() => sendCode(true)} disabled={!!busy} hitSlop={8}>
                <Text style={styles.link}>{busy === 'resend' ? 'Sending…' : 'Resend code'}</Text>
              </PressScale>
            </View>
          </FadeInUp>
        )}

        <Text style={styles.legal}>By continuing you agree to BibleNestra’s Terms and Privacy Policy. Your Bible notes and highlights stay on this device.</Text>
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
    // Cancelled by the user, or more steps needed (e.g. missing requirements on sign-up)
    if (res && res.authSessionResult && res.authSessionResult.type !== 'success') throw new Error('Sign-in cancelled');
    throw new Error('We couldn’t finish signing you in — try the email code instead');
  };

  const sendCode = async (email) => {
    if (!isLoaded || !signUpLoaded) throw new Error('Still loading — try again in a moment');
    try {
      const si = await signIn.create({ identifier: email });
      const factor = (si.supportedFirstFactors || []).find((f) => f.strategy === 'email_code');
      if (!factor) throw new Error('Email codes aren’t enabled for this account');
      await signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId });
      flow.current = 'signIn';
    } catch (e) {
      if (clerkCode(e) === 'form_identifier_not_found') {
        // New here → create the account with the same email code
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

  return <SignInView onGoogle={() => oauth('oauth_google')} onApple={() => oauth('oauth_apple')} onSendCode={sendCode} onVerifyCode={verifyCode} />;
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
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.screen },
  scroll: { flexGrow: 1, padding: 18, paddingBottom: 28 },
  hero: { borderRadius: 26, overflow: 'hidden', paddingHorizontal: 22, paddingTop: 26, paddingBottom: 24, backgroundColor: colors.night, ...shadow.md },
  mark: { width: 54, height: 54, borderRadius: 27, borderWidth: 1, borderColor: alpha(colors.goldLight, 0.45), backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  heroEyebrow: { marginTop: 18, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.goldLight },
  heroTitle: { marginTop: 6, fontFamily: fonts.serifBold, fontSize: 27, lineHeight: 33, letterSpacing: -0.5, color: colors.nightFg },
  heroVerse: { marginTop: 14, fontFamily: fonts.serifItalic, fontSize: 15, lineHeight: 22, color: colors.nightMuted },
  heroRef: { marginTop: 6, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', color: colors.goldLight },

  card: { marginTop: 16, backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 20, ...shadow.sm },
  title: { fontFamily: fonts.serifBold, fontSize: 24, letterSpacing: -0.4, color: colors.fg },
  sub: { marginTop: 4, fontSize: 14, lineHeight: 20, color: colors.muted },
  subStrong: { color: colors.fg, fontWeight: '700' },

  social: { height: 50, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  socialDark: { backgroundColor: '#000000', borderColor: '#000000' },
  socialText: { fontSize: 15, fontWeight: '700', color: colors.fg },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 18 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.faint },

  emailWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, paddingHorizontal: 14, marginBottom: 12 },
  emailInput: { flex: 1, height: 48, fontSize: 15, color: colors.fg },

  primary: { height: 50, borderRadius: radius.pill, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: colors.primaryFg, fontSize: 15, fontWeight: '700' },

  codeIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 20, marginBottom: 16, position: 'relative' },
  codeBox: { flex: 1, height: 56, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  codeBoxFilled: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  codeBoxActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.surface },
  codeChar: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.fg },
  codeHidden: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.01, color: 'transparent', fontSize: 1 },
  codeLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  link: { fontSize: 13.5, fontWeight: '700', color: colors.primary },

  legal: { marginTop: 18, paddingHorizontal: 8, fontSize: 11.5, lineHeight: 17, color: colors.faint, textAlign: 'center' },
});
