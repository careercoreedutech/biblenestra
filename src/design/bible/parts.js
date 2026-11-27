// Shared layout for the Bible study screens (reader tools, library, concordance, exegesis, factbook).
// The design's page header + ivory page, so every study screen opens the same way.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { k, PageHeader } from '../sanctuary';
import { useNav } from '../../navigation';

export function KitScreen({ title, subtitle, action, scroll = true, children }) {
  const nav = useNav();
  const head = <PageHeader title={title} subtitle={subtitle} back onBack={() => nav.pop()} action={action === undefined ? null : action} />;
  if (!scroll) {
    return (
      <View style={k.screen}>
        {head}
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    );
  }
  return (
    <View style={k.screen}>
      {head}
      <ScrollView contentContainerStyle={[k.scroll, { paddingBottom: 48 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}
