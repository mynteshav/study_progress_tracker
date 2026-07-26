import { useSyncExternalStore } from 'react';
import { TimerService, TimerState } from '../services/TimerService';

export function useTimerState(): TimerState {
  return useSyncExternalStore(
    TimerService.subscribe,
    TimerService.getState
  );
}
