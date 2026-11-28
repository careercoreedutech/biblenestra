// FIND LOVE discovery filters — a sheet opened from Discover (and the Profile tab). Age range, intention, denomination,
// city and shared interests. They are saved on the member's dating profile (prefs), so they persist across launches and
// devices, and the card stack reloads with them. Denomination and city are Dating Plus features (locked otherwise).
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icons';
import { Input } from '../ui';
import { useToast } from '../Toast';
import { useApi } from '../../api/auth';
import { useNav } from '../../navigation';
import { dating, datingError, INTENTION_LABELS, DENOMINATIONS } from '../../api/dating';
import { LoveButton, Choice, RoundBtn } from './parts';
import { love, haptic } from './theme';
import { colors } from '../../theme';

/** Shared interests: the same fixed list the profile editor offers (the example profiles use these too). */
export const INTEREST_OPTIONS = [
  'Worship', 'Prayer', 'Bible study', 'Cooking', 'Reading', 'Music', 'Art', 'Photography', 'Dance', 'Fashion',
  'Travel', 'Sports', 'Hiking', 'Coffee', 'Volunteering', 'Missions', 'Youth ministry', 'Mentoring', 'Family', 'Technology',
];

const DEFAULT_AGE_MIN = 18;
const DEFAULT_AGE_MAX = 99;

function fromPrefs(p) {
  return {
    ageMin: String(p.ageMin || DEFAULT_AGE_MIN), ageMax: String(p.ageMax || DEFAULT_AGE_MAX),
    intentions: p.intentions || [], denominations: p.denominations || [], city: p.city || '', interests: p.interests || [],
  };
}

/** How many filters differ from "everyone": shown on the Filters button. */
export function activeFilterCount(prefs) {
  const p = prefs || {};
  let n = (p.intentions || []).length + (p.denominations || []).length + (p.interests || []).length + (p.city ? 1 : 0);
  if ((p.ageMin || DEFAULT_AGE_MIN) > DEFAULT_AGE_MIN || (p.ageMax || DEFAULT_AGE_MAX) < DEFAULT_AGE_MAX) n += 1;
  return n;
}

export function FiltersSheet({ visible, home, onClose, onSaved }) {
  const api = useApi();
  const toast = useToast();
  const nav = useNav();
  const prefs = (home && home.profile && home.profile.prefs) || {};
  const flags = (home && home.plan && home.plan.flags) || {};
  const [f, setF] = useState(() => fromPrefs(prefs));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (visible) { setF(fromPrefs(prefs)); setErr(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function save(next) {
    if (saving) return;
    const lo = parseInt(next.ageMin, 10); const hi = parseInt(next.ageMax, 10);
    if (!(lo >= 18 && hi <= 99 && lo <= hi)) { setErr('Choose an age range from 18 to 99, with the youngest age first.'); return; }
    setSaving(true); setErr(null);
    try {
      await dating.saveProfile(api, {
        prefs: {
          ...prefs, ageMin: lo, ageMax: hi, intentions: next.intentions, interests: next.interests,
          // Dating Plus only: other values are kept as they were, never silently widened or cleared
          denominations: flags.advancedFilters ? next.denominations : (prefs.denominations || []),
          city: flags.advancedLocationFilters ? (next.city.trim() || null) : (prefs.city || null),
        },
      });
      haptic('success');
      toast.show('Filters saved', { icon: 'check', haptic: 'success' });
      if (onSaved) onSaved();
      onClose();
    } catch (e) {
      setErr(datingError(e, 'Couldn’t save your filters. Try again.'));
    } finally { setSaving(false); }
  }

  function reset() {
    const cleared = { ageMin: String(DEFAULT_AGE_MIN), ageMax: String(DEFAULT_AGE_MAX), intentions: [], denominations: [], city: '', interests: [] };
    setF(cleared);
    save(cleared);
  }

  const denomLocked = flags.advancedFilters ? null : 'Dating Plus';
  const cityLocked = flags.advancedLocationFilters ? null : 'Dating Plus';
  const unlock = () => { onClose(); nav.push('DatingPlans', { reason: 'filters' }); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close filters" />
        <View style={s.sheet} accessibilityViewIsModal>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={s.eyebrow}>Find Love</Text>
              <Text style={s.title}>Discovery filters</Text>
            </View>
            <RoundBtn icon="x" label="Close filters" onPress={onClose} size={38} />
          </View>
          <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Field label="Age range" hint="Only people in this range appear in your stack.">
              <View style={s.ageRow}>
                <Input value={f.ageMin} onChangeText={(v) => set('ageMin', v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" placeholder="18" style={s.ageInput} accessibilityLabel="Youngest age" />
                <Text style={s.to}>to</Text>
                <Input value={f.ageMax} onChangeText={(v) => set('ageMax', v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" placeholder="99" style={s.ageInput} accessibilityLabel="Oldest age" />
              </View>
            </Field>
            <Field label="Relationship intention">
              <Choice multi items={Object.keys(INTENTION_LABELS)} labels={INTENTION_LABELS} value={f.intentions} onChange={(v) => set('intentions', v)} />
            </Field>
            <Field label="Denomination" locked={denomLocked} onLocked={unlock}>
              <Choice multi items={DENOMINATIONS} value={f.denominations} onChange={(v) => set('denominations', v)} />
            </Field>
            <Field label="Location" hint="City only. Distance is never shown, and your exact location is never shared." locked={cityLocked} onLocked={unlock}>
              <Input value={f.city} onChangeText={(v) => set('city', v)} placeholder="City, for example Lagos" maxLength={60} accessibilityLabel="City" />
            </Field>
            <Field label="Shared interests" hint="Show people who share at least one of these.">
              <Choice multi items={INTEREST_OPTIONS} value={f.interests} onChange={(v) => set('interests', v)} />
            </Field>
            {err ? <Text style={s.err} accessibilityLiveRegion="polite">{err}</Text> : null}
          </ScrollView>
          <View style={s.foot}>
            <Pressable onPress={reset} disabled={saving} accessibilityRole="button" accessibilityLabel="Reset filters" style={s.reset}>
              <Icon name="repost" size={14} color={love.wine} />
              <Text style={s.resetText}>Reset</Text>
            </Pressable>
            <LoveButton label={saving ? 'Saving…' : 'Save filters'} icon="check" onPress={() => save(f)} disabled={saving} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, hint, children, locked, onLocked }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      <View style={locked ? s.dimmed : null} pointerEvents={locked ? 'none' : 'auto'}>{children}</View>
      {locked ? (
        <Pressable onPress={onLocked} accessibilityRole="button" accessibilityLabel={`${label} needs ${locked}`} style={s.lock}>
          <Icon name="lock" size={13} color={love.gold} />
          <Text style={s.lockText}>{`${label} is a ${locked} feature. Tap to see plans.`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(40,26,17,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 16 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: love.gold, fontWeight: '700' },
  title: { fontSize: 24, color: love.ink, marginTop: 2 },
  body: { paddingHorizontal: 20, paddingBottom: 12, gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: love.ink },
  hint: { fontSize: 12, lineHeight: 17, color: love.faint, marginTop: -4 },
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ageInput: { flex: 1, minWidth: 0 },
  to: { color: love.faint, fontSize: 14 },
  dimmed: { opacity: 0.4 },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  lockText: { flex: 1, fontSize: 12, color: love.gold },
  err: { fontSize: 13, color: love.danger },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: love.blushLine },
  reset: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 12 },
  resetText: { fontSize: 14, fontWeight: '700', color: love.wine },
});
