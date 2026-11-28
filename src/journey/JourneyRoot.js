// MY SCRIPTURE JOURNEY: mounted once inside the app's providers (App.js). Keeps the Scripture reminders planned for the
// next days, sends queued reading events when the app opens, and shows achievement celebrations.
import React from 'react';
import { useJourneyGoal } from '../api/journey';
import { useJourneyNotifications } from './schedule';
import { useJourneyFlush } from './tracker';
import { useApi } from '../api/auth';
import JourneyCelebrationHost from '../components/journey/Celebration';
import { useStore } from '../store';

export default function JourneyRoot() {
  const api = useApi();
  const { state } = useStore();
  const goal = useJourneyGoal();
  useJourneyFlush(api);
  useJourneyNotifications(goal.data && goal.data.goal ? goal.data.goal : null, state.scripturePop);
  return <JourneyCelebrationHost />;
}
