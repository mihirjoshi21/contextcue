import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ASK_CHIPS, PRODUCT_NAME } from './constants.js';
import { formatTimestamp, spoilerBadgeText } from './format.js';
import { theme } from './theme.js';
import type { ContextCue } from './useContextCue.js';

// ---------- focusable button (Pressable + focus state; no platform-specific imports) ----------

interface FocusButtonProps {
  label: string;
  onPress: () => void;
  preferred?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  children?: ReactNode;
}

function FocusButton({ label, onPress, preferred, style, accessibilityLabel, children }: FocusButtonProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      focusable
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[s.button, focused && s.buttonFocused, style]}
    >
      {children ?? <Text style={[s.buttonText, focused && s.buttonTextFocused]}>{label}</Text>}
    </Pressable>
  );
}

// ---------- Ask button ----------

export interface ContextCueAskButtonProps {
  onPress: () => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
  hasTVPreferredFocus?: boolean;
}

/** Drop this into your player controls. */
export function ContextCueAskButton({ onPress, label = `✨ Ask ${PRODUCT_NAME}`, style, hasTVPreferredFocus }: ContextCueAskButtonProps) {
  return <FocusButton label={label} onPress={onPress} style={style} preferred={hasTVPreferredFocus} />;
}

// ---------- Overlay ----------

export interface ContextCueOverlayProps {
  /** The object returned by useContextCue. */
  controller: ContextCue;
  /** Seek the host player to this position in ms (already minus 2s lead-in). */
  onSeek: (ms: number) => void;
  /** Pause the host player (panel opened while playing). */
  onRequestPause?: () => void;
  /** Resume the host player (panel closed / citation selected). */
  onRequestResume?: () => void;
  /** Render a QR code for the companion URL, e.g. react-native-qrcode-svg. Optional; the code and URL are always shown. */
  renderQr?: (url: string, size: number) => ReactNode;
  /**
   * Back-key subscription. Default: React Native's BackHandler (Fire OS and Vega map the remote Back
   * key to it). Provide your own if your platform exposes Back differently (e.g. a TV event handler).
   * Return a function that unsubscribes. The handler returns true when it consumed the key.
   */
  subscribeBack?: (handler: () => boolean) => () => void;
  style?: StyleProp<ViewStyle>;
}

const defaultSubscribeBack: NonNullable<ContextCueOverlayProps['subscribeBack']> = (handler) => {
  const sub = BackHandler.addEventListener('hardwareBackPress', handler);
  return () => sub.remove();
};

export function ContextCueOverlay(props: ContextCueOverlayProps) {
  const { controller: cue, onSeek, onRequestPause, onRequestResume, renderQr, subscribeBack = defaultSubscribeBack, style } = props;
  const { state, controller: engine } = cue;

  useEffect(() => {
    engine.setHandlers({ onSeek, onRequestPause, onRequestResume });
  }, [engine, onSeek, onRequestPause, onRequestResume]);

  useEffect(() => {
    if (!state.open) return undefined;
    return subscribeBack(() => engine.back());
  }, [state.open, engine, subscribeBack]);

  if (!state.open) return null;

  return (
    <View style={[s.scrim, style]} pointerEvents="box-none">
      <View style={s.panel} accessibilityViewIsModal>
        <View style={s.badge}>
          <Text style={s.badgeText}>{spoilerBadgeText(state.positionMs)}</Text>
        </View>
        <View style={s.gap20} />
        {state.view === 'phone' ? (
          <PhoneView code={state.sessionCode} url={state.companionUrl} renderQr={renderQr} onBack={engine.back} />
        ) : state.view === 'typing' ? (
          <TypingView onSubmit={engine.askQuestion} onCancel={engine.back} />
        ) : state.ask.status === 'idle' ? (
          <ChipsView engine={engine} />
        ) : state.ask.status === 'loading' ? (
          <LoadingView label={state.ask.query.label} />
        ) : state.ask.status === 'loaded' ? (
          <AnswerView cue={cue} />
        ) : (
          <ErrorView message={state.ask.message} onRetry={engine.retry} onBack={engine.back} />
        )}
      </View>
    </View>
  );
}

function ChipsView({ engine }: { engine: ContextCue['controller'] }) {
  return (
    <View>
      <Text style={s.heading}>{`Ask ${PRODUCT_NAME}`}</Text>
      <View style={s.gap20} />
      {ASK_CHIPS.map((c, i) => (
        <FocusButton key={c.id} label={c.label} preferred={i === 0} onPress={() => engine.askChip(c)} style={s.rowGap} />
      ))}
      <FocusButton label={'\u2328\uFE0F Type a question'} onPress={engine.showTyping} style={s.rowGap} />
      <FocusButton label="Ask from your phone" onPress={engine.showPhone} style={s.rowGap} />
    </View>
  );
}

function LoadingView({ label }: { label: string }) {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View>
      <Text style={s.heading} numberOfLines={2}>{label}</Text>
      <View style={s.gap20} />
      {[1, 0.92, 0.7].map((w, i) => (
        <Animated.View key={i} style={[s.skeleton, { width: `${w * 100}%`, opacity: pulse }]} />
      ))}
      <View style={s.gap20} />
      <Text style={s.dim}>Reading only what you've already seen…</Text>
    </View>
  );
}

