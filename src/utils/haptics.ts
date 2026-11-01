/**
 * Subtle tactile haptic feedback utility for iOS/mobile web
 * Gracefully degrades if vibration is unsupported or disabled.
 */
export function triggerHaptic(type: 'light' | 'selection' | 'success' | 'medium' = 'light') {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      if (type === 'light') {
        navigator.vibrate(8);
      } else if (type === 'selection') {
        navigator.vibrate(12);
      } else if (type === 'success') {
        navigator.vibrate([10, 30, 15]);
      } else if (type === 'medium') {
        navigator.vibrate(22);
      }
    } catch {
      // Ignore vibration errors silently
    }
  }
}
