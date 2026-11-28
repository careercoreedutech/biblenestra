import { isDarkScheme } from '../design/palette';
// Sign-in (online mode), rebuilt in the Figma design (SignIn + SignUp in routes.tsx): chapel art header,
//   "Welcome home" / "Continue your journey", email + password (Sign in, Forgot password), then
//   "or continue with": Google · Apple (iOS only, Apple requires it when another social login is offered) ·
//   email sign-in code, the Terms / Privacy links, and "Create an account" — a two-step sign-up: account
//   details (email, password, consent), then the 6-digit email code that verifies the address.
//
// `SignInView` is the presentational part (also used by the dev-only `SignInPreview` route);
// the default export wires it to Clerk (useSSO for Google/Apple, useSignIn/useSignUp for email).
// Clerk links accounts by verified email, so Google and email sign-ins with the same address land on one user.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../components/Icons';
import { FadeInUp, PressScale, ScaleIn } from '../components/Motion';
import { useToast, haptic } from '../components/Toast';
import { TERMS_URL, PRIVACY_URL } from '../data/onboarding';
import { d, df, images, fillImage, Eyebrow } from '../design/sanctuary';
import { colors } from '../theme'; // APPEARANCE (item 14): palette tokens

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SHOW_APPLE = Platform.OS === 'ios';
const PLACEHOLDER = (isDarkScheme() ? '#8A7A6C' : '#A39A8F');

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

function MailGlyph({ size = 18, color = d.goldDark }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" stroke={color} strokeWidth={1.9} strokeLinejoin="round" />
      <Path d="M3.5 7l8.5 6.5L20.5 7" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// .brand-mark (light on the art)
function BrandMark() {
  return (
    <View style={styles.brandRow} accessibilityLabel="BibleNestra">
      <View style={styles.brandSymbol}>
        <Icon name="sparkles" size={17} color="#FFFFFF" strokeWidth={1.9} />
      </View>
      <Text style={styles.brandText}>BibleNestra</Text>
    </View>
  );
}

// .auth-art: the photo with a dark wash, the brand mark on top and the line of copy at the bottom
function AuthArt({ image, kicker, line, height, top }) {
  return (
    <View style={[styles.art, { height, paddingTop: top + 22 }]}>
      <Image source={image} style={fillImage} resizeMode="cover" accessibilityIgnoresInvertColors />
      <LinearGradient
        colors={['rgba(22,21,36,0.18)', 'rgba(22,21,36,0.72)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <BrandMark />
      <View style={styles.artCopy}>
        {kicker ? <Text style={styles.artKicker}>{kicker}</Text> : null}
        <Text style={styles.artLine}>{line}</Text>
      </View>
    </View>
  );
}

// Labelled input (.auth-panel label + input: height 52, radius 14, line border, ivory fill)
function Field({ label, ...props }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.field}>
        <TextInput
          placeholderTextColor={PLACEHOLDER}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.fieldInput}
          accessibilityLabel={label}
          {...props}
        />
      </View>
    </View>
  );
}

function PrimaryButton({ label, icon, busy, disabled, onPress }) {
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled || busy}
      scaleTo={0.97}
      style={[styles.primary, disabled && !busy && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
        <>
          <Text style={styles.primaryText}>{label}</Text>
          {icon ? <Icon name={icon} size={18} color="#FFFFFF" strokeWidth={2.2} /> : null}
        </>
      )}
    </PressScale>
  );
}

// .auth-methods .button: outlined row, provider tile on the left, title + sub-label, chevron
function ProviderRow({ tile, tileBg, title, sub, label, busy, disabled, onPress }) {
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled || busy}
      scaleTo={0.98}
      style={styles.provider}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.providerTile, { backgroundColor: tileBg }]}>
        {busy ? <ActivityIndicator size="small" color={d.muted} /> : tile}
      </View>
      <View style={styles.providerText}>
        <Text style={styles.providerTitle}>{title}</Text>
        <Text style={styles.providerSub}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={15} color={d.muted} />
    </PressScale>
  );
}

