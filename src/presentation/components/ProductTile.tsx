import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPriceLabel, formatStockQty } from '../../core/utils/units';
import { Product } from '../../domain/entities/types';
import { Colors, Radius, Shadows, Spacing, Typography } from '../theme/tokens';

interface ProductTileProps {
  readonly product: Product;
  readonly resolvedImageUri: string | null;
  readonly onPress: (product: Product) => void;
  readonly onEditPress: (product: Product) => void;
}

export function ProductTile({
  product,
  resolvedImageUri,
  onPress,
  onEditPress,
}: ProductTileProps) {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [resolvedImageUri]);

  const isLowStock = product.stockQty <= product.minStockAlert;
  const isOutOfStock = product.stockQty === 0;
  const showImage = resolvedImageUri !== null && !imageError;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => onPress(product)}
      onLongPress={() => onEditPress(product)}
    >
      <View style={styles.mediaBox}>
        {showImage ? (
          <Image
            source={{ uri: resolvedImageUri }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons
              name={product.unitType === 'GRAM' ? 'scale-outline' : 'cube-outline'}
              size={34}
              color={Colors.primary}
            />
          </View>
        )}

        <View
          style={[
            styles.unitPill,
            product.unitType === 'GRAM' ? styles.unitPillGram : styles.unitPillUnit,
          ]}
        >
          <Text style={styles.unitPillText}>
            {product.unitType === 'GRAM' ? 'PESO' : 'UNID.'}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]}
          onPress={(event) => {
            event.stopPropagation();
            onEditPress(product);
          }}
          hitSlop={8}
        >
          <Ionicons name="pencil" size={14} color={Colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.infoBlock}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>

        <Text style={styles.price} numberOfLines={1}>
          {formatPriceLabel(product.unitPriceCents, product.unitType, product.priceBaseQty)}
        </Text>

        <View
          style={[
            styles.stockBadge,
            isOutOfStock
              ? styles.stockBadgeDanger
              : isLowStock
                ? styles.stockBadgeWarning
                : styles.stockBadgeOk,
          ]}
        >
          <View
            style={[
              styles.stockDot,
              isOutOfStock
                ? styles.dotDanger
                : isLowStock
                  ? styles.dotWarning
                  : styles.dotOk,
            ]}
          />
          <Text
            style={[
              styles.stockText,
              isOutOfStock
                ? styles.stockTextDanger
                : isLowStock
                  ? styles.stockTextWarning
                  : styles.stockTextOk,
            ]}
            numberOfLines={1}
          >
            {isOutOfStock ? 'Sin stock' : formatStockQty(product.stockQty, product.unitType)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadows.card,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    borderColor: Colors.primaryLight,
  },
  mediaBox: {
    width: '100%',
    aspectRatio: 1.15,
    backgroundColor: Colors.surfaceElevated,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primarySoft,
  },
  unitPill: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  unitPillGram: {
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
  },
  unitPillUnit: {
    backgroundColor: 'rgba(79, 70, 229, 0.88)',
  },
  unitPillText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  editButton: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: 30,
    height: 30,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  editButtonPressed: {
    backgroundColor: Colors.primarySoft,
  },
  infoBlock: {
    padding: Spacing.md,
    gap: 6,
  },
  name: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.textPrimary,
    lineHeight: 20,
    minHeight: 40,
  },
  price: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.primary,
  },
  stockBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
    marginTop: 2,
  },
  stockBadgeOk: {
    backgroundColor: Colors.successSoft,
  },
  stockBadgeWarning: {
    backgroundColor: Colors.warningSoft,
  },
  stockBadgeDanger: {
    backgroundColor: Colors.dangerSoft,
  },
  stockDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
  },
  dotOk: {
    backgroundColor: Colors.success,
  },
  dotWarning: {
    backgroundColor: Colors.warning,
  },
  dotDanger: {
    backgroundColor: Colors.danger,
  },
  stockText: {
    fontSize: Typography.micro,
    fontWeight: '700',
  },
  stockTextOk: {
    color: Colors.success,
  },
  stockTextWarning: {
    color: Colors.warning,
  },
  stockTextDanger: {
    color: Colors.danger,
  },
});