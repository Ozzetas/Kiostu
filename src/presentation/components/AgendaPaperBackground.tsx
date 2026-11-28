import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Colors } from '../theme/tokens';

const RULED_LINE_SPACING_PX = 32;

interface AgendaPaperBackgroundProps {
  readonly children: React.ReactNode;
}

export function AgendaPaperBackground({ children }: AgendaPaperBackgroundProps) {
  const { height } = useWindowDimensions();

  // Calculo la cantidad exacta de renglones para adaptarse a iPhone 14 Pro Max y modelos más altos.
  const lineIndices = useMemo(() => {
    const count = Math.ceil(height / RULED_LINE_SPACING_PX) + 4;
    return Array.from({ length: count }, (_, idx) => idx);
  }, [height]);

  return (
    <View style={styles.container}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {lineIndices.map((idx) => (
          <View
            key={idx}
            style={[styles.horizontalRule, { top: idx * RULED_LINE_SPACING_PX }]}
          />
        ))}
        <View style={styles.marginLine} />
      </View>
      <View style={styles.contentLayer}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.paperBackground,
  },
  horizontalRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.paperLine,
    opacity: 0.85,
  },
  marginLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 26,
    width: 1,
    backgroundColor: Colors.paperMarginLine,
    opacity: 0.75,
  },
  contentLayer: {
    flex: 1,
  },
});