import React, { useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, Section, Badge, Tag, Button, Row } from '../components/ui';
import { colors, fonts } from '../theme';
import { useNav } from '../navigation';
import { useStore } from '../store';

const CATEGORIES = [
  'All',
  'Software & Web Development',
  'Graphic Design & Video Editing',
  'Virtual Assistants',
  'Worship Musicians & Producers',
  'Writers, Editors & Translators',
  'Church Administration',
  'Social Media & Digital Marketing',
];

export default function JobsScreen() {
  const nav = useNav();
  const { state, dispatch } = useStore();
  const [filterKind, setFilterKind] = useState('all'); // 'all' | 'job' | 'task' | 'proposals'
  const [selectedCat, setSelectedCat] = useState('All');
  const [search, setSearch] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);

  // Proposal Form State
  const [bidRate, setBidRate] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [coverNote, setCoverNote] = useState('');

  // Post Job/Task Form State
  const [postTitle, setPostTitle] = useState('');
  const [postKind, setPostKind] = useState('task');
  const [postCategory, setPostCategory] = useState('Graphic Design & Video Editing');
  const [postBudget, setPostBudget] = useState('');
  const [postDeadline, setPostDeadline] = useState('');
  const [postSkills, setPostSkills] = useState('');
  const [postDesc, setPostDesc] = useState('');

  const jobs = state.jobs || [];
  const proposals = state.proposals || [];

  const filteredJobs = jobs.filter((j) => {
    if (filterKind !== 'all' && filterKind !== 'proposals' && j.kind !== filterKind) return false;
    if (selectedCat !== 'All' && j.category !== selectedCat) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return j.title.toLowerCase().includes(q) || j.category.toLowerCase().includes(q) || j.skills.some((s) => s.toLowerCase().includes(q));
    }
    return true;
  });

  const handleApply = () => {
    if (!bidRate.trim() || !coverNote.trim()) {
      Alert.alert('Required', 'Please enter your rate and cover note.');
      return;
    }
    dispatch({
      type: 'applyJob',
      jobId: selectedJob.id,
      jobTitle: selectedJob.title,
      proposal: {
        applicant: state.user.displayName,
        headline: state.user.headline,
        bidRate: bidRate.trim(),
        deliveryTime: deliveryTime.trim() || 'Flexible',
        coverNote: coverNote.trim(),
      },
    });
    Alert.alert('Success', 'Proposal submitted successfully! The client will review your application.');
    setShowApplyModal(false);
    setBidRate('');
    setDeliveryTime('');
    setCoverNote('');
  };

  const handlePostJob = () => {
    if (!postTitle.trim() || !postBudget.trim()) {
      Alert.alert('Required', 'Please enter job title and budget.');
      return;
    }
    dispatch({
      type: 'postJob',
      job: {
        title: postTitle.trim(),
        kind: postKind,
        category: postCategory,
        budget: postBudget.trim(),
        deadline: postDeadline.trim() || 'Flexible',
        skills: postSkills.split(',').map((s) => s.trim()).filter(Boolean),
        description: postDesc.trim() || 'Detailed scope discussed during consultation.',
      },
    });
    Alert.alert('Success', 'Job opportunity published to Christian marketplace!');
    setShowPostModal(false);
    setPostTitle('');
    setPostBudget('');
    setPostSkills('');
    setPostDesc('');
  };

  return (
    <Screen
      back
      title="Christian Jobs & Tasks"
      subtitle="Faith-Based Work, Freelance & Ministry Gigs"
      right={
        <Pressable onPress={() => setShowPostModal(true)} style={styles.postNavBtn}>
          <Text style={styles.postNavBtnText}>＋ Post Work</Text>
        </Pressable>
      }
    >
      {/* Search Input */}
      <View style={styles.searchBar}>
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" style={{ marginRight: 8 }}>
          <Path d="M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z" stroke={colors.muted} strokeWidth={1.8} />
        </Svg>
        <TextInput
          placeholder="Search jobs, projects, skills (e.g. React, Video, Yoruba)..."
          placeholderTextColor={colors.faint}
          value={search}
          onChangeText={setSearch}
          style={styles.searchInput}
        />
      </View>

      {/* Filter Tabs */}
      <View style={styles.typeTabs}>
        {[
          { id: 'all', label: 'All Work' },
          { id: 'job', label: 'Jobs & Vacancies' },
          { id: 'task', label: 'Project Tasks' },
          { id: 'proposals', label: `My Proposals (${proposals.length})` },
        ].map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setFilterKind(t.id)}
            style={[styles.typeTab, filterKind === t.id && styles.typeTabActive]}
          >
            <Text style={[styles.typeTabText, filterKind === t.id && { color: colors.gold, fontWeight: '600' }]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Categories Horizontal Scroll */}
      {filterKind !== 'proposals' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              onPress={() => setSelectedCat(cat)}
              style={[styles.catPill, selectedCat === cat && styles.catPillActive]}
            >
              <Text style={[styles.catPillText, selectedCat === cat && { color: colors.fg, fontWeight: '600' }]}>
                {cat}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Proposals View */}
      {filterKind === 'proposals' ? (
        <View style={{ marginTop: 10 }}>
          {proposals.length ? (
            proposals.map((prop) => (
              <View key={prop.id} style={styles.jobCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.jobTitle}>{prop.jobTitle}</Text>
                  <Badge label={prop.status} tint={colors.gold} />
                </View>
                <Text style={styles.jobMeta}>Your Bid: <Text style={{ color: colors.gold, fontWeight: '600' }}>{prop.bidRate}</Text> · Timeline: {prop.deliveryTime}</Text>
                <Text style={styles.jobDesc} numberOfLines={2}>"{prop.coverNote}"</Text>
                <Text style={styles.jobTimeText}>Submitted {prop.time}</Text>
              </View>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Text style={{ color: colors.muted, textAlign: 'center' }}>You haven't submitted any proposals yet. Browse opportunities and submit your pitch!</Text>
            </View>
          )}
        </View>
      ) : (
        /* Jobs List */
        <View style={{ marginTop: 10 }}>
          {filteredJobs.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => {
                setSelectedJob(item);
                setShowApplyModal(true);
              }}
              style={styles.jobCard}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Tag label={item.kind.toUpperCase()} tint={item.kind === 'job' ? colors.forest : colors.teal} />
                    <Text style={styles.categorySubText}>{item.category}</Text>
                  </View>
                  <Text style={styles.jobTitle}>{item.title}</Text>
                </View>
                <View style={styles.budgetPill}>
                  <Text style={styles.budgetText}>{item.budget}</Text>
                </View>
              </View>

              <Text style={styles.jobDesc} numberOfLines={2}>{item.description}</Text>

              {/* Skills Tags */}
              <View style={styles.skillsRow}>
                {item.skills?.map((s, idx) => (
                  <View key={idx} style={styles.skillChip}>
                    <Text style={styles.skillText}>{s}</Text>
                  </View>
                ))}
              </View>

              {/* Footer info: client and proposals */}
              <View style={styles.jobFooter}>
                <Text style={styles.clientText}>
                  👤 {item.client.name} · {item.client.church}
                </Text>
                <Text style={styles.proposalsCountText}>
                  {item.proposalsCount} proposals · {item.deadline}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {/* Apply / Proposal Submission Modal */}
      <Modal visible={showApplyModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.applySheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Submit Proposal</Text>
                <Text style={styles.sheetSubtitle} numberOfLines={1}>{selectedJob?.title}</Text>
              </View>
              <Pressable onPress={() => setShowApplyModal(false)} hitSlop={12}>
                <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{ flex: 1 }}>
              <View style={styles.clientInfoBox}>
                <Text style={styles.clientInfoTitle}>Client: {selectedJob?.client?.name}</Text>
                <Text style={styles.clientInfoSub}>{selectedJob?.category} · Budget: {selectedJob?.budget}</Text>
                <Text style={styles.clientInfoDesc}>{selectedJob?.description}</Text>
              </View>

              <Text style={styles.formLabel}>Your Proposed Rate / Price</Text>
              <TextInput
                placeholder="e.g. $250 or $35/hr"
                placeholderTextColor={colors.faint}
                value={bidRate}
                onChangeText={setBidRate}
                style={styles.formInput}
              />

              <Text style={styles.formLabel}>Estimated Delivery Timeline</Text>
              <TextInput
                placeholder="e.g. 3 business days"
                placeholderTextColor={colors.faint}
                value={deliveryTime}
                onChangeText={setDeliveryTime}
                style={styles.formInput}
              />

              <Text style={styles.formLabel}>Cover Letter & Ministry Portfolio</Text>
              <TextInput
                placeholder="Explain why you are well suited for this project..."
                placeholderTextColor={colors.faint}
                value={coverNote}
                onChangeText={setCoverNote}
                multiline
                style={[styles.formInput, { minHeight: 90 }]}
              />

              <Button
                label="Submit Proposal to Client"
                onPress={handleApply}
                style={{ marginTop: 20 }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Post Job / Task Modal */}
      <Modal visible={showPostModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.applySheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Post Christian Job or Task</Text>
                <Text style={styles.sheetSubtitle}>Hire verified believers for your projects</Text>
              </View>
              <Pressable onPress={() => setShowPostModal(false)} hitSlop={12}>
                <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{ flex: 1 }}>
              <Text style={styles.formLabel}>Type of Listing</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginVertical: 6 }}>
                <Pressable
                  onPress={() => setPostKind('task')}
                  style={[styles.kindSelectBtn, postKind === 'task' && styles.kindSelectBtnActive]}
                >
                  <Text style={[styles.kindSelectText, postKind === 'task' && { color: colors.gold }]}>Fixed Task / Project</Text>
                </Pressable>
                <Pressable
                  onPress={() => setPostKind('job')}
                  style={[styles.kindSelectBtn, postKind === 'job' && styles.kindSelectBtnActive]}
                >
                  <Text style={[styles.kindSelectText, postKind === 'job' && { color: colors.gold }]}>Job Vacancy</Text>
                </Pressable>
              </View>

              <Text style={styles.formLabel}>Job / Task Title</Text>
              <TextInput
                placeholder="e.g. Build a church website or Edit sermon videos"
                placeholderTextColor={colors.faint}
                value={postTitle}
                onChangeText={setPostTitle}
                style={styles.formInput}
              />

              <Text style={styles.formLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginVertical: 6 }}>
                {CATEGORIES.slice(1).map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setPostCategory(c)}
                    style={[styles.catPill, postCategory === c && styles.catPillActive]}
                  >
                    <Text style={[styles.catPillText, postCategory === c && { color: colors.fg, fontWeight: '600' }]}>{c}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={styles.formLabel}>Budget & Payment Arrangement</Text>
              <TextInput
                placeholder="e.g. $300 Fixed or $25/hr"
                placeholderTextColor={colors.faint}
                value={postBudget}
                onChangeText={setPostBudget}
                style={styles.formInput}
              />

              <Text style={styles.formLabel}>Deadline / Timeframe</Text>
              <TextInput
                placeholder="e.g. 7 Days or Full-time"
                placeholderTextColor={colors.faint}
                value={postDeadline}
                onChangeText={setPostDeadline}
                style={styles.formInput}
              />

              <Text style={styles.formLabel}>Required Skills (comma-separated)</Text>
              <TextInput
                placeholder="e.g. React Native, Video Editing, Yoruba"
                placeholderTextColor={colors.faint}
                value={postSkills}
                onChangeText={setPostSkills}
                style={styles.formInput}
              />

              <Text style={styles.formLabel}>Detailed Project Scope</Text>
              <TextInput
                placeholder="Describe deliverables, expectations, and church background..."
                placeholderTextColor={colors.faint}
                value={postDesc}
                onChangeText={setPostDesc}
                multiline
                style={[styles.formInput, { minHeight: 80 }]}
              />

              <Button
                label="Publish Listing"
                onPress={handlePostJob}
                style={{ marginTop: 20 }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  postNavBtn: {
    backgroundColor: colors.primaryBg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  postNavBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '600',
    color: colors.primaryFg,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.fg,
  },
  typeTabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    marginVertical: 4,
  },
  typeTab: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  typeTabActive: {
    backgroundColor: colors.raised,
  },
  typeTabText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  catPill: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  catPillActive: {
    backgroundColor: colors.raised,
    borderColor: colors.gold,
  },
  catPillText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  jobCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  categorySubText: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.muted,
  },
  jobTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '600',
    color: colors.fg,
    lineHeight: 19,
  },
  budgetPill: {
    backgroundColor: colors.raised,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  budgetText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '700',
    color: colors.gold,
  },
  jobDesc: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.passage,
    lineHeight: 17,
    marginTop: 6,
  },
  skillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 8,
  },
  skillChip: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  skillText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.sage,
  },
  jobFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  clientText: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.muted,
  },
  proposalsCountText: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.faint,
  },
  jobMeta: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.muted,
    marginVertical: 4,
  },
  jobTimeText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.faint,
    marginTop: 4,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  applySheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    height: '75%',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    paddingBottom: 10,
  },
  sheetTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    fontWeight: '600',
    color: colors.fg,
  },
  sheetSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  clientInfoBox: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  clientInfoTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '600',
    color: colors.fg,
  },
  clientInfoSub: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gold,
    marginTop: 2,
  },
  clientInfoDesc: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.passage,
    marginTop: 4,
  },
  formLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 10,
    marginBottom: 4,
  },
  formInput: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.fg,
  },
  kindSelectBtn: {
    flex: 1,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  kindSelectBtnActive: {
    borderColor: colors.gold,
    backgroundColor: colors.surface,
  },
  kindSelectText: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.muted,
  },
});