function Link({ label, onPress, disabled, style }) {
  return (
    <PressScale onPress={onPress} disabled={disabled} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={style}>
      <Text style={styles.link}>{label}</Text>
    </PressScale>
  );
}

// Two-step sign-up: 1 = account details, 2 = the email code
function SignUpProgress({ step }) {
  return (
    <View style={styles.progress}>
      <View style={[styles.stepDot, step >= 1 && styles.stepDotOn]}><Text style={[styles.stepNum, step >= 1 && styles.stepNumOn]}>1</Text></View>
      <View style={styles.stepLine} />
      <View style={[styles.stepDot, step >= 2 && styles.stepDotOn]}><Text style={[styles.stepNum, step >= 2 && styles.stepNumOn]}>2</Text></View>
      <Text style={styles.stepCount}>Step {step} of 2</Text>
    </View>
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
 * onPassword signs in, or (no account yet) creates the account and resolves { next: 'code' }, which
 * means the 6-digit email code is needed to finish.
 */
export function SignInView({ onGoogle, onApple, onSendCode, onVerifyCode, onPassword, onForgot, onReset, showApple = SHOW_APPLE }) {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [step, setStep] = useState('signin'); // signin | email | signup | code | reset
  const [signingUp, setSigningUp] = useState(false); // the code being entered finishes a sign-up
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const emailOk = EMAIL_RE.test(email.trim());
  const em = email.trim().toLowerCase();
  const artH = Math.max(250, Math.round(height * 0.32));

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
    if (!resend) setSigningUp(false);
    setStep('code'); setCode(''); haptic('success');
    toast.show(resend ? 'A new code is on its way' : `Code sent to ${email.trim()}`, { icon: 'message' });
  });
  const verify = (c = code) => run('code', () => onVerifyCode(c), (r) => {
    haptic('success');
    if (r && r.next === 'code') { setStep('code'); setCode(''); }
  });
  // Sign in with email + password, or create the account (sign-up step 1) and move on to the code (step 2)
  const passwordAuth = () => run('password', () => onPassword(em, password), (r) => {
    if (r && r.next === 'code') {
      setSigningUp(true); setStep('code'); setCode('');
      toast.show(`We sent a code to ${email.trim()} to confirm it’s you`, { icon: 'message' });
    }
  });
  const forgot = () => {
    if (!emailOk) { toast.show('Type your email first', { icon: 'message' }); return; }
    run('forgot', () => onForgot(em), () => { setStep('reset'); setCode(''); setPassword(''); toast.show(`Reset code sent to ${email.trim()}`, { icon: 'message' }); });
  };
  const reset = () => run('reset', () => onReset(code, password), () => haptic('success'));
  const back = () => {
    if (step === 'code') setStep(signingUp ? 'signup' : 'email');
    else setStep('signin');
    setCode('');
  };
  const emailCode = () => (emailOk ? sendCode(false) : setStep('email'));

  const showProgress = step === 'signup' || (step === 'code' && signingUp);
  const signUpArt = showProgress; // the two-step sign-up keeps the sign-up art on both steps
  const artImage = signUpArt ? images.companion : images.chapel;
  const artKicker = signUpArt ? 'Your journey starts here' : null;
  const artLine = signUpArt ? 'A sacred rhythm, shaped around your life.' : 'A quieter place for a deeper faith.';

  let body = null;
  if (step === 'signin') {
    body = (
      <>
        <Eyebrow>Welcome home</Eyebrow>
        <Text style={styles.h1}>Continue your journey</Text>
        <Text style={styles.lead}>Your notes, prayers, and reading rhythm stay with you.</Text>
        <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" />
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry autoComplete="password" textContentType="password" returnKeyType="go" onSubmitEditing={() => emailOk && password && passwordAuth()} />
        <View style={styles.optionsRow}>
          <Link label={busy === 'forgot' ? 'Sending…' : 'Forgot password?'} onPress={forgot} disabled={!!busy} />
        </View>
        <PrimaryButton label="Sign in" icon="arrow-right" busy={busy === 'password'} disabled={!emailOk || !password || !!busy} onPress={passwordAuth} />
        <View style={styles.or}><View style={styles.orLine} /><Text style={styles.orText}>or continue with</Text><View style={styles.orLine} /></View>
        <View style={styles.providers}>
          <ProviderRow label="Continue with Google" tile={<GoogleGlyph />} tileBg="#FFF0E3" title="Continue with Google" sub="Fast, secure sign in" busy={busy === 'google'} disabled={!!busy} onPress={() => run('google', onGoogle)} />
          {showApple ? <ProviderRow label="Continue with Apple" tile={<AppleGlyph />} tileBg={d.ink} title="Continue with Apple" sub="Keep your email private" busy={busy === 'apple'} disabled={!!busy} onPress={() => run('apple', onApple)} /> : null}
          <ProviderRow label="Email me a sign-in code" tile={<MailGlyph />} tileBg={d.gold} title="Email me a sign-in code" sub="No password needed" busy={busy === 'email'} disabled={!!busy} onPress={emailCode} />
        </View>
        <Text style={styles.legal}>
          By continuing, you agree to the <Text style={styles.legalLink} onPress={() => open(TERMS_URL)} accessibilityRole="link">Terms of Service</Text> and acknowledge the <Text style={styles.legalLink} onPress={() => open(PRIVACY_URL)} accessibilityRole="link">Privacy Policy</Text>.
        </Text>
        <Text style={styles.footText}>
          New to BibleNestra? <Text style={styles.footLink} onPress={() => { setStep('signup'); setCode(''); }} accessibilityRole="link">Create an account</Text>
        </Text>
      </>
    );
  } else if (step === 'email') {
    body = (
      <>
        <Eyebrow>Sign in without a password</Eyebrow>
        <Text style={styles.h1}>Email me a code</Text>
        <Text style={styles.lead}>We’ll email you a 6-digit code — no password needed. New here? This creates your account.</Text>
        <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="send" onSubmitEditing={() => emailOk && sendCode(false)} autoFocus />
        <PrimaryButton label="Email me a code" busy={busy === 'email'} disabled={!emailOk || !!busy} onPress={() => sendCode(false)} />
        <Link label="Use a password instead" onPress={() => setStep('signin')} disabled={!!busy} style={styles.centerLink} />
      </>
    );
  } else if (step === 'signup') {
    body = (
      <>
        <SignUpProgress step={1} />
        <Eyebrow>Create your sanctuary</Eyebrow>
        <Text style={styles.h1}>Create your account</Text>
        <Text style={styles.lead}>Build a private space for scripture, prayer, and spiritual growth.</Text>
        <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" />
        <Field label="Create password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoComplete="password-new" textContentType="newPassword" returnKeyType="go" />
        <Pressable onPress={() => setConsent(!consent)} style={styles.consent} accessibilityRole="checkbox" accessibilityState={{ checked: consent }} accessibilityLabel="I agree to the Terms of Service and Privacy Policy">
          <View style={[styles.checkbox, consent && styles.checkboxOn]}>
            {consent ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}
          </View>
          <Text style={styles.consentText}>
            I agree to the <Text style={styles.legalLink} onPress={() => open(TERMS_URL)}>Terms of Service</Text> and <Text style={styles.legalLink} onPress={() => open(PRIVACY_URL)}>Privacy Policy</Text>.
          </Text>
        </Pressable>
        <PrimaryButton label="Continue" icon="arrow-right" busy={busy === 'password'} disabled={!emailOk || password.length < 8 || !consent || !!busy} onPress={passwordAuth} />
        <Text style={styles.footText}>
          Already have an account? <Text style={styles.footLink} onPress={() => setStep('signin')} accessibilityRole="link">Sign in</Text>
        </Text>
      </>
    );
  } else if (step === 'code') {
    body = (
      <>
        {showProgress ? <SignUpProgress step={2} /> : null}
        <Eyebrow>{signingUp ? 'Almost there' : 'Email sign-in'}</Eyebrow>
        <Text style={styles.h1}>Check your inbox</Text>
        <Text style={styles.lead}>Enter the 6-digit code we sent to <Text style={styles.leadStrong}>{email.trim()}</Text></Text>
        <CodeBoxes value={code} onChange={setCode} onSubmit={(c) => verify(c)} />
        <PrimaryButton label="Verify & continue" busy={busy === 'code'} disabled={code.length !== 6 || !!busy} onPress={() => verify()} />
        <View style={styles.linkRow}>
          <Link label="Use a different email" onPress={() => { setStep(signingUp ? 'signup' : 'email'); setCode(''); }} disabled={!!busy} />
          <Link label={busy === 'resend' ? 'Sending…' : 'Resend code'} onPress={() => sendCode(true)} disabled={!!busy} />
        </View>
      </>
    );
  } else if (step === 'reset') {
    body = (
      <>
        <Eyebrow>Account recovery</Eyebrow>
        <Text style={styles.h1}>Choose a new password</Text>
        <Text style={styles.lead}>Enter the code we sent to <Text style={styles.leadStrong}>{email.trim()}</Text> and your new password.</Text>
        <CodeBoxes value={code} onChange={setCode} />
        <Field label="New password" value={password} onChangeText={setPassword} placeholder="New password" secureTextEntry autoComplete="password-new" textContentType="newPassword" />
        <PrimaryButton label="Save & sign in" busy={busy === 'reset'} disabled={code.length !== 6 || !password || !!busy} onPress={reset} />
      </>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <AuthArt image={artImage} kicker={artKicker} line={artLine} height={artH} top={insets.top} />
        <View style={styles.panel}>
          {step !== 'signin' ? (
            <PressScale onPress={back} hitSlop={10} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
              <Icon name="chevron-left" size={20} color={d.ink} strokeWidth={2.2} />
            </PressScale>
          ) : null}
          <FadeInUp key={step} distance={10} style={styles.stepBody}>
            {body}
          </FadeInUp>
        </View>
        <View style={{ height: insets.bottom + 12 }} />
      </ScrollView>
    </KeyboardAvoidingView>
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
  root: { flex: 1, backgroundColor: d.paper },
  scroll: { flexGrow: 1, width: '100%' },

  // Art header
  art: { position: 'relative', overflow: 'hidden', paddingHorizontal: 24, backgroundColor: '#2A2030' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandSymbol: { width: 34, height: 34, borderWidth: 1, borderColor: colors.surfaceWhite, borderTopLeftRadius: 17, borderTopRightRadius: 17, borderBottomRightRadius: 17, borderBottomLeftRadius: 12, alignItems: 'center', justifyContent: 'center' },
  brandText: { color: '#FFFFFF', fontFamily: df.sansBold, fontSize: 17, letterSpacing: -0.4 },
  artCopy: { position: 'absolute', left: 24, right: 24, bottom: 22 },
  artKicker: { color: '#FFC9A4', fontFamily: df.sansHeavy, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 7 },
  artLine: { color: '#FFFFFF', fontFamily: df.display, fontSize: 21, lineHeight: 28, letterSpacing: -0.3 },

  // Panel
  panel: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 26, paddingBottom: 12 },
  stepBody: { width: '100%' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: d.ivory, borderWidth: 1, borderColor: d.line, marginBottom: 10, marginLeft: -4 },
  h1: { color: d.ink, fontFamily: df.display, fontSize: 30, lineHeight: 36, letterSpacing: -1, marginTop: 10, marginBottom: 4 },
  lead: { color: d.muted, fontFamily: df.sans, fontSize: 14, lineHeight: 22, marginBottom: 6 },
  leadStrong: { color: d.ink, fontFamily: df.sansBold },

  // Fields
  fieldWrap: { marginTop: 16 },
  label: { color: (isDarkScheme() ? '#B8A797' : '#4C4953'), fontFamily: df.sansBold, fontSize: 12, marginBottom: 8 },
  field: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.ivory, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15 },
  fieldInput: { flex: 1, height: 50, fontFamily: df.sans, fontSize: 14, color: d.ink },
  optionsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10, marginBottom: 18 },
  centerLink: { alignSelf: 'center', marginTop: 8 },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  link: { color: d.plum, fontFamily: df.sansBold, fontSize: 12 },
  footText: { textAlign: 'center', color: d.muted, fontFamily: df.sans, fontSize: 13, marginTop: 20 },
  footLink: { color: d.plum, fontFamily: df.sansBold },

  // Buttons
  primary: { height: 56, borderRadius: 18, backgroundColor: d.plum, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 18,
    ...Platform.select({
      web: { boxShadow: '0 14px 30px rgba(255,107,26,0.22)' },
      default: { shadowColor: d.plum, shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.22, shadowRadius: 22, elevation: 6 },
    }),
  },
  primaryText: { color: '#FFFFFF', fontFamily: df.sansBold, fontSize: 15 },

  // Or divider + providers
  or: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 18 },
  orLine: { flex: 1, height: 1, backgroundColor: d.line },
  orText: { color: (isDarkScheme() ? '#8A7A6C' : '#AAA7AE'), fontFamily: df.sans, fontSize: 11 },
  providers: { gap: 8 },
  provider: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: d.line, backgroundColor: colors.surfaceWhite },
  providerTile: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  providerText: { flex: 1, minWidth: 0 },
  providerTitle: { color: d.ink, fontFamily: df.sansBold, fontSize: 13 },
  providerSub: { color: d.muted, fontFamily: df.sans, fontSize: 11, marginTop: 2 },

  // Legal
  legal: { textAlign: 'center', color: d.muted, fontFamily: df.sans, fontSize: 11, lineHeight: 17, marginTop: 18, paddingHorizontal: 6 },
  legalLink: { color: d.plum, fontFamily: df.sansBold },

  // Sign-up
  progress: { height: 32, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  stepDot: { width: 27, height: 27, borderRadius: 14, backgroundColor: (isDarkScheme() ? '#32271E' : '#E9DFD3'), alignItems: 'center', justifyContent: 'center' },
  stepDotOn: { backgroundColor: d.plum },
  stepNum: { color: (isDarkScheme() ? '#B8A797' : '#9B8B7F'), fontFamily: df.sansBold, fontSize: 11 },
  stepNumOn: { color: '#FFFFFF' },
  stepLine: { width: 38, height: 1, backgroundColor: d.line, marginHorizontal: 6 },
  stepCount: { marginLeft: 'auto', color: d.muted, fontFamily: df.sansBold, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 18 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: (isDarkScheme() ? '#4D3D30' : '#CFC3B4'), backgroundColor: colors.surfaceWhite, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: d.plum, borderColor: d.plum },
  consentText: { flex: 1, color: d.muted, fontFamily: df.sans, fontSize: 12, lineHeight: 18 },

  // Code + reset
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginVertical: 14, position: 'relative' },
  codeBox: { flex: 1, height: 56, borderRadius: 14, borderWidth: 1, borderColor: d.line, backgroundColor: d.ivory, alignItems: 'center', justifyContent: 'center' },
  codeBoxFilled: { backgroundColor: colors.surfaceWhite, borderColor: (isDarkScheme() ? '#4D3D30' : '#CFC3B4') },
  codeBoxActive: { borderColor: d.plum, borderWidth: 2, backgroundColor: colors.surfaceWhite },
  codeChar: { fontFamily: df.display, fontSize: 26, color: d.ink },
  codeHidden: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.01, color: 'transparent', fontSize: 1 },
});
