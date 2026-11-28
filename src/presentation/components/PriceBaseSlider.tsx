import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Shadows, Spacing, Typography } from '../theme/tokens';

export type GramPriceBaseOption = 1 | 100 | 1000;

interface StopDefinition {
  readonly value: GramPriceBaseOption;
  readonly label: string;
  readonly sublabel: string;
}

const GRAM_STOPS: readonly StopDefinition[] = [
  { value: 1, label: '1 g', sublabel: 'Por gramo' },
  { value: 100, label: '100 g', sublabel: 'Cada 100g' },
  { value: 1000, label: '1 kg', sublabel: '1000 g' },
];

const THUMB_SIZE = 28;

interface PriceBaseSliderProps {
  readonly value: number;
  readonly onChange: (nextBaseQty: GramPriceBaseOption) => void;
}

export function PriceBaseSlider({ value, onChange }: PriceBaseSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const activeIndex = useMemo(() => {
    const found = GRAM_STOPS.findIndex((stop) => stop.value === value);
    return found >= 0 ? found : 2;
  }, [value]);

  const selectByLocationX = useCallback((locationX: number): void => {
    const width = trackWidthRef.current;
    if (width <= 0) {
      return;
    }
    const clampedRatio = Math.max(0, Math.min(1, locationX / width));
    const snappedIndex = Math.round(clampedRatio * (GRAM_STOPS.length - 1));
    const stop = GRAM_STOPS[snappedIndex];
    if (stop !== undefined) {
      onChangeRef.current(stop.value);
    }
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        // Capturo únicamente gestos horizontales para no bloquear el scroll vertical del formulario.
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          selectByLocationX(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event) => {
          selectByLocationX(event.nativeEvent.locationX);
        },
      }),
    [selectByLocationX]
  );

  const handleTrackLayout = (event: LayoutChangeEvent): void => {
    const nextWidth = event.nativeEvent.layout.width;
    trackWidthRef.current = nextWidth;
    setTrackWidth(nextWidth);
  };

  const progressRatio = activeIndex / (GRAM_STOPS.length - 1);
  const usableTravel = Math.max(0, trackWidth - THUMB_SIZE);
  const thumbLeft = progressRatio * usableTravel;

  return (
    <View style={styles.wrapper}>
      <View style={styles.trackTouchArea} onLayout={handleTrackLayout} {...panResponder.panHandlers}>
        <View style={styles.trackRail}>
          <View style={[styles.trackFill, { width: `${progressRatio * 100}%` }]} />
        </View>

        <View style={styles.dotsOverlay} pointerEvents="none">
          {GRAM_STOPS.map((stop, idx) => {
            const passed = idx <= activeIndex;
            return (
              <View key={stop.value} style={[styles.stopDot, passed && styles.stopDotPassed]} />
            );
          })}
        </View>

        {trackWidth > 0 && (
          <View style={[styles.thumb, { left: thumbLeft }]} pointerEvents="none">
            <View style={styles.thumbCore} />
          </View>
        )}
      </View>

      <View style={styles.labelsRow}>
        {GRAM_STOPS.map((stop, idx) => {
          const isSelected = idx === activeIndex;
          return (
            <Pressable
              key={stop.value}
              style={[
                styles.labelTouch,
                idx === 0 && styles.alignLeft,
                idx === 1 && styles.alignCenter,
                idx === 2 && styles.alignRight,
              ]}
              onPress={() => onChange(stop.value)}
              hitSlop={8}
            >
              <Text style={[styles.stopLabel, isSelected && styles.stopLabelSelected]}>
                {stop.label}
              </Text>
              <Text style={styles.stopSublabel}>{stop.sublabel}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    gap: Spacing.xs,
  },
  trackTouchArea: {
    height: 40,
    justifyContent: 'center',
    position: 'relative',
  },
  trackRail: {
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
  },
  dotsOverlay: {
    position: 'absolute',
    left: 6,
    right: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.border,
  },
  stopDotPassed: {
    backgroundColor: Colors.primaryLight,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 2.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.card,
  },
  thumbCore: {
    width: 10,
    height: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  labelTouch: {
    flex: 1,
  },
  alignLeft: {
    alignItems: 'flex-start',
  },
  alignCenter: {
    alignItems: 'center',
  },
  alignRight: {
    alignItems: 'flex-end',
  },
  stopLabel: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  stopLabelSelected: {
    color: Colors.primary,
    fontWeight: '800',
  },
  stopSublabel: {
    fontSize: 10,
    color: Colors.textMuted,
  },
});