function AnswerView({ cue }: { cue: ContextCue }) {
  const { state, controller: engine } = cue;
  if (state.ask.status !== 'loaded') return null;
  const { query, response } = state.ask;
  return (
    <View style={s.flex}>
      {query.source === 'phone' ? (
        <>
          <Text style={s.primaryLabel}>{'\u{1F4F1} Asked from phone'}</Text>
          <Text style={s.dim} numberOfLines={2}>{query.question}</Text>
        </>
      ) : (
        <Text style={s.primaryLabel} numberOfLines={2}>{query.label}</Text>
      )}
      <View style={s.gap10} />
      <ScrollView style={s.flex} contentContainerStyle={s.scrollContent}>
        <Text style={s.answer}>{response.answer}</Text>
        {response.citations.length > 0 && <Text style={[s.dim, s.rowGap]}>Replay that moment</Text>}
        {response.citations.map((c, i) => (
          <FocusButton
            key={`${c.startMs}-${i}`}
            label={`[${formatTimestamp(c.startMs)}] ${c.text}`}
            accessibilityLabel={`Replay from ${formatTimestamp(c.startMs)}: ${c.text}`}
            onPress={() => engine.selectCitation(c)}
            style={s.rowGap}
          />
        ))}
      </ScrollView>
      <View style={s.gap10} />
      {state.canReadAloud && (
        <FocusButton
          label={state.ttsPlaying ? 'Stop' : '\u{1F50A} Read aloud'}
          preferred
          onPress={state.ttsPlaying ? engine.stopReadAloud : () => void engine.readAloud()}
          style={s.rowGap}
        />
      )}
      <FocusButton label="Ask something else" preferred={!state.canReadAloud} onPress={engine.askAnother} />
    </View>
  );
}

function ErrorView({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => boolean }) {
  return (
    <View>
      <Text style={s.heading}>Couldn't get an answer</Text>
      <View style={s.gap10} />
      <Text style={s.dim}>{message}</Text>
      <View style={s.gap20} />
      <FocusButton label="Retry" preferred onPress={onRetry} style={s.rowGap} />
      <FocusButton label="Back" onPress={() => void onBack()} />
    </View>
  );
}

function PhoneView({ code, url, renderQr, onBack }: { code: string | null; url: string | null; renderQr?: ContextCueOverlayProps['renderQr']; onBack: () => boolean }) {
  return (
    <View>
      <Text style={s.heading}>Ask from your phone</Text>
      <View style={s.gap20} />
      {!code || !url ? (
        <Text style={s.dim}>Still connecting to the backend session…</Text>
      ) : (
        <>
          {renderQr && <View style={s.qr}>{renderQr(url, 220)}</View>}
          <Text style={s.dim}>Session code</Text>
          <Text style={s.hero}>{code}</Text>
          <Text style={s.dim}>{url}</Text>
        </>
      )}
      <View style={s.gap20} />
      <FocusButton label="Back" preferred onPress={() => void onBack()} />
    </View>
  );
}

function TypingView({ onSubmit, onCancel }: { onSubmit: (q: string) => void; onCancel: () => boolean }) {
  const [text, setText] = useState('');
  return (
    <View>
      <Text style={s.heading}>Type a question</Text>
      <View style={s.gap10} />
      <TextInput
        autoFocus
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => onSubmit(text)}
        placeholder="Who is the man in the hat?"
        placeholderTextColor={theme.textDim}
        returnKeyType="send"
        maxLength={500}
        style={s.input}
      />
      <View style={s.gap20} />
      <FocusButton label="Ask" onPress={() => onSubmit(text)} style={s.rowGap} />
      <FocusButton label="Cancel" onPress={() => void onCancel()} />
    </View>
  );
}

const s = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.scrim, zIndex: 1000, elevation: 1000 },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: theme.panelWidthPct,
    minWidth: 520,
    backgroundColor: theme.surface,
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
    paddingHorizontal: 28,
    paddingTop: theme.safeV + 8,
    paddingBottom: theme.safeV + 8,
  },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 12 },
  badge: { alignSelf: 'flex-start', backgroundColor: theme.primaryTint, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  badgeText: { color: theme.primary, fontSize: theme.font.caption, fontWeight: '600' },
  heading: { color: theme.text, fontSize: theme.font.heading, fontWeight: '700' },
  primaryLabel: { color: theme.primary, fontSize: theme.font.label, fontWeight: '600' },
  answer: { color: theme.text, fontSize: theme.font.answer, lineHeight: 42 },
  dim: { color: theme.textDim, fontSize: theme.font.body },
  hero: { color: theme.primary, fontSize: theme.font.hero, fontWeight: '800', letterSpacing: 6 },
  button: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'transparent',
    paddingHorizontal: 18,
    paddingVertical: 14,
    minHeight: 64,
    justifyContent: 'center',
  },
  buttonFocused: { borderColor: theme.primary, backgroundColor: theme.focusFill },
  buttonText: { color: theme.text, fontSize: theme.font.body },
  buttonTextFocused: { fontWeight: '700' },
  rowGap: { marginBottom: 14 },
  gap10: { height: 10 },
  gap20: { height: 20 },
  skeleton: { height: 26, borderRadius: 8, backgroundColor: theme.surfaceAlt, marginBottom: 14 },
  qr: { alignSelf: 'flex-start', backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 20 },
  input: {
    color: theme.text,
    fontSize: theme.font.body,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
